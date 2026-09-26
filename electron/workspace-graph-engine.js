const crypto = require("crypto");

function clone(value) {
  return structuredClone(value);
}

function parentIds(node) {
  return (node?.parents || []).map((link) => link.id);
}

function childrenIndex(graph) {
  const result = new Map();
  for (const node of Object.values(graph.nodes)) {
    for (const parent of node.parents || []) {
      if (!result.has(parent.id)) result.set(parent.id, []);
      result.get(parent.id).push(node.id);
    }
  }
  return result;
}

function reachableFromRoot(graph) {
  const children = childrenIndex(graph);
  const seen = new Set();
  const queue = [graph.rootId];
  // shift() は配列を詰め直すので、ノード数の 2 乗になる。読み位置で進める。
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    if (seen.has(id) || !graph.nodes[id]) continue;
    seen.add(id);
    for (const child of children.get(id) || []) if (!seen.has(child)) queue.push(child);
  }
  return seen;
}

/**
 * Attach one deterministic entry node for each root-unreachable weak component.
 *
 * `writable(id)` はそのノードを書き換えてよい写しを返す。エンジンからは
 * 書き換えるノードだけを複製するために渡す。省略時はその場で書き換える。
 */
function repairRootReachability(graph, writable = (id) => graph.nodes[id]) {
  while (true) {
    const reachable = reachableFromRoot(graph);
    const entry = Object.keys(graph.nodes)
      .filter((id) => !reachable.has(id))
      .sort()[0];
    if (!entry) return;
    const links = graph.nodes[entry].parents || [];
    if (!links.some((link) => link.id === graph.rootId)) {
      const node = writable(entry);
      node.parents = [
        ...(node.parents || []),
        { id: graph.rootId, order: nextOrder(graph, graph.rootId) },
      ];
    }
  }
}

function nextOrder(graph, parentId) {
  let max = -1;
  for (const node of Object.values(graph.nodes)) {
    const link = (node.parents || []).find((item) => item.id === parentId);
    if (Number.isFinite(link?.order)) max = Math.max(max, link.order);
  }
  return max + 1;
}

function pathExists(graph, fromId, targetId) {
  const children = childrenIndex(graph);
  const seen = new Set();
  const queue = [fromId];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(children.get(id) || []));
  }
  return false;
}

function assertNode(graph, id) {
  if (!graph.nodes[id]) throw new Error(`Unknown node: ${id}`);
}

function assertEdgeAllowed(graph, childId, parentId, origin, ignoreParentId) {
  assertNode(graph, childId);
  assertNode(graph, parentId);
  if (childId === graph.rootId) throw new Error("The workspace root cannot have a parent");
  if (childId === parentId) throw new Error("Self edges are not allowed");
  if (
    (graph.nodes[childId].parents || []).some((p) => p.id === parentId && p.id !== ignoreParentId)
  ) {
    throw new Error("Duplicate edges are not allowed");
  }
  if (origin === "finder" && pathExists(graph, childId, parentId)) {
    throw new Error("This view cannot create a cycle");
  }
}

function cleanCloneNode(node, id) {
  const copy = clone(node);
  copy.id = id;
  copy.assetOwnerId = node.assetOwnerId || node.id;
  copy.parents = [];
  return copy;
}

