/**
 * Document-wide highlight engine for the header's "search-and-highlight" box.
 *
 * Why this exists
 * ----------------
 * The previous approach injected `<mark>` tags into the Markdown preview HTML,
 * which only worked for one place. Quill-rendered memos, the tree, the task
 * detail pane, and other surfaces never got highlights. This module uses the
 * CSS Custom Highlight API (`CSS.highlights` + `::highlight()`) so a single
 * pass over the DOM can paint matches on EVERY rendered text node — including
 * Quill content, tree row names, status labels, memo preview, etc.
 *
 * We also expose a navigation API: `prev()` / `next()` cycle through matches,
 * `getMatchCount()` / `getCurrentIndex()` report state, and `currentChanged`
 * notifies subscribers whenever the active match moves so the Header can
 * scroll-into-view + re-paint the "current" highlight.
 */

import { writable, type Readable } from "svelte/store";

/** Public name used by `::highlight()` in CSS. */
const ALL_HIGHLIGHT = "page-search";
const CURRENT_HIGHLIGHT = "page-search-current";

/**
 * Tags / classes whose text nodes should NOT participate in matching.
 * - Form controls: input.value is rendered through UA shadow DOM but some
 *   AT trees still expose it; either way the user never wants their own
 *   typed query to "match itself", so we exclude all editable text fields.
 * - `.ql-*`: Quill maintains hidden clipboards/tooltips containing copies
 *   of the document. Highlighting them ranges into invisible nodes.
 * - `.cm-editor`: the Markdown source editor. CodeMirror only keeps the
 *   visible lines in the DOM, so a page-wide count taken from it would be
 *   partial, and in split mode it would count the same text twice (editor +
 *   preview). The editor has its own search (Ctrl+F while typing in it).
 * - `.copy-btn`: the code block "コピー" button is UI, not memo text.
 * - `[data-page-search-skip]`: explicit opt-out for shell chrome (the
 *   header search box, the toolbar SearchBox, tooltips, etc.).
 */
const SKIP_SELECTOR =
  "script, style, noscript, template, input, textarea, select, " +
  ".ql-toolbar, .ql-tooltip, .ql-clipboard, .cm-editor, .copy-btn, " +
  "[data-page-search-skip], [data-page-search-skip] *";

/** How long after the last query change before we re-scan. */
const SCAN_DEBOUNCE_MS = 120;

interface ScanState {
  query: string;
  matches: Range[];
  /** Parallel to `matches`: where the match sits, to find it again after a re-render. */
  signatures: string[];
  index: number; // -1 when no matches
}

interface ScanResult {
  matches: Range[];
  signatures: string[];
}

const state: ScanState = { query: "", matches: [], signatures: [], index: -1 };

const matchCountStore = writable<number>(0);
const currentIndexStore = writable<number>(-1);

