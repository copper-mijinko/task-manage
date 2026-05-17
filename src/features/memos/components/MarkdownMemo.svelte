<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import { EditorView, keymap } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { languages } from "@codemirror/language-data";
  import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
  import { marked } from "marked";
  import quillIcons from "quill/ui/icons.js";
  import { toMarkdown } from "@features/memos/utils/memo_utils";
  import SegmentedControl from "@lib/primitives/SegmentedControl.svelte";
  import * as platform from "@lib/ipc/platform";

  export let saveMemo: (content: string) => void;
  export let content: unknown = "";
  export let readOnly = false;
  export let memoTitles: string[] = [];
  export let openMemoLink: ((title: string) => void) | undefined = undefined;
  export let workspaceProjectDir: string | null = null;
  export let taskId: string | null = null;

  let container: HTMLElement;
  let view: EditorView | null = null;
  let saveTimer: ReturnType<typeof setTimeout>;
  let savedTimer: ReturnType<typeof setTimeout>;
  let isEditing = false;
  let hasChanges = false;
  let saveState: "clean" | "dirty" | "saved" = "clean";
  let currentContent = toMarkdown(content);
  let renderedHtml = "";
  let renderSequence = 0;
  let previewEl: HTMLElement | null = null;
  let livePreviewEl: HTMLElement | null = null;
  let editBody: HTMLElement | null = null;
  let markdownSplitPercent = 55;

  const SPLIT_MIN_PERCENT = 30;
  const SPLIT_MAX_PERCENT = 72;
  const SPLIT_KEY_STEP = 5;

  const EXTERNAL_LINK_PATTERN = /^(https?:\/\/|mailto:|file:\/\/)/i;
  const toolbarIcons = {
    bold: quillIcons.bold,
    italic: quillIcons.italic,
    inlineCode: quillIcons.code,
    heading1: quillIcons.header["1"],
    heading2: quillIcons.header["2"],
    heading3: quillIcons.header["3"],
    link: quillIcons.link,
    bulletList: quillIcons.list.bullet,
    checklist: quillIcons.list.check,
    quote: quillIcons.blockquote,
    codeBlock: quillIcons["code-block"],
  };
  const memoModeOptions = [
    { value: "read", label: "Read", className: "read-mode-btn" },
    { value: "edit", label: "Edit", className: "edit-mode-btn" },
  ];

  function normalizeMemoTitle(title: string): string {
    return title.trim().toLocaleLowerCase();
  }

  function isExternalLink(target: string): boolean {
    return EXTERNAL_LINK_PATTERN.test(target.trim());
  }

  function escapeHtml(value: string): string {
    return value
      .split("&")
      .join("&amp;")
      .split("<")
      .join("&lt;")
      .split(">")
      .join("&gt;")
      .split('"')
      .join("&quot;")
      .split("'")
      .join("&#39;");
  }

  function preprocessWikiLinks(markdownText: string): string {
    const knownTitles = new Set(memoTitles.map((title) => normalizeMemoTitle(String(title || ""))));

    return markdownText.replace(/\[\[([^\]]+)\]\]/g, (fullMatch, rawTarget) => {
      const [targetPart, aliasPart] = String(rawTarget).split("|");
      const target = String(targetPart || "").trim();
      const alias = String(aliasPart || "").trim() || target;

      if (!target) return fullMatch;

      if (isExternalLink(target)) {
        return `<a href="${escapeHtml(target)}" class="wiki-link is-external">${escapeHtml(alias)}</a>`;
      }

      const resolvedClass = knownTitles.has(normalizeMemoTitle(target))
        ? "is-resolved"
        : "is-unresolved";

      return `<a href="#" class="wiki-link ${resolvedClass}" data-memo-link="${escapeHtml(target)}">${escapeHtml(alias)}</a>`;
    });
  }

  function flushSave(nextContent: string) {
    clearTimeout(saveTimer);
    currentContent = nextContent;
    saveMemo(currentContent);
    hasChanges = false;
    saveState = "saved";
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      if (!hasChanges) {
        saveState = "clean";
      }
    }, 1600);
  }

  function canSavePastedImages(): boolean {
    return Boolean(
      (workspaceProjectDir && taskId && platform.isPlatformAvailable()) || !workspaceProjectDir
    );
  }

  function readFileAsDataUrl(file: File): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  async function persistPastedImage(file: File): Promise<string | null> {
    if (!workspaceProjectDir || !taskId) {
      return readFileAsDataUrl(file);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await platform.wsSaveMemoImage(
      workspaceProjectDir,
      taskId,
      bytes,
      file.type || "image/png"
    );

    return result.success ? (result.path ?? null) : null;
  }

  function buildImageMarkdown(relativePath: string, label = ""): string {
    const alt = label.replace(/\.[^.]+$/, "").trim();
    return alt ? `![${alt}](${relativePath})` : `![](${relativePath})`;
  }

  function imageToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read image file"));
      reader.readAsDataURL(file);
    });
  }

  function insertTextAtSelection(editorView: EditorView, text: string) {
    const range = editorView.state.selection.main;
    editorView.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: text,
      },
      selection: {
        anchor: range.from + text.length,
      },
      scrollIntoView: true,
    });
  }

  function wrapInline(marker: string, markerEnd = marker) {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.doc.sliceString(from, to);
    if (selected) {
      view.dispatch({
        changes: { from, to, insert: `${marker}${selected}${markerEnd}` },
        selection: { anchor: from + marker.length, head: to + marker.length },
      });
    } else {
      view.dispatch({
        changes: { from, insert: `${marker}${markerEnd}` },
        selection: { anchor: from + marker.length },
      });
    }
    view.focus();
  }

  function formatBold() {
    wrapInline("**");
  }
  function formatItalic() {
    wrapInline("*");
  }
  function formatInlineCode() {
    wrapInline("`");
  }

  function formatHeading(level: 1 | 2 | 3) {
    if (!view) return;
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const newPrefix = "#".repeat(level) + " ";
    const headingMatch = line.text.match(/^(#{1,6}) /);
    if (headingMatch && headingMatch[0] === newPrefix) {
      view.dispatch({
        changes: { from: line.from, to: line.from + newPrefix.length, insert: "" },
        selection: { anchor: Math.max(line.from, from - newPrefix.length) },
      });
    } else if (headingMatch) {
      const oldLen = headingMatch[0].length;
      view.dispatch({
        changes: { from: line.from, to: line.from + oldLen, insert: newPrefix },
        selection: { anchor: from - oldLen + newPrefix.length },
      });
    } else {
      view.dispatch({
        changes: { from: line.from, insert: newPrefix },
        selection: { anchor: from + newPrefix.length },
      });
    }
    view.focus();
  }

  function formatCheckbox() {
    if (!view) return;
    const prefix = "- [ ] ";
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    if (line.text.startsWith(prefix)) {
      view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: "" },
        selection: { anchor: Math.max(line.from, from - prefix.length) },
      });
    } else {
      view.dispatch({
        changes: { from: line.from, insert: prefix },
        selection: { anchor: from + prefix.length },
      });
    }
    view.focus();
  }

  function toggleLinePrefix(prefix: string) {
    if (!view) return;
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    if (line.text.startsWith(prefix)) {
      view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: "" },
        selection: { anchor: Math.max(line.from, from - prefix.length) },
      });
    } else {
      view.dispatch({
        changes: { from: line.from, insert: prefix },
        selection: { anchor: from + prefix.length },
      });
    }
    view.focus();
  }

  function formatBulletList() {
    toggleLinePrefix("- ");
  }

  function formatQuote() {
    toggleLinePrefix("> ");
  }

  function formatLink() {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.doc.sliceString(from, to);
    if (selected) {
      const insert = `[${selected}](url)`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + selected.length + 3, head: from + insert.length - 1 },
      });
    } else {
      view.dispatch({
        changes: { from, insert: "[](url)" },
        selection: { anchor: from + 1 },
      });
    }
    view.focus();
  }

  function formatCodeBlock() {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc;
    const selected = doc.sliceString(from, to);
    const needsNewline = from > doc.lineAt(from).from;
    const pre = needsNewline ? "\n" : "";
    if (selected) {
      const insert = `${pre}\`\`\`\n${selected}\n\`\`\`\n`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + pre.length + 4, head: from + pre.length + 4 + selected.length },
      });
    } else {
      view.dispatch({
        changes: { from, insert: `${pre}\`\`\`\n\n\`\`\`\n` },
        selection: { anchor: from + pre.length + 4 },
      });
    }
    view.focus();
  }

  async function resolveImageSources(html: string): Promise<string> {
    if (!workspaceProjectDir || !taskId || !platform.isPlatformAvailable()) {
      return html;
    }

    const template = document.createElement("template");
    template.innerHTML = html;
    const images = Array.from(template.content.querySelectorAll("img[src]"));

    await Promise.all(
      images.map(async (image) => {
        const src = image.getAttribute("src");
        if (!src || isExternalLink(src) || src.startsWith("data:")) {
          return;
        }

        const result = await platform.wsResolveMemoAsset(workspaceProjectDir, taskId, src);

        if (result.success && result.url) {
          image.setAttribute("src", result.url);
        } else {
          image.setAttribute("data-missing-image", "true");
        }
      })
    );

    return template.innerHTML;
  }

  function injectCopyButtons(root: HTMLElement | null) {
    if (!root) return;
    root.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".copy-btn")) return;
      const code = pre.querySelector("code");
      if (!code) return;
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const text = code.innerText ?? code.textContent ?? "";
        void navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 1800);
        });
      });
      pre.appendChild(btn);
    });
  }

  async function updateRenderedHtml(markdownText: string) {
    const sequence = ++renderSequence;
    const baseHtml = marked.parse(preprocessWikiLinks(markdownText), {
      gfm: true,
      breaks: true,
    }) as string;
    renderedHtml = baseHtml;
    await tick();
    injectCopyButtons(previewEl);
    injectCopyButtons(livePreviewEl);

    const nextHtml = await resolveImageSources(baseHtml);
    if (sequence === renderSequence) {
      renderedHtml = nextHtml;
      await tick();
      injectCopyButtons(previewEl);
      injectCopyButtons(livePreviewEl);
    }
  }

  function clampSplitPercent(value: number): number {
    return Math.min(SPLIT_MAX_PERCENT, Math.max(SPLIT_MIN_PERCENT, value));
  }

  function applyMarkdownSplitPercent(value: number) {
    markdownSplitPercent = clampSplitPercent(value);
    view?.requestMeasure();
  }

  function resizeMarkdownSplitFromClientX(clientX: number) {
    if (!editBody) return;
    const rect = editBody.getBoundingClientRect();
    if (rect.width <= 0) return;
    applyMarkdownSplitPercent(((clientX - rect.left) / rect.width) * 100);
  }

  function handleSplitPointerMove(event: PointerEvent) {
    resizeMarkdownSplitFromClientX(event.clientX);
  }

  function stopSplitResize() {
    window.removeEventListener("pointermove", handleSplitPointerMove);
    window.removeEventListener("pointerup", stopSplitResize);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }

  function startSplitResize(event: PointerEvent) {
    if (!editBody) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    resizeMarkdownSplitFromClientX(event.clientX);
    window.addEventListener("pointermove", handleSplitPointerMove);
    window.addEventListener("pointerup", stopSplitResize);
  }

  function handleSplitKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        applyMarkdownSplitPercent(markdownSplitPercent - SPLIT_KEY_STEP);
        break;
      case "ArrowRight":
        event.preventDefault();
        applyMarkdownSplitPercent(markdownSplitPercent + SPLIT_KEY_STEP);
        break;
      case "Home":
        event.preventDefault();
        applyMarkdownSplitPercent(SPLIT_MIN_PERCENT);
        break;
      case "End":
        event.preventDefault();
        applyMarkdownSplitPercent(SPLIT_MAX_PERCENT);
        break;
    }
  }

  const editorTheme = EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--theme-color-Main-light)",
      color: "var(--theme-color-Sub-light)",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "inherit",
      fontSize: "0.9rem",
      lineHeight: "1.7",
    },
    ".cm-content": {
      padding: "1rem",
      caretColor: "var(--theme-color-Sub-light)",
      minHeight: "100%",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--theme-color-Primary-dark) !important",
    },
    ".cm-selectionMatch": {
      backgroundColor: "var(--theme-color-Primary-main)",
      opacity: "0.35",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--theme-color-Sub-light)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.02)",
    },
    ".cm-gutters": { display: "none" },
  });

  // テーマ非依存の Markdown 用シンタックスハイライト。defaultHighlightStyle は
  // 白背景前提の固定色 (#708, #a11, #940 など) を使うため、Dark テーマの
  // 暗い背景 (Main-light = #394249) で見えなくなる。base color は editorTheme
  // の color (Sub-light) を継承させ、トークンには太字/斜体/テーマ追従の
  // accent 色のみを乗せて両テーマで可読性を確保する。
  const markdownHighlightStyle = HighlightStyle.define([
    { tag: t.heading, fontWeight: "bold" },
    { tag: t.heading1, fontWeight: "bold" },
    { tag: t.heading2, fontWeight: "bold" },
    { tag: t.heading3, fontWeight: "bold" },
    { tag: t.heading4, fontWeight: "bold" },
    { tag: t.heading5, fontWeight: "bold" },
    { tag: t.heading6, fontWeight: "bold" },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.link, color: "var(--theme-color-Primary-main)", textDecoration: "underline" },
    { tag: t.url, color: "var(--theme-color-Primary-main)" },
    { tag: t.monospace, color: "var(--theme-color-Accent-main)" },
    { tag: t.quote, opacity: "0.78" },
    { tag: t.meta, opacity: "0.55" },
  ]);

  function buildExtensions() {
    return [
      editorTheme,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(markdownHighlightStyle),
      highlightSelectionMatches(),
      keymap.of([
        {
          key: "Mod-b",
          run: () => {
            formatBold();
            return true;
          },
        },
        {
          key: "Mod-i",
          run: () => {
            formatItalic();
            return true;
          },
        },
        {
          key: "Mod-k",
          run: () => {
            formatLink();
            return true;
          },
        },
        ...defaultKeymap,
        ...searchKeymap,
        {
          key: "Mod-s",
          run: (editorView) => {
            flushSave(editorView.state.doc.toString());
            return true;
          },
        },
        {
          key: "Mod-Enter",
          run: () => {
            stopEdit();
            return true;
          },
        },
        {
          key: "Escape",
          run: () => {
            stopEdit();
            return true;
          },
        },
      ]),
      keymap.of(historyKeymap),
      EditorView.lineWrapping,
      history(),
      EditorView.domEventHandlers({
        paste(event, editorView) {
          const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) =>
            item.type.startsWith("image/")
          );

          if (!imageItem) {
            return false;
          }

          const file = imageItem.getAsFile();
          if (!file) {
            return false;
          }

          event.preventDefault();
          void (async () => {
            let imageSrc: string | null;
            if (canSavePastedImages()) {
              imageSrc = await persistPastedImage(file);
            } else {
              imageSrc = await imageToDataUrl(file);
            }
            if (!imageSrc) {
              return;
            }

            const prefix = editorView.state.doc.length === 0 ? "" : "\n";
            insertTextAtSelection(
              editorView,
              `${prefix}${buildImageMarkdown(imageSrc, file.name || "Pasted image")}\n`
            );
          })();

          return true;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          hasChanges = true;
          saveState = "dirty";
          const nextContent = update.view.state.doc.toString();
          currentContent = nextContent;
          void updateRenderedHtml(nextContent);
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            flushSave(nextContent);
          }, 500);
        }
      }),
    ];
  }

  async function startEdit() {
    if (readOnly || isEditing) return;
    isEditing = true;
    await tick();
    if (!container || view) return;
    view = new EditorView({
      state: EditorState.create({ doc: currentContent, extensions: buildExtensions() }),
      parent: container,
    });
    view.focus();
  }

  function stopEdit() {
    if (view) {
      clearTimeout(saveTimer);
      currentContent = view.state.doc.toString();
      if (hasChanges) {
        flushSave(currentContent);
      }
      view.destroy();
      view = null;
    }
    isEditing = false;
  }

  function handleModeChange(event: CustomEvent<{ value: string }>) {
    if (event.detail.value === "edit") {
      void startEdit();
    } else {
      stopEdit();
    }
  }

  onDestroy(() => {
    stopSplitResize();
    clearTimeout(savedTimer);
    if (view) {
      clearTimeout(saveTimer);
      if (hasChanges) flushSave(view.state.doc.toString());
      view.destroy();
    }
  });

  function handlePreviewClick(e: MouseEvent | KeyboardEvent) {
    const link = (e.target as Element).closest("a") as HTMLAnchorElement | null;
    if (link?.dataset.memoLink) {
      e.preventDefault();
      openMemoLink?.(link.dataset.memoLink);
      return;
    }
    if (link?.href) {
      e.preventDefault();
      platform.openExternalLink(link.href);
      return;
    }
  }

  function handlePreviewKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      handlePreviewClick(e);
    }
  }

  $: normalizedContent = toMarkdown(content);
  $: if (!isEditing && normalizedContent !== currentContent) {
    currentContent = normalizedContent;
  }
  $: if (readOnly && isEditing) {
    stopEdit();
  }
  $: if (!isEditing) {
    void updateRenderedHtml(currentContent || "");
  }