function executeGraphCommand(input, command, origin = "graph") {
  if (command?.type === "batch") {
    if (
      !Array.isArray(command.commands) ||
      !command.commands.length ||
      command.commands.length > 10000 ||
      command.commands.some((c) => c?.type === "batch")
    )
      throw new Error("Invalid command batch");
    let graph = input;
    const selectedNodeIds = [],
      copiedFrom = {};
    for (const operation of command.commands) {
      const result = executeGraphCommand(graph, operation, origin);
      graph = result.graph;
      selectedNodeIds.push(...result.selectedNodeIds);
      Object.assign(copiedFrom, result.copiedFrom);
    }
    graph.revision = (input.revision || 0) + 1;
    return { graph, selectedNodeIds: [...new Set(selectedNodeIds)], copiedFrom };
  }
  if (!new Set(["graph", "tree", "finder"]).has(origin)) throw new Error("Invalid command origin");
  // 渡されたグラフは書き換えない。ただし全体を複製すると 1 回の操作ごとに
  // ノード数ぶんの仕事になるので、ノードの表だけを浅く写し、書き換える
  // ノードはその直前に `writable` で複製する（変わらないノードは共有する）。
  const graph = { ...input, nodes: { ...input.nodes } };
  if (input.positions) graph.positions = { ...input.positions };
  const ownNodes = new Set();
  const writable = (id) => {
    if (!ownNodes.has(id)) {
      const current = graph.nodes[id];
      graph.nodes[id] = {
        ...current,
        parents: (current.parents || []).map((parent) => ({ ...parent })),
      };
      ownNodes.add(id);
    }
    return graph.nodes[id];
  };
  const selectedNodeIds = [];
  const copiedFrom = {};
  identifyInbox(graph);
  const node = command.nodeId ? graph.nodes[command.nodeId] : undefined;
  if (command.nodeId) assertNode(graph, command.nodeId);
  const protectedInbox =
    graph.inboxId && (command.nodeId === graph.inboxId || command.childId === graph.inboxId);
  if (
    protectedInbox &&
    (command.type === "delete-node" ||
      command.type === "detach" ||
      command.type === "copy" ||
      command.type === "link" ||
      (command.type === "move" && command.toParentId !== graph.rootId) ||
      command.type === "archive-edge" ||
      (command.type === "update-node" && (command.changes.archived || command.changes.archivedAt)))
  )
    throw new Error("Inboxは削除・アーカイブ・移動できません。");

  if (command.type === "create-node") {
    assertNode(graph, command.parentId);
    const id = crypto.randomUUID();
    const requested = command.node && typeof command.node === "object" ? clone(command.node) : {};
    const allowed = [
      "name",
      "status",
      "startDate",
      "dueDate",
      "body",
      "format",
      "bodyLoaded",
      "tags",
      "attachments",
      "createdAt",
      "archived",
      "archivedAt",
    ];
    const supplied = Object.fromEntries(
      allowed
        .filter((key) => Object.prototype.hasOwnProperty.call(requested, key))
        .map((key) => [key, requested[key]])
    );
    graph.nodes[id] = {
      ...supplied,
      id,
      name: String(supplied.name || "New node"),
      parents: [
        {
          id: command.parentId,
          order: Number.isFinite(command.order)
            ? command.order
            : nextOrder(graph, command.parentId),
        },
      ],
      createdAt: supplied.createdAt || new Date().toISOString().slice(0, 10),
    };
    selectedNodeIds.push(id);
  } else if (command.type === "set-position") {
    assertNode(graph, command.nodeId);
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y))
      throw new Error("Invalid graph position");
    graph.positions = {
      ...(graph.positions || {}),
      [command.nodeId]: { x: command.x, y: command.y },
    };
    selectedNodeIds.push(command.nodeId);
  } else if (command.type === "update-node") {
    if (
      command.nodeId === graph.rootId &&
      ("parents" in command.changes || "archived" in command.changes)
    ) {
      throw new Error("The workspace root is protected");
    }
    const allowed = new Set([
      "name",
      "status",
      "startDate",
      "dueDate",
      "body",
      "format",
      "bodyLoaded",
      "tags",
      "attachments",
      "archived",
      "archivedAt",
    ]);
    if (Object.keys(command.changes).some((key) => !allowed.has(key))) {
      throw new Error("Structural fields require a graph command");
    }
    graph.nodes[command.nodeId] = { ...node, ...clone(command.changes), id: command.nodeId };
    selectedNodeIds.push(command.nodeId);
  } else if (command.type === "link") {
    assertEdgeAllowed(graph, command.childId, command.parentId, origin);
    writable(command.childId).parents.push({
      id: command.parentId,
      order: Number.isFinite(command.order) ? command.order : nextOrder(graph, command.parentId),
    });
    selectedNodeIds.push(command.childId);
  } else if (command.type === "detach") {
    if (command.childId === graph.rootId) throw new Error("The workspace root is protected");
    assertNode(graph, command.childId);
    const child = writable(command.childId);
    const before = child.parents.length;
    child.parents = child.parents.filter((parent) => parent.id !== command.parentId);
    if (before === child.parents.length) throw new Error("Edge not found");
    repairRootReachability(graph, writable);
    selectedNodeIds.push(command.childId);
  } else if (command.type === "archive-edge") {
    // 辺だけのアーカイブ。ノードは残るので、他の親の下では今までどおり見える。
    if (command.childId === graph.rootId) throw new Error("The workspace root is protected");
    assertNode(graph, command.childId);
    const edge = (graph.nodes[command.childId].parents || []).find(
      (parent) => parent.id === command.parentId
    );
    if (!edge) throw new Error("Edge not found");
    const archived = command.archived !== false;
    graph.nodes[command.childId] = {
      ...graph.nodes[command.childId],
      parents: graph.nodes[command.childId].parents.map((parent) =>
        parent.id === command.parentId
          ? archived
            ? { ...parent, archived: true, archivedAt: new Date().toISOString() }
            : { id: parent.id, order: parent.order }
          : parent
      ),
    };
    selectedNodeIds.push(command.childId);
  } else if (command.type === "move") {
    assertNode(graph, command.childId);
    const movingNode = writable(command.childId);
    if (!(movingNode.parents || []).some((p) => p.id === command.fromParentId))
      throw new Error("Edge not found");
    movingNode.parents = movingNode.parents.filter((p) => p.id !== command.fromParentId);
    assertEdgeAllowed(graph, command.childId, command.toParentId, origin);
    movingNode.parents.push({
      id: command.toParentId,
      order: Number.isFinite(command.order) ? command.order : nextOrder(graph, command.toParentId),
    });
    repairRootReachability(graph, writable);
    selectedNodeIds.push(command.childId);
  } else if (command.type === "delete-node") {
    if (command.nodeId === graph.rootId) throw new Error("The workspace root is protected");
    delete graph.nodes[command.nodeId];
    if (graph.positions) delete graph.positions[command.nodeId];
    for (const child of Object.values(graph.nodes)) {
      if ((child.parents || []).some((parent) => parent.id === command.nodeId))
        writable(child.id).parents = child.parents.filter((parent) => parent.id !== command.nodeId);
    }
    repairRootReachability(graph, writable);
  } else if (command.type === "copy") {
    assertNode(graph, command.targetParentId);
    if (command.nodeId === graph.rootId) throw new Error("The workspace root cannot be copied");
    if (!["node", "share-children", "subgraph"].includes(command.mode))
      throw new Error("Unknown copy mode");
    if (command.mode === "subgraph" && origin === "finder") {
      const reachable = new Set();
      const children = childrenIndex(graph);
      const queue = [command.nodeId];
      while (queue.length) {
        const id = queue.shift();
        if (reachable.has(id)) continue;
        reachable.add(id);
        queue.push(...(children.get(id) || []));
      }
      for (const id of reachable)
        for (const p of parentIds(graph.nodes[id]))
          if (reachable.has(p) && pathExists(graph, id, p))
            throw new Error("This view cannot copy a cyclic subgraph");
    }
    const idMap = new Map();
    const sourceIds = [command.nodeId];
    if (command.mode === "subgraph") {
      const children = childrenIndex(graph);
      const seen = new Set();
      const queue = [command.nodeId];
      sourceIds.length = 0;
      while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        sourceIds.push(id);
        queue.push(...(children.get(id) || []));
      }
    }
    for (const sourceId of sourceIds) idMap.set(sourceId, crypto.randomUUID());
    for (const sourceId of sourceIds) {
      const copyId = idMap.get(sourceId);
      graph.nodes[copyId] = cleanCloneNode(graph.nodes[sourceId], copyId);
      copiedFrom[copyId] = sourceId;
    }
    const newRootId = idMap.get(command.nodeId);
    // 複製はもとと同じ名前になるので、行だけを見ても「同じノードが 2 か所に
    // 出ている」のか「別のノードが増えた」のか区別が付かない。作った直後から
    // 見分けが付くよう、複製の先頭ノードだけ名前に印を付ける（リンクで置き場所
    // を増やしただけのときは同じノードなので、当然変えない）。
    graph.nodes[newRootId].name = copyName(
      graph,
      graph.nodes[command.nodeId].name,
      command.targetParentId,
      newRootId
    );
    graph.nodes[newRootId].parents = [
      {
        id: command.targetParentId,
        order: Number.isFinite(command.order)
          ? command.order
          : nextOrder(graph, command.targetParentId),
      },
    ];
    if (command.mode === "share-children") {
      for (const childId of childrenIndex(input).get(command.nodeId) || []) {
        assertEdgeAllowed(graph, childId, newRootId, origin);
        const sourceOrder = graph.nodes[childId].parents.find(
          (p) => p.id === command.nodeId
        )?.order;
        writable(childId).parents.push({ id: newRootId, order: sourceOrder });
      }
    } else if (command.mode === "subgraph") {
      for (const sourceId of sourceIds) {
        const internal = (graph.nodes[sourceId].parents || [])
          .filter((p) => idMap.has(p.id))
          .map((p) => ({ ...p, id: idMap.get(p.id) }));
        graph.nodes[idMap.get(sourceId)].parents =
          sourceId === command.nodeId
            ? [...graph.nodes[idMap.get(sourceId)].parents, ...internal]
            : internal;
      }
    }
    selectedNodeIds.push(...idMap.values());
  } else throw new Error("Unknown graph command");

  // 親子関係を変えない操作は、触ったノードだけ確かめれば足りる（全体の
  // 到達可能性は変わらない。新しいノードは既存の親の下に付く）。
  if (command.type === "update-node") validateGraph(graph, [command.nodeId]);
  else if (command.type === "create-node") validateGraph(graph, selectedNodeIds);
  else if (command.type === "set-position") validateGraph(graph, []);
  else validateGraph(graph);
  graph.revision = (input.revision || 0) + 1;
  return { graph, selectedNodeIds, copiedFrom };
}

