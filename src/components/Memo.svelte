<script>
  import { onMount } from "svelte";
  import Quill from "quill";
  import "../..//node_modules/quill/dist/quill.snow.css";
  import { isEqual } from "lodash";

  export let saveMemo;
  export let content = "";

  let editor;
  let toolbarOptions = [
    [{ font: [] }],
    [{ header: [1, 2, false] }],
    [{ color: [] }, { background: [] }], // dropdown with defaults from theme
    ["bold", "italic", "underline", "strike"], // toggled buttons
    ["blockquote", "code-block", { list: "ordered" }, { list: "bullet" }],
    [{ script: "sub" }, { script: "super" }], // superscript/subscript
    [{ indent: "-1" }, { indent: "+1" }], // outdent/indent
    [{ align: [] }],
    ["link", "image"],
    ["clean"], // remove formatting button
  ];
  let quill = null;

  // ql-previewクリックをハンドルする関数
  function setupLinkHandlers() {
    setTimeout(() => {
      const tooltipPreviews = document.querySelectorAll(
        ".ql-tooltip.ql-editing a.ql-action",
      );
      if (tooltipPreviews.length) {
        // リンク保存ボタンがクリックされた後にプレビューハンドラを設定する
        tooltipPreviews.forEach((preview) => {
          preview.addEventListener("click", () => {
            setTimeout(() => setupPreviewHandlers(), 100);
          });
        });
      }

      // 既存のプレビューリンクにもハンドラを設定
      setupPreviewHandlers();
    }, 100);
  }

  // プレビューリンクのハンドラを設定
  function setupPreviewHandlers() {
    const previewLinks = document.querySelectorAll(
      ".ql-tooltip:not(.ql-editing) .ql-preview",
    );
    previewLinks.forEach((link) => {
      if (!link.dataset.handlerAttached) {
        link.dataset.handlerAttached = "true";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const href = link.getAttribute("href");
          if (href) {
            window.electronAPI.openExternalLink(href);

            // tooltipを閉じる
            const tooltip = link.closest(".ql-tooltip");
            if (tooltip) {
              tooltip.style.display = "none";

              // エディタにフォーカスを戻す
              if (quill) {
                quill.focus();
              }
            }
          }
        });
      }
    });
  }

  onMount(() => {
    quill = new Quill(editor, {
      theme: "snow",
      modules: {
        toolbar: toolbarOptions,
      },
    });
    if (content) {
      quill.setContents(content);
    }
    quill.on("editor-change", function (eventName, args) {
      if (content != quill.getContents()) {
        saveMemo(quill.getContents());
      }

      // エディタの変更時にリンクハンドラをセットアップ
      setupLinkHandlers();
    });

    // 初期セットアップ
    setupLinkHandlers();

    // ドキュメント全体のクリックイベントでもチェック
    document.addEventListener("click", (e) => {
      // リンク挿入時または編集時にプレビューハンドラをセットアップ
      if (
        e.target &&
        (e.target.classList.contains("ql-link") ||
          (e.target.parentElement &&
            e.target.parentElement.classList.contains("ql-link")))
      ) {
        setupLinkHandlers();
      }
    });
  });

  $: if (quill && !isEqual(quill.getContents(), content)) {
    quill.setContents(content);
  }
</script>

<div class="wrapper">
  <div bind:this={editor} class="editor" on:blur />
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
