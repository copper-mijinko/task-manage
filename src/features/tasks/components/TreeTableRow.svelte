<script context="module">
  // Multi-id drag payload. For a single-row drag this contains exactly one id;
  // for a multi-select drag it contains the top-level selected ancestors in DFS
  // order. Shared module state so dragOver/drop can see what's being dragged.
  let dragged_ids = [];
  // 掴んだ行の経路。多親ノードは同じ id の行が複数あるので、「どの辺を掴んだか」
  // は id では決まらない（単一行のドラッグでのみ意味を持つ）。
  let dragged_path;
</script>

<script>
  import { getContext } from "svelte";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  const application = getContext(TREEGRID_APPLICATION);
  const tree_data = application?.tree ?? legacy_tree_data;

  import { createEventDispatcher } from "svelte";
  import { selected_ids } from "@stores/ui";
  import { tree_data as legacy_tree_data } from "@features/tasks/stores/tree";
  import { getNode, getTopLevelSelection } from "@features/tasks/utils/tree_control";
  import { ripple } from "@lib/actions";
  import TaskName from "@features/tasks/components/TaskName.svelte";
  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";
  import DateInput from "@lib/primitives/DateInput.svelte";
  import { dueDateUrgency } from "@lib/utils/date_urgency";
  import { active_tag } from "@features/memos/stores/tags";
  import { normalizeTagList } from "@lib/utils/tags";

  export let row;
  export let headers = [];
  export let selected = false;
  export let bulkSelectionActive = false;
  export let isAnchor = false;
  export let anyMultiSelected = false;
  /**
   * roving tabindex。行は 1 つだけ Tab の停留点にする。全行が停留点だと、
   * テーブルを通り過ぎるだけで行数ぶん Tab を押すことになる。
   */
  export let isTabStop = false;
  /**
   * このノードの最初の出現か。多親ノードは親ごとに複数行に出るので、DOM の
   * `id` 属性は最初の行にだけ付ける（重複 id を作らないため）。他の行は
   * `data-node-id` で引ける。
   */
  export let isPrimaryOccurrence = true;
  /** このノードが置かれている場所（親の名前）。2 つ以上なら共有ノード。 */
  export let sharedPlaces = [];
  /**
   * いま操作している行と同じノードを指す、別の親の下の行。選択はノード単位
   * なので多親ノードを選ぶと出現がすべて選択色になるが、「同じものがここにも
   * ある」ことと「いま触っている行」は別物なので、こちらは弱く表示する。
   * いま触っている行は tabindex の停留点（`isTabStop`）と一致する。
   */
  export let isEchoRow = false;
  export let isDark = false;
  export let canDrop = () => false;
  export let canMoveUp = false;
  export let canMoveDown = false;
  export let canIndent = false;
  export let canOutdent = false;
  export let canOpenTaskFolder = false;
  export let inheritedDueDate = "";
  export let nodePath = "";
  export let lineNumber = 0;
  // Capabilities for bulk operations (used when this row is part of multi-selection).
  export let bulkCanMove = false;
  export let bulkCanTreeOp = false;
  export let bulkCanOutdent = false;

  const dispatch = createEventDispatcher();
  let taskName;

  $: id = row.id;
  $: path = row.path;
  $: node = row.node;
  $: depth = row.depth;
  $: data = node.data;
  $: hasChildren = row.hasChildren;
  $: expanded = row.expanded;
  // A row is treated as archived if it is archived itself OR sits under an
  // archived ancestor (computed by flattenVisibleTree). Children of an archived
  // task don't carry their own `archived` flag, so relying on node.archived
  // alone would wrongly let them be edited in the show-archived view.
  $: isArchived = row.effectivelyArchived ?? !!node.archived;

  // When this row is part of an active multi-selection, the right-click menu
  // routes actions to the bulk handlers. Use bulk capability flags so the menu
  // accurately reflects what the bulk handler can actually do.
  $: inMulti = selected && anyMultiSelected;
  $: effectiveCanMoveUp = inMulti ? bulkCanMove : canMoveUp;
  $: effectiveCanMoveDown = inMulti ? bulkCanMove : canMoveDown;
  $: effectiveCanIndent = inMulti ? bulkCanTreeOp : canIndent;
  $: effectiveCanOutdent = inMulti ? bulkCanTreeOp && bulkCanOutdent : canOutdent;
  $: selectionCountForMenu = inMulti ? $selected_ids.size : 1;

  let dragOverType;
  let isDragging = false;
  let isMenuOpen = false;

  $: rowDueUrgency = dueDateUrgency(data["due date"] || inheritedDueDate, data["status"]);
  // ツリーのガイド線。祖先の段ごとの「まだ兄弟が続くか」と、自分が末っ子か。
  $: guideLines = row.guideLines ?? [];
  $: isLastSibling = row.isLastSibling ?? false;
  $: rowTags = normalizeTagList(data.tags);
  // 列幅は限られるので、読める大きさで出せる範囲だけ表示し、残りは「+N」で示す
  // （全件はセルの title と詳細ペインで確認できる）。3 件以上あるときは
  // 「+N」の幅を確保するため 1 件だけ出す。
  $: visibleRowTags = rowTags.slice(0, rowTags.length > 2 ? 1 : 2);
  $: hiddenRowTagCount = rowTags.length - visibleRowTags.length;

  const COUNT_LABELS = { attachments: "添付" };

  /** 添付の件数。未設定は 0 件として扱う。 */
  function countCellValue(headerName) {
    const value = data[headerName];
    return Array.isArray(value) ? value.length : Number(value) || 0;
  }

  function displayCellValue(headerName) {
    const value = data[headerName];
    if (headerName === "attachments" && value == null) {
      return 0;
    }
    return Array.isArray(value) ? value.length : (value ?? "");
  }

  function select(e) {
    e.stopPropagation();
    dispatch("select", {
      id,
      path,
      shiftKey: !!e.shiftKey,
      ctrlKey: !!(e.ctrlKey || e.metaKey),
    });
  }

  function toggleCheckbox(e) {
    e.stopPropagation();
    dispatch("toggleCheckbox", {
      id,
      path,
      shiftKey: !!e.shiftKey,
      ctrlKey: !!(e.ctrlKey || e.metaKey),
    });
  }

  function toggle(e) {
    e.stopPropagation();
    dispatch("toggle", { id, path });
  }

  /**
   * treegrid の矢印キー移動。行の並びや親子関係は TreeTable 側しか持って
   * いないので、ここでは「どのキーが来たか」だけを伝えて移動は任せる。
   */
  const NAVIGATION_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
  ]);

  function handleKeydown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(e);
      return;
    }
    // 修飾キー付きは既存のショートカット（Ctrl+↑ の移動など）に譲る。
    if (!NAVIGATION_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    dispatch("navigate", { id, path, key: e.key, shiftKey: e.shiftKey });
  }

  function commitData(key, value) {
    // archived 行は読み取り専用（仕様）。subscribe 経路で誤って入った
    // commit を捨て、データ層を変えない。archived 配下の子も対象に含める。
    if (isArchived) return;
    dispatch("commit", {
      id,
      patch: {
        [key]: value,
      },
    });
  }

  function dragStart(e) {
    if (isArchived || application?.isProtected(id) || depth === 0) {
      e.preventDefault();
      return;
    }
    isDragging = true;

    // Multi-row drag: only when this row is part of an existing multi-selection.
    // Otherwise it's a single-row drag (and the selection is left alone).
    const treeRoot = $tree_data?.data;
    if (treeRoot && $selected_ids.has(id) && $selected_ids.size > 1) {
      dragged_ids = getTopLevelSelection(treeRoot, $selected_ids);
      dragged_path = path;
    } else {
      dragged_ids = [id];
      dragged_path = path;
    }

    const name_tag = document.createElement("div");
    name_tag.classList.add("NameTag");
    name_tag.innerText = dragged_ids.length > 1 ? `${dragged_ids.length}件のタスク` : data.name;
    document.body.appendChild(name_tag);

    const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    e.dataTransfer.setDragImage(name_tag, -rem, -rem);
  }

  function dragEnd() {
    dragOverType = undefined;
    isDragging = false;
    document.querySelector(".NameTag")?.remove();
  }

  function dragOver(e) {
    e.preventDefault();

    if (dragged_ids.length === 0 || !dragged_ids.every((did) => canDrop(did, id))) {
      dragOverType = undefined;
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    // Split the row into three zones:
    //  - top  third  → insert as elder sibling (before)
    //  - mid  third  → append as child
    //  - bot  third  → insert as younger sibling (after)
    if (y <= h / 3) {
      dragOverType = "DragOverTop";
    } else if (y >= (h * 2) / 3) {
      dragOverType = "DragOverBelow";
    } else {
      dragOverType = "DragOverBottom";
    }
    if (isArchived || (depth === 0 && dragOverType !== "DragOverBottom")) dragOverType = undefined;
  }

  function dragLeave() {
    dragOverType = undefined;
  }

  function dragDrop() {
    if (dragged_ids.length === 0 || !dragOverType) {
      return;
    }

    let mode;
    if (dragOverType === "DragOverTop") mode = "insert";
    else if (dragOverType === "DragOverBelow") mode = "insert_after";
    else mode = "append";

    dispatch("reorder", {
      draggedIds: [...dragged_ids],
      draggedPath: dragged_path,
      targetId: id,
      targetPath: path,
      mode,
    });

    dragOverType = undefined;
    dragged_ids = [];
    dragged_path = undefined;
  }

  function openContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    // If this row is part of an existing multi-selection, keep the selection
    // intact and let the menu act on the whole set. Otherwise reduce to this row.
    if (!$selected_ids.has(id)) {
      dispatch("select", { id, path, shiftKey: false, ctrlKey: false });
    }
    taskName?.openMenuAt({
      x: e.clientX,
      y: e.clientY,
    });
  }
