<script lang="ts">
  import Modal from "@lib/primitives/Modal.svelte";
  import SegmentedControl from "@lib/primitives/SegmentedControl.svelte";
  import {
    date_time_format,
    ui_density,
    type DateFormat,
    type UiDensity,
  } from "@stores/preferences";
  import { formatDate, formatTime } from "@lib/utils/datetime_shortcuts";

  export let show = false;
  export let toggle: () => void;

  type CategoryId = "appearance" | "datetime-format" | "shortcuts" | "about";

  type ShortcutGroup = {
    title: string;
    items: { keys: string[]; description: string }[];
  };

  /**
   * ショートカットは各所のツールチップにしか出ておらず、一覧で確認する場所が
   * なかった。実装箇所（App.svelte / Header.svelte / TreeTable.svelte /
   * datetime_shortcuts.ts）に合わせてここへ集約する。
   */
  const shortcutGroups: ShortcutGroup[] = [
    {
      title: "全体",
      items: [
        { keys: ["Ctrl", "F"], description: "画面内をハイライト検索" },
        { keys: ["F3"], description: "次の検索結果へ（Shift+F3 で前へ / Ctrl+G も同じ）" },
        { keys: ["Ctrl", "Shift", "I"], description: "Inbox にクイック追加" },
        { keys: ["Alt", "←"], description: "前のページへ戻る" },
        { keys: ["Alt", "→"], description: "次のページへ進む" },
      ],
    },
    {
      title: "タスクツリー",
      items: [
        { keys: ["Ctrl", "A"], description: "表示中のタスクをすべて選択" },
        { keys: ["Esc"], description: "選択を解除" },
        { keys: ["Delete"], description: "選択したタスクをアーカイブ / 削除" },
        { keys: ["Ctrl", "C"], description: "選択したタスクをコピー" },
        { keys: ["Ctrl", "V"], description: "コピーしたタスクを子として貼り付け" },
        { keys: ["Ctrl", "Z"], description: "元に戻す" },
        { keys: ["Ctrl", "Y"], description: "やり直す（Ctrl+Shift+Z も同じ）" },
      ],
    },
    {
      title: "テキスト入力中",
      items: [
        { keys: ["Ctrl", ";"], description: "今日の日付を挿入" },
        { keys: ["Ctrl", ":"], description: "現在時刻を挿入" },
        { keys: ["Ctrl", "B"], description: "太字（Markdown メモ）" },
        { keys: ["Ctrl", "I"], description: "斜体（Markdown メモ）" },
        { keys: ["Ctrl", "K"], description: "リンク（Markdown メモ）" },
      ],
    },
    {
      title: "ウィンドウ",
      items: [
        { keys: ["Ctrl", "+"], description: "拡大（Ctrl+マウスホイールも同じ）" },
        { keys: ["Ctrl", "-"], description: "縮小" },
        { keys: ["Ctrl", "0"], description: "拡大率をリセット" },
      ],
    },
  ];

  type Category = {
    id: CategoryId;
    label: string;
    /** Optional short hint shown under the label in the sidebar. */
    description?: string;
  };

  const categories: Category[] = [
    {
      id: "appearance",
      label: "外観",
      description: "表示密度・フラットモード",
    },
    {
      id: "datetime-format",
      label: "日時フォーマット",
      description: "Ctrl+; / Ctrl+: で挿入する書式",
    },
    {
      id: "shortcuts",
      label: "ショートカット",
      description: "キーボード操作の一覧",
    },
    {
      id: "about",
      label: "バージョン情報",
      description: "アプリのバージョンを確認",
    },
  ];

  const appVersion = __APP_VERSION__;
  const appName = __APP_NAME__;

  let selected: CategoryId = categories[0].id;

  // Reset selection + refresh preview every time the modal opens.
  let now = new Date();
  $: if (show) {
    now = new Date();
    selected = categories[0].id;
  }

  const formatOptions = [
    { value: "slash", label: "2026/05/26" },
    { value: "iso", label: "2026-05-26" },
    { value: "japanese", label: "2026年5月26日" },
  ];

  const densityOptions = [
    { value: "comfortable", label: "標準" },
    { value: "compact", label: "コンパクト" },
  ];

  $: previewDate = formatDate(now, $date_time_format);
  $: previewTime = formatTime(now, $date_time_format);

  function handleFormatChange(event: CustomEvent<{ value: string }>) {
    date_time_format.set(event.detail.value as DateFormat);
  }

  function handleDensityChange(event: CustomEvent<{ value: string }>) {
    ui_density.set(event.detail.value as UiDensity);
  }
