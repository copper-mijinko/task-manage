import { derived, get, writable } from "svelte/store";
import { workspace_graph_store, workspace_graph } from "../stores/graph";
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
} from "@stores/ui";
import * as platform from "@lib/ipc/platform";

export const TREEGRID_APPLICATION = "task-manage:treegrid-application";

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
      return node ? sortTree(filterTree(node, filters), sort) : null;
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
  const update = (id, patch) =>
    dispatch({ type: "update-node", nodeId: id, changes: nodeChanges(patch) });
  const updateMany = (patch, targets = ids()) =>
    dispatch(
      targets.map((id) => ({ type: "update-node", nodeId: id, changes: nodeChanges(patch) }))
    );
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
      closed_row_paths.expandNodeEverywhere(parentId);
      selectOnly(result.selectedNodeIds[0]);
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
        : direction === "outdent"
          ? path.split("/").slice(0, -2).join("/")
          : path.split("/").slice(0, -1).join("/");
    await dispatchMove(commands, anchor.id, parentPath);
    closed_row_paths.expandNodeEverywhere(parentId);
  }
  let clipboard = [];
  const copied = writable([]);
  return {
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
    dispose: closed_row_paths.dispose,
    workspacePath,
    openDetail: (nodeId, name, path = get(active_row_path)) =>
      platform.openTaskDetailWindow({
        workspacePath,
        projectId: get(scope),
        taskId: nodeId,
        taskName: name,
        occurrencePath: path,
        selectedType: "WorkspaceProject",
      }),
    archive: (targets = ids(), archived = true) => updateMany({ archived }, targets),
    remove: (targets) => dispatch(targets.map((nodeId) => ({ type: "delete-node", nodeId }))),
    copied,
    copy: (targets = ids()) => {
      clipboard = [...targets];
      copied.set(clipboard);
    },
    paste: (targetParentId = get(table_selected_id), mode = "subgraph") =>
      dispatch(clipboard.map((nodeId) => ({ type: "copy", nodeId, targetParentId, mode }))),
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
    reorder: ({ draggedIds, draggedPath, targetId, targetPath, mode }) => {
      const sourceId = draggedPath?.split("/").at(-1);
      if (!draggedIds.includes(sourceId)) return;
      const fromParentId = context(sourceId, draggedPath).parentId;
      const toParentId = mode === "append" ? targetId : context(targetId, targetPath).parentId;
      if (!fromParentId || !toParentId || draggedIds.includes(targetId)) return;
      if (!draggedIds.every((id) => siblings(fromParentId).some((node) => node.id === id))) {
        error.set("同じ親の行を選択してください。");
        return;
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