</script>

<div
  id={isPrimaryOccurrence ? id : undefined}
  data-node-id={id}
  data-row-path={path}
  role="row"
  class:TableRow={true}
  class:Selected={selected}
  class:EchoRow={isEchoRow}
  class:Anchor={isAnchor && anyMultiSelected}
  class:Dragging={isDragging}
  class:MenuOpen={isMenuOpen}
  class:DragOverTop={dragOverType === "DragOverTop"}
  class:DragOverBottom={dragOverType === "DragOverBottom"}
  class:DragOverBelow={dragOverType === "DragOverBelow"}
  class:OverdueRow={rowDueUrgency === "overdue"}
  class:DueSoonRow={rowDueUrgency === "today" || rowDueUrgency === "due-soon"}
  class:ArchivedRow={isArchived}
  class:RootRow={depth === 0}
  class:ParentRow={hasChildren}
  style:--row-depth={depth}
  use:ripple
  tabindex={isTabStop ? 0 : -1}
  draggable="true"
  aria-level={depth + 1}
  aria-selected={selected}
  aria-expanded={hasChildren ? expanded : undefined}
  on:click={select}
  on:keydown={handleKeydown}
  on:dragstart={dragStart}
  on:dragend={dragEnd}
  on:dragover={dragOver}
  on:dragleave={dragLeave}
  on:drop={dragDrop}
  on:contextmenu={openContextMenu}
