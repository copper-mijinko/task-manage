/**
 * ワークスペースのグラフの保存。
 *
 * 正本は、ワークスペースのフォルダーの中の Markdown ファイル（旧 Markdown 形式。
 * 1 ノード = 1 ファイル）。グラフの機能（複数の親・循環・親ごとの並び順・辺だけの
 * アーカイブ）は各ファイルの `parents:` に入り、操作の処理は
 * `workspace-graph-engine.js` がメモリ上のグラフに対して行う。
 *
 * 操作のたびに書くのは、変わったノードのファイルと、履歴の 1 段（`.task-manage/
 * history/`）だけ。ワークスペースの大きさに関係なく、1 回の編集は数個の小さな
 * ファイルの書き込みで済む。
 *
 * 形式の詳細は `docs/data.md`、ファイルの読み書きは `store/` の各モジュール。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { executeGraphCommand, validateGraph } = require("./workspace-graph-engine");
const { STORE_DIR, WORKSPACE_FILE, loadWorkspace, sha1 } = require("./store/loader");
const { readBody, bodyHashSource } = require("./store/body");
const {
  HISTORY_LIMIT,
  loadHistoryIndex,
  readStep,
  writeStep,
  removeStep,
  makeStep,
} = require("./store/history");
const { collectTrash } = require("./store/trash");
const {
  ExternalChangeError,
  applyGraphPatch,
  applyToDisk,
  patchFrom,
  rewriteNodes,
  absolute,
} = require("./store/writer");
const { migrateGraphJson, GRAPH_JSON } = require("./store/migrate-graph-json");
const { extensionFromMimeType, safeFileName, uniqueFileName } = require("./store/files");

const queues = new Map();
/** 読み込み済みのワークスペース（プロセスの間は持ち続ける）。 */
const states = new Map();

/** @type {(message: string) => void} */
let warnHandler = () => {};

/** 読み込み時の警告（手で直したファイルの誤りなど）の出し先を決める。 */
function setWarningHandler(handler) {
  warnHandler = typeof handler === "function" ? handler : () => {};
}

