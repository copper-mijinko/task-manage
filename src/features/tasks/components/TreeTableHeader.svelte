<script>
  import { getContext, tick } from "svelte";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  const application = getContext(TREEGRID_APPLICATION);
  import { filter } from "@stores";
  import { tag_index } from "@features/memos/stores/tags";
  import { viewportPopover } from "@lib/actions/viewport_popover";
  let openTagPanel = $state(false);
  let tagAnchorRect = $state(null);
  import { column_settings } from "@features/tasks/stores/column_settings";
  import { readColumnWidths, saveColumnWidths } from "@features/tasks/stores/column_layout";
  let panelTrigger;
  let widths = $state(readColumnWidths());
  function setWidth(id, event) {
    const width = Number(event.target.value);
    if (!Number.isFinite(width) || width < 32 || width > 4000) return;
    saveColumnWidths({ [id]: width });
    widths = readColumnWidths();
    oncolumnwidth?.({ id, width });
  }
  function closePanel() {
    showPanel = false;
    panelTrigger?.focus();
  }
  import { sort_state, SORTABLE_COLUMNS } from "@features/tasks/stores/sort";
  import { activePanelId, newPanelId } from "@stores/panel_coordinator";

  const columnSettingsPanelId = newPanelId();
  import { ripple, globalDismiss } from "@lib/actions";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import DateRangePanel from "@features/search/components/DateRangePanel.svelte";
  import NameFilterPanel from "@features/search/components/NameFilterPanel.svelte";
  import StatusFilterPanel from "@features/search/components/StatusFilterPanel.svelte";
  import NumberRangePanel from "@features/search/components/NumberRangePanel.svelte";

  /**
   * @typedef {Object} Props
   * @property {any} headers
   * @property {any} [allHeaders]
   * @property {number} [selectedCount] - Number of selected rows. Drives header checkbox state (unchecked / indeterminate / checked).
   * @property {number} [selectableCount] - Number of selectable visible rows (excluding root).
   * @property {(detail: { id: string, width: number }) => void} [oncolumnwidth]
   * @property {() => void} [onselectall]
   * @property {() => void} [onclearselection]
   */

  /** @type {Props} */
  let {
    headers,
    allHeaders = [],
    selectedCount = 0,
    selectableCount = 0,
    oncolumnwidth,
    onselectall,
    onclearselection,
  } = $props();

  let headerCheckboxEl = $state();

  function onHeaderCheckboxClick(e) {
    e.stopPropagation();
    // unchecked → select all; indeterminate or checked → clear.
    if (headerChecked || headerIndeterminate) {
      onclearselection?.();
    } else {
      onselectall?.();
    }
  }

  // 「なし」（空文字）は他の状態と同格の選択肢。ステータスを持たないノードは
  // 統一後ふつうに存在するので、絞り込めないと数の多いほうが探せなくなる。
  const NO_STATUS = "";
  const STATUS_LABELS = {
    [NO_STATUS]: "なし",
    Undefined: "未定義",
    Open: "未着手",
    Pending: "保留",
    "In Progress": "進行中",
    Completed: "完了",
    Canceled: "キャンセル",
  };
  const STATUS_OPTIONS = [
    NO_STATUS,
    "Undefined",
    "Open",
    "Pending",
    "In Progress",
    "Completed",
    "Canceled",
  ];

  /**
   * 選択済みステータスの取り出し。
   *
   * `filter(Boolean)` を使わないこと。「なし」は空文字なので落ちてしまい、
   * 選んでもフィルタが効いていないように見える。落としたいのは null/undefined
   * だけで、空文字は正当な値。
   */
  const selectedStatuses = (currentFilter) =>
    (currentFilter?.status ?? []).filter((value) => value != null);

  let openCountPanel = $state(null);
  let countPanelAnchorRect = $state(null);
  const EMPTY_FILTER_LABEL = "条件なし";
  const FILTER_ICON_PATH =
    "M3 7C3 6.44772 3.44772 6 4 6H20C20.5523 6 21 6.44772 21 7C21 7.55228 20.5523 8 20 8H4C3.44772 8 3 7.55228 3 7ZM6 12C6 11.4477 6.44772 11 7 11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H7C6.44772 13 6 12.5523 6 12ZM9 17C9 16.4477 9.44772 16 10 16H14C14.5523 16 15 16.4477 15 17C15 17.5523 14.5523 18 14 18H10C9.44772 18 9 17.5523 9 17Z";
  const FILTER_CLEAR_ICON_PATH =
    "M9.291,10.352l-4-4-4.005,4A.75.75,0,1,1,.22,9.291l4.005-4L.22,1.281A.75.75,0,0,1,1.281.22L5.286,4.225l4-4.005a.75.75,0,1,1,1.061,1.061l-4,4.005,4,4a.75.75,0,0,1-1.061,1.061Z";

  let showPanel = $state(false);
  let panelElement = $state();
  let panelStyle = $state("");

  let openDatePanel = $state(null);
  let datePanelAnchorRect = $state(null);
  let openNamePanel = $state(false);
  let namePanelAnchorRect = $state(null);
  let openStatusPanel = $state(false);
  let statusPanelAnchorRect = $state(null);

  function toggleStatusPanel(e) {
    openTagPanel = false;
    openCountPanel = null;
    e.stopPropagation();
    showPanel = false;
    openDatePanel = null;
    openNamePanel = false;
    statusPanelAnchorRect = e.currentTarget.getBoundingClientRect();
    openStatusPanel = !openStatusPanel;
  }

  function isDateColumn(headerName) {
    return headerName === "start date" || headerName === "due date";
  }

  /**
   * 件数を出す列。件数バッジを出す列は件数で絞り込めるべきなので、
   * 列 id を直書きせずここで一括して決める。
   *
   * 以前は「メモ数」だけがこのパネルに繋がっていて、隣の「添付数」は同じ
   * 件数列なのに絞り込めなかった。判定を列 id 直書きにすると、その非対称が
   * また生まれる。
   */
  const COUNT_COLUMN_LABELS = { attachments: "添付数" };

  function isCountColumn(headerName) {
    return headerName in COUNT_COLUMN_LABELS;
  }

  /**
   * 列の設定を開く。トリガーはツールバーの「…」メニュー項目なので、
   * クリックイベントそのものが渡ってくるとは限らない。要素を持たない
   * 呼び出し側のために、位置だけ（DOMRect）でも開けるようにしておく。
   */
  export function openPanel(anchor) {
    openTagPanel = false;
    openStatusPanel = false;
    openCountPanel = null;
    const isEvent = typeof anchor?.stopPropagation === "function";
    if (isEvent) anchor.stopPropagation();
    const triggerElement = isEvent ? anchor.currentTarget : (anchor?.element ?? null);
    panelTrigger = triggerElement;
    widths = readColumnWidths();
    openDatePanel = null;
    openNamePanel = false;
    const rect = isEvent ? anchor.currentTarget.getBoundingClientRect() : (anchor?.rect ?? anchor);
    panelStyle = `top: ${rect.bottom}px; right: calc(100vw - ${rect.right}px);`;
    if (!showPanel) {
      activePanelId.set(columnSettingsPanelId);
    }
    showPanel = !showPanel;
    // role="dialog" を開いてもフォーカスが body のままで、キーボードだけだと
    // 文書の先頭から Tab で辿り直すことになっていた。
    if (showPanel) {
      void tick().then(() => {
        panelElement?.querySelector("input, button")?.focus();
      });
    }
  }

  function handleSortClick(e, headerName) {
    if (!SORTABLE_COLUMNS.has(headerName)) return;
    sort_state.cycle(headerName);
  }

  function getSortDirection(headerName) {
    return $sort_state?.column === headerName ? $sort_state.direction : null;
  }

  function getSortButtonLabel(headerName) {
    const label = getColumnLabel(headerName);
    const direction = getSortDirection(headerName);
    if (direction === "asc") return `${label}：昇順`;
    if (direction === "desc") return `${label}：降順`;
    return `${label}を並べ替え`;
  }

  function getColumnLabel(headerName) {
    return $column_settings.find((column) => column.id === headerName)?.label ?? headerName;
  }

  function isFilterActive(headerName, currentFilter = $filter) {
    if (headerName === "name") {
      return Boolean(currentFilter?.name?.[0]);
    }
    if (headerName === "tags") return (currentFilter?.tags?.length ?? 0) > 0;
    if (headerName === "status") {
      return selectedStatuses(currentFilter).length > 0;
    }
    return (currentFilter?.[headerName]?.filter(Boolean).length ?? 0) > 0;
  }

  function getDateFilterSummary(headerName, currentFilter = $filter) {
    const [from = "", to = ""] = currentFilter?.[headerName] ?? [];
    if (from && to) return `${from} - ${to}`;
    if (from) return `From ${from}`;
    if (to) return `To ${to}`;
    return EMPTY_FILTER_LABEL;
  }

  function getFilterSummary(headerName, currentFilter = $filter) {
    if (headerName === "tags")
      return (
        (currentFilter?.tags ?? []).map((tag) => tag || "タグなし").join(" / ") ||
        EMPTY_FILTER_LABEL
      );
    if (headerName === "name") {
      const nameQuery = currentFilter?.name?.[0] ?? "";
      if (nameQuery) return nameQuery;
      return EMPTY_FILTER_LABEL;
    }
    if (isDateColumn(headerName)) {
      return getDateFilterSummary(headerName, currentFilter);
    }
    if (isCountColumn(headerName)) {
      const [min = "", max = ""] = currentFilter?.[headerName] ?? [];
      if (min && max) return `${min}〜${max}件`;
      if (min) return `${min}件以上`;
      if (max) return `${max}件以下`;
      return EMPTY_FILTER_LABEL;
    }
    if (headerName === "status") {
      const statusValues = selectedStatuses(currentFilter);
      if (statusValues.length === 1) return STATUS_LABELS[statusValues[0]] ?? statusValues[0];
      if (statusValues.length > 1) return `${statusValues.length} selected.`;
      return EMPTY_FILTER_LABEL;
    }
    const values = currentFilter?.[headerName]?.filter(Boolean) ?? [];
    if (values.length === 1) return values[0];
    if (values.length > 1) return `${values.length} selected.`;
    return EMPTY_FILTER_LABEL;
  }

  function toggleCountPanel(e, headerName) {
    openTagPanel = false;
    openStatusPanel = false;
    e.stopPropagation();
    showPanel = false;
    openNamePanel = false;
    openDatePanel = null;
    if (openCountPanel === headerName) {
      openCountPanel = null;
    } else {
      countPanelAnchorRect = e.currentTarget.getBoundingClientRect();
      openCountPanel = headerName;
    }
  }

  function handleCountFilterChange(headerName, detail) {
    const { min, max } = detail;
    filter.update((f) => {
      const next = { ...f };
      if (!min && !max) {
        delete next[headerName];
      } else {
        next[headerName] = [min, max];
      }
      return next;
    });
  }

  function toggleDatePanel(e, headerName) {
    openTagPanel = false;
    openStatusPanel = false;
    openCountPanel = null;
    e.stopPropagation();
    showPanel = false;
    openNamePanel = false;
    openCountPanel = null;
    if (openDatePanel === headerName) {
      openDatePanel = null;
    } else {
      datePanelAnchorRect = e.currentTarget.getBoundingClientRect();
      openDatePanel = headerName;
    }
  }

  function toggleNamePanel(e) {
    openTagPanel = false;
    openStatusPanel = false;
    openCountPanel = null;
    e.stopPropagation();
    showPanel = false;
    openDatePanel = null;
    namePanelAnchorRect = e.currentTarget.getBoundingClientRect();
    openNamePanel = !openNamePanel;
  }

  function handleDateRangeChange(headerName, detail) {
    const { from, to } = detail;
    filter.update((f) => {
      const next = { ...f };
      if (!from && !to) {
        delete next[headerName];
      } else {
        next[headerName] = [from, to];
      }
      return next;
    });
  }

  function handleStatusFilterChange(detail) {
    const nextSelected = detail.selected ?? [];
    filter.update((f) => {
      const next = { ...f };
      if (nextSelected.length > 0) {
        next.status = nextSelected;
      } else {
        delete next.status;
      }
      return next;
    });
  }

  function handleNameFilterChange(detail) {
    const { name } = detail;
    filter.update((f) => {
      const next = { ...f };
      if (name) {
        next.name = [name];
      } else {
        delete next.name;
      }
      return next;
    });
  }

  function clearColumnFilter(headerName) {
    if (openDatePanel === headerName) {
      openDatePanel = null;
    }
    if (openCountPanel === headerName) {
      openCountPanel = null;
    }
    if (headerName === "name") {
      openNamePanel = false;
    }

    filter.update((f) => {
      const next = { ...f };
      delete next[headerName];
      return next;
    });
  }

  function portal(node) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }
  let tagOptions = $derived([...new Set(["", ...$tag_index.keys(), ...($filter.tags ?? [])])]);
  // Auto-close column settings when another panel opens
  $effect.pre(() => {
    if ($activePanelId !== null && $activePanelId !== columnSettingsPanelId && showPanel) {
      showPanel = false;
    }
  });
  let headerChecked = $derived(selectableCount > 0 && selectedCount >= selectableCount);
  let headerIndeterminate = $derived(selectedCount > 0 && selectedCount < selectableCount);
  let headerCheckboxLabel = $derived(
    headerChecked || headerIndeterminate ? "選択を解除" : "すべて選択"
  );
  $effect.pre(() => {
    if (headerCheckboxEl) headerCheckboxEl.indeterminate = headerIndeterminate;
  });
  let availableIds = $derived(new Set(allHeaders.map((h) => h.name)));
  let startDateFilter = $derived($filter["start date"] ?? ["", ""]);
  let dueDateFilter = $derived($filter["due date"] ?? ["", ""]);
  let nameFilterValue = $derived($filter?.name?.[0] ?? "");
  let statusSelected = $derived(selectedStatuses($filter));
  let filterSummaries = $derived(
    Object.fromEntries(
      (headers ?? []).map((header) => [header.name, getFilterSummary(header.name, $filter)])
    )
  );
  let filterActive = $derived(
    Object.fromEntries(
      (headers ?? []).map((header) => [header.name, isFilterActive(header.name, $filter)])
    )
  );
  let sortDirections = $derived(
    Object.fromEntries(
      (headers ?? []).map((h) => [
        h.name,
        $sort_state?.column === h.name ? $sort_state?.direction : null,
      ])
    )
  );
