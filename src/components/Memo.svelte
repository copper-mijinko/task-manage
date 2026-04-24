<script>
  import { onMount } from "svelte";
  import { EditorView, keymap } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
  import { languages } from "@codemirror/language-data";
  import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";

  export let saveMemo;
  export let content = "";
  export let readOnly = false;

  let container;
  let saveTimer;

  // Quill Delta (object) が残っている場合は JSON 文字列に変換してフォールバック表示
  function toMarkdown(val) {
    if (!val) return "";
    if (typeof val === "string") return val;
    return JSON.stringify(val, null, 2);
  }

  onMount(() => {
    const theme = EditorView.theme({
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
      ".cm-gutters": {
        display: "none",
      },
    });

    const baseExtensions = [
      theme,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(defaultHighlightStyle),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
    ];

    const extensions = readOnly
      ? [...baseExtensions, EditorState.readOnly.of(true)]
      : [
          ...baseExtensions,
          history(),
          keymap.of(historyKeymap),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              clearTimeout(saveTimer);
              saveTimer = setTimeout(() => saveMemo(update.state.doc.toString()), 500);
            }
          }),
        ];

    const view = new EditorView({
      state: EditorState.create({
        doc: toMarkdown(content),
        extensions,
      }),
      parent: container,
    });

    return () => {
      clearTimeout(saveTimer);
      view.destroy();
    };
  });
</script>

<div class="wrapper">
  <div class="editor" bind:this={container}></div>
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

  .editor {
    flex: 1;
    height: 100%;
    overflow: hidden;
  }
</style>