</script>

<div class="wrapper">
  {#if isEditing}
    <div class="edit-mode">
      <div class="edit-bar">
        <div class="toolbar">
          <!-- eslint-disable svelte/no-at-html-tags -->
          <button
            type="button"
            class="tool-btn tool-bold"
            aria-label="Bold"
            title="Bold (Ctrl+B)"
            on:mousedown|preventDefault
            on:click={formatBold}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.bold}</span>
          </button>
          <button
            type="button"
            class="tool-btn tool-italic"
            aria-label="Italic"
            title="Italic (Ctrl+I)"
            on:mousedown|preventDefault
            on:click={formatItalic}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.italic}</span>
          </button>
          <button
            type="button"
            class="tool-btn tool-code-inline"
            aria-label="Inline code"
            title="Inline code"
            on:mousedown|preventDefault
            on:click={formatInlineCode}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.inlineCode}</span>
          </button>
          <span class="tool-sep"></span>
          <button
            type="button"
            class="tool-btn"
            aria-label="Heading 1"
            title="Heading 1"
            on:mousedown|preventDefault
            on:click={() => formatHeading(1)}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.heading1}</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            aria-label="Heading 2"
            title="Heading 2"
            on:mousedown|preventDefault
            on:click={() => formatHeading(2)}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.heading2}</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            aria-label="Heading 3"
            title="Heading 3"
            on:mousedown|preventDefault
            on:click={() => formatHeading(3)}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.heading3}</span>
          </button>
          <span class="tool-sep"></span>
          <button
            type="button"
            class="tool-btn"
            aria-label="Link"
            title="Link (Ctrl+K)"
            on:mousedown|preventDefault
            on:click={formatLink}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.link}</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            aria-label="Bullet list"
            title="Bullet list"
            on:mousedown|preventDefault
            on:click={formatBulletList}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.bulletList}</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            aria-label="Checklist"
            title="Checklist"
            on:mousedown|preventDefault
            on:click={formatCheckbox}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.checklist}</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            aria-label="Quote"
            title="Quote"
            on:mousedown|preventDefault
            on:click={formatQuote}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.quote}</span>
          </button>
          <button
            type="button"
            class="tool-btn tool-code-block"
            aria-label="Code block"
            title="Code block"
            on:mousedown|preventDefault
            on:click={formatCodeBlock}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.codeBlock}</span>
          </button>
          <!-- eslint-enable svelte/no-at-html-tags -->
        </div>
        <div class="edit-bar-end">
          <span class="save-status" aria-live="polite">
            {saveState === "dirty" ? "Unsaved" : saveState === "saved" ? "Saved" : ""}
          </span>
          <SegmentedControl
            options={memoModeOptions}
            value="edit"
            ariaLabel="Memo mode"
            on:change={handleModeChange}
          />
        </div>
      </div>
      <div
        class="edit-body"
        bind:this={editBody}
        style={`--editor-pane-width: ${markdownSplitPercent}%`}
      >
        <div class="editor-pane">
          <div class="editor" bind:this={container}></div>
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="markdown-split-resizer"
          role="separator"
          aria-label="Resize editor and preview"
          aria-orientation="vertical"
          aria-valuemin={SPLIT_MIN_PERCENT}
          aria-valuemax={SPLIT_MAX_PERCENT}
          aria-valuenow={Math.round(markdownSplitPercent)}
          tabindex="0"
          on:pointerdown={startSplitResize}
          on:keydown={handleSplitKeydown}
        ></div>
        <div class="live-preview" aria-label="Markdown preview">
          {#if currentContent.trim()}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="preview" bind:this={livePreviewEl}>{@html renderedHtml}</div>
          {:else}
            <div class="placeholder">Preview</div>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="preview-mode" on:click={handlePreviewClick} on:keydown={handlePreviewKeydown}>
      {#if !readOnly}
        <div class="preview-bar">
          <SegmentedControl
            options={memoModeOptions}
            value="read"
            ariaLabel="Memo mode"
            on:change={handleModeChange}
          />
        </div>
      {/if}
      {#if currentContent.trim()}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="preview" bind:this={previewEl}>{@html renderedHtml}</div>
      {:else if !readOnly}
        <div class="placeholder">No content</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrapper {
    --memo-quill-button-color: var(--theme-color-Sub-light);
    --memo-quill-button-active-color: #06c;
    --memo-quill-button-height: 24px;
    --memo-quill-button-width: 28px;

    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background-color: var(--theme-color-Main-light);
  }

  .edit-mode {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .edit-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--sp2);
    background-color: var(--theme-color-Main-dark);
    flex-shrink: 0;
    gap: var(--sp2);
    min-width: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0;
    flex-wrap: nowrap;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .toolbar::-webkit-scrollbar {
    display: none;
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    height: var(--memo-quill-button-height);
    width: auto;
    padding: var(--sp1) var(--sp2);
    margin: 0;
    font-size: var(--font-label-md);
    background: none;
    border: none;
    border-radius: 0;
    color: var(--memo-quill-button-color);
    cursor: pointer;
    line-height: 1;
    min-width: var(--memo-quill-button-width);
    text-align: center;
    transition: color 0.1s ease;
  }

  .tool-btn:hover,
  .tool-btn:focus-visible {
    background: none;
    color: var(--memo-quill-button-active-color);
  }

  .tool-btn:active {
    background: none;
  }

  .tool-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    pointer-events: none;
  }

  .tool-icon :global(svg) {
    display: block;
    width: 18px;
    height: 18px;
  }

  .tool-icon :global(.ql-stroke) {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }

  .tool-icon :global(.ql-stroke-miter) {
    fill: none;
    stroke: currentColor;
    stroke-miterlimit: 10;
    stroke-width: 2;
  }

  .tool-icon :global(.ql-fill),
  .tool-icon :global(.ql-stroke.ql-fill) {
    fill: currentColor;
  }

  .tool-icon :global(.ql-even) {
    fill-rule: evenodd;
  }

  .tool-icon :global(.ql-thin),
  .tool-icon :global(.ql-stroke.ql-thin) {
    stroke-width: 1;
  }

  .tool-icon :global(.ql-transparent) {
    opacity: 0.4;
  }

  .tool-bold {
    font-weight: bold;
  }

  .tool-italic {
    font-style: italic;
  }

  .tool-code-inline,
  .tool-code-block {
    min-width: var(--memo-quill-button-width);
  }

  .tool-sep {
    width: 0;
    height: var(--memo-quill-button-height);
    background-color: transparent;
    margin: 0 var(--sp2) 0 var(--sp1);
    flex-shrink: 0;
  }

  .edit-bar-end {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    flex-shrink: 0;
    margin-left: auto;
  }

  .save-status {
    min-width: 3rem;
    text-align: right;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    white-space: nowrap;
  }

  .save-status:empty {
    display: none;
  }

  .edit-body {
    --editor-pane-width: 55%;
    display: flex;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }

  .editor-pane {
    display: flex;
    flex: 0 0 var(--editor-pane-width);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .editor {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }

  .editor :global(.cm-editor) {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .editor :global(.cm-scroller) {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  /* Match SplitPanes' resizer look: thin neutral bar that turns Primary on
     hover/focus, with subtle grip dots. Keeps the visual language consistent. */
  .markdown-split-resizer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 5px;
    min-width: 5px;
    padding: 0;
    cursor: col-resize;
    background-color: transparent;
    border: none;
    touch-action: none;
  }

  .markdown-split-resizer::before {
    content: "";
    position: absolute;
    top: 0;
    left: 1px;
    width: 3px;
    height: 100%;
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 48%, transparent);
    border-radius: 1.5px;
    opacity: 0.85;
    transition:
      background-color 0.15s ease,
      width 0.15s ease,
      opacity 0.15s ease;
  }

  .markdown-split-resizer::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 1px;
    width: 3px;
    height: 1.5rem;
    transform: translateY(-50%);
    background-image: radial-gradient(circle, var(--theme-color-Main-main) 1px, transparent 1.2px);
    background-size: 3px 4px;
    background-repeat: repeat-y;
    opacity: 0.9;
    pointer-events: none;
  }

  .markdown-split-resizer:hover::before,
  .markdown-split-resizer:focus-visible::before {
    width: 5px;
    left: 0;
    background-color: var(--theme-color-Primary-main);
    opacity: 1;
  }

  .markdown-split-resizer:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -2px;
  }

  .live-preview {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background-color: color-mix(in srgb, var(--theme-color-Main-light) 92%, black);
  }

  .preview-mode {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: auto;
  }

  .preview-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    justify-content: flex-end;
    padding: var(--sp2) var(--sp2);
    border-bottom: 1px solid var(--theme-color-Shadow-main);
    background-color: color-mix(in srgb, var(--theme-color-Main-light) 94%, black);
  }

  .preview {
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--sp4);
    color: var(--theme-color-Sub-light);
    font-size: var(--font-body-md);
    line-height: 1.7;
  }

  @media (max-width: 900px) {
    .editor-pane {
      flex-basis: 100%;
    }

    .markdown-split-resizer,
    .live-preview {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .edit-bar {
      flex-wrap: wrap;
      row-gap: var(--sp1);
    }

    .edit-bar-end {
      order: 1;
    }

    .toolbar {
      order: 2;
      flex-basis: 100%;
    }
  }

  .placeholder {
    flex: 1 1 auto;
    min-height: 100%;
    box-sizing: border-box;
    padding: var(--sp4);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-md);
    font-style: italic;
  }

  .preview :global(h1),
  .preview :global(h2),
  .preview :global(h3),
  .preview :global(h4) {
    margin: 0.75em 0 0.4em;
    font-weight: bold;
    line-height: 1.3;
    color: var(--theme-color-Sub-light);
  }

  .preview :global(h1) {
    font-size: 1.5rem;
  }

  .preview :global(h2) {
    font-size: 1.25rem;
  }

  .preview :global(h3) {
    font-size: 1.1rem;
  }

  .preview :global(p) {
    margin: 0.5em 0;
  }

  .preview :global(img) {
    display: block;
    max-width: min(100%, 48rem);
    height: auto;
    margin: var(--sp3) 0;
    border-radius: var(--shape-md);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 25%, transparent);
    background: color-mix(in srgb, var(--theme-color-Main-dark) 80%, transparent);
    box-shadow: var(--elevation-2);
  }

  .preview :global(img[data-missing-image="true"]) {
    min-height: 6rem;
    object-fit: contain;
    opacity: 0.65;
  }

  .preview :global(a) {
    color: var(--theme-color-Primary-main);
    text-decoration: underline;
    cursor: pointer;
  }

  .preview :global(a.wiki-link) {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    padding: 1px var(--sp2);
    border-radius: var(--shape-pill);
    text-decoration: none;
    font-weight: 600;
    background: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 45%, transparent);
  }

  .preview :global(a.wiki-link.is-unresolved) {
    opacity: 0.8;
    border-style: dashed;
  }

  .preview :global(a.wiki-link.is-external)::after {
    content: "ext";
    font-size: 0.8em;
  }

  .preview :global(code) {
    font-family: monospace;
    font-size: 0.85em;
    background-color: var(--theme-color-Main-dark);
    padding: 0.1em 0.35em;
    border-radius: var(--shape-xs);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 20%, transparent);
  }

  .preview :global(pre) {
    background-color: var(--theme-color-Main-dark);
    padding: var(--sp3) var(--sp4);
    border-radius: var(--shape-xs);
    overflow-x: auto;
    margin: 0.5em 0;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 25%, transparent);
    position: relative;
  }

  .preview :global(pre code) {
    background: none;
    padding: 0;
    border: none;
    font-size: var(--font-body-sm);
  }

  .preview :global(pre .copy-btn) {
    position: absolute;
    top: var(--sp1);
    right: var(--sp1);
    padding: 2px var(--sp2);
    font-size: var(--font-label-sm);
    font-family: inherit;
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 40%, transparent);
    border-radius: var(--shape-xs);
    color: var(--theme-color-Sub-main);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.15s ease,
      background-color 0.1s ease;
    line-height: 1.4;
    user-select: none;
  }

  .preview :global(pre:hover .copy-btn) {
    opacity: 1;
  }

  .preview :global(pre .copy-btn:hover) {
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 30%, transparent);
    color: var(--theme-color-Sub-light);
    border-color: var(--theme-color-Sub-main);
  }

  .preview :global(pre .copy-btn.copied) {
    color: var(--theme-color-Success-main);
    border-color: var(--theme-color-Success-dark);
    opacity: 1;
  }

  .preview :global(blockquote) {
    border-left: 3px solid var(--theme-color-Sub-dark);
    margin: 0.5em 0;
    padding: 0.25em 0.75em;
    color: var(--theme-color-Sub-main);
  }

  .preview :global(ul),
  .preview :global(ol) {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  .preview :global(ul.contains-task-list) {
    list-style: none;
    padding-left: 0;
  }

  .preview :global(li) {
    margin: 0.2em 0;
  }

  .preview :global(.task-list-item) {
    list-style: none;
    display: flex;
    gap: var(--sp2);
    align-items: flex-start;
  }

  .preview :global(.task-list-item input[type="checkbox"]) {
    margin-top: var(--sp1);
    accent-color: var(--theme-color-Primary-main);
    pointer-events: none;
  }

  .preview :global(hr) {
    border: none;
    border-top: 1px solid var(--theme-color-Sub-dark);
    margin: 1em 0;
  }

  .preview :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
    font-size: var(--font-body-md);
  }

  .preview :global(th),
  .preview :global(td) {
    border: 1px solid var(--theme-color-Sub-dark);
    padding: 0.3em 0.6em;
  }

  .preview :global(th) {
    background-color: var(--theme-color-Main-dark);
  }
</style>
