<script>
  import { onMount } from "svelte";
  import Quill from "quill";
  import "quill/dist/quill.snow.css";
  import { isEqual } from "lodash";

  export let saveMemo;
  export let content = "";
  export let readOnly = false;

  let editor;
  let quill = null;
  let isEditing = false;
  let savedSelection = null;
  let lastSavedContent = null;
  let linkClickListener;
  let pasteListener;
  let errorMessage = null;
  let isHandlingLink = false;

  const toolbarOptions = [
    [{ font: [] }],
    [{ header: [1, 2, false] }],
    [{ color: [] }, { background: [] }],
    ["bold", "italic", "underline", "strike"],
    ["blockquote", "code-block", { list: "ordered" }, { list: "bullet" }],
    [{ script: "sub" }, { script: "super" }],
    [{ indent: "-1" }, { indent: "+1" }],
    [{ align: [] }],
    ["link", "image"],
    ["clean"],
  ];

  function isEmptyContent(value) {
    if (!value) return true;
    return (
      typeof value === "object" &&
      Array.isArray(value.ops) &&
      (value.ops.length === 0 ||
        (value.ops.length === 1 && (value.ops[0].insert === "\n" || value.ops[0].insert === "")))
    );
  }

  function applyContent(nextContent) {
    if (!quill) return;

    if (isEmptyContent(nextContent)) {
      quill.setContents([{ insert: "\n" }]);
      return;
    }

    if (typeof nextContent === "string") {
      quill.setText(nextContent);
      return;
    }

    quill.setContents(nextContent);
  }

  function openExternalLink(href) {
    return window.electronAPI?.openExternalLink?.(href);
  }

  function handleLinkTooltips() {
    const handleLinkClick = async (e) => {
      if (!e.target?.classList?.contains("ql-preview")) return;

      const href = e.target.getAttribute("href");
      if (!href || href.trim() === "" || isHandlingLink) return;

      e.preventDefault();
      e.stopPropagation();

      if (quill?.theme?.tooltip) {
        quill.theme.tooltip.hide();
      }

      try {
        isHandlingLink = true;
        await openExternalLink(href);
      } catch {
        errorMessage = "Could not open link";
      } finally {
        isHandlingLink = false;
      }
    };

    linkClickListener = handleLinkClick;
    document.addEventListener("click", linkClickListener, false);
  }

  function handlePastePreservingLeadingNewlines() {
    const onPaste = (event) => {
      if (readOnly || !quill) return;

      const clipboardData = event.clipboardData;
      const pastedText = clipboardData?.getData("text/plain");
      const pastedHtml = clipboardData?.getData("text/html");
      const hasRichContent = typeof pastedHtml === "string" && pastedHtml.trim() !== "";
      const hasImageFile = Array.from(clipboardData?.items ?? []).some(
        (item) =>
          item.kind === "file" && typeof item.type === "string" && item.type.startsWith("image/")
      );

      if (hasRichContent || hasImageFile) return;
      if (typeof pastedText !== "string" || !pastedText.startsWith("\n")) return;

      event.preventDefault();
      event.stopPropagation();

      const selection = quill.getSelection(true) ?? {
        index: quill.getLength(),
        length: 0,
      };

      if (selection.length > 0) {
        quill.deleteText(selection.index, selection.length, "user");
      }

      quill.insertText(selection.index, pastedText, "user");
      quill.setSelection(selection.index + pastedText.length, 0, "silent");
    };

    pasteListener = onPaste;
    quill.root.addEventListener("paste", pasteListener, true);
  }

  onMount(() => {
    quill = new Quill(editor, {
      theme: "snow",
      modules: {
        toolbar: readOnly ? false : toolbarOptions,
        clipboard: {
          matchVisual: false,
        },
      },
    });

    applyContent(content);
    lastSavedContent = content;
    quill.enable(!readOnly);

    if (!readOnly) {
      quill.on("text-change", (_delta, _oldDelta, source) => {
        if (source !== "user") return;

        isEditing = true;
        const currentSelection = quill.hasFocus() ? quill.getSelection() : null;
        const contents = quill.getContents();
        lastSavedContent = contents;

        if (currentSelection) {
          saveMemo(contents, currentSelection);
        } else {
          saveMemo(contents);
        }

        setTimeout(() => {
          isEditing = false;
        }, 100);
      });

      quill.on("selection-change", (range, _oldRange, source) => {
        if (range && source === "user") {
          savedSelection = {
            index: range.index,
            length: range.length,
          };
        }
      });
    }

    handleLinkTooltips();
    handlePastePreservingLeadingNewlines();

    return () => {
      if (linkClickListener) {
        document.removeEventListener("click", linkClickListener, false);
        linkClickListener = null;
      }
      if (pasteListener && quill?.root) {
        quill.root.removeEventListener("paste", pasteListener, true);
        pasteListener = null;
      }

      isEditing = false;
      savedSelection = null;
      lastSavedContent = null;
      quill = null;
    };
  });

  $: if (quill && !isEditing) {
    const contentIsEmpty = isEmptyContent(content);
    const lastSavedIsEmpty = isEmptyContent(lastSavedContent);
    const needsUpdate =
      contentIsEmpty !== lastSavedIsEmpty ||
      (!contentIsEmpty && !isEqual(content, lastSavedContent));

    if (needsUpdate) {
      isEditing = true;
      applyContent(content);
      lastSavedContent = content;
      setTimeout(() => {
        isEditing = false;
      }, 50);
    }
  }

  $: if (quill) {
    quill.enable(!readOnly);
  }
</script>

<div class="wrapper">
  {#if errorMessage}
    <div class="error-banner" role="alert">
      <span>{errorMessage}</span>
      <button type="button" aria-label="Dismiss link error" on:click={() => (errorMessage = null)}>
        x
      </button>
    </div>
  {/if}
  <div bind:this={editor} class="editor"></div>
</div>

<style>
  .wrapper {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    border: none !important;
    color: var(--theme-color-Sub-light);
    background-color: var(--theme-color-Main-dark);
  }

  .editor {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--theme-color-Main-light);
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.75rem;
    background-color: var(--theme-color-Error-main, #c0392b);
    color: #fff;
    font-size: 0.875rem;
    flex-shrink: 0;
  }

  .error-banner button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.25rem;
  }

  :global(.ql-container) {
    flex: 1;
    min-height: 0;
    border-color: var(--theme-color-Sub-dark) !important;
    color: var(--theme-color-Sub-light);
    font-family: inherit;
  }

  :global(.ql-toolbar) {
    flex-shrink: 0;
    border-color: var(--theme-color-Sub-dark) !important;
    background-color: var(--theme-color-Main-dark);
  }

  :global(.ql-editor) {
    color: var(--theme-color-Sub-light);
    font-size: 0.9rem;
    line-height: 1.7;
  }

  :global(.ql-picker :not(.ql-active, :hover)) {
    color: var(--theme-color-Sub-light) !important;
  }

  :global(.ql-picker-options) {
    background-color: var(--theme-color-Main-light) !important;
  }

  :global(*:not(.ql-active, :hover) > svg > .ql-stroke) {
    stroke: var(--theme-color-Sub-light) !important;
  }

  :global(*:not(.ql-active, :hover) > svg > .ql-fill) {
    fill: var(--theme-color-Sub-light) !important;
  }
</style>
