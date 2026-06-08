<script>
  import { onMount } from "svelte";
  import Quill from "quill";
  import quillIcons from "quill/ui/icons.js";
  import "quill/dist/quill.snow.css";
  import { isEqual } from "lodash";
  import { memoContentForCompare } from "@features/memos/utils/memo_utils";

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
  let visibleSpaceLayer = null;
  let visibleSpaceScrollListener = null;
  let visibleSpaceResizeListener = null;
  let visibleSpaceResizeObserver = null;
  let visibleSpaceBeforeInputListener = null;
  let visibleSpaceCompositionStartListener = null;
  let visibleSpaceCompositionEndListener = null;
  let visibleSpaceUpdateTimer = null;
  let visibleSpaceAnimationFrame = null;
  let editReleaseTimer;
  let errorMessage = null;
  let isHandlingLink = false;
  let isVisibleSpaceComposing = false;

  const codeBlockIconSvg =
    '<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">' +
    '<rect class="ql-stroke" x="2.5" y="3.5" width="13" height="11" rx="1.5" ry="1.5" fill="none"/>' +
    '<polyline class="ql-even ql-stroke" points="7 8 5.5 9.5 7 11"/>' +
    '<polyline class="ql-even ql-stroke" points="11 8 12.5 9.5 11 11"/>' +
    "</svg>";

  const formatToolbarLabels = {
    code: "インラインコード",
    "code-block": "コードブロック",
  };

  const formatToolbarIcons = {
    code: quillIcons.code,
    "code-block": codeBlockIconSvg,
  };

  const tableToolbarLabels = {
    insert: "表を挿入",
    "row-above": "行を上に追加",
    "row-below": "行を下に追加",
    "column-left": "列を左に追加",
    "column-right": "列を右に追加",
    "delete-row": "行を削除",
    "delete-column": "列を削除",
    "delete-table": "表を削除",
  };

  const tableToolbarActions = Object.keys(tableToolbarLabels);

  const toolbarOptions = [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "code"],
    ["link", { list: "bullet" }, "blockquote", "code-block"],
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

  function normalizeContent(value) {
    if (value && typeof value === "object" && Array.isArray(value.ops)) {
      return JSON.parse(JSON.stringify({ ops: value.ops }));
    }
    return value;
  }

  function releaseEditingAfter(delay) {
    if (editReleaseTimer) {
      clearTimeout(editReleaseTimer);
    }
    editReleaseTimer = setTimeout(() => {
      isEditing = false;
      editReleaseTimer = null;
    }, delay);
  }

  function restoreSelection(range) {
    if (!quill || !range || !quill.hasFocus()) return;

    const index = Math.max(0, Math.min(range.index, quill.getLength()));
    const length = Math.max(0, Math.min(range.length ?? 0, quill.getLength() - index));
    quill.setSelection(index, length, "silent");
  }

  function applyContent(nextContent) {
    if (!quill) return;

    if (isEmptyContent(nextContent)) {
      quill.setContents([{ insert: "\n" }]);
      scheduleVisibleSpaceOverlayUpdate();
      return;
    }

    if (typeof nextContent === "string") {
      quill.setText(nextContent);
      scheduleVisibleSpaceOverlayUpdate();
      return;
    }

    quill.setContents(nextContent);
    scheduleVisibleSpaceOverlayUpdate();
  }

  function openExternalLink(href) {
    return window.electronAPI?.openExternalLink?.(href);
  }

  function runTableAction(value) {
    const table = quill?.getModule?.("table");
    if (!table) return;

    // Interacting with the toolbar <select> blurs the editor, so
    // quill.getSelection() returns null at this point. Every table module
    // method (insertTable / insertRow* / deleteTable …) early-returns when the
    // selection is null, so the action would silently do nothing. Refocus the
    // editor and restore the last known caret position (falling back to the
    // end of the document) so the table module has a range to act on.
    quill.focus?.();
    if (!quill.getSelection()) {
      const fallback = savedSelection ?? { index: quill.getLength(), length: 0 };
      const index = Math.max(0, Math.min(fallback.index, quill.getLength()));
      const length = Math.max(0, Math.min(fallback.length ?? 0, quill.getLength() - index));
      quill.setSelection(index, length, "silent");
    }
    if (!quill.getSelection()) return;

    switch (value) {
      case "insert":
        table.insertTable(2, 2);
        return;
      case "row-above":
        table.insertRowAbove();
        return;
      case "row-below":
        table.insertRowBelow();
        return;
      case "column-left":
        table.insertColumnLeft();
        return;
      case "column-right":
        table.insertColumnRight();
        return;
      case "delete-row":
        table.deleteRow();
        return;
      case "delete-column":
        table.deleteColumn();
        return;
      case "delete-table":
        table.deleteTable();
        return;
      default:
    }
  }

  function installTableToolbarSelect() {
    const toolbar = quill?.getModule?.("toolbar")?.container;
    if (!toolbar || toolbar.querySelector(".memo-table-picker")) return;

    const group = document.createElement("span");
    group.className = "ql-formats memo-table-picker";

    const select = document.createElement("select");
    select.className = "memo-toolbar-select memo-table-select";
    select.setAttribute("aria-label", "Table");
    select.setAttribute("title", "Table");

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Table";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    for (const value of tableToolbarActions) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = tableToolbarLabels[value];
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      if (!select.value) return;
      runTableAction(select.value);
      select.value = "";
    });

    group.appendChild(select);
    toolbar.appendChild(group);
  }

  function labelToolbarButtons() {
    const toolbar = quill?.getModule?.("toolbar")?.container;
    if (!toolbar) return;

    for (const [value, label] of Object.entries(formatToolbarLabels)) {
      const button = toolbar.querySelector(`button.ql-${value}`);
      button?.setAttribute("aria-label", label);
      button?.setAttribute("title", label);
      if (button && formatToolbarIcons[value]) {
        button.innerHTML = formatToolbarIcons[value];
      }
    }

    installTableToolbarSelect();
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

  function getVisibleTextRect(range, textNode, offset) {
    if (typeof document.createRange !== "function") return null;
    if (typeof range.getClientRects !== "function") return null;

    range.setStart(textNode, offset);
    range.setEnd(textNode, offset + 1);

    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0 && rect.height > 0) return rect;
    }
    const rect = range.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function rectIntersectsRoot(rect, rootRect) {
    return (
      rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= rootRect.top &&
      rect.top <= rootRect.bottom &&
      rect.right >= rootRect.left &&
      rect.left <= rootRect.right
    );
  }

  function getVisibleEditorRect() {
    const rootRect = quill.root.getBoundingClientRect();
    const rootStyle = getComputedStyle(quill.root);
    const paddingLeft = Number.parseFloat(rootStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(rootStyle.paddingRight) || 0;
    const paddingTop = Number.parseFloat(rootStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(rootStyle.paddingBottom) || 0;

    return {
      top: rootRect.top + paddingTop,
      right: rootRect.left + quill.root.clientWidth - paddingRight,
      bottom: rootRect.top + quill.root.clientHeight - paddingBottom,
      left: rootRect.left + paddingLeft,
    };
  }

  function getElementContentRect(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;

    return {
      top: rect.top + paddingTop,
      right: rect.left + element.clientWidth - paddingRight,
      bottom: rect.top + element.clientHeight - paddingBottom,
      left: rect.left + paddingLeft,
    };
  }

  function intersectRects(a, b) {
    const rect = {
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
      left: Math.max(a.left, b.left),
    };

    return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
  }

  function getVisibleClipRectForTextNode(textNode, editorRect) {
    let clipRect = editorRect;
    let element = textNode.parentElement;

    while (element && element !== quill.root) {
      if (element.matches?.(".ql-code-block-container, td, th")) {
        clipRect = intersectRects(clipRect, getElementContentRect(element));
        if (!clipRect) return null;
      }
      element = element.parentElement;
    }

    return clipRect;
  }

  function rectCenterFitsVisibleClip(rect, clipRect) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    return (
      rect &&
      clipRect &&
      rect.width > 0 &&
      rect.height > 0 &&
      centerY >= clipRect.top &&
      centerY <= clipRect.bottom &&
      centerX >= clipRect.left &&
      centerX <= clipRect.right
    );
  }

  function textNodeIntersectsRoot(range, textNode, rootRect) {
    range.selectNodeContents(textNode);

    for (const rect of Array.from(range.getClientRects())) {
      if (rectIntersectsRoot(rect, rootRect)) return true;
    }

    return rectIntersectsRoot(range.getBoundingClientRect?.(), rootRect);
  }

  function createVisibleSpaceMarker(character, rect, layerRect) {
    const marker = document.createElement("div");
    const kind = character === " " ? "half" : "full";
    marker.className = `quill-visible-space-marker quill-visible-${kind}-space-marker`;

    const charLeft = rect.left - layerRect.left;
    const charTop = rect.top - layerRect.top;
    const charWidth = rect.right - rect.left;
    const charHeight = rect.bottom - rect.top;
    const size =
      kind === "half"
        ? Math.max(2, Math.min(charWidth, charHeight) * 0.14)
        : Math.max(8, Math.min(charWidth, charHeight) * 0.62);

    marker.style.left = `${charLeft + (charWidth - size) / 2}px`;
    marker.style.top =
      kind === "half"
        ? `${charTop + (charHeight - size) * 0.56}px`
        : `${charTop + (charHeight - size) / 2}px`;
    marker.style.width = `${size}px`;
    marker.style.height = `${size}px`;
    return marker;
  }

  function isVisibleSpaceTextNode(node) {
    if (!node.textContent || !/[ \u3000]/.test(node.textContent)) return false;
    const parent = node.parentElement;
    if (!parent || parent.closest(".ql-cursor")) return false;
    return true;
  }

  function renderVisibleSpaceOverlay() {
    if (!quill?.root || !visibleSpaceLayer) return;
    if (isVisibleSpaceComposing) return;
    if (typeof document.createRange !== "function") return;

    const layerRect = visibleSpaceLayer.getBoundingClientRect();
    const rootRect = quill.root.getBoundingClientRect();
    const visibleRect = getVisibleEditorRect();
    if (
      layerRect.width <= 0 ||
      layerRect.height <= 0 ||
      rootRect.width <= 0 ||
      rootRect.height <= 0
    ) {
      return;
    }

    const range = document.createRange();
    const fragment = document.createDocumentFragment();
    const walker = document.createTreeWalker(quill.root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isVisibleSpaceTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    let textNode = walker.nextNode();
    while (textNode) {
      const text = textNode.textContent ?? "";
      if (!textNodeIntersectsRoot(range, textNode, rootRect)) {
        textNode = walker.nextNode();
        continue;
      }
      const clipRect = getVisibleClipRectForTextNode(textNode, visibleRect);
      if (!clipRect) {
        textNode = walker.nextNode();
        continue;
      }

      for (let offset = 0; offset < text.length; offset += 1) {
        const character = text[offset];
        if (character !== " " && character !== "\u3000") continue;

        const rect = getVisibleTextRect(range, textNode, offset);
        if (!rectIntersectsRoot(rect, rootRect)) continue;
        if (!rectCenterFitsVisibleClip(rect, clipRect)) continue;

        fragment.appendChild(createVisibleSpaceMarker(character, rect, layerRect));
      }
      textNode = walker.nextNode();
    }

    range.detach?.();
    visibleSpaceLayer.replaceChildren(fragment);
  }

  function cancelVisibleSpaceOverlayUpdate() {
    if (visibleSpaceUpdateTimer !== null) {
      clearTimeout(visibleSpaceUpdateTimer);
      visibleSpaceUpdateTimer = null;
    }
    if (visibleSpaceAnimationFrame !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(visibleSpaceAnimationFrame);
      } else {
        clearTimeout(visibleSpaceAnimationFrame);
      }
      visibleSpaceAnimationFrame = null;
    }
  }

  function clearVisibleSpaceOverlay() {
    visibleSpaceLayer?.replaceChildren();
  }

  function scheduleVisibleSpaceOverlayUpdate(delay = 0) {
    if (!quill?.root || !visibleSpaceLayer) return;
    if (isVisibleSpaceComposing) return;

    if (visibleSpaceUpdateTimer !== null) {
      clearTimeout(visibleSpaceUpdateTimer);
      visibleSpaceUpdateTimer = null;
    }

    const requestUpdate = () => {
      visibleSpaceUpdateTimer = null;
      if (visibleSpaceAnimationFrame !== null) return;

      const runUpdate = () => {
        visibleSpaceAnimationFrame = null;
        renderVisibleSpaceOverlay();
      };

      visibleSpaceAnimationFrame =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(runUpdate)
          : setTimeout(runUpdate, 16);
    };

    if (delay > 0) {
      visibleSpaceUpdateTimer = setTimeout(requestUpdate, delay);
      return;
    }

    requestUpdate();
  }

  function scheduleVisibleSpaceTypingUpdate() {
    scheduleVisibleSpaceOverlayUpdate();
  }

  function scheduleVisibleSpaceLayoutUpdate() {
    scheduleVisibleSpaceOverlayUpdate();
  }

  function installVisibleSpaceOverlay() {
    if (!quill?.root || visibleSpaceLayer) return;

    const host = quill.root.parentElement;
    if (!host) return;

    host.classList.add("quill-visible-space-host");

    visibleSpaceLayer = document.createElement("div");
    visibleSpaceLayer.className = "quill-visible-space-layer";
    visibleSpaceLayer.setAttribute("aria-hidden", "true");

    host.appendChild(visibleSpaceLayer);

    visibleSpaceScrollListener = scheduleVisibleSpaceLayoutUpdate;
    quill.root.addEventListener("scroll", visibleSpaceScrollListener, { passive: true });
    visibleSpaceBeforeInputListener = (event) => {
      if (event.isComposing || event.inputType === "insertCompositionText") {
        clearVisibleSpaceOverlay();
      }
    };
    quill.root.addEventListener("beforeinput", visibleSpaceBeforeInputListener, true);
    visibleSpaceCompositionStartListener = () => {
      isVisibleSpaceComposing = true;
      cancelVisibleSpaceOverlayUpdate();
      clearVisibleSpaceOverlay();
    };
    quill.root.addEventListener("compositionstart", visibleSpaceCompositionStartListener, true);
    visibleSpaceCompositionEndListener = () => {
      isVisibleSpaceComposing = false;
      scheduleVisibleSpaceLayoutUpdate();
    };
    quill.root.addEventListener("compositionend", visibleSpaceCompositionEndListener, true);
    visibleSpaceResizeListener = scheduleVisibleSpaceLayoutUpdate;
    window.addEventListener("resize", visibleSpaceResizeListener, { passive: true });
    if (typeof ResizeObserver === "function") {
      visibleSpaceResizeObserver = new ResizeObserver(scheduleVisibleSpaceLayoutUpdate);
      visibleSpaceResizeObserver.observe(host);
      visibleSpaceResizeObserver.observe(quill.root);
    }
    scheduleVisibleSpaceLayoutUpdate();
  }

  function removeVisibleSpaceOverlay() {
    cancelVisibleSpaceOverlayUpdate();
    if (visibleSpaceScrollListener && quill?.root) {
      quill.root.removeEventListener("scroll", visibleSpaceScrollListener);
    }
    if (visibleSpaceBeforeInputListener && quill?.root) {
      quill.root.removeEventListener("beforeinput", visibleSpaceBeforeInputListener, true);
    }
    if (visibleSpaceCompositionStartListener && quill?.root) {
      quill.root.removeEventListener(
        "compositionstart",
        visibleSpaceCompositionStartListener,
        true
      );
    }
    if (visibleSpaceCompositionEndListener && quill?.root) {
      quill.root.removeEventListener("compositionend", visibleSpaceCompositionEndListener, true);
    }
    if (visibleSpaceResizeListener) {
      window.removeEventListener("resize", visibleSpaceResizeListener);
    }
    visibleSpaceResizeObserver?.disconnect();
    visibleSpaceResizeObserver = null;
    visibleSpaceBeforeInputListener = null;
    visibleSpaceCompositionStartListener = null;
    visibleSpaceCompositionEndListener = null;
    visibleSpaceScrollListener = null;
    visibleSpaceResizeListener = null;
    isVisibleSpaceComposing = false;
    visibleSpaceLayer?.remove();
    visibleSpaceLayer = null;
  }

  onMount(() => {
    quill = new Quill(editor, {
      theme: "snow",
      modules: {
        table: true,
        toolbar: readOnly
          ? false
          : {
              container: toolbarOptions,
            },
        clipboard: {
          matchVisual: false,
        },
      },
    });
    labelToolbarButtons();

    const initialContent = normalizeContent(content);
    applyContent(initialContent);
    installVisibleSpaceOverlay();
    lastSavedContent = initialContent;
    quill.enable(!readOnly);

    if (!readOnly) {
      quill.on("text-change", (_delta, _oldDelta, source) => {
        if (source !== "user") return;

        isEditing = true;
        const currentSelection = quill.hasFocus() ? quill.getSelection() : null;
        const contents = normalizeContent(quill.getContents());
        lastSavedContent = contents;
        if (currentSelection) {
          savedSelection = {
            index: currentSelection.index,
            length: currentSelection.length,
          };
        }

        if (currentSelection) {
          saveMemo(contents, currentSelection);
        } else {
          saveMemo(contents);
        }

        scheduleVisibleSpaceTypingUpdate();
        releaseEditingAfter(100);
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

      if (editReleaseTimer) {
        clearTimeout(editReleaseTimer);
        editReleaseTimer = null;
      }
      removeVisibleSpaceOverlay();
      isEditing = false;
      savedSelection = null;
      lastSavedContent = null;
      quill = null;
    };
  });

  $: if (quill && !isEditing) {
    const normalizedContent = normalizeContent(content);
    const normalizedLastSavedContent = normalizeContent(lastSavedContent);
    const contentIsEmpty = isEmptyContent(normalizedContent);
    const lastSavedIsEmpty = isEmptyContent(normalizedLastSavedContent);
    const needsUpdate =
      contentIsEmpty !== lastSavedIsEmpty ||
      (!contentIsEmpty &&
        !isEqual(
          memoContentForCompare(normalizedContent),
          memoContentForCompare(normalizedLastSavedContent)
        ));

    if (needsUpdate) {
      isEditing = true;
      applyContent(normalizedContent);
      restoreSelection(savedSelection);
      lastSavedContent = normalizedContent;
      scheduleVisibleSpaceOverlayUpdate();
      releaseEditingAfter(50);
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
    --memo-editor-font:
      "BIZ UDゴシック", "BIZ UDGothic", "ＭＳ ゴシック", "MS Gothic", "Cascadia Mono",
      "Cascadia Code", Consolas, "Courier New", monospace;

    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border: none !important;
    color: var(--theme-color-Sub-light);
    background-color: var(--theme-color-Main-dark);
  }

  .editor {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: auto;
    background-color: var(--theme-color-Main-light);
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp1) var(--sp3);
    background-color: var(--theme-color-Error-main, #c0392b);
    color: #fff;
    font-size: var(--font-body-md);
    flex-shrink: 0;
  }

  .error-banner button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 var(--sp1);
  }

  .wrapper :global(.ql-container.ql-snow) {
    display: flex;
    flex: 1 1 0 !important;
    flex-direction: column;
    min-height: 0 !important;
    min-width: 0;
    height: auto !important;
    overflow: hidden;
    border-color: var(--theme-color-Sub-dark) !important;
    border-top: 0 !important;
    color: var(--theme-color-Sub-light);
    font-family: var(--memo-editor-font);
  }

  .wrapper :global(.ql-toolbar) {
    flex-shrink: 0;
    padding: var(--sp1) var(--sp2) !important;
    border-color: var(--theme-color-Sub-dark) !important;
    background-color: var(--theme-color-Main-dark);
  }

  /* Compact (flat) mode strips Quill's internal frame so the editor
     runs edge-to-edge inside the Card, matching MarkdownMemo's
     --memo-wrapper-border: none behavior. */
  :global(.density-compact) .wrapper :global(.ql-container.ql-snow),
  :global(.density-compact) .wrapper :global(.ql-toolbar) {
    border: none !important;
  }

  .wrapper :global(.ql-toolbar .ql-formats) {
    margin-right: var(--sp1) !important;
  }

  .wrapper :global(.ql-toolbar .memo-table-picker) {
    position: relative;
    display: inline-block;
    height: 24px;
    color: var(--theme-color-Sub-light);
    vertical-align: middle;
  }

  .wrapper :global(.ql-toolbar .memo-table-picker::after) {
    content: "";
    position: absolute;
    top: 50%;
    right: 6px;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: translateY(-65%) rotate(45deg);
    pointer-events: none;
  }

  .wrapper :global(.ql-toolbar .memo-toolbar-select) {
    appearance: none;
    width: 112px;
    height: 24px;
    padding: 0 20px 0 8px;
    margin: 0;
    border: none;
    border-radius: 0;
    outline: none;
    color: inherit;
    background: transparent;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    line-height: 24px;
  }

  .wrapper :global(.ql-toolbar .memo-table-picker:hover),
  .wrapper :global(.ql-toolbar .memo-table-picker:focus-within) {
    color: #06c;
  }

  .wrapper :global(.ql-toolbar .memo-toolbar-select option) {
    color: var(--theme-color-Sub-light);
    background-color: var(--theme-color-Main-light);
  }

  .wrapper :global(.ql-editor) {
    position: relative;
    z-index: 1;
    flex: 1 1 auto;
    height: auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--sp2) var(--sp3);
    color: var(--theme-color-Sub-light);
    font-family: var(--memo-editor-font);
    font-size: var(--font-body-md);
    font-kerning: none;
    font-variant-ligatures: none;
    font-feature-settings:
      "liga" 0,
      "calt" 0;
    line-height: 1.55;
    white-space: break-spaces;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .wrapper :global(.quill-visible-space-host) {
    position: relative;
  }

  .wrapper :global(.quill-visible-space-layer) {
    position: absolute;
    inset: 0;
    z-index: 2;
    overflow: hidden;
    pointer-events: none;
  }

  .wrapper :global(.quill-visible-space-marker) {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
  }

  .wrapper :global(.quill-visible-half-space-marker) {
    border-radius: 50%;
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 46%, transparent);
  }

  .wrapper :global(.quill-visible-full-space-marker) {
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 42%, transparent);
  }

  .wrapper :global(.ql-editor code),
  .wrapper :global(.ql-editor .ql-code-block-container) {
    font-family: var(--memo-editor-font);
  }

  .wrapper :global(.ql-editor code) {
    font-size: 0.85em;
    color: var(--theme-color-Sub-light);
    background-color: var(--theme-color-Main-dark);
    padding: 0.1em 0.35em;
    border-radius: var(--shape-xs);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 20%, transparent);
  }

  .wrapper :global(.ql-editor .ql-code-block-container) {
    color: var(--theme-color-Sub-light);
    background-color: var(--theme-color-Main-dark);
    padding: var(--sp2) var(--sp3);
    border-radius: var(--shape-sm);
    overflow-x: visible;
    margin: 0.75em 0;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 25%, transparent);
    white-space: break-spaces;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .wrapper :global(.ql-editor table) {
    border-collapse: collapse;
    table-layout: fixed;
    width: 100%;
    margin: 0.5em 0;
    color: var(--theme-color-Sub-light);
    font-size: var(--font-body-md);
  }

  .wrapper :global(.ql-editor table th),
  .wrapper :global(.ql-editor table td) {
    border: 1px solid var(--theme-color-Sub-dark);
    padding: 0.3em 0.6em;
    min-width: 2.5rem;
    vertical-align: top;
    white-space: break-spaces;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .wrapper :global(.ql-editor .ql-code-block) {
    white-space: break-spaces;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .wrapper :global(.ql-editor table th),
  .wrapper :global(.ql-editor table tr:first-child td) {
    background-color: var(--theme-color-Main-dark);
    font-weight: 700;
  }

  .wrapper :global(.ql-editor table p) {
    margin: 0;
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
