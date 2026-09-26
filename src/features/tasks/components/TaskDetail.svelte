<script>
  import { getContext, onDestroy, tick } from "svelte";
  import { get } from "svelte/store";
  import debounce from "lodash/debounce";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  import { getNode, isNodeEffectivelyArchived } from "@features/tasks/utils/tree_control";
  import {
    active_row_path,
    selected_ids,
    selected_id,
    selected_type,
    table_selected_id,
  } from "@stores/ui";
  import { tag_index } from "@features/memos/stores/tags";
  import { theme } from "@stores/theme";
  import Memo from "@features/memos/components/Memo.svelte";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import Button from "@lib/primitives/Button.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import Modal from "@lib/primitives/Modal.svelte";
  import TaskMenu from "./TaskMenu.svelte";
  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";
  import TaskAttachments from "@features/tasks/components/TaskAttachments.svelte";
  import DateInput from "@lib/primitives/DateInput.svelte";
  import TagField from "@lib/primitives/TagField.svelte";
  import ParentField from "@features/tasks/components/ParentField.svelte";
  import { normalizeTagList } from "@lib/utils/tags";
  import { parentIdsOf } from "@lib/utils/parent_links";
  import {
    convertMemoContent,
    isEmptyMemoContent,
    isQuillDelta,
    normalizeMemoFormat,
  } from "@features/memos/utils/memo_utils";

  const application = getContext(TREEGRID_APPLICATION);
  const relationError = application.error;
  const tree_data = application.tree;
  /** id → グラフのノード（親子関係を含む）。 */
  const records = application.records;
  const defaultMemoFormat = "markdown";

  export let titleOverride = "";
  export let showOpenWindowAction = true;

  let relationTarget = "";
  let copyMode = "node";
  let relationAction = "";
  let relationBusy = false;
  let relationNodeId;
  $: if (relationNodeId !== $table_selected_id) {
    relationNodeId = $table_selected_id;
    relationAction = "";
    relationTarget = "";
  }
  function openRelation(action) {
    application.error.set("");
    relationTarget = "";
    copyMode = "node";
    relationAction = action;
  }
  async function submitRelation() {
    relationBusy = true;
    try {
      const result =
        relationAction === "copy"
          ? await application.copyTo(node.id, relationTarget, copyMode)
          : relationAction === "detach"
            ? await application.detach(node.id, $active_row_path)
            : await application.moveTo(node.id, $active_row_path, relationTarget);
      if (result) relationAction = "";
    } finally {
      relationBusy = false;
    }
  }

  $: extraSelectedCount = Math.max(0, $selected_ids.size - 1);
  $: is_selected = $table_selected_id ? true : false;
  $: node =
    $table_selected_id && $tree_data ? getNode($table_selected_id, $tree_data.data) : undefined;
  $: name = node ? node.data["name"] : "Select Task";
  $: cardTitle = titleOverride || name;
  $: nodeBody = node ? (node.data["body"] ?? "") : "";
  $: bodyFormat = normalizeMemoFormat(node?.data?.["format"], defaultMemoFormat);
  // `[[…]]` の補完候補。自分の子ノードの名前（旧メモは子ノードになる）。
  $: siblingNodeNames = (node?.children ?? [])
    .map((child) => child?.data?.name)
    .filter((childName) => Boolean(childName) && childName !== node?.data?.name);
  $: attachments = node ? (node.data["attachments"] ?? []) : [];
  $: isArchived = isNodeEffectivelyArchived($table_selected_id, $tree_data?.data);

  $: isDark = $theme === "dark";
  const detailDateStyle =
    "border: 0; padding: 0 var(--sp7) 0 var(--sp2); font-size: 0.75rem; background-color: transparent;";
  const statusLabels = {
    Open: "未着手",
    Pending: "保留",
    "In Progress": "進行中",
    Completed: "完了",
    Canceled: "キャンセル",
    Undefined: "未定義",
  };
  let activeTab = "overview";
  let editingProperties = false;
  let editingBody = false;
  let bodyVisited = false;
  let memoEditor;
  let detailMenu = false;
  let detailTrigger;
  let detailMenuPosition = { x: 0, y: 0, position: "left" };
  let parentEditing = false;
  let parentNotice = "";
  let blockedParent = "";
  let dangerTarget = null;
  const requestDanger = () => {
    dangerTarget = { id: node.id, name, permanent: isArchived };
  };
  async function confirmDanger() {
    const target = dangerTarget;
    dangerTarget = null;
    if (!target) return;
    if ((await memoEditor?.flush()) === false) return;
    if (target.permanent) await application.remove([target.id]);
    else await application.archive([target.id]);
  }
  $: detailMenuItems = [
    ...(node
      ? [
          {
            title: "配置を変更",
            action: "move",
            disabled: isArchived || application.isProtected(node.id),
          },
          { title: "コピー先を指定", action: "copy", disabled: isArchived },
          ...(isArchived
            ? [
                {
                  title: "アーカイブから復元",
                  action: "restore",
                  disabled: application.isProtected(node.id),
                },
              ]
            : []),
          {
            title: isArchived ? "完全削除…" : "アーカイブ…",
            action: "danger",
            disabled: application.isProtected(node.id),
          },
        ]
      : []),
    ...(showOpenWindowAction ? [{ title: "別Windowで開く", action: "window" }] : []),
    ...(activeTab === "body"
      ? [{ title: "形式を変換", action: "format", disabled: isArchived }]
      : []),
  ];
  function toggleDetailMenu(event) {
    detailTrigger = event.currentTarget;
    const box = detailTrigger.getBoundingClientRect();
    detailMenuPosition = { x: box.right, y: box.bottom, position: "left" };
    detailMenu = !detailMenu;
  }
  function closeDetailMenu() {
    detailMenu = false;
    detailTrigger?.focus();
  }
  async function changeTab(tab) {
    flushNameChange();
    if ((await memoEditor?.flush()) === false) return;
    activeTab = tab;
    if (tab === "body") bodyVisited = true;
  }
  async function toggleBodyEditing() {
    if ((await memoEditor?.flush()) === false) return;
    editingBody = !editingBody;
    await tick();
    if (editingBody) memoEditor?.startEditing();
  }
  async function visitParent(id, clearFilters = false) {
    if ((await memoEditor?.flush()) === false) return;
    flushNameChange();
    const result = await application.navigateToNode(id, { clearFilters });
    parentNotice = result?.error || "";
    blockedParent = result?.filtered ? id : "";
  }

  // 編集した時点で開いていたノードを覚えておき、遅れて届いた保存が別の
  // ノードへ書き込まれないようにする。
  const getEditContext = () => ({
    selectedType: $selected_type,
    selectedId: $selected_id,
    tableSelectedId: $table_selected_id,
  });

  const contextMatches = (context) =>
    context &&
    context.selectedType === $selected_type &&
    context.selectedId === $selected_id &&
    context.tableSelectedId === $table_selected_id;

  const changeData = (target, key, value, editContext = getEditContext()) => {
    if (target && contextMatches(editContext)) {
      return application.update(target.id, { [key]: value });
    }
  };
  const changeDataDebounce = debounce(changeData, 500);
  let previousEditContextKey = "";

  const getLiveNode = (editContext = getEditContext()) => {
    const liveTreeData = get(tree_data);
    if (!contextMatches(editContext) || !liveTreeData?.data || !editContext.tableSelectedId) {
      return undefined;
    }
    return getNode(editContext.tableSelectedId, liveTreeData.data);
  };

  $: editContextKey = [$selected_type ?? "", $selected_id ?? "", $table_selected_id ?? ""].join(
    ":"
  );

  $: if (editContextKey !== previousEditContextKey) {
    changeDataDebounce.cancel();
    previousEditContextKey = editContextKey;
    editingProperties = false;
    editingBody = false;
    parentEditing = false;
    parentNotice = "";
    blockedParent = "";
  }

  onDestroy(() => {
    changeDataDebounce.cancel();
  });
  $: allTags = [...$tag_index.keys()].sort();
  $: taskTags = normalizeTagList(node?.data?.tags);

  const saveTaskTags = (nextTags) => {
    changeTaskField("tags", normalizeTagList(nextTags));
  };

  /**
   * ノード本文の保存。
   *
   * ノードは本文を 1 つだけ持つ（「1 つのメモ ＝ 1 つのノード」）。複数の記録を
   * 残したいときはタブではなく子ノードを足す。
   */
  const assetSaver = (id) => (file) => application.saveAsset(id, file);
  const assetResolver = (id) => (path) => application.resolveAsset(id, path);
  // Capture the identity before an editor can finish an asynchronous save.
  const bodySaveCallback = (target) => (editedContent) => {
    if (!target) return false;
    const currentTarget = get(records)[target.id];
    const targetFormat = normalizeMemoFormat(
      currentTarget?.format ?? target.data.format,
      defaultMemoFormat
    );
    const sourceFormat = isQuillDelta(editedContent) ? "quill" : "markdown";
    const body = convertMemoContent(editedContent, sourceFormat, targetFormat);
    return application.update(target.id, { body }).then(Boolean);
  };

  let show_format_confirm = false;
  let pendingBodyFormat = null;

  const toggle_format_confirm = () => {
    show_format_confirm = !show_format_confirm;
    if (!show_format_confirm) pendingBodyFormat = null;
  };

  const callback_format_confirm = () => {
    const nextFormat = pendingBodyFormat;
    pendingBodyFormat = null;
    if (nextFormat) applyBodyFormat(nextFormat);
  };

  /**
   * 形式の切り替えを要求する。
   *
   * Markdown ⇄ Quill の変換では装飾や埋め込みが落ちうるので、中身があるときは
   * 必ず確認を挟む。空の本文なら落ちるものが無いので、そのまま変換する。
   */
  const requestBodyFormat = async (nextFormat) => {
    if ((await memoEditor?.flush()) === false) return;
    const liveNode = getLiveNode(getEditContext());
    if (!liveNode) return;
    if (normalizeMemoFormat(liveNode.data.format, defaultMemoFormat) === nextFormat) return;
    pendingBodyFormat = nextFormat;
    if (isEmptyMemoContent(liveNode.data.body)) {
      callback_format_confirm();
      return;
    }
    show_format_confirm = true;
  };

  /** 本文の形式を切り替える。中身も合わせて変換する。 */
  const applyBodyFormat = (nextFormat) => {
    const current = getLiveNode();
    if (!current) return false;
    void application.update(current.id, {
      body: convertMemoContent(
        current.data.body,
        current.data.format || defaultMemoFormat,
        nextFormat
      ),
      format: nextFormat,
    });
    return true;
  };

  $: isProjectRoot = Boolean(node && !$records[node.id]?.parents.length);
  $: currentParentIds = parentIdsOf($records[node?.id]?.parents);

  /** id → 名前。チップと候補の表示に使う。 */
  $: nodeNameById = Object.fromEntries(
    Object.values($records ?? {}).map((record) => [record.id, record.name])
  );

  /**
   * 親の候補。自分自身だけを除外し、子孫へのリンクも許可する（循環は
   * グラフが保存できる）。既に親になっているものは ParentField 側で外れる。
   */
  $: parentCandidates =
    node && $tree_data?.data
      ? Object.values($records ?? {})
          .filter((record) => record.id !== node.id)
          .map((record) => ({
            id: record.id,
            name: record.name,
            path: nodePathById[record.id] ?? "",
          }))
      : [];

  /** 候補に出す補助情報（ルートからの経路）。同名ノードの見分けに要る。 */
  $: nodePathById = buildNodePathLabels($tree_data?.data);

  function buildNodePathLabels(root) {
    const labels = {};
    if (!root) return labels;
    // 多親ノードは経路が複数ある。1 本目だけ出すと、経路で見分けるという
    // この欄の目的が、いちばん見分けたい相手で果たせない。残りは件数で示す。
    const pathsById = {};
    const walk = (treeNode, trail) => {
      const label = trail.join(" / ");
      const seen = (pathsById[treeNode.id] ??= []);
      if (!seen.includes(label)) seen.push(label);
      const nextTrail = [...trail, treeNode.data?.name ?? ""];
      for (const child of treeNode.children ?? []) walk(child, nextTrail);
    };
    walk(root, []);
    for (const [id, paths] of Object.entries(pathsById)) {
      labels[id] = paths.length > 1 ? `${paths[0]} 他 ${paths.length - 1} 件` : (paths[0] ?? "");
    }
    return labels;
  }

  function saveParents(nextParentIds) {
    return application.parents(node.id, nextParentIds);
  }

  const changeTaskField = (key, value, debounceChange = false) => {
    if (!node) return;
    const editContext = getEditContext();
    if (debounceChange) {
      changeDataDebounce(node, key, value, editContext);
    } else {
      changeData(node, key, value, editContext);
    }
  };

  const handleNameInput = (event) => {
    changeTaskField("name", event.target.value, true);
  };

  const flushNameChange = () => {
    changeDataDebounce.flush?.();
  };

  function openTaskDetailInWindow() {
    if (node) application.openDetail(node.id, name);
  }
