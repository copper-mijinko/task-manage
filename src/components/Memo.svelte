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
  let isEditing = false;
  let hasChanges = false;
  let currentContent = toMarkdown(content);
  let renderedHtml = "";
  let renderSequence = 0;

  const EXTERNAL_LINK_PATTERN = /^(https?:\/\/|mailto:|file:\/\/)/i;

  function toMarkdown(val: unknown): string {
    if (!val) return "";
    if (typeof val === "string") return val;
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
  }

  function canSavePastedImages(): boolean {
    return Boolean(workspaceProjectDir && taskId && window.electronAPI?.wsSaveMemoImage);
  }

  async function persistPastedImage(file: File): Promise<string | null> {
    if (!workspaceProjectDir || !taskId || !window.electronAPI?.wsSaveMemoImage) {
      return null;
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

          if (!imageItem || !canSavePastedImages()) {
            return false;
          }

          const file = imageItem.getAsFile();
          if (!file) {
            return false;
          }

          event.preventDefault();
          void (async () => {
            const savedPath = await persistPastedImage(file);
            if (!savedPath) {
              return;
            }

            const prefix = editorView.state.doc.length === 0 ? "" : "\n";
            const suffix = "\n";
            insertTextAtSelection(
              editorView,
              `${prefix}${buildImageMarkdown(savedPath, file.name || "Pasted image")}${suffix}`
            );
          })();

          return true;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          hasChanges = true;
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            flushSave(update.view.state.doc.toString());
          }, 500);
        }
      }),
    ];
  }

  async function startEdit() {
    if (readOnly) return;
    isEditing = true;
    await tick();
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
    if (view) {
      clearTimeout(saveTimer);
      if (hasChanges) flushSave(view.state.doc.toString());
      view.destroy();
    }
  });

  function handlePreviewClick(e: MouseEvent) {
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
    startEdit();
  }

  $: normalizedContent = toMarkdown(content);
  $: if (!isEditing && normalizedContent !== currentContent) {
    currentContent = normalizedContent;
  }
  $: if (!isEditing) {
    void updateRenderedHtml(currentContent || "");
  }
</script>

<div class="wrapper">
  {#if isEditing}
    <div class="edit-mode">
      <div class="edit-bar">
        <span class="shortcut-hint">Ctrl/Cmd+S to save / Ctrl/Cmd+Enter to finish</span>
        <button class="done-btn" on:click={stopEdit}>Done</button>
      </div>
      <div class="editor" bind:this={container}></div>
    </div>
  {:else}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="preview-mode"
      on:click={handlePreviewClick}
      on:keydown={(e) => e.key === "Enter" && startEdit()}
    >
      {#if currentContent.trim()}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="preview">{@html renderedHtml}</div>
      {:else if !readOnly}
        <div class="placeholder">Click to start writing...</div>
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
    gap: 0.75rem;
    align-items: center;
    padding: 0.25rem 0.5rem;
    background-color: var(--theme-color-Main-dark);
    flex-shrink: 0;
  }

  .shortcut-hint {
    color: var(--theme-color-Sub-main);
    font-size: 0.75rem;
  }

  .done-btn {
    padding: 0.2rem 0.75rem;
    font-size: 0.8rem;
    background-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Main-dark);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .done-btn:hover {
    background-color: var(--theme-color-Primary-dark);
  }

  .editor {
    flex: 1;
    overflow: hidden;
  }

  .preview-mode {
    flex: 1;
    height: 100%;
    overflow: auto;
    cursor: text;
  }

  .preview {
    padding: 1rem;
    color: var(--theme-color-Sub-light);
    font-size: 0.9rem;
    line-height: 1.7;
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