</script>

<div class:TableRow={true} role="row">
  <div class="CheckboxHeaderCell" role="columnheader">
    <!-- 当たり判定はセル全体、グリフは本文に見合う大きさ。label で包むと
         セルのどこを押しても input がトグルするので、input 自体を 24px に
         膨らませる必要がない。 -->
    <label class="CheckboxHit">
      <input
        bind:this={headerCheckboxEl}
        type="checkbox"
        class="HeaderCheckbox"
        checked={headerChecked}
        aria-label={headerCheckboxLabel}
        title={headerCheckboxLabel}
        onclick={onHeaderCheckboxClick}
      />
    </label>
  </div>
  {#each headers as header}
    <div class:TableHeader={true} data-column={header.name} role="columnheader">
      <div class="HeaderLabelRow" class:sortActive={$sort_state?.column === header.name}>
        <span class="HeaderLabelText TextOverFlow">{getColumnLabel(header.name)}</span>
        {#if SORTABLE_COLUMNS.has(header.name)}
          <span class="HeaderSortButton">
            <IconButton
              variant="text"
              normalColor={sortDirections[header.name]
                ? "var(--theme-color-Primary-main)"
                : "var(--fg-muted)"}
              activeColor={"var(--theme-color-Primary-main)"}
              ariaLabel={getSortButtonLabel(header.name)}
              tooltipContent={getSortButtonLabel(header.name)}
              onclick={(e) => {
                e.stopPropagation();
                handleSortClick(e, header.name);
              }}
              style="margin: 0; width: var(--header-icon-size); height: var(--header-icon-size); box-shadow: none;"
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                {#if sortDirections[header.name] === "asc"}
                  <path
                    d="M6 15l6-6 6 6"
                    stroke="currentColor"
                    stroke-width="2.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                {:else if sortDirections[header.name] === "desc"}
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    stroke-width="2.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                {:else}
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                {/if}
              </svg>
            </IconButton>
          </span>
        {/if}
      </div>
      <div class="HeaderControlRow">
        {#if header.name == "status"}
          <div class="HeaderFilterGroup">
            <button
              class="HeaderFilterControl"
              class:active={filterActive[header.name]}
              onclick={(event) => {
                event.stopPropagation();
                toggleStatusPanel(event);
              }}
              aria-label="ステータスフィルター"
              aria-expanded={openStatusPanel}
              title="ステータスフィルター"
              use:ripple
            >
              <span class="FilterIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d={FILTER_ICON_PATH} />
                </svg>
              </span>
              {#if filterActive[header.name]}
                <span class="FilterSelection">{filterSummaries[header.name]}</span>
              {/if}
            </button>
            {#if filterActive[header.name]}
              <IconButton
                style={"margin: 0rem; padding: var(--sp1); margin-left: auto; width: 1.125rem; height: 1.125rem; flex-shrink: 0;"}
                ariaLabel="ステータスフィルターをクリア"
                onclick={(e) => {
                  clearColumnFilter(header.name);
                  e.stopPropagation();
                }}
                activeColor={"transparent"}
                normalColor={"transparent"}
              >
                <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d={FILTER_CLEAR_ICON_PATH}
                    fill="currentColor"
                    transform="translate(6.629 6.8)"
                  />
                </svg>
              </IconButton>
            {/if}
          </div>
        {:else if header.name == "tags"}
          <div class="HeaderFilterGroup">
            <button
              class="HeaderFilterControl"
              class:active={filterActive.tags}
              aria-label="タグフィルター"
              aria-expanded={openTagPanel}
              onclick={(event) => {
                event.stopPropagation();
                openStatusPanel = false;
                openNamePanel = false;
                openDatePanel = null;
                openCountPanel = null;
                showPanel = false;
                tagAnchorRect = event.currentTarget.getBoundingClientRect();
                openTagPanel = !openTagPanel;
              }}
            >
              <span class="FilterIcon" aria-hidden="true"
                ><svg viewBox="0 0 24 24"><path d={FILTER_ICON_PATH} /></svg></span
              >
              {#if filterActive.tags}<span class="FilterSelection">{filterSummaries.tags}</span
                >{/if}
            </button>
            {#if filterActive.tags}<IconButton
                variant="text"
                normalColor="var(--fg-muted)"
                activeColor="var(--accent-fg)"
                style="margin:0; width:1.125rem; height:1.125rem;"
                ariaLabel="タグフィルターをクリア"
                onclick={(e) => {
                  e.stopPropagation();
                  clearColumnFilter("tags");
                }}
                ><svg viewBox="0 0 24 24" aria-hidden="true"
                  ><path
                    d="m7 7 10 10M17 7 7 17"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  /></svg
                ></IconButton
              >{/if}
          </div>
        {:else if header.name == "name"}
          <div class="HeaderFilterGroup">
            <button
              class="HeaderFilterControl"
              class:active={filterActive[header.name]}
              onclick={(event) => {
                event.stopPropagation();
                toggleNamePanel(event);
              }}
              aria-label="ノード名フィルター"
              aria-expanded={openNamePanel}
              title="ノード名フィルター"
              use:ripple
            >
              <span class="FilterIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d={FILTER_ICON_PATH} />
                </svg>
              </span>
              {#if filterActive[header.name]}
                <span class="FilterSelection">{filterSummaries[header.name]}</span>
              {/if}
            </button>
            {#if filterActive[header.name]}
              <IconButton
                style={"margin: 0rem; padding: var(--sp1); margin-left: auto; width: 1.125rem; height: 1.125rem; flex-shrink: 0;"}
                ariaLabel="ノード名フィルターをクリア"
                onclick={(e) => {
                  clearColumnFilter(header.name);
                  e.stopPropagation();
                }}
                activeColor={"transparent"}
                normalColor={"transparent"}
              >
                <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d={FILTER_CLEAR_ICON_PATH}
                    fill="currentColor"
                    transform="translate(6.629 6.8)"
                  />
                </svg>
              </IconButton>
            {/if}
          </div>
        {:else if isCountColumn(header.name)}
          <div class="HeaderFilterGroup">
            <button
              class="HeaderFilterControl"
              class:active={filterActive[header.name]}
              onclick={(e) => {
                e.stopPropagation();
                toggleCountPanel(e, header.name);
              }}
              aria-label={`${COUNT_COLUMN_LABELS[header.name]}フィルター`}
              aria-expanded={openCountPanel === header.name}
              title={`${COUNT_COLUMN_LABELS[header.name]}フィルター`}
              use:ripple
            >
              <span class="FilterIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d={FILTER_ICON_PATH} />
                </svg>
              </span>
              {#if filterActive[header.name]}
                <span class="FilterSelection">{filterSummaries[header.name]}</span>
              {/if}
            </button>
            {#if filterActive[header.name]}
              <IconButton
                style={"margin: 0rem; padding: var(--sp1); margin-left: auto; width: 1.125rem; height: 1.125rem; flex-shrink: 0;"}
                ariaLabel={`${COUNT_COLUMN_LABELS[header.name]}フィルターをクリア`}
                onclick={(e) => {
                  clearColumnFilter(header.name);
                  e.stopPropagation();
                }}
                activeColor={"transparent"}
                normalColor={"transparent"}
              >
                <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d={FILTER_CLEAR_ICON_PATH}
                    fill="currentColor"
                    transform="translate(6.629 6.8)"
                  />
                </svg>
              </IconButton>
            {/if}
          </div>
        {:else if isDateColumn(header.name)}
          <div class="HeaderFilterGroup">
            <button
              class="HeaderFilterControl"
              class:active={filterActive[header.name]}
              onclick={(e) => {
                e.stopPropagation();
                toggleDatePanel(e, header.name);
              }}
              aria-label={`${getColumnLabel(header.name)}フィルター`}
              aria-expanded={openDatePanel === header.name}
              title="日付フィルター"
              use:ripple
            >
              <span class="FilterIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d={FILTER_ICON_PATH} />
                </svg>
              </span>
              {#if filterActive[header.name]}
                <span class="FilterSelection">{filterSummaries[header.name]}</span>
              {/if}
            </button>
            {#if filterActive[header.name]}
              <IconButton
                style={"margin: 0rem; padding: var(--sp1); margin-left: auto; width: 1.125rem; height: 1.125rem; flex-shrink: 0;"}
                ariaLabel={`${getColumnLabel(header.name)}フィルターをクリア`}
                onclick={(e) => {
                  clearColumnFilter(header.name);
                  e.stopPropagation();
                }}
                activeColor={"transparent"}
                normalColor={"transparent"}
              >
                <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d={FILTER_CLEAR_ICON_PATH}
                    fill="currentColor"
                    transform="translate(6.629 6.8)"
                  />
                </svg>
              </IconButton>
            {/if}
          </div>
        {:else}
          <div class="HeaderFilterGroup">
            <!-- 絞り込み UI を持たない列（添付数など）は、条件が付いていない
                 あいだサマリー自体を出さない。押せないフィルターアイコンが
                 常時見えていると操作できそうに見えてしまうため。 -->
            {#if filterActive[header.name]}
              <div
                class="HeaderFilterControl HeaderFilterSummary"
                class:active={filterActive[header.name]}
                aria-label={`${getColumnLabel(header.name)}フィルター：${filterSummaries[header.name]}`}
              >
                <span class="FilterIcon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d={FILTER_ICON_PATH} />
                  </svg>
                </span>
                <span class="FilterSelection">{filterSummaries[header.name]}</span>
              </div>
            {/if}
            {#if filterActive[header.name]}
              <IconButton
                style={"margin: 0rem; padding: var(--sp1); margin-left: auto; width: 1.125rem; height: 1.125rem; flex-shrink: 0;"}
                ariaLabel={`${getColumnLabel(header.name)}フィルターをクリア`}
                onclick={(e) => {
                  clearColumnFilter(header.name);
                  e.stopPropagation();
                }}
                activeColor={"transparent"}
                normalColor={"transparent"}
              >
                <svg viewBox="4 4 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d={FILTER_CLEAR_ICON_PATH}
                    fill="currentColor"
                    transform="translate(6.629 6.8)"
                  />
                </svg>
              </IconButton>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>

{#if showPanel}
  <div
    bind:this={panelElement}
    class="ColumnSettingsPanel"
    style={panelStyle}
    role="dialog"
    aria-label="列の設定"
    use:portal
    use:viewportPopover
    use:globalDismiss={closePanel}
  >
    <div class="PanelTitle">
      <span>列の設定</span>
      <!-- 無地の入力欄が並ぶだけで、何の数字を入れる欄なのか画面から読めなかった
           （aria-label にはあった）。 -->
      <span class="PanelTitleUnit">幅 (px)</span>
    </div>
    {#each $column_settings as setting, index}
      {#if availableIds.has(setting.id)}
        <div class="SettingsRow">
          {#if setting.id === "name"}
            <span class="LockIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect
                  x="3"
                  y="11"
                  width="18"
                  height="11"
                  rx="2"
                  ry="2"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M7 11V7a5 5 0 0 1 10 0v4"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span class="ColumnLabel">{setting.label}</span>
          {:else}
            <input
              type="checkbox"
              id={`col-vis-${setting.id}`}
              checked={setting.visible}
              onchange={() => column_settings.toggle(setting.id)}
            />
            <label for={`col-vis-${setting.id}`} class="ColumnLabel">{setting.label}</label>
            <div class="MoveButtons">
              <!-- 端の矢印は押しても並びが変わらない（moveUp は index<=1、
                   moveDown は末尾で何もしない）。押せる見た目のままだと、
                   効かなかったのか押し損ねたのか区別できない。 -->
              <button
                class="MoveBtn"
                aria-label="{setting.label}を上へ"
                disabled={index <= 1}
                onclick={(event) => {
                  event.stopPropagation();
                  column_settings.moveUp(setting.id);
                }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 5l-7 7h4v7h6v-7h4z" />
                </svg>
              </button>
              <button
                class="MoveBtn"
                aria-label="{setting.label}を下へ"
                disabled={index >= $column_settings.length - 1}
                onclick={(event) => {
                  event.stopPropagation();
                  column_settings.moveDown(setting.id);
                }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 19l7-7h-4V5h-6v7H5z" />
                </svg>
              </button>
            </div>
          {/if}
          <input
            type="number"
            min="32"
            max="4000"
            step="1"
            aria-label={setting.label + "の幅"}
            value={widths[setting.id] || ""}
            placeholder="自動"
            style="width:3.75rem"
            onchange={(event) => setWidth(setting.id, event)}
          />
        </div>
      {/if}
    {/each}
  </div>
{/if}

{#if openDatePanel === "start date"}
  <DateRangePanel
    column="start date"
    from={startDateFilter[0]}
    to={startDateFilter[1]}
    anchorRect={datePanelAnchorRect}
    onchange={(e) => handleDateRangeChange("start date", e)}
    onclose={() => (openDatePanel = null)}
  />
{/if}

{#if openDatePanel === "due date"}
  <DateRangePanel
    column="due date"
    from={dueDateFilter[0]}
    to={dueDateFilter[1]}
    anchorRect={datePanelAnchorRect}
    onchange={(e) => handleDateRangeChange("due date", e)}
    onclose={() => (openDatePanel = null)}
  />
{/if}

{#if openNamePanel}
  <NameFilterPanel
    value={nameFilterValue}
    anchorRect={namePanelAnchorRect}
    onchange={(e) => handleNameFilterChange(e)}
    onclose={() => (openNamePanel = false)}
  />
{/if}

{#if openCountPanel}
  <NumberRangePanel
    column={COUNT_COLUMN_LABELS[openCountPanel]}
    min={$filter[openCountPanel]?.[0] ?? ""}
    max={$filter[openCountPanel]?.[1] ?? ""}
    anchorRect={countPanelAnchorRect}
    onchange={(e) => handleCountFilterChange(openCountPanel, e)}
    onclose={() => (openCountPanel = null)}
  />
{/if}

{#if openTagPanel}
  <StatusFilterPanel
    title="タグフィルター（いずれかに一致）"
    labels={{ "": "タグなし" }}
    showDots={false}
    selected={$filter.tags ?? []}
    options={tagOptions}
    anchorRect={tagAnchorRect}
    onchange={(event) => filter.update((value) => ({ ...value, tags: event.selected }))}
    onclose={() => (openTagPanel = false)}
  />
{/if}

{#if openStatusPanel}
  <StatusFilterPanel
    selected={statusSelected}
    options={STATUS_OPTIONS}
    anchorRect={statusPanelAnchorRect}
    onchange={(e) => handleStatusFilterChange(e)}
    onclose={() => (openStatusPanel = false)}
  />
{/if}

<style>
  .TableRow {
    --header-bg: var(--canvas-subtle);
    --header-fg: var(--theme-color-Sub-main);
    --header-border: color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
    --header-hover: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    --header-active: var(--theme-color-Primary-main);
    --header-button-border: color-mix(in srgb, var(--theme-color-Sub-main) 24%, transparent);
    /* 1.125rem は html が 75% なので実寸 18px にしかならず、WCAG 2.2 SC 2.5.8
       の 24px を割っていた。px のトークンで最低線を固定する。 */
    --header-icon-size: var(--tap-min);
    --header-action-icon-size: 0.825rem;

    position: sticky;
    top: 0;
    display: flex;
    flex-shrink: 0;
    box-sizing: border-box;
    height: 2.25rem;
    padding: 0;
    width: 100%;
    z-index: 9999;
  }
  .TableHeader {
    flex-shrink: 0;
    position: relative;
    height: 2.25rem;
    box-sizing: border-box;
    --col-min: var(--col-min-default);
    min-width: var(--col-min);
    display: flex;
    flex-direction: column;
    /* 列同士は線で区切らない。境目は列幅ハンドル（hover で Primary の線が
       出る）と余白で分かる。 */
    border-bottom: 1px solid var(--header-border);
    background-color: var(--header-bg);
    color: var(--header-fg);
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: var(--font-label-md);
    letter-spacing: 0.02em;
  }
  /* 並べ替えは列見出しでいちばんよく使う操作なので、常に見えているようにする。
     以前は opacity: 0 で、ホバーするまで存在が分からなかった。その一方で
     たまにしか使わない「すべて展開 / 折りたたみ」が最も濃い色・20px で常時
     並んでおり、優先順位が逆になっていた（あの 2 つは ⋯ メニューにもある
     重複なので、ヘッダーからは外した）。
     見出しより出しゃばらないよう普段は控えめにし、触れたときと実際に効いて
     いるときは明瞭にする。見出しの幅を食わないよう浮かせて置くのは従来どおり。 */
  .HeaderSortButton {
    position: absolute;
    right: 2px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    opacity: 0.55;
    transition: opacity 0.12s ease;
  }
  /* 図像は見出し（11px）に対して控えめに。ボタン自体は 24px のまま
     （SC 2.5.8 の当たり判定）で、中の絵だけ小さくする。 */
  .HeaderSortButton :global(svg) {
    width: var(--font-title-md);
    height: var(--font-title-md);
  }
  .TableHeader:hover .HeaderSortButton,
  .TableHeader:focus-within .HeaderSortButton,
  .HeaderLabelRow.sortActive .HeaderSortButton {
    opacity: 1;
  }
  .HeaderControlRow {
    opacity: 0.55;
    transition: opacity 0.12s ease;
  }
  .TableHeader:hover .HeaderControlRow,
  .TableHeader:focus-within .HeaderControlRow,
  .HeaderControlRow:has(:global(.active)) {
    opacity: 1;
  }
  .TableHeader[data-column="name"] {
    --col-min: var(--col-min-name);
  }
  .TableHeader[data-column="status"] {
    --col-min: var(--col-min-status);
  }
  .TableHeader[data-column="start date"],
  .TableHeader[data-column="due date"] {
    --col-min: var(--col-min-date);
  }
  .TableHeader[data-column="attachments"] {
    --col-min: var(--col-min-count);
  }
  .TableHeader[data-column="tags"] {
    --col-min: var(--col-min-tags);
  }
  /* 行側の .CheckboxCell と同じ幅にする。ここだけ 21px のままだと、
     以降のすべての列が見出しに対して 3px ずれる。 */
  .CheckboxHeaderCell {
    flex: 0 0 var(--tap-min);
    width: var(--tap-min);
    height: 2.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    line-height: 0;
    background-color: var(--header-bg);
    border-bottom: 1px solid var(--header-border);
  }
  /* 当たり判定 (SC 2.5.8 の 24px) はこの label が持ち、グリフは下の
     .HeaderCheckbox が持つ。input 自体を 24px にすると、14px の本文や
     32px の行に対してチェックボックスだけが不釣り合いに大きくなる。 */
  .CheckboxHit {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-width: var(--tap-min);
    min-height: var(--tap-min);
    cursor: pointer;
  }
  .HeaderCheckbox {
    display: block;
    flex: 0 0 auto;
    /* グリフは本文と同寸にする。選択の目印が本文より目立つと、行の主役が
       ノード名ではなくチェックボックスになってしまう。当たり判定は
       .CheckboxHit 側が 24px を担保するので、ここを大きくする必要はない。 */
    width: var(--font-body-md);
    height: var(--font-body-md);
    margin: 0;
    line-height: 1;
    cursor: pointer;
    accent-color: var(--theme-color-Primary-dark);
  }
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .HeaderLabelRow {
    position: relative;
    display: flex;
    flex: 0 0 1.3125rem;
    width: 100%;
    height: 1.3125rem;
    align-items: center;
    /* 見出しは列の内容と同じ側に寄せる。中央寄せのままだと、幅の広い列ほど
       見出しとセルの文字が離れ、どの列の見出しなのかを目で追えなくなる
       （ノード名列では見出しが x≈173、セルの文字が x≈100 だった）。
       セル側 (.TableData) と同じ横 padding を使って字下げも揃える。 */
    justify-content: flex-start;
    gap: var(--sp1);
    padding: 0 var(--sp2);
    overflow: visible;
    box-sizing: border-box;
    color: var(--header-fg);
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }
  .HeaderLabelText {
    flex: 1 1 auto;
    min-width: 0;
    /* 見出しは本文より「少し強い」程度。小さめ・やや太字・薄い色で、
       行の内容より先に目に入らないようにする。 */
    font-size: var(--font-label-sm);
    color: var(--fg-muted);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: capitalize;
  }
  .HeaderControlRow {
    display: flex;
    flex: 0 0 0.9375rem;
    width: 100%;
    height: 0.9375rem;
    align-items: center;
    justify-content: center;
    gap: var(--sp1);
    padding: 0 var(--sp1);
    box-sizing: border-box;
    overflow: hidden;
  }
  .HeaderFilterGroup {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    height: 0.9375rem;
  }

  .HeaderFilterControl {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    /* 高さ 0.9375rem = 実寸 15px だった。列ヘッダーは 1 行しかないので、
       ここを 24px にしてもコストは行数に比例しない。 */
    min-height: var(--tap-min);
    margin: 0;
    padding: 0 var(--sp1);
    box-sizing: border-box;
    border: none;
    border-radius: var(--shape-xs);
    background-color: transparent;
    color: var(--header-fg);
    cursor: pointer;
    flex: 1 1 auto;
    font-size: var(--font-label-sm);
    font-weight: 500;
    overflow: hidden;
    white-space: nowrap;
    gap: 2px;
  }
  .HeaderFilterControl:hover {
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 10%, transparent);
  }
  .HeaderFilterControl:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
  }
  .HeaderFilterControl:active {
    background-color: transparent;
  }
  .HeaderFilterSummary {
    cursor: default;
  }
  .FilterIcon {
    width: 0.825rem;
    height: 0.825rem;
    margin: 0;
    padding: 2px;
    box-sizing: content-box;
    flex-shrink: 0;
  }
  .FilterIcon svg {
    width: 100%;
    height: 100%;
    fill: var(--header-fg);
    stroke: none;
  }
  .HeaderFilterControl.active .FilterIcon svg {
    fill: var(--theme-color-Primary-main);
  }
  .FilterSelection {
    min-width: 0;
    padding: 0 var(--sp1);
    box-sizing: border-box;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ColumnSettingsPanel {
    position: fixed;
    z-index: 99999999;
    background: var(--theme-color-Main-main);
    border: 1px solid var(--theme-color-Shadow-main);
    border-radius: var(--shape-sm);
    box-shadow: var(--elevation-3);
    padding: var(--sp2) 0;
    min-width: 9.75rem;
    color: var(--theme-color-Sub-main);
  }
  .PanelTitle {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp3);
    font-size: var(--font-label-md);
    font-weight: 700;
    color: var(--theme-color-Sub-main);
    padding: var(--sp1) var(--sp3) var(--sp2);
    border-bottom: 1px solid var(--theme-color-Shadow-main);
    margin-bottom: var(--sp1);
  }
  .PanelTitleUnit {
    font-weight: 400;
    opacity: 0.65;
  }
  .SettingsRow {
    display: flex;
    align-items: center;
    padding: var(--sp1) var(--sp3);
    gap: var(--sp2);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-sm);
  }
  .SettingsRow:hover {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 10%, transparent);
  }
  .LockIcon {
    width: 0.675rem;
    height: 0.675rem;
    flex-shrink: 0;
    opacity: 0.4;
    display: flex;
    align-items: center;
  }
  .LockIcon svg {
    width: 100%;
    height: 100%;
    stroke: currentColor;
  }
  .ColumnLabel {
    flex: 1;
    cursor: pointer;
    user-select: none;
  }
  .SettingsRow input[type="checkbox"] {
    width: 0.675rem;
    height: 0.675rem;
    flex-shrink: 0;
    cursor: pointer;
    accent-color: var(--theme-color-Primary-dark);
  }
  .MoveButtons {
    display: flex;
    gap: 0.075rem;
    flex-shrink: 0;
  }
  .MoveBtn {
    /* 実測 14x14 で SC 2.5.8 の 24px を割っていた。グリフは小さいままで
       当たり判定だけ広げる。 */
    width: var(--tap-min);
    height: var(--tap-min);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    border-radius: 0.15rem;
    padding: 0;
    color: var(--theme-color-Sub-main);
    opacity: 0.6;
  }
  .MoveBtn:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 14%, transparent);
    opacity: 1;
  }
  .MoveBtn:disabled {
    opacity: 0.22;
    cursor: default;
  }
  .MoveBtn svg {
    width: 0.9rem;
    height: 0.9rem;
  }
  .MoveBtn svg {
    width: 100%;
    height: 100%;
  }
</style>
