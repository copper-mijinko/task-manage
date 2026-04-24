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

  let container: HTMLElement;
  let view: EditorView | null = null;
  let saveTimer: ReturnType<typeof setTimeout>;
  let isEditing = false;
  let hasChanges = false;
  let currentContent = toMarkdown(content);

  function toMarkdown(val: unknown): string {
    if (!val) return "";
    if (typeof val === "string") return val;
    // Legacy Quill Delta → JSON fallback
    return JSON.stringify(val, null, 2);
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
        { key: "Escape", run: () => { stopEdit(); return true; } },
      ]),
      keymap.of(historyKeymap),
      EditorView.lineWrapping,
      history(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          hasChanges = true;
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            currentContent = update.view.state.doc.toString();
            saveMemo(currentContent);
            hasChanges = false;
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
        saveMemo(currentContent);
        hasChanges = false;
      }
      view.destroy();
      view = null;
    }
    isEditing = false;
  }

  onDestroy(() => {
    if (view) {
      clearTimeout(saveTimer);
      if (hasChanges) saveMemo(view.state.doc.toString());
      view.destroy();
    }
  });

  function handlePreviewClick(e: MouseEvent) {
    const link = (e.target as Element).closest("a") as HTMLAnchorElement | null;
    if (link?.href) {
      e.preventDefault();
      window.electronAPI?.openExternalLink(link.href);
      return;
    }
    startEdit();
  }

  $: renderedHtml = marked.parse(currentContent || "") as string;
</script>

<div class="wrapper">
  {#if isEditing}
    <div class="edit-mode">
      <div class="edit-bar">
        <button class="done-btn" on:click={stopEdit}>完了</button>
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
        <!-- ローカルコンテンツのみのためサニタイズ不要 -->
        <div class="preview">{@html renderedHtml}</div>
      {:else if !readOnly}
        <div class="placeholder">クリックして編集...</div>
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

  /* ---- Edit mode ---- */
  .edit-mode {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .edit-bar {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding: 0.25rem 0.5rem;
    background-color: var(--theme-color-Main-dark);
    flex-shrink: 0;
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

  /* ---- View mode ---- */
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

  /* Markdown preview element styles */
  .preview :global(h1),
  .preview :global(h2),
  .preview :global(h3),
  .preview :global(h4) {
    margin: 0.75em 0 0.4em;
    font-weight: bold;
    line-height: 1.3;
    color: var(--theme-color-Sub-light);
  }

  .preview :global(h1) { font-size: 1.5rem; }
  .preview :global(h2) { font-size: 1.25rem; }
  .preview :global(h3) { font-size: 1.1rem; }

  .preview :global(p) {
    margin: 0.5em 0;
  }

  .preview :global(a) {
    color: var(--theme-color-Accent-main);
    text-decoration: underline;
    cursor: pointer;
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

  .preview :global(li) {
    margin: 0.2em 0;
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
