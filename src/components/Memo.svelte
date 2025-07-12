<script>
  import { onMount, createEventDispatcher } from "svelte";
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

  // リンク処理のための変数
  let isHandlingLink = false;

  // イベントリスナーの参照を保持する変数
  let linkClickListener;

  // Quillのリンクツールチップを処理するための関数
  function handleLinkTooltips() {
    // イベントハンドラー関数を定義
    const handleLinkClick = (e) => {
      // Visit (ql-preview) ボタンがクリックされた場合
      if (e.target && e.target.classList.contains("ql-preview")) {
        const href = e.target.getAttribute("href");
        if (href && href.trim() !== "") {
          // 既に処理中なら何もしない（二重実行防止）
          if (isHandlingLink) return;
          isHandlingLink = true;

          // クリックイベントのデフォルト動作を停止（内部ブラウザでの開封を防止）
          e.preventDefault();
          e.stopPropagation();

          // Quillの標準ツールチップを適切に閉じる
          if (quill && quill.theme && quill.theme.tooltip) {
            quill.theme.tooltip.hide();
          }

          // 外部ブラウザでリンクを開く
          window.electronAPI.openExternalLink(href);

          // フラグをリセット（次のリンククリックのため）
          // 適切な時間でリセットし、短時間での複数回クリックを防止
          setTimeout(() => {
            isHandlingLink = false;
          }, 300);
        }
      }
    };

    // 参照を保存してクリーンアップで使用できるようにする
    linkClickListener = handleLinkClick;

    // ドキュメント全体のクリックイベントリスナーを設定
    document.addEventListener("click", linkClickListener, false);
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
    });

    // リンクツールチップの処理をセットアップ
    handleLinkTooltips();

    // クリーンアップ関数を返す
    return () => {
      // コンポーネントがアンマウントされる時に必要なクリーンアップを行う

      // イベントリスナーを削除
      if (linkClickListener) {
        document.removeEventListener("click", linkClickListener, false);
        linkClickListener = null;
      }

      quill = null;
    };
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
