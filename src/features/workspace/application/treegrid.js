import { derived, get, writable } from "svelte/store";
import {
  workspace_graph_store,
  workspace_graph,
  can_undo_graph,
  can_redo_graph,
} from "../stores/graph";
import { createExpansionState } from "./expansion";
import { projectTreeGrid, nodeChanges } from "./tree_projection";
import { filter } from "@features/search/stores/search";
import { sort_state } from "@features/tasks/stores/sort";
import { active_tag } from "@features/memos/stores/tags";
import { filterTree, sortTree, stripArchivedNodes } from "@features/tasks/utils/tree_control";
import {
  selected_ids,
  table_selected_id,
  active_row_path,
  show_archived,
  selectOnly,
  pending_rename_id,
} from "@stores/ui";
import * as platform from "@lib/ipc/platform";
import { tick } from "svelte";
import { selected_id } from "@stores/ui";
import { navigation_history } from "@stores/navigation_history";
import { showNotice } from "@stores/notice";

export const TREEGRID_APPLICATION = "task-manage:treegrid-application";

function filterProject(project, filters, archived, tag) {
  if (!project) return undefined;
  let node = archived ? project.data : stripArchivedNodes(project.data);
  if (tag && node) {
    const prune = (item) => {
      const children = item.children.map(prune).filter(Boolean);
      return children.length ||
        item.data.tags.some((value) => value.toLowerCase() === tag.toLowerCase())
        ? { ...item, children }
        : null;
    };
    node = prune(node);
  }
  return node ? filterTree(node, filters) : null;
}

/**
 * 作った直後で、まだ何も変わっていないノード。名前の入力を Esc で取り消したら
 * 作成ごと取り消す（以前は「新しいノード」「新しいプロジェクト」という空の
 * ノードが残った）。行の追加とサイドバーのプロジェクト追加が書き、名前欄が読む。
 * どのツリー画面からでも取り消せるよう、画面ごとではなくここに 1 つだけ置く。
 *
 * @type {{ id: string, revision?: number, fromId?: string, fromPath?: string, onCancel?: () => void } | null}
 */
let justCreated = null;

/** 作ったノードを「作った直後」として覚える。 */
export function markJustCreated(record) {
  justCreated = record;
}

