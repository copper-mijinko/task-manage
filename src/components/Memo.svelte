<script>
  import { onMount, createEventDispatcher } from "svelte";
  import Quill from "quill";
  import "../..//node_modules/quill/dist/quill.snow.css";
  import { isEqual, debounce } from "lodash";

  export let saveMemo;
  export let content = "";
  export let memoIndex = 0; // メモのインデックスを受け取る

  let editor;
  // 編集中のフラグとカーソル位置を保存する変数
  let isEditing = false;
  let savedSelection = null;
  let lastSavedContent = null;
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

    // テキスト変更のみを検知して保存処理を行う
    quill.on("text-change", function (delta, oldDelta, source) {
      if (source === "user") {
        // 編集中フラグを設定
        isEditing = true;

        // 現在のカーソル位置を取得
        const currentSelection = quill.hasFocus() ? quill.getSelection() : null;

        // 内容を保存（カーソル位置も一緒に送信）
        const contents = quill.getContents();
        lastSavedContent = contents;

        // カーソル位置情報も一緒に送信
        if (currentSelection) {
          saveMemo(contents, memoIndex, currentSelection);
        } else {
          saveMemo(contents, memoIndex);
        }

        // 編集フラグをリセット
        setTimeout(() => {
          isEditing = false;
        }, 100);
      }
    });

    // カーソル位置の変更のみを検出（保存は行わない）
    quill.on("selection-change", function (range, oldRange, source) {
      if (range && source === "user") {
        // カーソル位置を保存（ローカルのみ）
        savedSelection = {
          index: range.index,
          length: range.length,
        };
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

      // すべてのリソース解放
      isEditing = false;
      savedSelection = null;
      lastSavedContent = null;
      quill = null;
    };
  });

  // 外部から更新されたコンテンツとの同期（編集中は同期しない）
  $: if (
    quill &&
    content &&
    !isEditing &&
    !isEqual(content, lastSavedContent)
  ) {
    // 一時的に編集中フラグを立てる（再描画防止）
    isEditing = true;

    // コンテンツを更新
    quill.setContents(content);
    lastSavedContent = content;

    // 外部更新後はカーソル位置を保存せずにシンプルに編集フラグのみリセット
    setTimeout(() => {
      // 編集フラグをリセット
      isEditing = false;
    }, 50);
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
