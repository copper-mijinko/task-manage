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
 * - `[data-page-search-skip]`: explicit opt-out for shell chrome (the
 *   header search box, the toolbar SearchBox, tooltips, etc.).
 */
const SKIP_SELECTOR =
  "script, style, noscript, template, input, textarea, select, " +
  ".ql-toolbar, .ql-tooltip, .ql-clipboard, " +
  "[data-page-search-skip], [data-page-search-skip] *";

/** How long after the last query change before we re-scan. */
const SCAN_DEBOUNCE_MS = 120;

interface ScanState {
  query: string;
  matches: Range[];
  index: number; // -1 when no matches
}

const state: ScanState = { query: "", matches: [], index: -1 };

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
 * Walk every text node under `root` and collect Ranges for matches of `query`
 * (case-insensitive). We do NOT modify the DOM — Ranges sit alongside it.
 */
function scanForMatches(query: string): Range[] {
  if (!query) return [];
  if (typeof document === "undefined") return [];

  const regex = new RegExp(escapeRegex(query), "gi");
  const matches: Range[] = [];
  const root = document.body;
  if (!root) return matches;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (shouldSkipNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  } as NodeFilter);

  let textNode = walker.nextNode() as Text | null;
  while (textNode) {
    const text = textNode.nodeValue ?? "";
    if (text.length > 0) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        try {
          const range = new Range();
          range.setStart(textNode, m.index);
          range.setEnd(textNode, m.index + m[0].length);
          matches.push(range);
        } catch {
          // Range creation can throw if the text node was reparented mid-walk.
          // We just skip those.
        }
        if (m[0].length === 0) regex.lastIndex += 1;
      }
    }
    textNode = walker.nextNode() as Text | null;
  }

  return matches;
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
      state.index = -1;
      clearHighlights();
      publish();
      return;
    }
    const matches = scanForMatches(state.query);
    state.matches = matches;
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
    state.index = -1;
    clearHighlights();
    publish();
    return;
  }
  const matches = scanForMatches(state.query);
  state.matches = matches;
  if (matches.length === 0) {
    state.index = -1;
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