export function createTreeGridApplication(workspacePath) {
  const scope = writable("");
  const error = writable("");
  const tree = derived([workspace_graph, scope], ([graph, root]) =>
    projectTreeGrid(graph, root || graph?.rootId)
  );
  const closed_row_paths = createExpansionState(tree, scope, workspacePath);
  const filtered = derived(
    [tree, filter, sort_state, show_archived, active_tag],
    ([project, filters, sort, archived, tag]) => {
      const node = filterProject(project, filters, archived, tag);
      return node ? sortTree(node, sort) : node;
    }
  );
  const records = derived(workspace_graph, (graph) => graph?.nodes || {});
  const graphNow = () => get(workspace_graph);
  const occurrenceOf = (id) => {
    const root = get(tree)?.data;
    if (!root) return undefined;
    const pending = [{ node: root, path: root.id }];
    while (pending.length) {
      const { node, path } = pending.pop();
      if (node.id === id && !node.cycleReference) return path;
      for (const child of [...node.children].reverse())
        pending.push({ node: child, path: `${path}/${child.id}` });
    }
  };
  function revealOccurrence(path) {
    if (!path) return;
    const parts = path.split("/");
    for (let end = 1; end < parts.length; end++)
      closed_row_paths.delete(parts.slice(0, end).join("/"));
    active_row_path.set(path);
  }
  function hasOccurrence(path) {
    const [rootId, ...parts] = path.split("/");
    let node = get(tree)?.data;
    if (node?.id !== rootId) return false;
    for (const id of parts) node = node?.children.find((child) => child.id === id);
    return Boolean(node);
  }
  async function dispatchMove(commands, nodeId, parentPath) {
    const currentScope = get(scope);
    const result = await dispatch(commands);
    if (result && parentPath && get(scope) === currentScope && get(table_selected_id) === nodeId) {
      const requested = `${parentPath}/${nodeId}`;
      const destination = hasOccurrence(requested)
        ? requested
        : `${occurrenceOf(parentPath.split("/").at(-1))}/${nodeId}`;
      if (hasOccurrence(destination)) revealOccurrence(destination);
    }
    return result;
  }
  const ids = () =>
    [...new Set(get(selected_ids).size ? get(selected_ids) : [get(table_selected_id)])].filter(
      Boolean
    );
  const context = (id = get(table_selected_id), path = get(active_row_path)) => {
    const parts = (path || "").split("/");
    if (parts.at(-1) !== id) throw new Error("操作する行を選択してください。");
    return { id, parentId: parts.at(-2), path };
  };
  const siblings = (parentId) =>
    Object.values(graphNow()?.nodes || {})
      .filter((n) => n.parents.some((p) => p.id === parentId))
      .sort(
        (a, b) =>
          a.parents.find((p) => p.id === parentId).order -
            b.parents.find((p) => p.id === parentId).order ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id)
      );
  async function dispatch(commands) {
    error.set("");
    try {
      const list = Array.isArray(commands) ? commands : [commands];
      if (!list.length) return;
      return await workspace_graph_store.execute(
        list.length === 1 ? list[0] : { type: "batch", commands: list },
        "tree",
        workspacePath
      );
    } catch (e) {
      error.set(e.message);
      return undefined;
    }
  }
  /**
   * 操作の結果を知らせ、「元に戻す」を添える（アーカイブ・添付を外すなど、
   * 確認ダイアログで止めない操作）。通知の「元に戻す」は、その後に別の変更が
   * 入っていたら、無関係な段を戻さないよう何もしない。
   */
  function notifyUndoable(result, message) {
    if (!result) return;
    const revision = result.graph?.revision;
    showNotice(message, {
      actionLabel: "元に戻す",
      timeout: 8000,
      action: () => {
        if (graphNow()?.revision !== revision) {
          showNotice(
            "このあとに別の変更があるため、ここからは戻せません。「元に戻す」ボタンを使ってください。"
          );
          return;
        }
        workspace_graph_store.undo().catch((e) => error.set(e.message));
      },
    });
  }
  const update = (id, patch) =>
    dispatch({ type: "update-node", nodeId: id, changes: nodeChanges(patch) });
  const updateMany = (patch, targets = ids()) =>
    dispatch(
      targets.map((id) => ({ type: "update-node", nodeId: id, changes: nodeChanges(patch) }))
    );
  const isFreshNode = (nodeId) =>
    justCreated?.id === nodeId && graphNow()?.revision === justCreated.revision;
  async function cancelCreation(nodeId) {
    const created = justCreated;
    justCreated = null;
    if (!created || created.id !== nodeId || graphNow()?.revision !== created.revision)
      return false;
    try {
      await workspace_graph_store.undo({ quiet: true });
    } catch (e) {
      error.set(e.message);
      return false;
    }
    // 追加を始めた場所へ戻る（行の追加なら元の行、プロジェクトなら元の画面）。
    if (created.onCancel) {
      created.onCancel();
      return true;
    }
    if (created.fromId) selectOnly(created.fromId);
    if (created.fromPath && hasOccurrence(created.fromPath)) revealOccurrence(created.fromPath);
    return true;
  }
  async function add(id = get(table_selected_id), action = "append", path = get(active_row_path)) {
    id ||= get(scope) || graphNow().rootId;
    const parentId =
      action === "append" || id === get(tree)?.data.id ? id : context(id, path).parentId;
    const list = siblings(parentId);
    const index = list.findIndex((n) => n.id === id);
    const order =
      action === "append" || index < 0
        ? undefined
        : (list[index].parents.find((p) => p.id === parentId).order +
            (list[index + 1]?.parents.find((p) => p.id === parentId).order ??
              list[index].parents.find((p) => p.id === parentId).order + 2)) /
          2;
    const result = await dispatch({
      type: "create-node",
      parentId,
      node: { name: "新しいノード" },
      order,
    });
    if (result?.selectedNodeIds[0]) {
      justCreated = {
        id: result.selectedNodeIds[0],
        revision: result.graph?.revision,
        fromId: id,
        fromPath: path,
      };
      closed_row_paths.expandNodeEverywhere(parentId);
      selectOnly(result.selectedNodeIds[0]);
      // 作った行をそのまま名前入力にする。既定名「新しいノード」のまま
      // 放置されて同名の行が並ぶのを防ぐ。
      pending_rename_id.set(result.selectedNodeIds[0]);
      const parentPath = parentId === id ? path : path?.split("/").slice(0, -1).join("/");
      const visibleParent = parentPath || occurrenceOf(parentId);
      if (visibleParent) revealOccurrence(`${visibleParent}/${result.selectedNodeIds[0]}`);
    }
  }
  async function move(direction, targets = ids(), path = get(active_row_path)) {
    const anchor = context(path?.split("/").at(-1), path);
    if (!anchor.parentId) return;
    const list = siblings(anchor.parentId);
    if (!targets.every((id) => list.some((n) => n.id === id))) {
      error.set("同じ親の行を選択してください。");
      return;
    }
    const chosen = list.filter((n) => targets.includes(n.id));
    let parentId = anchor.parentId;
    let ordered;
    if (direction === "indent") {
      const first = list.findIndex((n) => n.id === chosen[0].id);
      parentId = list[first - 1]?.id;
    } else if (direction === "outdent") parentId = path.split("/").at(-3);
    else {
      ordered = [...list];
      const indexes = chosen.map((n) => list.indexOf(n));
      if (indexes.at(-1) - indexes[0] + 1 !== indexes.length) return;
      const start = indexes[0],
        delta = direction === "up" ? -1 : 1;
      if (start + delta < 0 || indexes.at(-1) + delta >= list.length) return;
      ordered.splice(start, chosen.length);
      ordered.splice(start + delta, 0, ...chosen);
    }
    if (!parentId) return;
    if (direction === "outdent") {
      // もとの親のすぐ後ろに出す（末尾に回すと、親から離れた位置に飛んで
      // どこへ行ったか分からなくなる）。祖父母の子を並べ直し、出す行には
      // 親の付け替えと並び順を同時に指定する。
      const grandChildren = siblings(parentId).filter((n) => !targets.includes(n.id));
      const at = grandChildren.findIndex((n) => n.id === anchor.parentId) + 1;
      const next = [...grandChildren];
      next.splice(at > 0 ? at : next.length, 0, ...chosen);
      const outdentCommands = next.map((n, order) => ({
        type: "move",
        childId: n.id,
        fromParentId: chosen.includes(n) ? anchor.parentId : parentId,
        toParentId: parentId,
        order,
      }));
      await dispatchMove(outdentCommands, anchor.id, path.split("/").slice(0, -2).join("/"));
      closed_row_paths.expandNodeEverywhere(parentId);
      return;
    }
    const commands = ordered
      ? ordered.map((n, order) => ({
          type: "move",
          childId: n.id,
          fromParentId: parentId,
          toParentId: parentId,
          order,
        }))
      : chosen.map((n) => ({
          type: "move",
          childId: n.id,
          fromParentId: anchor.parentId,
          toParentId: parentId,
        }));
    const parentPath =
      direction === "indent"
        ? `${path.split("/").slice(0, -1).join("/")}/${parentId}`
        : path.split("/").slice(0, -1).join("/");
    await dispatchMove(commands, anchor.id, parentPath);
    closed_row_paths.expandNodeEverywhere(parentId);
  }
  let clipboard = [];
  /** 切り取りなら、貼り付けで複製せずに移す。移す元の親もここに持つ。 */
  let cutSources = null;
  const copied = writable([]);
  async function navigateToNode(id, { clearFilters = false } = {}) {
    const graph = graphNow();
    if (!graph?.nodes[id]) return { error: "所属先が見つかりません。" };
    const findPath = (root) => {
      const pending = root ? [{ node: root, path: root.id }] : [];
      while (pending.length) {
        const { node, path } = pending.pop();
        if (node.id === id && !node.cycleReference) return path;
        for (const child of [...node.children].reverse())
          pending.push({ node: child, path: `${path}/${child.id}` });
      }
    };
    const localPath = findPath(get(tree)?.data);
    const targetProject = localPath ? get(tree) : projectTreeGrid(graph, graph.rootId);
    const targetPath = localPath || findPath(targetProject?.data);
    if (!targetPath) return { error: "表示上限または循環参照のため、所属先へ到達できません。" };
    if (graph.nodes[id].archived && !get(show_archived))
      return { error: "所属先はアーカイブ済みです。表示メニューでアーカイブを表示してください。" };
    if (clearFilters) {
      filter.set({});
      active_tag.set(null);
    }
    const filters = get(filter);
    const filteredRoot = filterProject(targetProject, filters, get(show_archived), get(active_tag));
    const visiblePath = findPath(filteredRoot);
    if (!visiblePath)
      return { filtered: true, error: "絞り込み条件により所属先を表示できません。" };
    navigation_history.pushSelection();
    if (!localPath) {
      selected_id.set(graph.rootId);
      scope.set(graph.rootId);
      await tick();
      if (graphNow() !== graph || get(scope) !== graph.rootId)
        return { error: "表示範囲が変更されました。もう一度お試しください。" };
    }
    selectOnly(id);
    revealOccurrence(visiblePath);
    navigation_history.pushSelection();
    return { path: visiblePath };
  }
  /** その行がアーカイブされている理由（ノード側か、辺側か）。 */
  function archiveStateOf(nodeId, path) {
    const node = graphNow()?.nodes?.[nodeId];
    const parentId = (path || "").split("/").at(-2);
    return {
      node: Boolean(node?.archived),
      edge: Boolean(node?.parents?.find((parent) => parent.id === parentId)?.archived),
      /** その行以外にも出現があるか（＝アーカイブ範囲を選ばせる意味があるか）。 */
      shared: (node?.parents || []).length > 1,
      /** いくつの親の下に置かれているか。 */
      places: (node?.parents || []).length,
    };
  }
  /**
   * その行を復元する。辺だけアーカイブされていたのか、ノードごとだったのかは
   * 画面からは同じに見えるので、立っている方を（両方なら両方を）まとめて外す。
   *
   * 経路上の祖先も一緒に外す。中間をアーカイブすると配下の行もまとめて消える
   * 仕様なので、祖先が畳まれたままだと「復元したのに戻らない」行ができる。
   * 外すのは押した行の経路だけなので、多親ノードの別の親側は巻き添えにしない
   * （旧 JSON モードの restoreNode と同じ考え方）。
   */
  function restoreOccurrence(nodeId, path) {
    const graph = graphNow();
    const parts = (path || "").split("/").filter(Boolean);
    if (parts.at(-1) !== nodeId || parts.length < 2) {
      // 経路が分からないときは、そのノードだけ戻す。
      const state = archiveStateOf(nodeId, path);
      return state.node
        ? dispatch([{ type: "update-node", nodeId, changes: { archived: false } }])
        : Promise.resolve();
    }
    const commands = [];
    const restoredNodes = new Set();
    for (let index = 1; index < parts.length; index += 1) {
      const childId = parts[index];
      const parentId = parts[index - 1];
      const node = graph?.nodes?.[childId];
      if (!node) continue;
      if (node.parents?.find((parent) => parent.id === parentId)?.archived)
        commands.push({ type: "archive-edge", childId, parentId, archived: false });
      if (node.archived && !restoredNodes.has(childId)) {
        restoredNodes.add(childId);
        commands.push({ type: "update-node", nodeId: childId, changes: { archived: false } });
      }
    }
    if (commands.length === 0) return Promise.resolve();
    return dispatch(commands);
  }
  return {
    navigateToNode,
    scope,
    error,
    tree,
    filtered,
    records,
    isProtected: (id) => id === graphNow()?.rootId || id === graphNow()?.inboxId,
    update,
    updateMany,
    add,
    move,
    dispatch,
    closed: closed_row_paths,
    canUndo: can_undo_graph,
    canRedo: can_redo_graph,
    dispose: closed_row_paths.dispose,
    workspacePath,
    openDetail: (nodeId, name, path = get(active_row_path)) =>
      platform.openTaskDetailWindow({
        workspacePath,
        projectId: get(scope),
        taskId: nodeId,
        taskName: name,
        occurrencePath: path,
      }),
    /** ノードごとアーカイブ（そのノードの行がすべて片付く）。 */
    archive: (targets = ids(), archived = true) => updateMany({ archived }, targets),
    /**
     * アーカイブして、取り消せる通知を出す。アーカイブは元に戻せるので確認
     * ダイアログで止めず、代わりに直後の「元に戻す」を用意する（以前は Delete の
     * たびに確認が出ていた）。通知の「元に戻す」は、その後に別の変更が
     * 入っていたら、無関係な段を戻さないよう何もしない。
     */
    archiveWithNotice: async (targets = ids()) => {
      const names = targets.map((id) => graphNow()?.nodes?.[id]?.name || "（名前なし）");
      const result = await updateMany({ archived: true }, targets);
      notifyUndoable(
        result,
        targets.length === 1
          ? `「${names[0]}」をアーカイブしました`
          : `${targets.length} 件をアーカイブしました`
      );
      return result;
    },
    notifyUndoable,
    isFreshNode,
    cancelCreation,
    /**
     * その行（＝辺）だけをアーカイブ。ノードは残るので、他の親の下では
     * 今までどおり見える。`path` は行の経路で、親はその末尾ひとつ手前。
     */
    archiveEdge: (nodeId, path, archived = true) =>
      dispatch({
        type: "archive-edge",
        childId: nodeId,
        parentId: context(nodeId, path).parentId,
        archived,
      }),
    archiveStateOf,
    restoreOccurrence,
    remove: (targets) => dispatch(targets.map((nodeId) => ({ type: "delete-node", nodeId }))),
    copied,
    copy: (targets = ids()) => {
      cutSources = null;
      clipboard = [...targets];
      copied.set(clipboard);
      // コピーは画面が何も変わらないので、何を写したかを知らせる。
      if (!clipboard.length) return;
      const first = graphNow()?.nodes?.[clipboard[0]]?.name || "（名前なし）";
      showNotice(
        `${clipboard.length === 1 ? `「${first}」` : `${clipboard.length} 件`}をコピーしました（Ctrl+V で選んだ行の子に貼り付け）`
      );
    },
    /**
     * 切り取り（Ctrl+X）。貼り付けで選んだ行の子へ移す。多親ノードは、
     * いま操作している行の親（それ以外は最初に見つかった行の親）から外す。
     */
    cut: (targets = ids()) => {
      const activePath = get(active_row_path) || "";
      const activeId = activePath.split("/").at(-1);
      const sources = targets
        .map((id) => ({
          id,
          parentId:
            id === activeId ? activePath.split("/").at(-2) : occurrenceOf(id)?.split("/").at(-2),
        }))
        .filter((source) => source.parentId);
      if (!sources.length) return;
      clipboard = sources.map((source) => source.id);
      cutSources = sources;
      copied.set(clipboard);
      const first = graphNow()?.nodes?.[clipboard[0]]?.name || "（名前なし）";
      showNotice(
        `${clipboard.length === 1 ? `「${first}」` : `${clipboard.length} 件`}を切り取りました（Ctrl+V で選んだ行の子に移動）`
      );
    },
    paste: async (targetParentId = get(table_selected_id), mode = "subgraph") => {
      if (!cutSources) {
        return dispatch(
          clipboard.map((nodeId) => ({ type: "copy", nodeId, targetParentId, mode }))
        );
      }
      // 切り取りは 1 回だけ貼れる（移したあとに同じ元の親から外すことはできない）。
      const sources = cutSources;
      const result = await dispatch(
        sources
          .filter((source) => source.id !== targetParentId && source.parentId !== targetParentId)
          .map((source) => ({
            type: "move",
            childId: source.id,
            fromParentId: source.parentId,
            toParentId: targetParentId,
          }))
      );
      if (result) {
        cutSources = null;
        clipboard = [];
        copied.set([]);
        closed_row_paths.expandNodeEverywhere(targetParentId);
      }
      return result;
    },
    copyTo: (nodeId, targetParentId, mode) =>
      dispatch({ type: "copy", nodeId, targetParentId, mode }),
    moveTo: (nodeId, path, toParentId) =>
      dispatchMove(
        {
          type: "move",
          childId: nodeId,
          fromParentId: context(nodeId, path).parentId,
          toParentId,
        },
        nodeId,
        occurrenceOf(toParentId)
      ),
    detach: (nodeId, path) =>
      dispatch({ type: "detach", childId: nodeId, parentId: context(nodeId, path).parentId }),
    parents: (nodeId, parentIds) => {
      const previous = graphNow().nodes[nodeId].parents.map((p) => p.id);
      return dispatch([
        ...parentIds
          .filter((id) => !previous.includes(id))
          .map((parentId) => ({ type: "link", childId: nodeId, parentId })),
        ...previous
          .filter((id) => !parentIds.includes(id))
          .map((parentId) => ({ type: "detach", childId: nodeId, parentId })),
      ]);
    },
    reorder: ({ draggedIds, draggedPath, targetId, targetPath, mode, operation = "move" }) => {
      const sourceId = draggedPath?.split("/").at(-1);
      if (!draggedIds.includes(sourceId)) return;
      const fromParentId = context(sourceId, draggedPath).parentId;
      const toParentId = mode === "append" ? targetId : context(targetId, targetPath).parentId;
      if (!fromParentId || !toParentId || draggedIds.includes(targetId)) return;
      if (!draggedIds.every((id) => siblings(fromParentId).some((node) => node.id === id))) {
        error.set("同じ親の行を選択してください。");
        return;
      }
      if (operation === "copy") {
        const children = siblings(toParentId);
        const index =
          mode === "append"
            ? children.length
            : children.findIndex((node) => node.id === targetId) +
              (mode === "insert" || mode === "insert_before" ? 0 : 1);
        return dispatch([
          ...(mode === "append"
            ? []
            : children.map((node, i) => ({
                type: "move",
                childId: node.id,
                fromParentId: toParentId,
                toParentId,
                order: i < index ? i : i + draggedIds.length,
              }))),
          ...draggedIds.map((nodeId, i) => ({
            type: "copy",
            nodeId,
            targetParentId: toParentId,
            mode: "subgraph",
            order:
              mode === "append"
                ? Math.max(
                    -1,
                    ...children.map((node) => node.parents.find((p) => p.id === toParentId).order)
                  ) +
                  i +
                  1
                : index + i,
          })),
        ]);
      }
      const ordered = siblings(toParentId)
        .map((node) => node.id)
        .filter((id) => !draggedIds.includes(id));
      const index =
        mode === "append"
          ? ordered.length
          : ordered.indexOf(targetId) + (mode === "insert" || mode === "insert_before" ? 0 : 1);
      ordered.splice(index, 0, ...draggedIds);
      return dispatchMove(
        ordered.map((childId, order) => ({
          type: "move",
          childId,
          fromParentId: draggedIds.includes(childId) ? fromParentId : toParentId,
          toParentId,
          order,
        })),
        draggedIds[0],
        mode === "append" ? targetPath : targetPath.split("/").slice(0, -1).join("/")
      );
    },
    history: async (direction) => {
      error.set("");
      try {
        await workspace_graph_store[direction]();
      } catch (e) {
        error.set(e.message);
      }
    },
    saveAsset: async (id, file) =>
      (
        await platform.wsSaveGraphAsset(
          workspacePath,
          id,
          file.name || "pasted-image.png",
          new Uint8Array(await file.arrayBuffer())
        )
      ).relativePath,
    resolveAsset: async (id, path) =>
      (await platform.wsResolveGraphAsset(workspacePath, id, path)).url,
    openAsset: (id, path, chooseProgram = false) =>
      platform.wsOpenGraphAsset(workspacePath, id, path, chooseProgram),
  };
}