</script>

<Modal {show} {toggle} width="80%" height="80%" label="設定">
  <div class="Container">
    <header class="Header">
      <h2 class="Title">設定</h2>
      <button type="button" class="CloseBtn" on:click={toggle} aria-label="閉じる">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6 6L18 18M18 6L6 18"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
        </svg>
      </button>
    </header>

    <div class="Body">
      <nav class="Sidebar" aria-label="設定カテゴリ">
        <ul class="CategoryList">
          {#each categories as cat (cat.id)}
            <li>
              <button
                type="button"
                class="CategoryRow"
                class:Selected={selected === cat.id}
                aria-current={selected === cat.id ? "page" : undefined}
                on:click={() => (selected = cat.id)}
              >
                <span class="CategoryLabel">{cat.label}</span>
                {#if cat.description}
                  <span class="CategoryDesc">{cat.description}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </nav>

      <section class="Detail" aria-live="polite">
        {#if selected === "appearance"}
          <header class="DetailHeader">
            <h3 class="DetailTitle">外観</h3>
            <p class="DetailHint">
              <strong>標準</strong>はカードに影と丸みを付けた既定の見た目です。
              <strong>コンパクト</strong
              >はVSCode風のフラットレイアウトで、影と角の丸みを消し、余白を詰めて密度を上げます。
            </p>
          </header>

          <div class="Field">
            <span class="FieldLabel">表示密度</span>
            <SegmentedControl
              options={densityOptions}
              value={$ui_density}
              ariaLabel="表示密度"
              size="md"
              on:change={handleDensityChange}
            />
          </div>

          <p class="Note">
            <strong>補足:</strong>
            切り替えは即時反映され、次回起動時にも復元されます。テーマ（Dark / Light）の選択とは独立して機能します。
          </p>
        {:else if selected === "datetime-format"}
          <header class="DetailHeader">
            <h3 class="DetailTitle">日時フォーマット</h3>
            <p class="DetailHint">
              テキスト入力で <kbd>Ctrl</kbd>+<kbd>;</kbd> を押すと日付、
              <kbd>Ctrl</kbd>+<kbd>:</kbd> を押すと時刻が現在のカーソル位置に挿入されます。 ここで挿入時の表記を切り替えられます。
            </p>
          </header>

          <div class="Field">
            <span class="FieldLabel">日付の表記</span>
            <SegmentedControl
              options={formatOptions}
              value={$date_time_format}
              ariaLabel="日付・時刻フォーマット"
              size="md"
              on:change={handleFormatChange}
            />
          </div>

          <div class="Preview">
            <span class="PreviewLabel">プレビュー</span>
            <div class="PreviewRow">
              <span class="PreviewKey">日付 (Ctrl+;)</span>
              <code class="PreviewValue">{previewDate}</code>
            </div>
            <div class="PreviewRow">
              <span class="PreviewKey">時刻 (Ctrl+:)</span>
              <code class="PreviewValue">{previewTime}</code>
            </div>
          </div>

          <p class="Note">
            <strong>補足:</strong>
            <code>&lt;input type="date"&gt;</code> や <code>&lt;input type="time"&gt;</code>
            では仕様上 ISO 形式が必要なため、ここでの設定にかかわらず YYYY-MM-DD / HH:MM 形式で値がセットされます。
          </p>
        {:else if selected === "shortcuts"}
          <header class="DetailHeader">
            <h3 class="DetailTitle">ショートカット</h3>
            <p class="DetailHint">
              テキスト入力中は、入力欄向けのショートカット以外は入力側が優先されます。
            </p>
          </header>

          <div class="ShortcutGroups">
            {#each shortcutGroups as group (group.title)}
              <section class="ShortcutGroup">
                <h4 class="ShortcutGroupTitle">{group.title}</h4>
                <dl class="ShortcutList">
                  {#each group.items as item (item.description)}
                    <div class="ShortcutRow">
                      <dt class="ShortcutKeys">
                        {#each item.keys as key, index (key + index)}
                          {#if index > 0}<span class="ShortcutPlus" aria-hidden="true">+</span>{/if}
                          <kbd>{key}</kbd>
                        {/each}
                      </dt>
                      <dd class="ShortcutDesc">{item.description}</dd>
                    </div>
                  {/each}
                </dl>
              </section>
            {/each}
          </div>
        {:else if selected === "about"}
          <header class="DetailHeader">
            <h3 class="DetailTitle">バージョン情報</h3>
            <p class="DetailHint">現在インストールされているアプリのバージョンです。</p>
          </header>

          <dl class="AboutList">
            <div class="AboutRow">
              <dt class="AboutKey">アプリ名</dt>
              <dd class="AboutValue">{appName}</dd>
            </div>
            <div class="AboutRow">
              <dt class="AboutKey">バージョン</dt>
              <dd class="AboutValue"><code>{appVersion}</code></dd>
            </div>
          </dl>
        {/if}
      </section>
    </div>
  </div>
</Modal>

<style>
  .Container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background-color: var(--theme-color-Main-light);
    border-radius: var(--shape-md);
    overflow: hidden;
  }
  .Header {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp3) var(--sp4);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 20%, transparent);
    background-color: var(--theme-color-Main-main);
    flex-shrink: 0;
  }
  .Title {
    flex: 1 1 auto;
    margin: 0;
    font-size: var(--font-title-md);
    font-weight: 600;
    color: var(--theme-color-Sub-main);
  }
  .CloseBtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    color: var(--theme-color-Sub-main);
    border-radius: var(--shape-xs);
    cursor: pointer;
  }
  .CloseBtn:hover {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
  .CloseBtn svg {
    width: 1.1rem;
    height: 1.1rem;
  }

  .Body {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
  }

  .Sidebar {
    flex: 0 0 18rem;
    min-width: 0;
    border-right: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    background-color: var(--theme-color-Main-main);
    overflow-y: auto;
    padding: var(--sp2) 0;
  }
  .CategoryList {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .CategoryRow {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: var(--sp2) var(--sp3);
    border: none;
    background: transparent;
    color: var(--theme-color-Sub-light);
    cursor: pointer;
    text-align: left;
    border-left: 3px solid transparent;
    transition: background-color 0.12s ease;
  }
  .CategoryRow:hover {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 8%, transparent);
  }
  .CategoryRow:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -2px;
  }
  .CategoryRow.Selected {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
    border-left-color: var(--theme-color-Primary-main);
  }
  .CategoryLabel {
    font-size: var(--font-body-md);
    font-weight: 500;
    color: var(--theme-color-Sub-light);
  }
  .CategoryDesc {
    font-size: var(--font-label-sm);
    color: var(--theme-color-Sub-main);
    line-height: 1.4;
  }

  .Detail {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    padding: var(--sp4) var(--sp4) var(--sp4);
    display: flex;
    flex-direction: column;
    gap: var(--sp3);
  }
  .DetailHeader {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
  }
  .DetailTitle {
    margin: 0;
    font-size: var(--font-title-md);
    font-weight: 600;
    color: var(--theme-color-Sub-light);
  }
  .DetailHint {
    margin: 0;
    font-size: var(--font-body-sm);
    color: var(--theme-color-Sub-main);
    line-height: 1.6;
  }

  .Field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp3);
    padding: var(--sp3);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    border-radius: var(--shape-sm);
    background-color: var(--theme-color-Main-main);
  }
  .FieldLabel {
    font-size: var(--font-body-md);
    font-weight: 500;
    color: var(--theme-color-Sub-light);
  }

  .Preview {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
    padding: var(--sp3);
    border: 1px dashed color-mix(in srgb, var(--theme-color-Sub-main) 28%, transparent);
    border-radius: var(--shape-sm);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 4%, transparent);
  }
  .PreviewLabel {
    font-size: var(--font-label-sm);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--theme-color-Sub-main);
  }
  .PreviewRow {
    display: flex;
    align-items: center;
    gap: var(--sp3);
    padding: var(--sp1) 0;
  }
  .PreviewKey {
    flex: 0 0 8rem;
    font-size: var(--font-body-sm);
    color: var(--theme-color-Sub-main);
  }
  .PreviewValue {
    padding: 2px var(--sp2);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    font-family: "Consolas", "Courier New", monospace;
    font-size: var(--font-body-sm);
    color: var(--theme-color-Sub-light);
  }

  .Note {
    margin: 0;
    padding: var(--sp2) var(--sp3);
    border-left: 3px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 5%, transparent);
    font-size: var(--font-label-md);
    color: var(--theme-color-Sub-main);
    line-height: 1.6;
  }
  .ShortcutGroups {
    display: grid;
    /* 説明が折り返さない幅を優先する。狭いときは 1 列、広い設定画面では
       2 列に自然に増える。 */
    grid-template-columns: repeat(auto-fit, minmax(24rem, 1fr));
    gap: var(--sp4);
    align-content: start;
  }

  .ShortcutGroup {
    min-width: 0;
  }

  .ShortcutGroupTitle {
    margin: 0 0 var(--sp1);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: none;
  }

  .ShortcutList {
    display: flex;
    flex-direction: column;
    margin: 0;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    border-radius: var(--shape-sm);
    overflow: hidden;
  }

  .ShortcutRow {
    display: flex;
    align-items: baseline;
    gap: var(--sp3);
    padding: var(--sp2) var(--sp3);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }

  .ShortcutRow:last-child {
    border-bottom: none;
  }

  .ShortcutKeys {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 0 0 auto;
    min-width: 6.5rem;
    margin: 0;
  }

  .ShortcutPlus {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 55%, transparent);
    font-size: var(--font-label-sm);
  }

  .ShortcutDesc {
    margin: 0;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 85%, transparent);
    font-size: var(--font-body-sm);
  }

  .AboutList {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    border-radius: var(--shape-sm);
    background-color: var(--theme-color-Main-main);
    overflow: hidden;
  }
  .AboutRow {
    display: flex;
    align-items: center;
    gap: var(--sp3);
    padding: var(--sp2) var(--sp3);
    border-top: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
  }
  .AboutRow:first-child {
    border-top: none;
  }
  .AboutKey {
    flex: 0 0 8rem;
    margin: 0;
    font-size: var(--font-body-sm);
    font-weight: 500;
    color: var(--theme-color-Sub-main);
  }
  .AboutValue {
    flex: 1 1 auto;
    margin: 0;
    font-size: var(--font-body-md);
    color: var(--theme-color-Sub-light);
  }
  .AboutValue code {
    padding: 2px var(--sp2);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 18%, transparent);
    font-family: "Consolas", "Courier New", monospace;
    font-size: var(--font-body-sm);
  }
  .Note code {
    padding: 0 4px;
    border-radius: var(--shape-xs);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 14%, transparent);
    font-family: "Consolas", "Courier New", monospace;
    font-size: 0.95em;
  }
  .Note strong {
    color: var(--theme-color-Sub-light);
  }
  .DetailHint kbd,
  .ShortcutKeys kbd {
    display: inline-block;
    padding: 0 var(--sp1);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 35%, transparent);
    border-bottom-width: 2px;
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    font-family: "Consolas", "Courier New", monospace;
    font-size: 0.85em;
    color: var(--theme-color-Sub-light);
  }
</style>
