<script>
  import { getContext } from "svelte";
  import { TREEGRID_APPLICATION } from "@features/workspace/application/treegrid";
  const application = getContext(TREEGRID_APPLICATION);
  const relationError = application?.error ?? writable("");
  import { active_row_path } from "@stores/ui";
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
  const tree_data = application?.tree ?? legacy_tree_data;
  const workspace_tasks_cache = application?.records ?? legacy_workspace_tasks_cache;

  import {
    getNode,
    isChild,
    isNodeEffectivelyArchived,
    updateNodeDataById,
  } from "@features/tasks/utils/tree_control";
  import { uuidV4 } from "@lib/utils/uuid";
  import {
    tree_data as legacy_tree_data,
    table_selected_id,
    cancelPendingOperations,
    selected_type,
    selected_id,
    workspace_store,
    workspace_tasks_cache as legacy_workspace_tasks_cache,
    tag_index,
    theme,
  } from "@stores";
  import { selected_ids } from "@stores/ui";
  import debounce from "lodash/debounce";
  import { onDestroy } from "svelte";
  import { get, writable } from "svelte/store";
  import Memo from "@features/memos/components/Memo.svelte";

  import IconButton from "@lib/primitives/IconButton.svelte";
  import Button from "@lib/primitives/Button.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import Modal from "@lib/primitives/Modal.svelte";
  import TaskMenu from "./TaskMenu.svelte";
  import { tick } from "svelte";

  import StatusSelect from "@features/tasks/components/StatusSelect.svelte";
  import TaskAttachments from "@features/tasks/components/TaskAttachments.svelte";
  import DateInput from "@lib/primitives/DateInput.svelte";
  import TagField from "@lib/primitives/TagField.svelte";
  import ParentField from "@features/tasks/components/ParentField.svelte";
  import { normalizeTagList } from "@lib/utils/tags";
  import * as platform from "@lib/ipc/platform";
  import { parentIdsOf } from "@lib/utils/parent_links";
  import {
    projectDataToWorkspaceTasks,
    workspaceToProjectData,
  } from "@features/workspace/utils/workspace_tree";
  import {
    convertMemoContent,
    isEmptyMemoContent,
    isQuillDelta,
    normalizeMemoFormat,
  } from "@features/memos/utils/memo_utils";

  export let titleOverride = "";
  export let showOpenWindowAction = true;

  $: extraSelectedCount = Math.max(0, $selected_ids.size - 1);
  $: is_selected = $table_selected_id ? true : false;
  $: node =
    $table_selected_id && $tree_data ? getNode($table_selected_id, $tree_data.data) : undefined;
  $: name = node ? node.data["name"] : "Select Task";
  $: cardTitle = titleOverride || name;
  $: nodeBody = node ? (node.data["body"] ?? "") : "";
  $: bodyFormat = normalizeMemoFormat(node?.data?.["format"], defaultMemoFormat);
  // `[[…]]` の補完候補。統一後は「同じタスクのメモ」ではなく、自分の子ノードが
  // それにあたる（旧メモは子ノードになる）。
  $: siblingNodeNames = (node?.children ?? [])
    .map((child) => child?.data?.name)
    .filter((childName) => Boolean(childName) && childName !== node?.data?.name);
  $: attachments = node ? (node.data["attachments"] ?? []) : [];
  $: projectTree = $tree_data?.data ?? null;
  $: isArchived = isNodeEffectivelyArchived($table_selected_id, $tree_data?.data);
  $: isWorkspaceProject = $selected_type === "WorkspaceProject";
  $: workspaceProjectDir = isWorkspaceProject ? $workspace_store.activeProjectDir : null;
  $: defaultMemoFormat = isWorkspaceProject ? "markdown" : "quill";

  $: isDark = $theme === "dark";
  const detailDateStyle =
    "border: 0; padding: 0 var(--sp7) 0 var(--sp2); font-size: 1rem; background-color: transparent;";
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
    ...(application && node
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
      ? [{ title: "形式を変換", action: "format", disabled: isArchived || bodyLoading }]
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

  const getEditContext = () => ({
    selectedType: $selected_type,
    selectedId: $selected_id,
    tableSelectedId: $table_selected_id,
    activeProjectDir: $workspace_store.activeProjectDir,
  });

  const contextMatches = (context) =>
    context &&
    context.selectedType === $selected_type &&
    context.selectedId === $selected_id &&
    context.tableSelectedId === $table_selected_id &&
    context.activeProjectDir === $workspace_store.activeProjectDir;

  let bodyHydrationKey = "";
  let bodyLoading = false;

  /**
   * 開いたノードの本文だけを読みに行く。
   *
   * プロジェクト読み出しは一覧目的なので本文を読まない（`bodyLoaded: false`）。
   * 統一でノード数が大きく増えるため、ここを一括読みに戻すと開くたびに全文を
   * 読むことになる。
   */
  async function hydrateWorkspaceNodeBody(taskId, editContext = getEditContext()) {
    if (!editContext.activeProjectDir || !taskId) return;
    const key = `${editContext.activeProjectDir}:${taskId}`;
    if (bodyHydrationKey === key) return;

    bodyHydrationKey = key;
    bodyLoading = true;
    try {
      const result = await platform.wsReadTaskBody(editContext.activeProjectDir, taskId);
      if (!contextMatches(editContext) || !result || result.error) return;

      const liveTreeData = get(tree_data);
      if (!liveTreeData?.data) return;
      if (!getNode(taskId, liveTreeData.data)) return;

      const loaded = { body: result.body, format: result.format, bodyLoaded: true };
      const data = updateNodeDataById(liveTreeData.data, taskId, loaded);
      if (data !== liveTreeData.data) {
        tree_data.setFromSource({ ...liveTreeData, data });
      }
      workspace_tasks_cache.update((cache) => {
        const cachedTask = cache[taskId];
        if (!cachedTask) return cache;
        return { ...cache, [taskId]: { ...cachedTask, ...loaded } };
      });
    } finally {
      if (contextMatches(editContext)) {
        bodyLoading = false;
      }
      if (bodyHydrationKey === key) {
        bodyHydrationKey = "";
      }
    }
  }

  $: if (isWorkspaceProject && workspaceProjectDir && node?.id && node.data?.bodyLoaded === false) {
    hydrateWorkspaceNodeBody(node.id);
  }

  const changeData = (node, key, value, editContext = getEditContext()) => {
    if (application) {
      if (node && contextMatches(editContext)) return application.update(node.id, { [key]: value });
      return;
    }
    if (!contextMatches(editContext)) {
      return;
    }
    if (!node) {
      return;
    }
    const liveTreeData = get(tree_data);
    if (!liveTreeData?.data) {
      return;
    }
    const data = updateNodeDataById(liveTreeData.data, node.id, { [key]: value });
    if (data !== liveTreeData.data) {
      tree_data.set({ ...liveTreeData, data });
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

  $: editContextKey = [
    $selected_type ?? "",
    $selected_id ?? "",
    $table_selected_id ?? "",
    $workspace_store.activeProjectDir ?? "",
  ].join(":");

  $: if (editContextKey !== previousEditContextKey) {
    changeDataDebounce.cancel();
    previousEditContextKey = editContextKey;
    editingProperties = false;
    editingBody = false;
    parentEditing = false;
    parentNotice = "";
    blockedParent = "";
  }

  const unsubscribeCancelPending = cancelPendingOperations.subscribe(() => {
    changeDataDebounce.cancel();
  });

  onDestroy(() => {
    changeDataDebounce.cancel();
    unsubscribeCancelPending();
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
  const bodySaveCallback = (target, editContext) => (editedContent) => {
    if (!target) return false;
    const currentTarget = application
      ? get(application.records)[target.id]
      : getNode(target.id, get(tree_data)?.data)?.data;
    const targetFormat = normalizeMemoFormat(
      currentTarget?.format ?? target.data.format,
      defaultMemoFormat
    );
    const sourceFormat = isQuillDelta(editedContent) ? "quill" : "markdown";
    const body = convertMemoContent(editedContent, sourceFormat, targetFormat);
    if (application) return application.update(target.id, { body }).then(Boolean);
    if (
      editContext.selectedType !== $selected_type ||
      editContext.selectedId !== $selected_id ||
      editContext.activeProjectDir !== $workspace_store.activeProjectDir
    )
      return false;
    const current = get(tree_data);
    if (!current?.data) return false;
    tree_data.set({ ...current, data: updateNodeDataById(current.data, target.id, { body }) });
    return true;
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
    if (application) {
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
    }
    const editContext = getEditContext();
    const liveNode = getLiveNode(editContext);
    if (!liveNode) return false;
    const currentFormat = normalizeMemoFormat(liveNode.data.format, defaultMemoFormat);
    if (currentFormat === nextFormat) return false;
    changeData(
      liveNode,
      "body",
      convertMemoContent(liveNode.data.body, currentFormat, nextFormat),
      editContext
    );
    changeData(liveNode, "format", nextFormat, editContext);
    return true;
  };

  const saveAttachments = (nextAttachments) => {
    const editContext = getEditContext();
    const liveNode = getLiveNode(editContext);
    if (!liveNode) return false;
    changeData(liveNode, "attachments", nextAttachments, editContext);
    return true;
  };
  /**
   * 親の付け外し。
   *
   * Graphではfacadeからlink/detachをdispatchする。互換モデルを保存し直さない。
   * 従来プロジェクトの経路だけは既存キャッシュとツリーの変換を使う。
   */
  $: isProjectRoot = Boolean(
    node &&
    (application
      ? !$workspace_tasks_cache[node.id]?.parents.length
      : node.id === $tree_data?.data?.id)
  );
  $: currentParentIds = parentIdsOf($workspace_tasks_cache[node?.id]?.parents);

  /** 追加する親の下での並び順。その親の既存の子の末尾に置く。 */
  function nextOrderUnder(tasks, parentId) {
    let max = -1;
    for (const task of Object.values(tasks ?? {})) {
      for (const link of task.parents ?? []) {
        if (link.id === parentId && typeof link.order === "number") {
          max = Math.max(max, link.order);
        }
      }
    }
    return max + 1;
  }

  /** id → 名前。チップと候補の表示に使う。 */
  $: nodeNameById = Object.fromEntries(
    Object.values($workspace_tasks_cache ?? {}).map((task) => [task.id, task.name])
  );

  /**
   * 親の候補。Graphでは自分自身だけを除外し、子孫へのlinkも許可する。
   * 既に親になっているものは ParentField 側で外れる。
   */
  $: parentCandidates =
    node && $tree_data?.data
      ? Object.values($workspace_tasks_cache ?? {})
          .filter((task) => task.id !== node.id)
          .filter((task) => application || !isChild(task.id, node.id, $tree_data.data))
          .map((task) => ({
            id: task.id,
            name: task.name,
            path: nodePathById[task.id] ?? "",
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
    if (application) return application.parents(node.id, nextParentIds);
    if (!node || !isWorkspaceProject || !workspaceProjectDir) return;
    const normalized = (Array.isArray(nextParentIds) ? nextParentIds : []).filter(
      (id) => typeof id === "string" && id
    );
    // 孤児は作らない。空になる操作は受け付けない。
    if (normalized.length === 0) return;

    const cached = $workspace_tasks_cache[node.id];
    if (!cached) return;

    // 並び順は辺の属性。残る親の順序はそのまま、増えた親は末尾に置く。
    const existingLinks = new Map((cached.parents ?? []).map((link) => [link.id, link]));
    const nextParents = normalized.map(
      (id) => existingLinks.get(id) ?? { id, order: nextOrderUnder($workspace_tasks_cache, id) }
    );
    const nextTask = { ...cached, parents: nextParents };
    const nextTasks = { ...$workspace_tasks_cache, [node.id]: nextTask };
    workspace_tasks_cache.set(nextTasks);

    const rootId = $tree_data?.data?.id;
    if (!rootId) return;
    tree_data.set(workspaceToProjectData(nextTasks, rootId));
  }

  const changeTaskField = (key, value, debounceChange = false) => {
    if (!node) {
      return;
    }

    const editContext = getEditContext();
    if (!application) node.data[key] = value;
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
    if (application && node) {
      application.openDetail(node.id, name);
      return;
    }
    if (!node || !$selected_id || !$table_selected_id) return;

    if (isWorkspaceProject && workspaceProjectDir && $tree_data?.data) {
      const tasks = projectDataToWorkspaceTasks($tree_data, $workspace_tasks_cache);
      platform.wsBroadcastProjectSnapshot(
        workspaceProjectDir,
        Object.fromEntries(tasks.map((task) => [task.id, task]))
      );
      tree_data.flushPendingPersist();
    }

    platform.openTaskDetailWindow({
      projectId: $selected_id,
      taskId: node.id,
      taskName: name,
      selectedType: isWorkspaceProject ? "WorkspaceProject" : "Projects",
      projectDir: isWorkspaceProject ? ($workspace_store.activeProjectDir ?? undefined) : undefined,
    });
  }
</script>

{#if is_selected && node}
  <section class="node-detail" aria-label="Node詳細">
    <header class="detail-header">
      <h2>{cardTitle}</h2>
      <div class="task-detail-actions">
        <IconButton
          variant="text"
          normalColor="var(--fg-default)"
          activeColor="var(--accent-fg)"
          ariaLabel={editingProperties ? "編集終了" : "編集"}
          tooltipContent={editingProperties ? "編集終了" : "編集"}
          style="margin:0; width:2.25rem; height:2.25rem;"
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
          ariaLabel="Node詳細の操作"
          aria-haspopup="menu"
          aria-expanded={detailMenu}
          data-task-menu-trigger
          style="margin:0; width:2.25rem; height:2.25rem;"
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
    <div class="detail-tabs" role="tablist" aria-label="Nodeの内容">
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
            <span>このタスクはアーカイブ済みです。編集するには復元してください。</span>
          </div>
        {/if}
        <div class="detail-container">
          <div class="detail-fields">
            <label class="detail-field">
              <span class="detail-label">タスク名</span>
              <div class="detail-control" class:reading={!editingProperties || isArchived}>
                {#if editingProperties && !isArchived}
                  <input
                    class="detail-input"
                    type="text"
                    value={name}
                    aria-label="タスク名"
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
                  ariaLabel="タスクのタグ"
                  on:change={(event) => saveTaskTags(event.detail.tags)}
                />{:else}<div class="detail-control reading">
                  <span class="detail-value">{taskTags.join(" · ") || "未設定"}</span>
                </div>{/if}
            </div>
          </div>
          {#if isWorkspaceProject && !isProjectRoot}
            <section class="parent-context" aria-label="所属する場所">
              <h3>所属する場所</h3>
              {#each currentParentIds as parentId}
                <div class="parent-location">
                  {#if application}<button
                      class="parent-link"
                      on:click={() => visitParent(parentId)}
                      >{nodeNameById[parentId] || parentId}</button
                    >
                  {:else}<span>{nodeNameById[parentId] || parentId}</span>{/if}
                  <small title={parentId}>{nodePathById[parentId] || "Workspace内の所属先"}</small>
                  {#if ($active_row_path || "").split("/").at(-2) === parentId}<small
                      >現在の表示経路</small
                    >{/if}
                  <IconButton
                    variant="text"
                    normalColor="var(--fg-default)"
                    activeColor="var(--accent-fg)"
                    style="margin:0; width:2rem; height:2rem;"
                    ariaLabel={(nodeNameById[parentId] || parentId) + "の所属操作"}
                    disabled={isArchived ||
                      currentParentIds.length < 2 ||
                      application?.isProtected(node.id)}
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
                disabled={isArchived || application?.isProtected(node.id)}
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
                  disabled={isArchived || application?.isProtected(node.id)}
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
        <TaskAttachments
          {attachments}
          readOnly={isArchived}
          {isWorkspaceProject}
          {workspaceProjectDir}
          taskId={$table_selected_id ?? null}
          onAttachmentsChange={saveAttachments}
        />
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
                disabled={isArchived || bodyLoading}
                on:click={toggleBodyEditing}
                content={editingBody ? "プレビュー" : "編集"}
              />
            {/if}
            <IconButton
              variant="text"
              normalColor="var(--fg-default)"
              activeColor="var(--accent-fg)"
              ariaLabel="今すぐ保存"
              tooltipContent="今すぐ保存"
              disabled={isArchived || bodyLoading}
              style="margin:0; width:2rem; height:2rem;"
              on:click={() => memoEditor?.flush()}
              ><svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2Z M7 3v6h10V3M7 21v-8h10v8" /></svg
              ></IconButton
            >
          </div>
          <div class="body-editor">
            {#if bodyVisited}
              {#key `${editContextKey}:${bodyFormat}`}
                <Memo
                  bind:this={memoEditor}
                  freezeTarget={true}
                  draftKey={`${$workspace_store.activeWorkspacePath || workspaceProjectDir || $selected_id}:${node.id}`}
                  saveImage={application ? assetSaver(node.id) : undefined}
                  resolveAsset={application ? assetResolver(node.id) : undefined}
                  saveMemo={bodySaveCallback(node, getEditContext())}
                  content={nodeBody}
                  readOnly={isArchived ||
                    bodyLoading ||
                    (bodyFormat !== "markdown" && !editingBody)}
                  memoTitles={siblingNodeNames}
                  currentMemoTitle={node?.data?.name ?? ""}
                  {isWorkspaceProject}
                  format={bodyFormat}
                  {workspaceProjectDir}
                  taskId={$table_selected_id ?? null}
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
    callback={confirmDanger}
  />
  <Dialog
    show={show_format_confirm}
    toggle={toggle_format_confirm}
    header="本文形式の変換"
    content={`Markdown と Quill の変換では、装飾や埋め込みなど一部の情報が損なわれる可能性があります。\n変換後は元に戻す / やり直しで取り消しできます。\n\nこのノードの本文を ${pendingBodyFormat === "markdown" ? "Markdown" : "Quill"} に変換しますか？`}
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
    <p class="empty-state-title">タスクを選択してください</p>
    <p class="empty-state-hint">左のツリーでタスクを選ぶと、ここに詳細とメモを表示します。</p>
  </div>
{/if}

{#if relationAction && node}
  <Modal
    label={relationAction === "copy" ? "ノードをコピー" : "配置を変更"}
    width="30rem"
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
  h3 {
    font-size: var(--font-title-md);
    font-weight: 600;
  }
  .parent-location {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp2);
    padding: var(--sp2) 0;
  }
  .parent-link {
    color: var(--accent-fg);
    border: 0;
    background: transparent;
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
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp2);
    width: 100%;
    height: 100%;
    padding: var(--sp6);
    color: color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent);
    text-align: center;
  }
  .empty-state-icon {
    width: 2.25rem;
    height: 2.25rem;
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
    max-width: 22rem;
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
  .detail-fields {
    display: grid;
    grid-template-columns: 1fr;
    align-content: start;
    gap: var(--sp2);
    flex: 0 0 auto;
    min-width: 0;
  }
  .detail-field {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr);
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
    flex: 0 0 1.1rem;
    width: 1.1rem;
  }
  .detail-control :global(.select select) {
    font-size: 1rem;
  }
  .detail-control :global(.Date) {
    font-size: 1rem;
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
  @container (max-width: 28rem) {
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
