<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import { EditorView, keymap } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
  import { languages } from "@codemirror/language-data";
  import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
  import { marked } from "marked";

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

  const EXTERNAL_LINK_PATTERN = /^(https?:\/\/|mailto:|file:\/\/)/i;

  function isQuillDelta(value: unknown): value is { ops: Array<{ insert?: unknown }> } {
    return (
      typeof value === "object" && value !== null && Array.isArray((value as { ops?: unknown }).ops)
    );
  }

  function quillDeltaToMarkdown(delta: { ops: Array<{ insert?: unknown }> }): string {
    return delta.ops
      .map((op) => {
        if (typeof op.insert === "string") {
          return op.insert;
        }
        if (
          typeof op.insert === "object" &&
          op.insert !== null &&
          typeof (op.insert as { image?: unknown }).image === "string"
        ) {
          return `![](${(op.insert as { image: string }).image})`;
        }
        return "";
      })
      .join("")
      .replace(/\s+$/, "");
  }

  function toMarkdown(val: unknown): string {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (isQuillDelta(val)) return quillDeltaToMarkdown(val);
    return JSON.stringify(val, null, 2);
  }

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
      (workspaceProjectDir && taskId && window.electronAPI?.wsSaveMemoImage) || !workspaceProjectDir
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
    if (!workspaceProjectDir || !taskId || !window.electronAPI?.wsSaveMemoImage) {
      return readFileAsDataUrl(file);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await window.electronAPI.wsSaveMemoImage(
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
    if (!workspaceProjectDir || !taskId || !window.electronAPI?.wsResolveMemoAsset) {
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

        const result = await window.electronAPI.wsResolveMemoAsset(
          workspaceProjectDir,
          taskId,
          src
        );

        if (result.success && result.url) {
          image.setAttribute("src", result.url);
        } else {
          image.setAttribute("data-missing-image", "true");
        }
      })
    );

    return template.innerHTML;
  }

  async function updateRenderedHtml(markdownText: string) {
    const sequence = ++renderSequence;
    const baseHtml = marked.parse(preprocessWikiLinks(markdownText), {
      gfm: true,
      breaks: true,
    }) as string;
    renderedHtml = baseHtml;

    const nextHtml = await resolveImageSources(baseHtml);
    if (sequence === renderSequence) {
      renderedHtml = nextHtml;
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
      backgroundColor: "var(--theme-color-Accent-dark) !important",
    },
    ".cm-selectionMatch": {
      backgroundColor: "var(--theme-color-Accent-main)",
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

  function buildExtensions() {
    return [
      editorTheme,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(defaultHighlightStyle),
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

  onDestroy(() => {
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
      window.electronAPI?.openExternalLink(link.href);
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
          <button
            class="tool-btn tool-bold"
            title="Bold (Ctrl+B)"
            on:mousedown|preventDefault
            on:click={formatBold}>B</button
          >
          <button
            class="tool-btn tool-italic"
            title="Italic (Ctrl+I)"
            on:mousedown|preventDefault
            on:click={formatItalic}>I</button
          >
          <button
            class="tool-btn tool-mono"
            title="Inline code"
            on:mousedown|preventDefault
            on:click={formatInlineCode}>`</button
          >
          <span class="tool-sep"></span>
          <button
            class="tool-btn"
            title="Heading 1"
            on:mousedown|preventDefault
            on:click={() => formatHeading(1)}>H1</button
          >
          <button
            class="tool-btn"
            title="Heading 2"
            on:mousedown|preventDefault
            on:click={() => formatHeading(2)}>H2</button
          >
          <button
            class="tool-btn"
            title="Heading 3"
            on:mousedown|preventDefault
            on:click={() => formatHeading(3)}>H3</button
          >
          <span class="tool-sep"></span>
          <button
            class="tool-btn"
            title="Link (Ctrl+K)"
            on:mousedown|preventDefault
            on:click={formatLink}>[]</button
          >
          <button
            class="tool-btn"
            title="Bullet list"
            on:mousedown|preventDefault
            on:click={formatBulletList}>-</button
          >
          <button
            class="tool-btn"
            title="Checklist"
            on:mousedown|preventDefault
            on:click={formatCheckbox}>[ ]</button
          >
          <button class="tool-btn" title="Quote" on:mousedown|preventDefault on:click={formatQuote}
            >&gt;</button
          >
          <button
            class="tool-btn tool-mono"
            title="Code block"
            on:mousedown|preventDefault
            on:click={formatCodeBlock}>```</button
          >
        </div>
        <div class="edit-bar-end">
          <span class="save-status" aria-live="polite">
            {saveState === "dirty" ? "Unsaved" : saveState === "saved" ? "Saved" : ""}
          </span>
          <div class="mode-switch" role="group" aria-label="Memo mode">
            <button class="read-mode-btn" type="button" aria-pressed="false" on:click={stopEdit}
              >Read</button
            >
            <button class="edit-mode-btn active" type="button" aria-pressed="true">Edit</button>
          </div>
        </div>
      </div>
      <div class="edit-body">
        <div class="editor" bind:this={container}></div>
        <div class="live-preview" aria-label="Markdown preview">
          {#if currentContent.trim()}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="preview">{@html renderedHtml}</div>
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
          <div class="mode-switch" role="group" aria-label="Memo mode">
            <button class="read-mode-btn active" type="button" aria-pressed="true">Read</button>
            <button
              class="edit-mode-btn"
              type="button"
              aria-pressed="false"
              on:click|stopPropagation={startEdit}>Edit</button
            >
          </div>
        </div>
      {/if}
      {#if currentContent.trim()}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="preview">{@html renderedHtml}</div>
      {:else if !readOnly}
        <div class="placeholder">No content</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrapper {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    overflow: hidden;
    background-color: var(--theme-color-Main-light);
  }

  .edit-mode {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .edit-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0.5rem;
    background-color: var(--theme-color-Main-dark);
    flex-shrink: 0;
    gap: 0.5rem;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    flex-wrap: nowrap;
  }

  .tool-btn {
    padding: 0.15rem 0.35rem;
    font-size: 0.75rem;
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--theme-color-Sub-main);
    cursor: pointer;
    line-height: 1.4;
    min-width: 1.6rem;
    text-align: center;
  }

  .tool-btn:hover {
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 30%, transparent);
    border-color: var(--theme-color-Sub-dark);
    color: var(--theme-color-Sub-light);
  }

  .tool-bold {
    font-weight: bold;
  }

  .tool-italic {
    font-style: italic;
  }

  .tool-mono {
    font-family: monospace;
    font-size: 0.7rem;
  }

  .tool-sep {
    width: 1px;
    height: 1rem;
    background-color: var(--theme-color-Sub-dark);
    margin: 0 0.15rem;
    flex-shrink: 0;
  }

  .edit-bar-end {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .save-status {
    min-width: 4rem;
    text-align: right;
    color: var(--theme-color-Sub-main);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .mode-switch {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem;
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: 4px;
    background-color: var(--theme-color-Main-main);
    gap: 0.15rem;
  }

  .mode-switch button {
    border: none;
    border-radius: 3px;
    background-color: transparent;
    color: var(--theme-color-Sub-main);
    padding: 0.2rem 0.55rem;
    min-width: 3.25rem;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .mode-switch button:hover {
    color: var(--theme-color-Sub-light);
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 30%, transparent);
  }

  .mode-switch button.active {
    background-color: var(--theme-color-Primary-dark);
    color: var(--theme-color-Main-dark);
    cursor: default;
  }

  .editor {
    flex: 1;
    overflow: hidden;
    min-width: 0;
  }

  .edit-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 0.9fr);
    min-height: 0;
    flex: 1;
  }

  .live-preview {
    min-width: 0;
    overflow: auto;
    border-left: 1px solid var(--theme-color-Sub-dark);
    background-color: color-mix(in srgb, var(--theme-color-Main-light) 92%, black);
  }

  .preview-mode {
    flex: 1;
    height: 100%;
    overflow: auto;
  }

  .preview-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    justify-content: flex-end;
    padding: 0.45rem 0.6rem;
    border-bottom: 1px solid var(--theme-color-Shadow-main);
    background-color: color-mix(in srgb, var(--theme-color-Main-light) 94%, black);
  }

  .preview {
    padding: 1rem;
    color: var(--theme-color-Sub-light);
    font-size: 0.9rem;
    line-height: 1.7;
  }

  @media (max-width: 900px) {
    .edit-body {
      grid-template-columns: 1fr;
    }

    .live-preview {
      display: none;
    }
  }

  .placeholder {
    padding: 1rem;
    color: var(--theme-color-Sub-main);
    font-size: 0.9rem;
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
    margin: 0.75rem 0;
    border-radius: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 25%, transparent);
    background: color-mix(in srgb, var(--theme-color-Main-dark) 80%, transparent);
    box-shadow: 0 0.75rem 1.5rem rgba(0, 0, 0, 0.18);
  }

  .preview :global(img[data-missing-image="true"]) {
    min-height: 6rem;
    object-fit: contain;
    opacity: 0.65;
  }

  .preview :global(a) {
    color: var(--theme-color-Accent-main);
    text-decoration: underline;
    cursor: pointer;
  }

  .preview :global(a.wiki-link) {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    text-decoration: none;
    font-weight: 600;
    background: color-mix(in srgb, var(--theme-color-Accent-main) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--theme-color-Accent-main) 45%, transparent);
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
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }

  .preview :global(pre) {
    background-color: var(--theme-color-Main-dark);
    padding: 0.75rem 1rem;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0.5em 0;
  }

  .preview :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.85rem;
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
    gap: 0.5rem;
    align-items: flex-start;
  }

  .preview :global(.task-list-item input[type="checkbox"]) {
    margin-top: 0.3rem;
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
    font-size: 0.9rem;
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