</script>

{#if is_selected && node}
  <section class="node-detail" aria-label="ノード詳細">
    <header class="detail-header">
      <h2>{cardTitle}</h2>
      <div class="task-detail-actions">
        <IconButton
          variant="text"
          normalColor="var(--fg-default)"
          activeColor="var(--accent-fg)"
          ariaLabel={editingProperties ? "編集終了" : "編集"}
          tooltipContent={editingProperties ? "編集終了" : "編集"}
          style="margin:0; width:1.6875rem; height:1.6875rem;"
          disabled={isArchived}
          on:click={async () => {
            if ((await memoEditor?.flush()) === false) return;
            flushNameChange();
            editingProperties = !editingProperties;
            activeTab = "overview";
          }}
          ><svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            aria-hidden="true"
            >{#if editingProperties}<path d="m5 12 4 4L19 6" />{:else}<path
                d="m15 4 5 5-11 11H4v-5L15 4Z M13 6l5 5"
              />{/if}</svg
          ></IconButton
        >
        <IconButton
          variant="text"
          normalColor="var(--fg-default)"
          activeColor="var(--accent-fg)"
          ariaLabel="ノード詳細の操作"
          aria-haspopup="menu"
          aria-expanded={detailMenu}
          data-task-menu-trigger
          style="margin:0; width:1.6875rem; height:1.6875rem;"
          on:click={toggleDetailMenu}
          ><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
            ><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle
              cx="19"
              cy="12"
              r="1.5"
            /></svg
          ></IconButton
        >
      </div>
    </header>
    <TaskMenu
      show={detailMenu}
      position={detailMenuPosition}
      menuItems={detailMenuItems}
      on:danger={requestDanger}
      on:restore={() => application.archive([node.id], false)}
      on:close={closeDetailMenu}
      on:move={() => openRelation("move")}
      on:copy={() => openRelation("copy")}
      on:window={openTaskDetailInWindow}
      on:format={() => requestBodyFormat(bodyFormat === "markdown" ? "quill" : "markdown")}
    />
    <div class="detail-tabs" role="tablist" aria-label="ノードの内容">
      {#each [{ id: "overview", label: "概要" }, { id: "attachments", label: "添付 (" + attachments.length + ")" }, { id: "body", label: "本文" }] as tab}
        <button
          role="tab"
          id={"detail-tab-" + tab.id}
          aria-controls={"detail-panel-" + tab.id}
          aria-selected={activeTab === tab.id}
          tabindex={activeTab === tab.id ? 0 : -1}
          on:click={() => changeTab(tab.id)}
          on:keydown={(event) => {
            const ids = ["overview", "attachments", "body"];
            let index = ids.indexOf(activeTab);
            if (event.key === "ArrowRight") index = (index + 1) % 3;
            else if (event.key === "ArrowLeft") index = (index + 2) % 3;
            else if (event.key === "Home") index = 0;
            else if (event.key === "End") index = 2;
            else return;
            event.preventDefault();
            event.stopPropagation();
            void changeTab(ids[index]);
            document.getElementById("detail-tab-" + ids[index])?.focus();
          }}>{tab.label}</button
        >
      {/each}
    </div>
    {#if extraSelectedCount > 0}
      <div class="multi-select-indicator" role="status" aria-live="polite">
        他 {extraSelectedCount} 件選択中（一括操作はバーから行えます）
      </div>
    {/if}
    <div class="task-detail-card-body">
      <div
        class="detail-pane"
        role="tabpanel"
        id="detail-panel-overview"
        aria-labelledby="detail-tab-overview"
        hidden={activeTab !== "overview"}
      >
        {#if isArchived}
          <div class="archived-banner" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M3 7h18v3H3V7zM5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9M10 14h4"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              />
            </svg>
            <span>このノードはアーカイブ済みです。編集するには復元してください。</span>
          </div>
        {/if}
        <div class="detail-container">
          <div class="detail-fields">
            <label class="detail-field">
              <span class="detail-label">ノード名</span>
              <div class="detail-control" class:reading={!editingProperties || isArchived}>
                {#if editingProperties && !isArchived}
                  <input
                    class="detail-input"
                    type="text"
                    value={name}
                    aria-label="ノード名"
                    on:input={handleNameInput}
                    on:blur={flushNameChange}
                  />
                {:else}<span class="detail-value">{name || "未設定"}</span>{/if}
              </div>
            </label>

            <label class="detail-field">
              <span class="detail-label">ステータス</span>
              <div class="detail-control" class:reading={!editingProperties || isArchived}>
                {#if editingProperties && !isArchived}
                  <StatusSelect
                    status={node.data.status ?? ""}
                    ariaLabel="ステータス"
                    style="height: 100%; font-size: var(--font-body-md);"
                    on:change={(event) => changeTaskField("status", event.detail.value)}
                  />
                {:else}<span class="detail-value"
                    >{statusLabels[node.data.status] || node.data.status || "未設定"}</span
                  >{/if}
              </div>
            </label>

            <label class="detail-field">
              <span class="detail-label">開始日</span>
              <div class="detail-control" class:reading={!editingProperties || isArchived}>
                {#if editingProperties && !isArchived}
                  <DateInput
                    is_dark={isDark}
                    id="detail-start-date"
                    backgroundColor={"var(--theme-color-Main-light)"}
                    style={detailDateStyle}
                    value={node.data["start date"] ?? ""}
                    ariaLabel="開始日"
                    showUrgency={false}
                    on:change={(event) =>
                      changeTaskField("start date", event.target.value || undefined)}
                  />
                {:else}<span class="detail-value">{node.data["start date"] || "未設定"}</span>{/if}
              </div>
            </label>

            <label class="detail-field">
              <span class="detail-label">期限日</span>
              <div class="detail-control" class:reading={!editingProperties || isArchived}>
                {#if editingProperties && !isArchived}
                  <DateInput
                    is_dark={isDark}
                    id="detail-due-date"
                    backgroundColor={"var(--theme-color-Main-light)"}
                    style={detailDateStyle}
                    value={node.data["due date"] ?? ""}
                    ariaLabel="期限日"
                    status={node.data["status"]}
                    on:change={(event) =>
                      changeTaskField("due date", event.target.value || undefined)}
                  />
                {:else}<span class="detail-value">{node.data["due date"] || "未設定"}</span>{/if}
              </div>
            </label>

            <div class="detail-field detail-field-wide">
              <span class="detail-label" id="lbl-task-tags">タグ</span>
              {#if editingProperties && !isArchived}<TagField
                  tags={taskTags}
                  suggestions={allTags}
                  disabled={isArchived}
                  showLabels={false}
                  ariaLabel="ノードのタグ"
                  on:change={(event) => saveTaskTags(event.detail.tags)}
                />{:else}<div class="detail-control reading">
                  <span class="detail-value">{taskTags.join(" · ") || "未設定"}</span>
                </div>{/if}
            </div>
          </div>
          {#if !isProjectRoot}
            <section class="parent-context" aria-label="所属する場所">
              <h3>所属する場所</h3>
              {#each currentParentIds as parentId}
                <div class="parent-location">
                  <button class="parent-link" on:click={() => visitParent(parentId)}
                    >{nodeNameById[parentId] || parentId}</button
                  >
                  <small class="parent-path" title={parentId}
                    >{nodePathById[parentId] || "Workspace内の所属先"}</small
                  >
                  {#if ($active_row_path || "").split("/").at(-2) === parentId}<span
                      class="parent-chip">現在の表示経路</span
                    >{/if}
                  <IconButton
                    variant="text"
                    normalColor="var(--fg-default)"
                    activeColor="var(--accent-fg)"
                    style="margin:0; width:1.5rem; height:1.5rem;"
                    ariaLabel={(nodeNameById[parentId] || parentId) + "の所属操作"}
                    disabled={isArchived ||
                      currentParentIds.length < 2 ||
                      application.isProtected(node.id)}
                    on:click={() => {
                      relationTarget = parentId;
                      parentEditing = true;
                    }}
                    ><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                      ><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle
                        cx="19"
                        cy="12"
                        r="1.5"
                      /></svg
                    ></IconButton
                  >
                  {#if parentEditing && relationTarget === parentId}
                    <Button
                      variant="text"
                      normalColor="var(--fg-default)"
                      activeColor="var(--accent-fg)"
                      content="この所属を外す"
                      disabled={isArchived || currentParentIds.length < 2}
                      on:click={() => saveParents(currentParentIds.filter((id) => id !== parentId))}
                    />
                  {/if}
                </div>
              {/each}
              {#if parentNotice}<p role="status">{parentNotice}</p>{/if}
              {#if blockedParent}<Button
                  variant="text"
                  normalColor="var(--fg-default)"
                  activeColor="var(--accent-fg)"
                  content="絞り込みを解除して表示"
                  on:click={() => visitParent(blockedParent, true)}
                />{/if}
              <Button
                variant="text"
                normalColor="var(--fg-default)"
                activeColor="var(--accent-fg)"
                content="所属先を追加"
                disabled={isArchived || application.isProtected(node.id)}
                on:click={() => {
                  parentEditing = !parentEditing;
                  relationTarget = "";
                }}
              />
              {#if parentEditing}
                <ParentField
                  parentIds={currentParentIds}
                  candidates={parentCandidates}
                  nameById={nodeNameById}
                  disabled={isArchived || application.isProtected(node.id)}
                  on:change={(event) => saveParents(event.detail.parentIds)}
                />
              {/if}
            </section>
          {/if}
        </div>
      </div>

      <div
        class="attachment-pane"
        role="tabpanel"
        id="detail-panel-attachments"
        aria-labelledby="detail-tab-attachments"
        hidden={activeTab !== "attachments"}
      >
        <TaskAttachments {attachments} readOnly={isArchived} taskId={$table_selected_id ?? null} />
      </div>

      <div
        class="memo-pane"
        role="tabpanel"
        id="detail-panel-body"
        aria-labelledby="detail-tab-body"
        hidden={activeTab !== "body"}
      >
        <div class="body-container">
          <div class="body-toolbar" data-page-search-skip>
            <span class="body-label">{bodyFormat === "markdown" ? "Markdown" : "Quill"}</span>
            {#if bodyFormat !== "markdown"}
              <Button
                variant="text"
                normalColor="var(--fg-default)"
                activeColor="var(--accent-fg)"
                disabled={isArchived}
                on:click={toggleBodyEditing}
                content={editingBody ? "プレビュー" : "編集"}
              />
            {/if}
            <!-- 手動の「今すぐ保存」は置かない。自動保存を謳う UI にフロッピーの
                 保存ボタンが併存すると「押さないと保存されないのでは」という疑いを
                 生む。下書きを失いうる操作（形式変換・削除・ページ遷移など）の前は
                 このコンポーネントが memoEditor.flush() を呼んでいる。 -->
          </div>
          <div class="body-editor">
            {#if bodyVisited}
              {#key `${editContextKey}:${bodyFormat}`}
                <Memo
                  bind:this={memoEditor}
                  freezeTarget={true}
                  draftKey={`${application.workspacePath}:${node.id}`}
                  saveImage={assetSaver(node.id)}
                  resolveAsset={assetResolver(node.id)}
                  saveMemo={bodySaveCallback(node)}
                  content={nodeBody}
                  readOnly={isArchived || (bodyFormat !== "markdown" && !editingBody)}
                  memoTitles={siblingNodeNames}
                  currentMemoTitle={node?.data?.name ?? ""}
                  format={bodyFormat}
                />
              {/key}
            {/if}
          </div>
        </div>
      </div>
    </div>
  </section>
  <Dialog
    show={Boolean(dangerTarget)}
    toggle={() => (dangerTarget = null)}
    header={dangerTarget?.permanent ? "完全削除の確認" : "アーカイブの確認"}
    content={`「${dangerTarget?.name || ""}」を${dangerTarget?.permanent ? "完全削除" : "アーカイブ"}しますか？\n${dangerTarget?.permanent ? "Workspaceの履歴に残っている間は「元に戻す」で復元できます。" : "後でアーカイブ表示から復元できます。"}`}
    ok={dangerTarget?.permanent ? "完全に削除" : "アーカイブする"}
    danger={Boolean(dangerTarget?.permanent)}
    callback={confirmDanger}
  />
  <Dialog
    show={show_format_confirm}
    toggle={toggle_format_confirm}
    header="本文形式の変換"
    content={`Markdown と Quill の変換では、装飾や埋め込みなど一部の情報が損なわれる可能性があります。\n変換後は元に戻す / やり直しで取り消しできます。\n\nこのノードの本文を ${pendingBodyFormat === "markdown" ? "Markdown" : "Quill"} に変換しますか？`}
    ok="変換する"
    callback={callback_format_confirm}
  />
{:else}
  <div class="empty-state" role="status">
    <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h10M4 12h16M4 18h7"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
      <circle cx="18" cy="7" r="3" stroke="currentColor" stroke-width="1.6" />
    </svg>
    <p class="empty-state-title">ノードを選択してください</p>
    <p class="empty-state-hint">左のツリーでノードを選ぶと、ここに詳細とメモを表示します。</p>
  </div>
{/if}

{#if relationAction && node}
  <Modal
    label={relationAction === "copy" ? "ノードをコピー" : "配置を変更"}
    width="22.5rem"
    height="auto"
    toggle={() => {
      if (!relationBusy) relationAction = "";
    }}
  >
    <div class="graph-actions">
      <h2>{relationAction === "copy" ? "ノードをコピー" : "配置を変更"}</h2>
      {#if $relationError}<p role="alert">{$relationError}</p>{/if}
      <p>{name}</p>
      {#if relationAction !== "copy"}
        <p>現在の親: {nodeNameById[($active_row_path || "").split("/").at(-2)] || "なし"}</p>
        <label
          >操作
          <select bind:value={relationAction} disabled={relationBusy}>
            <option value="move">この配置を移動</option>
            <option value="detach">この配置を外す</option>
          </select>
        </label>
      {/if}
      {#if relationAction !== "detach"}
        <label
          >対象の親
          <select aria-label="配置先の親" bind:value={relationTarget} disabled={relationBusy}>
            <option value="">親を選択</option>
            {#each parentCandidates as candidate}<option value={candidate.id}
                >{candidate.name}{candidate.path ? ` — ${candidate.path}` : ""}</option
              >{/each}
          </select>
        </label>
      {:else}
        <p>この親との接続を外します。ノード自体は削除されません。</p>
      {/if}
      {#if relationAction === "copy"}
        <label
          >コピー範囲
          <select aria-label="コピー範囲" bind:value={copyMode} disabled={relationBusy}>
            <option value="node">このノードのみ</option>
            <option value="share-children">直接の子を共有</option>
            <option value="subgraph">子孫もコピー</option>
          </select>
        </label>
      {/if}
      <button disabled={relationBusy} on:click={() => (relationAction = "")}>キャンセル</button>
      <button
        disabled={relationBusy ||
          (relationAction !== "detach" && !relationTarget) ||
          (relationAction !== "copy" && !($active_row_path || "").includes("/"))}
        on:click={submitRelation}
      >
        {relationAction === "copy" ? "コピー" : relationAction === "detach" ? "配置を外す" : "移動"}
      </button>
    </div>
  </Modal>
{/if}

<style>
  :global(.density-compact) .node-detail {
    border-radius: 0;
  }
  .node-detail {
    border-radius: var(--shape-lg);
    box-shadow: var(--elevation-1);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    width: 100%;
    background: var(--canvas-default);
    color: var(--fg-default);
  }
  .detail-header {
    display: flex;
    align-items: flex-start;
    gap: var(--sp3);
    padding: var(--sp2) var(--sp3);
  }
  .detail-header h2 {
    margin: 0;
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--font-title-md);
    font-weight: 600;
  }
  .detail-tabs {
    display: flex;
    gap: var(--sp2);
    padding: 0 var(--sp4);
    border-bottom: 1px solid var(--border-muted);
  }
  .detail-tabs button {
    font: inherit;
    color: var(--fg-muted);
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    padding: var(--sp2);
    cursor: pointer;
  }
  .detail-tabs button[aria-selected="true"] {
    color: var(--fg-default);
    border-bottom-color: var(--accent-fg);
    font-weight: 600;
  }
  .detail-tabs button:hover {
    background: var(--hover-bg);
  }
  .detail-pane,
  .attachment-pane {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .attachment-pane {
    padding: var(--sp4);
  }
  .memo-pane {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  [hidden] {
    display: none !important;
  }
  small {
    color: var(--fg-muted);
    font-size: var(--font-body-sm);
  }
  .parent-context {
    margin-top: var(--sp6);
  }
  /* text ボタンは枠を持たないのに Button primitive の左右 padding (16px) を
     そのまま持つので、行頭が上の所属先の名前より内側にずれて見えていた。
     この節の直下のボタンだけ左端を揃える。 */
  .parent-context > :global(button) {
    padding-left: 0;
    padding-right: var(--sp2);
  }
  h3 {
    font-size: var(--font-title-md);
    font-weight: 600;
  }
  /* 1 行 = 1 つの所属先。以前はリンク・経路・状態・メニューが素の空白だけで
     横一列に並び、どれが押せるのか・どこまでが 1 件なのかが読めなかった。
     名前を先頭に置き、経路はその下、状態はチップ、メニューは右端に固定する。 */
  .parent-location {
    display: grid;
    /* 名前 / 状態チップ / メニュー。チップに列を与えないと暗黙の 3 列目が
       生まれ、メニューが中央に、チップが右端に飛ぶ。 */
    grid-template-columns: auto 1fr auto;
    align-items: center;
    column-gap: var(--sp2);
    row-gap: 2px;
    padding: var(--sp2) 0;
    border-bottom: 1px solid color-mix(in srgb, var(--fg-muted) 18%, transparent);
  }
  .parent-location:last-of-type {
    border-bottom: 0;
  }
  /* 名前は 1 行目の左、チップはその隣、メニューは 1 行目の右端、
     経路は 2 行目に回す。 */
  .parent-location :global(.parent-link),
  .parent-location .parent-chip {
    grid-column: 2;
    grid-row: 1;
  }
  .parent-location .parent-path {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .parent-location :global(.IconButton) {
    grid-column: 3;
    grid-row: 1;
  }
  /* 状態を表す印。ラベルと同じ見た目だと名前の一部に見えるので背景を敷く。 */
  .parent-chip {
    justify-self: start;
    font-size: var(--font-label-sm);
    line-height: 1.6;
    padding: 0 var(--sp1);
    border-radius: var(--shape-xs);
    background: color-mix(in srgb, var(--accent-fg) 16%, transparent);
    color: var(--fg-default);
    white-space: nowrap;
  }
  .parent-link {
    color: var(--accent-fg);
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: color-mix(in srgb, var(--accent-fg) 45%, transparent);
    border: 0;
    background: transparent;
    /* 実測 57x16。上下に余白を足して 24px の当たり判定を確保する。 */
    display: inline-flex;
    align-items: center;
    min-height: var(--tap-min);
    padding: 0;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .parent-link:hover {
    text-decoration: underline;
  }
  .parent-location small {
    overflow-wrap: anywhere;
  }

  .graph-actions {
    margin-top: var(--sp2);
  }
  .graph-actions p {
    margin: var(--sp1) 0;
  }
  .graph-actions label {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    margin: var(--sp1) 0;
  }
  .graph-actions select {
    min-width: 0;
    max-width: 100%;
    flex: 1;
  }
  .graph-actions select,
  .graph-actions button {
    background: var(--theme-color-Main-light);
    color: var(--theme-color-Sub-light);
    border: 1px solid var(--theme-color-Sub-dark);
    border-radius: var(--shape-xs);
    padding: var(--sp1);
  }
  .graph-actions button {
    margin: var(--sp1) var(--sp1) var(--sp1) 0;
    cursor: pointer;
  }
  .graph-actions button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  /* 空状態にも .node-detail と同じ面を与える。以前はここだけ背景が透明で、
     親の canvas がそのまま見えていたため、左のツリーが白い Card なのに
     右半分だけ「抜けた穴」に見えていた。 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp2);
    width: 100%;
    height: 100%;
    padding: var(--sp6);
    box-sizing: border-box;
    border-radius: var(--shape-lg);
    box-shadow: var(--elevation-1);
    background: var(--canvas-default);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    text-align: center;
  }
  .empty-state-hint {
    max-width: 24rem;
  }
  .empty-state-icon {
    width: 1.6875rem;
    height: 1.6875rem;
    color: color-mix(in srgb, var(--theme-color-Primary-main) 75%, transparent);
  }
  .empty-state-title {
    margin: 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-title-md);
    font-weight: 600;
  }
  .empty-state-hint {
    margin: 0;
    max-width: 16.5rem;
    font-size: var(--font-body-sm);
    line-height: 1.5;
  }
  .task-detail-card-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .multi-select-indicator {
    padding: var(--sp1) var(--sp3);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 14%, transparent);
    color: var(--theme-color-Primary-dark);
    font-size: var(--font-label-md);
    font-weight: 600;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 30%, transparent);
  }
  .task-detail-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--sp2);
    flex: 0 0 auto;
  }
  /* Vertical split: the fixed fields block on top (natural height), then
     the attachments field taking whatever height remains. overflow: auto is
     only the fallback for panes too short to fit even the fixed fields. */
  .detail-container {
    display: flex;
    flex-direction: column;
    gap: var(--sp1);
    flex: 1;
    width: 100%;
    min-height: 0;
    box-sizing: border-box;
    padding: var(--sp4);
    overflow: auto;
    container-type: inline-size;
  }
  /* アーカイブ済みの告知帯。スタイルが当たっておらず、寸法指定の無い
     インライン SVG が幅いっぱい（viewBox 比で高さも）に伸びて、詳細欄の
     大半を箱の絵が占めていた。 */
  .archived-banner {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    box-sizing: border-box;
    margin-bottom: var(--sp3);
    padding: var(--sp2) var(--sp3);
    border-radius: var(--shape-sm);
    background-color: color-mix(in srgb, var(--fg-muted) 10%, transparent);
    color: var(--fg-muted);
    font-size: var(--font-body-sm);
    line-height: 1.5;
  }
  .archived-banner svg {
    flex: 0 0 0.8625rem;
    width: 0.8625rem;
    height: 0.8625rem;
  }
  .detail-fields {
    display: grid;
    grid-template-columns: 1fr;
    align-content: start;
    gap: var(--sp2);
    flex: 0 0 auto;
    min-width: 0;
    /* タグ欄は枠を TagField 自身が描くので、他項目の .detail-control と
       同じ高さになるよう寸法を渡す。渡さないと 1.3125rem の既定値のままで、
       1 行だけ背の低い入力欄が混ざる。 */
    --detail-control-height: var(--tree-row-height);
  }
  .detail-field {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    align-items: start;
    gap: var(--sp2);
    min-width: 0;
    color: var(--theme-color-Sub-main);
  }
  /* タグは値が可変長なので、2 カラムのフィールドグリッドを跨いで
     1 行まるごと使う。 */
  .detail-field-wide {
    grid-column: 1 / -1;
  }
  /* 中身は短い語が 1〜2 個。他項目と同じだけ横に伸ばすと、空のときに
     幅いっぱいの空箱が出るので上限を切って左に寄せる。 */
  .detail-field-wide :global(.tag-field) {
    max-width: 16.5rem;
  }
  /* 枠の見え方も .detail-control に合わせる（角丸だけ別値だった）。 */
  .detail-field-wide :global(.tag-chips) {
    border-radius: var(--shape-sm);
  }
  .detail-value {
    padding: 0 var(--sp2);
    overflow-wrap: anywhere;
  }
  .detail-control.reading {
    border-color: transparent;
    background: transparent;
    height: auto;
    min-height: var(--tree-row-height);
  }
  .detail-label {
    display: flex;
    align-items: center;
    min-height: var(--tree-row-height);
    flex: 0 0 auto;
    min-width: 0;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    font-weight: 500;
    letter-spacing: 0.01em;
    line-height: 1.3;
    user-select: none;
  }
  .detail-input {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: 0;
    padding: 0 var(--sp2);
    color: var(--theme-color-Sub-main);
    background-color: transparent;
    font-size: var(--font-body-md);
  }
  .detail-input:focus {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: 2px;
  }
  .detail-control {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: var(--tree-row-height);
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    border-radius: var(--shape-sm);
    background-color: var(--theme-color-Main-light);
    overflow: hidden;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
    --backgroundColor: var(--theme-color-Main-light);
  }
  .detail-control:focus-within {
    border-color: var(--theme-color-Primary-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
  }
  .detail-control :global(.StatusContainer) {
    gap: var(--sp1);
    padding: 0 var(--sp1);
    box-sizing: border-box;
  }
  .detail-control :global(.StatusContainer svg) {
    flex: 0 0 0.825rem;
    width: 0.825rem;
  }
  .detail-control :global(.select select) {
    font-size: 0.75rem;
  }
  .detail-control :global(.Date) {
    font-size: 0.75rem;
  }
  .body-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    margin: 0;
    padding: var(--memotab-pad);
    overflow: hidden;
  }
  /* 見出しと形式切替の帯。タブが無くなったので、本文がどこから始まるかを
     示すのはこの 1 行だけになる。 */
  .body-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp2);
    flex: 0 0 auto;
    padding: var(--sp1);
  }
  .body-label {
    font-size: var(--font-label-sm);
    font-weight: 600;
    color: color-mix(in srgb, var(--theme-color-Sub-main) 75%, transparent);
  }

  .body-editor {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .body-editor > :global(.container) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  @container (max-width: 21rem) {
    .detail-fields {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 760px) {
    .detail-fields {
      grid-template-columns: 1fr;
    }
  }
</style>