/** 同じ親の下で衝突しない「… のコピー」を作る。 */
function copyName(graph, baseName, parentId, exceptId) {
  const taken = new Set(
    Object.values(graph.nodes)
      .filter((node) => node.id !== exceptId && (node.parents || []).some((p) => p.id === parentId))
      .map((node) => node.name)
  );
  const base = `${baseName} のコピー`;
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} (${index})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * グラフの整合性を確かめる。
 *
 * `onlyIds` を渡すと、そのノードの中身だけを確かめ、全体の到達可能性は
 * 見ない。親子関係を変えない操作の後に、変えたノードだけを確かめるため。
 *
 * @param {object} graph
 * @param {string[]} [onlyIds]
 */
function validateGraph(graph, onlyIds) {
  if (!graph || graph.schemaVersion !== 1 || !graph.nodes || !graph.nodes[graph.rootId])
    throw new Error("Invalid workspace graph");
  if ((graph.nodes[graph.rootId].parents || []).length)
    throw new Error("The workspace root cannot have parents");
  const statuses = new Set([
    undefined,
    "Undefined",
    "Open",
    "Pending",
    "In Progress",
    "Completed",
    "Canceled",
  ]);
  const validDate = (value) => {
    if (value === undefined) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  };
  const records = onlyIds
    ? onlyIds.map((id) => [id, graph.nodes[id]])
    : Object.entries(graph.nodes);
  for (const [recordId, node] of records) {
    if (
      !node ||
      node.id !== recordId ||
      typeof node.name !== "string" ||
      !Array.isArray(node.parents)
    ) {
      throw new Error(`Invalid node record: ${recordId}`);
    }
    if (!statuses.has(node.status)) throw new Error(`Invalid node status: ${node.status}`);
    if (!validDate(node.startDate) || !validDate(node.dueDate) || !validDate(node.createdAt)) {
      throw new Error(`Invalid node date: ${recordId}`);
    }
    if (node.startDate && node.dueDate && node.startDate > node.dueDate)
      throw new Error(`Start date is after due date: ${recordId}`);
    if (node.bodyLoaded !== undefined && typeof node.bodyLoaded !== "boolean")
      throw new Error("Invalid bodyLoaded value");
    const seen = new Set();
    for (const parent of node.parents || []) {
      if (!graph.nodes[parent.id]) throw new Error(`Unknown parent: ${parent.id}`);
      if (parent.id === node.id) throw new Error("Self edges are not allowed");
      if (seen.has(parent.id)) throw new Error("Duplicate edges are not allowed");
      seen.add(parent.id);
    }
  }
  if (graph.nodes[graph.rootId].archived || graph.nodes[graph.rootId].archivedAt)
    throw new Error("The workspace root cannot be archived");
  if (onlyIds) return;
  if (reachableFromRoot(graph).size !== Object.keys(graph.nodes).length)
    throw new Error("Every node must be reachable from the workspace root");
}

function identifyInbox(graph) {
  if (graph.inboxId) return graph.inboxId;
  const nodes = Object.values(graph.nodes);
  const imported = nodes.find(
    (node) => /[\\/]_inbox$/.test(node.sourceProjectDir || "") && node.sourceTaskDir === "_project"
  );
  const legacy = nodes.find(
    (node) =>
      node.name?.toLowerCase() === "inbox" &&
      node.parents?.some((parent) => parent.id === graph.rootId)
  );
  const inbox = imported || legacy;
  if (inbox) graph.inboxId = inbox.id;
  return graph.inboxId;
}

module.exports = {
  executeGraphCommand,
  validateGraph,
  repairRootReachability,
  reachableFromRoot,
  identifyInbox,
};