/** Public read-only stores for the Header UI. */
export const pageSearchMatchCount: Readable<number> = { subscribe: matchCountStore.subscribe };
export const pageSearchCurrentIndex: Readable<number> = {
  subscribe: currentIndexStore.subscribe,
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does this browser support the CSS Custom Highlight API? We treat the
 * existence of `CSS.highlights` + the global `Highlight` constructor as
 * the canonical check.
 */
function isSupported(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cssAny = (window as any).CSS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const HighlightCtor = (window as any).Highlight;
  return Boolean(cssAny?.highlights && typeof HighlightCtor === "function");
}

function clearHighlights() {
  if (!isSupported()) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const highlights = (window as any).CSS.highlights as Map<string, unknown>;
  highlights.delete(ALL_HIGHLIGHT);
  highlights.delete(CURRENT_HIGHLIGHT);
}

function applyHighlights(matches: Range[], currentIndex: number) {
  if (!isSupported()) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const HighlightCtor = (window as any).Highlight;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const highlights = (window as any).CSS.highlights as Map<string, unknown>;

  highlights.delete(ALL_HIGHLIGHT);
  highlights.delete(CURRENT_HIGHLIGHT);

  if (matches.length === 0) return;

  const all = new HighlightCtor(...matches);
  highlights.set(ALL_HIGHLIGHT, all);

  if (currentIndex >= 0 && currentIndex < matches.length) {
    const current = new HighlightCtor(matches[currentIndex]);
    highlights.set(CURRENT_HIGHLIGHT, current);
  }
}

function shouldSkipNode(node: Node): boolean {
  const parent = (node as Text).parentElement;
  if (!parent) return true;
  if (parent.closest(SKIP_SELECTOR)) return true;

  // Collapsed / clipped / off-screen content shouldn't be searchable.
  // We do a layout-based check first (zero-sized client rect is the most
  // reliable visibility signal — covers display:none, position:absolute
  // with width:0, collapsed SplitPanes, hidden tree branches, etc.) and
  // fall back to a computed-style check for the trickier visibility cases
  // (visibility:hidden, opacity:0 isn't excluded because users still
  // "see" the text outline).
  const rect = parent.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return true;

  const cs = window.getComputedStyle(parent);
  if (cs.display === "none" || cs.visibility === "hidden") return true;

  return false;
}

/**
 * The element whose text flows as one run: the nearest ancestor that is not
 * an inline box. Text nodes under the same block are matched as one string, so
 * a query can span `<strong>`, `<code>`, `<a>` and other inline markup
 * ("bold text" in `**bold** text`).
 */
function blockOf(el: Element, cache: Map<Element, Element>): Element {
  const cached = cache.get(el);
  if (cached) return cached;
  let block: Element = el;
  const display = window.getComputedStyle(el).display;
  if ((display === "inline" || display === "contents") && el.parentElement) {
    block = blockOf(el.parentElement, cache);
  }
  cache.set(el, block);
  return block;
}

interface TextRun {
  nodes: Text[];
  text: string;
}

function collectRuns(root: Node): TextRun[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      shouldSkipNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  } as NodeFilter);

  const blocks = new Map<Element, Element>();
  const runs: TextRun[] = [];
  let current: { block: Element; run: TextRun } | null = null;

  let textNode = walker.nextNode() as Text | null;
  while (textNode) {
    const text = textNode.nodeValue ?? "";
    const parent = textNode.parentElement;
    if (text.length > 0 && parent) {
      const block = blockOf(parent, blocks);
      if (!current || current.block !== block) {
        current = { block, run: { nodes: [], text: "" } };
        runs.push(current.run);
      }
      current.run.nodes.push(textNode);
      current.run.text += text;
    }
    textNode = walker.nextNode() as Text | null;
  }
  return runs;
}

/** Maps an offset in a run's joined text back to a (text node, offset) pair. */
function locate(run: TextRun, offset: number, preferEnd: boolean): [Text, number] | null {
  let start = 0;
  for (const node of run.nodes) {
    const end = start + (node.nodeValue ?? "").length;
    if (offset < end || (preferEnd && offset === end)) return [node, offset - start];
    start = end;
  }
  return null;
}

/**
 * Walk every visible text run under the body and collect Ranges for matches of
 * `query` (case-insensitive). We do NOT modify the DOM — Ranges sit alongside it.
 */
function scanForMatches(query: string): ScanResult {
  const result: ScanResult = { matches: [], signatures: [] };
  if (!query) return result;
  if (typeof document === "undefined") return result;

  const regex = new RegExp(escapeRegex(query), "gi");
  const root = document.body;
  if (!root) return result;

  const seen = new Map<string, number>();
  for (const run of collectRuns(root)) {
    const text = run.text;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      const from = locate(run, m.index, false);
      const to = locate(run, m.index + m[0].length, true);
      if (!from || !to) continue;
      try {
        const range = new Range();
        range.setStart(from[0], from[1]);
        range.setEnd(to[0], to[1]);
        result.matches.push(range);
        // 文脈 + 同じ文脈の何番目か。DOM が作り直されても同じ一致を見つけ直せる。
        const context = `${m.index}:${text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24)}`;
        const nth = seen.get(context) ?? 0;
        seen.set(context, nth + 1);
        result.signatures.push(`${context}#${nth}`);
      } catch {
        // Range creation can throw if the text node was reparented mid-walk.
        // We just skip those.
      }
    }
  }

  return result;
}