>
  <div
    class="CheckboxCell"
    class:Visible={selected || anyMultiSelected}
    class:HasCheckbox={depth > 0}
    role="gridcell"
    tabindex="-1"
    draggable="false"
    on:click|stopPropagation
    on:keydown|stopPropagation
    on:dragstart|preventDefault|stopPropagation
  >
    {#if lineNumber > 0}
      <span class="RowNumber" aria-hidden="true" data-page-search-skip>{lineNumber}</span>
    {/if}
    {#if depth > 0}
      <input
        type="checkbox"
        class="RowCheckbox"
        checked={bulkSelectionActive && selected}
        aria-label="一括操作の対象として選択"
        title="一括操作の対象として選択"
        tabindex="-1"
        on:click={toggleCheckbox}
        on:keydown|stopPropagation
      />
    {/if}
  </div>
  {#each headers as header, i}
    <div class:TableData={true} data-column={header.name} role="gridcell" style:z-index={i + 100}>
      {#if header.name == "name"}
        {#each Array(depth) as _, level}
          <div
            class:TreeLine={true}
            class:ParentLine={level === depth - 1}
            class:GuideEnd={level === depth - 1 && isLastSibling}
            class:GuideHidden={level < depth - 1 && !guideLines[level]}
            style="flex-shrink: 0"
          ></div>
        {/each}
        {#if hasChildren}
          <button
            class:Expanded={expanded}
            class:ExpandButton={true}
            style="flex-shrink: 0"
            aria-label={expanded ? "タスクを折りたたむ" : "タスクを展開"}
            on:click={toggle}
          >
            <svg viewBox="-12 0 32 32" xmlns="http://www.w3.org/2000/svg"
              ><path
                d="M0.88 23.28c-0.2 0-0.44-0.080-0.6-0.24-0.32-0.32-0.32-0.84 0-1.2l5.76-5.84-5.8-5.84c-0.32-0.32-0.32-0.84 0-1.2 0.32-0.32 0.84-0.32 1.2 0l6.44 6.44c0.16 0.16 0.24 0.36 0.24 0.6s-0.080 0.44-0.24 0.6l-6.4 6.44c-0.2 0.16-0.4 0.24-0.6 0.24z"
              ></path>
            </svg>
          </button>
        {:else}
          <!-- 子を持たない行は開閉ボタンぶんの幅だけ空ける。全行に書類
               アイコンを並べると、字下げより先にアイコンの列が目に入って
               階層が読みにくくなる。 -->
          <div class:Space={true} aria-hidden="true"></div>
        {/if}
        <!-- 同じノードが複数の場所に出ていることを示す印。コピーで増えた別ノード
             とは、この印の有無で見分ける。印の有無で名前の位置がずれると比べに
             くいので、印が無い行でも同じ幅の枠を空けておく。 -->
        {#if sharedPlaces.length > 1}
          <!-- 主体（原本）を決めていないモデルなので、どこかを指し示す「鎖」の
               記号は使わない。ツリーは左上から右下へ伸びるので、記号も同じ流れで
               「1 つのノードが右へ 2 か所に分かれて現れる」形にする。 -->
          <span
            class="SharedMark"
            role="img"
            aria-label={`同じノードが${sharedPlaces.length}か所にあります: ${sharedPlaces.join(" / ")}`}
            title={`同じノードが${sharedPlaces.length}か所にあります: ${sharedPlaces.join(" / ")}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M7.5 12h3.5l5-5.5M11 12l5 5.5"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle cx="5" cy="12" r="2.8" fill="currentColor" />
              <circle cx="18" cy="6" r="2.4" fill="currentColor" />
              <circle cx="18" cy="18" r="2.4" fill="currentColor" />
            </svg>
            <span class="SharedMarkCount">{sharedPlaces.length}</span>
          </span>
        {:else}
          <span class="SharedMarkSpacer" aria-hidden="true"></span>
        {/if}
        {#if node.cycleReference}<span
            class="cycle-reference"
            role="img"
            aria-label="循環参照：この行は展開しません"
            title="循環参照：この行は展開しません">↩</span
          >{/if}
        <TaskName
          bind:this={taskName}
          text={data[header.name]}
          {hasChildren}
          {expanded}
          isRoot={depth === 0 || application?.isProtected(id)}
          canMoveUp={effectiveCanMoveUp}
          canMoveDown={effectiveCanMoveDown}
          canIndent={effectiveCanIndent}
          canOutdent={effectiveCanOutdent}
          {canOpenTaskFolder}
          selectionCount={selectionCountForMenu}
          {nodePath}
          archived={isArchived}
          on:commit={(e) => {
            commitData("name", e.detail.value);
          }}
          on:addBelow={() => {
            dispatch("addBelow", { id, path });
          }}
          on:addChild={() => {
            dispatch("addChild", { id, path });
          }}
          on:toggleExpand={() => {
            dispatch("toggle", { id, path });
          }}
          on:moveUp={() => {
            dispatch("moveUp", { id, path });
          }}
          on:moveDown={() => {
            dispatch("moveDown", { id, path });
          }}
          on:indentTask={() => {
            dispatch("indentTask", { id, path });
          }}
          on:outdentTask={() => {
            dispatch("outdentTask", { id, path });
          }}
          on:deleteTask={() => {
            // 経路も渡す。多親ノードでは「この行（辺）だけ」を片付ける選択が
            // あるので、どの親の下の行なのかが要る。
            dispatch("deleteTask", { id, path });
          }}
          on:restoreTask={() => {
            dispatch("restoreTask", { id, path });
          }}
          on:permanentDeleteTask={() => {
            dispatch("permanentDeleteTask", { id });
          }}
          on:copyTask={() => {
            dispatch("copyTask", { id });
          }}
          on:pasteTask={() => {
            dispatch("pasteTask", { id, path });
          }}
          on:menuVisibilityChange={({ detail }) => {
            isMenuOpen = detail.open;
          }}
          on:openTaskFolder={() => {
            dispatch("openTaskFolder", { id });
          }}
        />
      {:else if header.name == "status"}
        <StatusSelect
          status={data[header.name]}
          ariaLabel={`${data.name}のステータス`}
          disabled={isArchived}
          on:change={(e) => {
            commitData("status", e.detail.value);
          }}
        />
      {:else if header.name == "start date"}
        <DateInput
          displayOnly={true}
          is_dark={isDark}
          backgroundColor={"var(--backgroundColor)"}
          value={data[header.name]}
          ariaLabel={`${data.name}の開始日`}
          showUrgency={false}
          disabled={isArchived}
          on:change={(e) => {
            commitData("start date", e.target.value);
          }}
        />
      {:else if header.name == "due date"}
        <DateInput
          displayOnly={true}
          is_dark={isDark}
          backgroundColor={"var(--backgroundColor)"}
          value={data[header.name]}
          ariaLabel={`${data.name}の期限日`}
          status={data["status"]}
          inheritedDate={inheritedDueDate}
          disabled={isArchived}
          on:change={(e) => {
            commitData("due date", e.target.value);
          }}
        />
      {:else if header.name == "tags"}
        {#if rowTags.length > 0}
          <span class="TagCellChips" title={rowTags.join(", ")}>
            {#each visibleRowTags as tag (tag)}
              <button
                type="button"
                class="TagChip"
                class:Active={$active_tag === tag}
                title={`タグ ${tag} で絞り込む`}
                aria-pressed={$active_tag === tag}
                aria-label={`タグ ${tag} で絞り込む`}
                on:click|stopPropagation={() => ($active_tag = $active_tag === tag ? null : tag)}
              >
                {tag}
              </button>
            {/each}
            {#if hiddenRowTagCount > 0}
              <span class="TagOverflow" aria-label={`他 ${hiddenRowTagCount} 件のタグ`}
                >+{hiddenRowTagCount}</span
              >
            {/if}
          </span>
        {/if}
      {:else if header.name === "attachments"}
        <!-- 件数は 0 のほうが普通なので、0 のときは目に入れない。1 件以上の
             ときだけバッジで出す。全行に "0" を並べると、実際に中身がある
             行を探すのがかえって難しくなる。 -->
        {@const count = countCellValue(header.name)}
        {#if count > 0}
          <span
            class="CountBadge"
            title={`${COUNT_LABELS[header.name]} ${count}件`}
            aria-label={`${COUNT_LABELS[header.name]} ${count}件`}
          >
            <svg class="CountBadgeIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M18 8.5l-7 7a3 3 0 0 1-4.2-4.2l7.5-7.5a2 2 0 0 1 2.8 2.8l-7.5 7.5a1 1 0 0 1-1.4-1.4l6.8-6.8"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {count}
          </span>
        {:else}
          <span class="CountEmpty" aria-label={`${COUNT_LABELS[header.name]} なし`}>—</span>
        {/if}
      {:else}
        <span class:TextOverFlow={true}>{displayCellValue(header.name)}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  button {
    border: none;
    padding: 0;
    margin: 0;
    border-radius: 0;
    background-color: transparent;
  }
  button:active {
    background-color: transparent;
  }
  :global(.NameTag) {
    position: absolute;
    top: -1000rem;
    display: inline;
    background-color: var(--theme-color-Primary-dark);
    border: 1px solid var(--theme-color-Primary-dark);
    color: var(--theme-color-Sub-main);
    padding: 0 var(--sp2);
  }
  .TableRow.Dragging {
    opacity: 0.6;
  }
  .TableRow.DragOverTop:before {
    /* Insert as elder sibling: blue line on top edge */
    border-top: 0.2rem solid var(--theme-color-Primary-dark);
    position: absolute;
    top: 0;
    left: 0;
    content: "";
    height: 0;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999999999;
    pointer-events: none;
  }
  .TableRow.DragOverBottom:before {
    /* Append as child: outline around the entire row */
    border: 0.2rem solid var(--theme-color-Primary-dark);
    position: absolute;
    top: 0;
    left: 0;
    content: "";
    height: 100%;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999999999;
    pointer-events: none;
  }
  .TableRow.DragOverBelow:before {
    /* Insert as younger sibling: blue line on bottom edge */
    border-bottom: 0.2rem solid var(--theme-color-Primary-dark);
    position: absolute;
    top: 0;
    left: 0;
    content: "";
    height: 100%;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999999999;
    pointer-events: none;
  }
  /* Row enter/leave animation when a node is expanded/collapsed.
     Pure CSS (no Svelte transitions) so virtualisation stays cheap. */
  @keyframes RowEnter {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .TableRow {
    animation: RowEnter 0.16s ease-out;
    display: flex;
    flex-direction: row;
    box-sizing: border-box;
    position: relative;
    height: var(--tree-row-height, 36px);
    min-height: var(--tree-row-height, 36px);
    max-height: var(--tree-row-height, 36px);
    padding: 0;
    width: 100%;
    /* 行の区切りだけを引く（セルの縦罫線は引かない）。薄くしすぎると行の
       切れ目が読めないので、区切り線の標準色をそのまま使う。 */
    border-bottom: 1px solid var(--border-muted);
  }
  .TableRow.MenuOpen {
    z-index: 9999;
  }
  .TableRow {
    --backgroundColor: var(--theme-color-Main-light);
  }
  /* 期限の状態は日付セル（文字色・太さ・左の縁）で示す。行全体を塗ると
     選択やホバーと区別が付かず、色の意味も読めなくなるため塗らない。 */
  /* Archived rows: muted, with subtle diagonal striping to visually flag
     "this is in the archive view". Stronger than urgency tints so it reads
     even when the row is also overdue. */
  .TableRow.ArchivedRow {
    opacity: 0.55;
    font-style: italic;
    background-image: repeating-linear-gradient(
      135deg,
      transparent,
      transparent 6px,
      color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent) 6px,
      color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent) 7px
    );
  }
  .TableRow.ArchivedRow:hover {
    opacity: 0.85;
  }
  .TableRow:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
    z-index: 999;
  }
  .TableRow:hover {
    --backgroundColor: var(--hover-bg);
  }
  .TableRow.Selected {
    --backgroundColor: var(--accent-subtle);
  }
  .TableRow:hover .TableData {
    background-color: var(--backgroundColor);
  }
  .TableRow.Selected::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 0.2rem;
    height: 100%;
    background-color: var(--theme-color-Primary-main);
    z-index: 999;
    pointer-events: none;
  }
  .TableRow.Anchor::after {
    background-color: var(--theme-color-Primary-dark);
    width: 0.3rem;
  }
  /*
   * 同じノードを指す別の行（別の親の下の出現）。ノード単位の選択なので色は
   * 付くが、操作中の行と同じ強さだと「どこを触っているか」が分からなくなる。
   * 塗りを薄くし、左のバーを破線にして「ここにもある」だけを伝える。
   */
  .TableRow.Selected.EchoRow {
    --backgroundColor: color-mix(
      in srgb,
      var(--theme-color-Primary-main) 6%,
      var(--theme-color-Main-light)
    );
  }
  .TableRow.Selected.EchoRow::after {
    background-color: transparent;
    background-image: repeating-linear-gradient(
      to bottom,
      var(--theme-color-Primary-main) 0 4px,
      transparent 4px 9px
    );
  }
  .CheckboxCell {
    flex: 0 0 1.75rem;
    width: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    box-sizing: border-box;
    background-color: var(--backgroundColor);
  }
  .RowNumber {
    font-size: 0.7rem;
    line-height: 1;
    color: var(--theme-color-Sub-dark);
    opacity: 0.55;
    user-select: none;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  .RowCheckbox {
    display: none;
    width: 0.95rem;
    height: 0.95rem;
    margin: 0;
    cursor: pointer;
    accent-color: var(--theme-color-Primary-dark);
  }
  /* チェックボックスを持つ行で hover / 選択中のとき、番号を隠してチェックボックスを出す */
  .TableRow:hover .CheckboxCell.HasCheckbox .RowNumber,
  .CheckboxCell.HasCheckbox.Visible .RowNumber {
    display: none;
  }
  .TableRow:hover .CheckboxCell.HasCheckbox .RowCheckbox,
  .CheckboxCell.HasCheckbox.Visible .RowCheckbox {
    display: inline-block;
  }
  .TableData {
    flex-shrink: 0;
    display: flex;
    position: relative;
    box-sizing: border-box;
    height: 100%;
    --col-min: var(--col-min-default);
    min-width: var(--col-min);
    background-color: var(--backgroundColor);
    padding: var(--sp1) var(--sp2);
    align-items: center;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-md);
  }
  .TableData[data-column="name"] {
    --col-min: var(--col-min-name);
  }
  .TableData[data-column="status"] {
    --col-min: var(--col-min-status);
  }
  .TableData[data-column="start date"],
  .TableData[data-column="due date"] {
    --col-min: var(--col-min-date);
  }
  .TableData[data-column="attachments"] {
    --col-min: var(--col-min-count);
  }
  .TableData[data-column="tags"] {
    --col-min: var(--col-min-tags);
    /* チップ自身が丸い余白を持っているので、セル側の左右余白まで他の列と
       同じだけ取ると二重に空く。タグ列だけ詰めて、列を細くしたときに
       チップの文字が先に消えないようにする。 */
    padding-inline: var(--sp1);
  }
  /* プロジェクトのルート行。これまで子タスクとの差はインデントとアイコン
     だけで、木の頂点がどこか一目で分からなかった。名前を太くし、下辺を
     はっきりさせて「ここから下がこのプロジェクト」と読めるようにする。
     色は足さない（色は期限の緊急度に予約してある）。 */
  .TableRow.RootRow {
    --backgroundColor: color-mix(
      in srgb,
      var(--theme-color-Sub-main) 5%,
      var(--theme-color-Main-light)
    );
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 22%, transparent);
  }
  .TableRow.RootRow :global(.highlight-display),
  .TableRow.RootRow :global(input[type="text"]) {
    font-weight: 700;
  }

  /* 件数バッジ。0 は控えめなダッシュにして、中身のある行だけが目に入る
     ようにする（期限日の色付けと同じ「必要なものだけ目立たせる」方針）。 */
  .CountBadge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px var(--sp1);
    border-radius: var(--shape-pill);
    background-color: color-mix(in srgb, var(--theme-color-Sub-main) 12%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.25;
  }
  .CountBadgeIcon {
    width: 0.85em;
    height: 0.85em;
    flex-shrink: 0;
  }
  .CountEmpty {
    color: color-mix(in srgb, var(--theme-color-Sub-main) 32%, transparent);
    font-size: var(--font-label-md);
    user-select: none;
  }

  /* タグセルは行内で 1 行に収める。溢れた分は横スクロールではなく
     単純に切り落とし、詳細ペインで全部見てもらう。 */
  .TableData .TagCellChips {
    /* .TableData span の共通ルール（flex:1 / center）を上書きする。
       中央寄せのままだとチップが左右どちらもはみ出して両端が切れる。 */
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: flex-start;
    gap: var(--sp1);
    min-width: 0;
    overflow: hidden;
  }
  .TableData .TagOverflow {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    font-size: var(--font-label-sm);
    font-weight: 600;
    white-space: nowrap;
  }
  .TagChip {
    max-width: 8rem;
    min-width: 0;
    height: 1.25rem;
    /* 詳細ペインの .tag-chip と同じ詰め方。8px だと 2〜3 文字のタグでも
       文字より余白のほうが広くなり、列の最小幅を無駄に押し上げていた。 */
    padding: 0 var(--sp1);
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 55%, transparent);
    border-radius: var(--shape-pill);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 14%, transparent);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-sm);
    font-weight: 500;
    line-height: 1.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    flex: 0 1 auto;
  }
  .TagChip:hover {
    border-color: var(--theme-color-Primary-main);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 26%, transparent);
  }
  .TagChip.Active {
    border-color: var(--theme-color-Primary-main);
    background-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Main-main);
  }
  .TableData:last-child {
    border-right: none;
  }
  .TableData span {
    flex: 1;
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  /* 共有の印。`.TableData span`（flex:1 / 中央寄せ）の共通ルールより強く
     指定しないと、セルの半分を占めて名前を押し出してしまう。 */
  .TableData .SharedMark {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 1px;
    height: 1.05rem;
    padding: 0 3px 0 1px;
    margin-right: var(--sp1);
    border-radius: var(--shape-pill);
    background-color: color-mix(in srgb, var(--accent-fg) 14%, transparent);
    color: var(--accent-fg);
    line-height: 1;
    white-space: nowrap;
    user-select: none;
  }
  .TableData .SharedMark svg {
    flex: 0 0 0.95rem;
    width: 0.95rem;
    height: 0.95rem;
  }
  .SharedMarkCount {
    font-size: var(--font-label-sm);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  /* 印が無い行の同じ幅の空き。行ごとに名前の開始位置がずれないようにする。 */
  .TableData .SharedMarkSpacer {
    flex: 0 0 auto;
    display: inline-block;
    width: 1.95rem;
    height: 1px;
    margin-right: var(--sp1);
  }
  .TableData .cycle-reference {
    flex: 0 0 1.2rem;
    white-space: nowrap;
    line-height: 1;
  }
  /* Indent line — stretched to fill the full row height (including cell padding
     and the row's bottom border) so adjacent rows show one continuous vertical line */
  .TreeLine {
    position: relative;
    display: inline-block;
    align-self: stretch;
    /* 1 段ぶんの字下げ（ガイド線 + 余白でおよそ 17px）。階層は主にこの
       字下げで読ませる。 */
    width: 1.1rem;
    margin-top: calc(-1 * var(--sp1));
    margin-bottom: calc(-1 * var(--sp1) - 1px);
    margin-left: var(--sp1);
    flex-shrink: 0;
  }
  /* 縦線。末っ子では行の中央で止めたいので、border ではなく擬似要素で引く。
     階層は面の色ではなくこの線で示すので、区切り線より強い濃さにする。 */
  .TreeLine::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-left: 1px solid color-mix(in srgb, var(--fg-muted) 42%, transparent);
  }
  /* 末っ子は「└」。中央で閉じて、下に線を垂らさない。 */
  .TreeLine.GuideEnd::before {
    bottom: 50%;
  }
  /* その段の祖先がもう末っ子なら、この行に線は通らない。 */
  .TreeLine.GuideHidden::before {
    display: none;
  }
  /* 一番手前の 1 本＝自分の親。ここから自分の行へ横枝を伸ばして、
     「この行はこの縦線にぶら下がっている」と一目で分かるようにする。 */
  .TreeLine.ParentLine::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 0;
    width: 100%;
    border-top: 1px solid color-mix(in srgb, var(--fg-muted) 42%, transparent);
    pointer-events: none;
  }

  .ExpandButton:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
    z-index: 999;
  }
  .ExpandButton {
    cursor: pointer;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    transform: rotate(0deg);
    /* Smooth chevron rotation while the rows themselves fade-in (see RowEnter
       keyframes below). Keep this longer than RowEnter so the chevron motion
       reads as the cause. */
    transition:
      transform 0.18s ease-out,
      background-color 0.12s ease;
  }
  .ExpandButton svg {
    width: 100%;
    height: 100%;
    fill: var(--theme-color-Sub-light);
  }
  .ExpandButton.Expanded {
    transform: rotate(90deg);
  }
  .Space {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  /* 親（子を持つ行）は「少しだけ強い」程度に差を付ける。太い枠や濃い塗りは
     使わず、文字の太さとごく薄い面の差だけ。 */
  .TableRow.ParentRow :global(.highlight-display),
  .TableRow.ParentRow :global(input[type="text"]) {
    font-weight: 600;
  }
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
</style>