function workspaceQueueKey(workspacePath) {
  const resolved = path.resolve(workspacePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function enqueue(workspacePath, operation) {
  const key = workspaceQueueKey(workspacePath);
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  const tail = next.then(
    () => undefined,
    () => undefined
  );
  queues.set(key, tail);
  tail.finally(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return next;
}

/**
 * @typedef {object} WorkspaceState
 * @property {string} workspacePath
 * @property {any} graph
 * @property {Map<string, { dir: string, file: string, memo?: boolean }>} locations
 * @property {Map<string, { fmHash?: string, bodyHash?: string, attachmentKey: boolean }>} fileInfo
 * @property {{ undo: number[], redo: number[], nextSeq: number }} history
 */

/**
 * レンダラーへ渡す graph に、永続化しない「元に戻す / やり直しの残り段数」を
 * 添える。`state.graph` 自体には足さない（浅い写しを作るだけで、ノードは共有する）。
 */
function withHistoryDepth(state) {
  return {
    ...state.graph,
    history: { undo: state.history.undo.length, redo: state.history.redo.length },
  };
}

/**
 * 操作の結果を、レンダラーへ差分で伝える形にする。
 * 画面は、持っているグラフ（`baseRevision`）にこれを当てて新しいグラフを作る。
 */
function makeDelta(state, before, changedIds, fieldKeys) {
  /** @type {Record<string, any>} */
  const nodes = {};
  for (const id of changedIds) nodes[id] = state.graph.nodes[id] ?? null;
  /** @type {Record<string, any>} */
  const fields = {};
  for (const key of fieldKeys) fields[key] = state.graph[key] ?? null;
  return {
    baseRevision: before.revision,
    revision: state.graph.revision,
    nodes,
    fields,
    history: { undo: state.history.undo.length, redo: state.history.redo.length },
  };
}

const STORE_GITIGNORE = `# アプリの作業用（元に戻す履歴・削除したノードのごみ箱・変換前の退避）。
# ワークスペースを git で管理するときは、これらを入れない。
history/
trash/
backup/
migration.json
`;

/** ワークスペースを git で管理しても作業用のファイルが入らないようにする（なくても困らない）。 */
async function ensureStoreGitignore(workspacePath) {
  const file = path.join(workspacePath, STORE_DIR, ".gitignore");
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, STORE_GITIGNORE, { flag: "wx" });
  } catch {
    // すでにある、または書けない。どちらでもそのまま進める。
  }
}

/** ワークスペースを開く（旧形式からの変換・読み込み・修復・履歴の読み込み）。 */
async function openWorkspace(workspacePath, revision = 0) {
  await migrateGraphJson(workspacePath, { onWarn: warnHandler });
  // frontmatter までしか読まない。本文は、選んだとき・書き戻すときに読む（`bodyLoaded: false`）。
  const loaded = await loadWorkspace(workspacePath, { lazy: true });
  /** @type {WorkspaceState} */
  const state = {
    workspacePath,
    graph: { ...loaded.graph, revision },
    locations: loaded.locations,
    fileInfo: loaded.fileInfo,
    history: { undo: [], redo: [], nextSeq: 1 },
  };
  for (const message of loaded.warnings) warnHandler(`${workspacePath}: ${message}`);

  // 読み込みで直したもの（新しいワークスペースのルート・重複 id の振り直し）をファイルに残す。
  const repairs = new Set(loaded.dirtyIds);
  if (loaded.rootCreated) repairs.add(state.graph.rootId);
  if (repairs.size > 0) await rewriteNodes(state, [...repairs]);

  const index = await loadHistoryIndex(workspacePath);
  state.history.undo = index.undo;
  state.history.redo = index.redo;
  state.history.nextSeq = Math.max(0, ...index.undo, ...index.redo) + 1;
  await collectTrash(workspacePath, new Set([...index.undo, ...index.redo]));
  await ensureStoreGitignore(workspacePath);
  return state;
}

/** 読み込み済みのワークスペース。無ければ開く。操作の列の中で呼ぶこと。 */
async function getState(workspacePath) {
  const key = workspaceQueueKey(workspacePath);
  let state = states.get(key);
  if (!state) {
    state = await openWorkspace(workspacePath);
    states.set(key, state);
  }
  return state;
}

function checkRevision(state, expectedRevision) {
  if (Number.isFinite(expectedRevision) && state.graph.revision !== expectedRevision) {
    throw new Error(
      `Workspace graph changed (expected revision ${expectedRevision}, found ${state.graph.revision})`
    );
  }
}

async function readWorkspaceGraph(workspacePath) {
  return enqueue(workspacePath, async () => withHistoryDepth(await getState(workspacePath)));
}

/**
 * ディスクから読み直す（外で書き換えられたファイルを取り込む）。
 * 画面が持っているリビジョンより小さくならないよう、リビジョンは引き継いで進める。
 */
async function reloadWorkspaceGraph(workspacePath) {
  return enqueue(workspacePath, async () => {
    const key = workspaceQueueKey(workspacePath);
    const previous = states.get(key);
    const state = await openWorkspace(workspacePath, (previous?.graph.revision ?? 0) + 1);
    states.set(key, state);
    return withHistoryDepth(state);
  });
}

/** 読み込み済みの状態を捨てる（次に読むときにディスクから開き直す）。 */
function forgetWorkspace(workspacePath) {
  states.delete(workspaceQueueKey(workspacePath));
}

/** 履歴から外れた段のごみ箱を片付ける（失敗しても操作には影響しない）。 */
async function tidyHistory(state, droppedSeqs) {
  for (const seq of droppedSeqs) {
    await removeStep(state.workspacePath, "undo", seq).catch(() => {});
    await removeStep(state.workspacePath, "redo", seq).catch(() => {});
  }
  await collectTrash(
    state.workspacePath,
    new Set([...state.history.undo, ...state.history.redo])
  ).catch(() => {});
}

const BODY_READ_CONCURRENCY = 16;

/** 同時に `limit` 個まで走らせて、全部の結果を待つ。 */
async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * 本文を読んでいないノードの本文を読み、グラフのそのノードを本文つきにする（リビジョンは
 * 変えない）。操作の前に呼ぶ。読めなければ投げて、操作ごと止める（本文が空のまま
 * 履歴やコピーに入らないように）。
 *
 * @param {WorkspaceState} state
 * @param {Iterable<string>} ids
 */
async function hydrateBodies(state, ids) {
  const targets = [...new Set(ids)].filter((id) => state.graph.nodes[id]?.bodyLoaded === false);
  if (targets.length === 0) return;
  /** @type {Map<string, { body: any, text: string }>} */
  const loaded = new Map();
  await mapLimit(targets, BODY_READ_CONCURRENCY, async (id) => {
    const location = state.locations.get(id);
    if (!location) throw new Error(`本文を読めませんでした（置き場所が分かりません）: ${id}`);
    loaded.set(id, await readBody(state.workspacePath, state.graph.nodes[id], location));
  });
  const nodes = { ...state.graph.nodes };
  for (const [id, { body, text }] of loaded) {
    const { bodyLoaded: _unloaded, ...rest } = nodes[id];
    nodes[id] = { ...rest, body };
    const info = state.fileInfo.get(id);
    // 読んだ本文を、保存の直前の照合に使う（読んだあとに外で変えられたら止める）。
    if (info) info.bodyHash = sha1(bodyHashSource(text));
  }
  state.graph = { ...state.graph, nodes };
}

/** `nodeId` とその子孫（子の方向に辿れるノード）。 */
function descendantsOf(graph, nodeId) {
  const children = new Map();
  for (const node of Object.values(graph.nodes))
    for (const link of node.parents ?? []) {
      if (!children.has(link.id)) children.set(link.id, []);
      children.get(link.id).push(node.id);
    }
  const seen = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return seen;
}

/**
 * コマンドが本文を使うノード。本文を変える・形式を変えるノードは、元の本文が履歴
 * （元に戻す）に要る。コピーは、コピー元の本文を写す。
 *
 * @param {any} graph
 * @param {any} command
 * @returns {Set<string>}
 */
function bodiesNeededBy(graph, command) {
  const ids = new Set();
  const visit = (item) => {
    if (item?.type === "batch") {
      for (const inner of item.commands ?? []) visit(inner);
    } else if (item?.type === "update-node") {
      if (item.changes && ("body" in item.changes || "format" in item.changes))
        ids.add(item.nodeId);
    } else if (item?.type === "copy") {
      const sources = item.mode === "subgraph" ? descendantsOf(graph, item.nodeId) : [item.nodeId];
      for (const id of sources) ids.add(id);
    }
  };
  visit(command);
  return ids;
}

/**
 * 操作 1 回ぶんを、ファイルと履歴に反映する。
 *
 * @param {string} workspacePath
 * @param {number | undefined} expectedRevision
 * @param {(state: WorkspaceState) => Promise<{ after: any, selectedNodeIds?: string[], copiedFrom?: Record<string, string> }>} action
 * @param {(state: WorkspaceState) => Iterable<string>} [bodiesNeeded] 操作の前に本文を読むノード
 */
async function mutate(workspacePath, expectedRevision, action, bodiesNeeded) {
  return enqueue(workspacePath, async () => {
    const state = await getState(workspacePath);
    checkRevision(state, expectedRevision);
    if (bodiesNeeded) await hydrateBodies(state, bodiesNeeded(state));
    const before = state.graph;
    const { after, selectedNodeIds = [], copiedFrom = {} } = await action(state);
    const seq = state.history.nextSeq;
    const transaction = await applyToDisk(state, before, after, { seq, copiedFrom });
    try {
      const patch = patchFrom(before, transaction.changedIds, transaction.fieldKeys);
      await writeStep(workspacePath, "undo", makeStep(seq, patch, transaction.trashed));
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    // ここから先は確定。
    await transaction.finalize();
    const droppedRedo = state.history.redo;
    state.graph = after;
    state.history.undo = [...state.history.undo, seq];
    state.history.redo = [];
    state.history.nextSeq = seq + 1;
    const droppedUndo = state.history.undo.splice(
      0,
      Math.max(0, state.history.undo.length - HISTORY_LIMIT)
    );
    if (droppedRedo.length > 0 || droppedUndo.length > 0)
      await tidyHistory(state, [...droppedRedo, ...droppedUndo]);
    return {
      selectedNodeIds,
      graph: withHistoryDepth(state),
      delta: makeDelta(state, before, transaction.changedIds, transaction.fieldKeys),
    };
  });
}

async function executeWorkspaceGraphCommand(workspacePath, command, origin, expectedRevision) {
  const bodiesNeeded = (state) => bodiesNeededBy(state.graph, command);
  return mutate(
    workspacePath,
    expectedRevision,
    async (state) => {
      const result = executeGraphCommand(state.graph, command, origin);
      return {
        after: result.graph,
        selectedNodeIds: result.selectedNodeIds,
        copiedFrom: result.copiedFrom,
      };
    },
    bodiesNeeded
  );
}

/**
 * ノードの本文を読む（詳細を開いたとき）。すでに本文を持っていればそれを、無ければ
 * ディスクから読む。グラフは変えない。
 */
async function readNodeBody(workspacePath, nodeId) {
  const state = await enqueue(workspacePath, () => getState(workspacePath));
  const node = state.graph.nodes[nodeId];
  if (!node) throw new Error(`Unknown node: ${nodeId}`);
  if (node.bodyLoaded !== false)
    return { body: node.body ?? "", format: node.format ?? "markdown" };
  const location = state.locations.get(nodeId);
  if (!location) throw new Error(`本文を読めませんでした（置き場所が分かりません）: ${nodeId}`);
  const { body, format } = await readBody(workspacePath, node, location);
  return { body, format };
}

/**
 * 全ノードの本文を読む（本文の検索・全メモの形式変換のとき）。グラフは変えない。
 *
 * @returns {Promise<Record<string, { body: any, format: string }>>}
 */
async function readAllNodeBodies(workspacePath) {
  const state = await enqueue(workspacePath, () => getState(workspacePath));
  /** @type {Record<string, { body: any, format: string }>} */
  const bodies = {};
  const unloaded = [];
  for (const node of Object.values(state.graph.nodes)) {
    if (node.bodyLoaded === false) unloaded.push(node);
    else bodies[node.id] = { body: node.body ?? "", format: node.format ?? "markdown" };
  }
  await mapLimit(unloaded, BODY_READ_CONCURRENCY, async (node) => {
    const location = state.locations.get(node.id);
    if (!location) return;
    const { body, format } = await readBody(workspacePath, node, location);
    bodies[node.id] = { body, format };
  });
  return bodies;
}

async function changeHistory(workspacePath, direction, expectedRevision) {
  return enqueue(workspacePath, async () => {
    const state = await getState(workspacePath);
    checkRevision(state, expectedRevision);
    const source = state.history[direction];
    if (source.length === 0) return { graph: withHistoryDepth(state), changed: false, delta: null };
    const seq = source[source.length - 1];
    let step;
    try {
      step = await readStep(workspacePath, direction, seq);
    } catch (error) {
      // 読めない段は、いつまでも残すと毎回失敗するので捨てる。
      await removeStep(workspacePath, direction, seq).catch(() => {});
      state.history[direction] = source.slice(0, -1);
      throw new Error(
        `履歴の 1 段を読めなかったため、破棄しました。もう一度操作してください。（${error.message}）`
      );
    }
    const before = state.graph;
    // パッチはノードの表と最上位の欄を置き換えるだけなので、浅い写しで足りる。
    const restored = { ...before, nodes: { ...before.nodes } };
    const inverse = applyGraphPatch(restored, step.patch);
    restored.revision = before.revision + 1;
    validateGraph(restored);

    const transaction = await applyToDisk(state, before, restored, {
      seq,
      trashedIn: step.trashed ?? {},
    });
    const other = direction === "undo" ? "redo" : "undo";
    try {
      await writeStep(workspacePath, other, makeStep(seq, inverse, transaction.trashed));
      await removeStep(workspacePath, direction, seq);
    } catch (error) {
      await removeStep(workspacePath, other, seq).catch(() => {});
      await transaction.rollback();
      throw error;
    }
    await transaction.finalize();
    state.graph = restored;
    state.history[direction] = source.slice(0, -1);
    state.history[other] = [...state.history[other], seq];
    return {
      graph: withHistoryDepth(state),
      changed: true,
      delta: makeDelta(state, before, transaction.changedIds, transaction.fieldKeys),
    };
  });
}

// ── 画像と添付 ───────────────────────────────────────────────────────────

const ASSET_KINDS = { image: "assets", attachment: "attachments" };

/**
 * 画像（本文に貼るもの）と添付ファイルを、ノードのフォルダーへ保存する。
 * 画像は `./assets/<file>`、添付は `./attachments/<file>`。本文からは相対パスで
 * 参照するので、ふつうの Markdown ビューアでも表示できる。
 */
async function saveNodeAsset(workspacePath, nodeId, fileName, bytes, kind = "attachment") {
  const { location } = await enqueue(workspacePath, async () => {
    const state = await getState(workspacePath);
    if (!state.graph.nodes[nodeId]) throw new Error("Unknown node");
    return { location: state.locations.get(nodeId) };
  });
  if (!location) throw new Error("Unknown node");
  const folder = ASSET_KINDS[kind] ?? ASSET_KINDS.attachment;
  const dir = path.join(absolute(workspacePath, location), folder);
  await fs.promises.mkdir(dir, { recursive: true });
  let name = safeFileName(fileName, "attachment");
  // 貼り付けた画像は名前が決まっている（pasted-image.png）ので、衝突しない名前にする。
  if (kind === "image" && /^(pasted-image|image)\.[A-Za-z0-9]+$/i.test(name)) {
    const extension = path.extname(name).slice(1) || extensionFromMimeType("");
    name = `pasted-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  }
  const unique = await uniqueFileName(dir, name);
  await fs.promises.writeFile(path.join(dir, unique), Buffer.from(bytes));
  return { relativePath: `./${folder}/${unique}` };
}

/** 本文・添付が指すファイルの、ディスク上の場所。ノードのフォルダーの外は拒否する。 */
async function resolveNodeAsset(workspacePath, nodeId, relativePath) {
  const { location } = await enqueue(workspacePath, async () => {
    const state = await getState(workspacePath);
    if (!state.graph.nodes[nodeId]) throw new Error("Unknown node");
    return { location: state.locations.get(nodeId) };
  });
  if (!location) throw new Error("Unknown node");
  const normalized = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  const base = path.resolve(absolute(workspacePath, location));
  const resolved = path.resolve(base, normalized);
  const inside = ["assets", "attachments"].some((folder) =>
    resolved.startsWith(path.join(base, folder) + path.sep)
  );
  if (!inside) throw new Error("Asset path escapes the node folder");
  const realBase = await fs.promises.realpath(base);
  const real = await fs.promises.realpath(resolved);
  if (!real.startsWith(realBase + path.sep)) throw new Error("Asset escapes the node folder");
  if (!(await fs.promises.lstat(real)).isFile()) throw new Error("Asset is not a file");
  return real;
}

/** 書き込み待ちのグラフ操作があるか。 */
function hasPendingWrites() {
  return queues.size > 0;
}

/** いま待ち行列にあるグラフ操作がすべて終わるまで待つ。 */
async function whenIdle() {
  while (queues.size) await Promise.all([...queues.values()]);
}

/**
 * フォルダーがこのアプリのワークスペースか（選択を受け付けるかの判断）。
 * 新しい形式（`_workspace.md`）と、変換前の `graph-v1.json` のどちらも該当する。
 */
function isWorkspaceFolder(workspacePath) {
  return (
    fs.existsSync(path.join(workspacePath, WORKSPACE_FILE)) ||
    fs.existsSync(path.join(workspacePath, STORE_DIR, GRAPH_JSON))
  );
}

module.exports = {
  ExternalChangeError,
  setWarningHandler,
  readWorkspaceGraph,
  reloadWorkspaceGraph,
  forgetWorkspace,
  executeWorkspaceGraphCommand,
  readNodeBody,
  readAllNodeBodies,
  undoWorkspaceGraph: (workspacePath, revision) => changeHistory(workspacePath, "undo", revision),
  redoWorkspaceGraph: (workspacePath, revision) => changeHistory(workspacePath, "redo", revision),
  saveNodeAsset,
  resolveNodeAsset,
  hasPendingWrites,
  whenIdle,
  isWorkspaceFolder,
};