function scrollCurrentIntoView() {
  if (state.index < 0 || state.index >= state.matches.length) return;
  const range = state.matches[state.index];
  // Use the start container's parent element as the scroll anchor — Range
  // itself doesn't expose scrollIntoView.
  const node = range.startContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
}

function publish() {
  matchCountStore.set(state.matches.length);
  currentIndexStore.set(state.index);
}

let scanTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Trigger a debounced rescan for the given query string.
 * If `query` is empty, all highlights are cleared.
 */
export function setQuery(query: string) {
  state.query = query;
  if (scanTimer !== null) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  scanTimer = setTimeout(() => {
    scanTimer = null;
    if (!state.query) {
      state.matches = [];
      state.signatures = [];
      state.index = -1;
      clearHighlights();
      publish();
      return;
    }
    const { matches, signatures } = scanForMatches(state.query);
    state.matches = matches;
    state.signatures = signatures;
    state.index = matches.length > 0 ? 0 : -1;
    applyHighlights(matches, state.index);
    publish();
    if (state.index >= 0) scrollCurrentIntoView();
  }, SCAN_DEBOUNCE_MS);
}

/**
 * Move to the next match, wrapping around. No-op if there are no matches.
 */
export function next() {
  if (state.matches.length === 0) return;
  state.index = (state.index + 1) % state.matches.length;
  applyHighlights(state.matches, state.index);
  publish();
  scrollCurrentIntoView();
}

/**
 * Move to the previous match, wrapping around. No-op if there are no matches.
 */
export function prev() {
  if (state.matches.length === 0) return;
  state.index = (state.index - 1 + state.matches.length) % state.matches.length;
  applyHighlights(state.matches, state.index);
  publish();
  scrollCurrentIntoView();
}

/**
 * Force an immediate rescan using the current query. The Header / Tree / Memo
 * call this after their content updates so newly rendered text is highlighted.
 */
export function rescan() {
  if (scanTimer !== null) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  if (!state.query) {
    state.matches = [];
    state.signatures = [];
    state.index = -1;
    clearHighlights();
    publish();
    return;
  }
  const previous = state.index >= 0 ? state.matches[state.index] : undefined;
  const previousSignature = state.index >= 0 ? state.signatures[state.index] : undefined;
  const { matches, signatures } = scanForMatches(state.query);
  state.matches = matches;
  state.signatures = signatures;
  // 番号ではなく「同じ文字位置の一致」を追う。ツリーは見えている行の
  // 周りしか描かないので、スクロールで上の一致が消えると番号がずれ、
  // 次へ進んだときに別の一致へ飛んでしまう。
  let sameMatch = previous
    ? matches.findIndex(
        (range) =>
          range.startContainer === previous.startContainer &&
          range.startOffset === previous.startOffset
      )
    : -1;
  // メモのプレビューは再描画のたびに DOM ごと作り直される。ノードでは
  // 見つからないので、周辺の文字列で同じ一致を探し直す（先頭へ戻さない）。
  if (sameMatch < 0 && previousSignature) sameMatch = signatures.indexOf(previousSignature);
  if (matches.length === 0) {
    state.index = -1;
  } else if (sameMatch >= 0) {
    state.index = sameMatch;
  } else if (state.index >= matches.length || state.index < 0) {
    state.index = 0;
  }
  applyHighlights(matches, state.index);
  publish();
}

/**
 * Hook the highlighter up to a MutationObserver so newly mounted content
 * (memo loading, tree filtering, etc.) gets highlighted automatically.
 * Idempotent — calling more than once is safe.
 */
let observer: MutationObserver | null = null;
let rescanScheduled = false;
export function startAutoRescan() {
  if (observer || typeof MutationObserver === "undefined" || typeof document === "undefined") {
    return;
  }
  observer = new MutationObserver(() => {
    if (rescanScheduled || !state.query) return;
    rescanScheduled = true;
    // Coalesce bursts of mutations into a single rescan.
    setTimeout(() => {
      rescanScheduled = false;
      rescan();
    }, 150);
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

export function stopAutoRescan() {
  observer?.disconnect();
  observer = null;
}
