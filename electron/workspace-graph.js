const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const workspace = require("./workspace");
const {
  executeGraphCommand,
  validateGraph,
  repairRootReachability,
  identifyInbox,
} = require("./workspace-graph-engine");

const GRAPH_DIR = ".task-manage";
const GRAPH_FILE = "graph-v1.json";
const HISTORY_LIMIT = 50;
const queues = new Map();

function workspaceQueueKey(workspacePath) {
  const resolved = path.resolve(workspacePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function graphPath(workspacePath) {
  return path.join(workspacePath, GRAPH_DIR, GRAPH_FILE);
}

function assetDir(workspacePath, nodeId) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(String(nodeId))) throw new Error("Invalid node id");
  return path.join(workspacePath, GRAPH_DIR, "assets", nodeId);
}

function rewriteAssetReferences(value, fromPrefix, toPrefix) {
  if (typeof value === "string") {
    if (fromPrefix === "assets/" || fromPrefix === "attachments/") {
      const folder = fromPrefix.slice(0, -1);
      return value.replace(
        new RegExp(`(^|[\\s(\\"'=])(?:\\./)?${folder}/`, "g"),
        (_match, prefix) => `${prefix}${toPrefix}`
      );
    }
    return value.split(fromPrefix).join(toPrefix);
  }
  if (Array.isArray(value))
    return value.map((entry) => rewriteAssetReferences(entry, fromPrefix, toPrefix));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        rewriteAssetReferences(entry, fromPrefix, toPrefix),
      ])
    );
  }
  return value;
}

async function copyDirectoryStrict(source, destination, allowedRoot) {
  let entries;
  try {
    entries = await fs.promises.readdir(source, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await fs.promises.mkdir(destination, { recursive: true });
  const allowedReal = await fs.promises.realpath(allowedRoot);
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const stat = await fs.promises.lstat(sourcePath);
    if (stat.isSymbolicLink())
      throw new Error(`Symbolic links are not allowed in node assets: ${sourcePath}`);
    const real = await fs.promises.realpath(sourcePath);
    if (real !== allowedReal && !real.startsWith(allowedReal + path.sep))
      throw new Error("Asset escapes its project");
    const destinationPath = path.join(destination, entry.name);
    if (stat.isDirectory()) await copyDirectoryStrict(sourcePath, destinationPath, allowedRoot);
    else if (stat.isFile()) await fs.promises.copyFile(sourcePath, destinationPath);
  }
}

/**
 * 旧プロジェクトを取り込む前に、読み落としが起きないことを確かめる。
 *
 * 返り値の `duplicateMemos` は、同じ id のメモファイルが複数あったときの
 * 置き場所（id → [{ ownerId, dirName, fileName }]）。v0.40 の貼り付けは
 * タスクに新しい id を振るがメモの id は引き継いだので、プロジェクト内の
 * 別タスクに同じ id のメモが並ぶ。旧形式はメモをタスクごとに読んでいたので
 * これは正しいデータで、取り込み側で片方に新しい id を振る。
 * メモとタスクの id が重なるのは別の話なので、これまでどおり止める。
 */
async function strictProjectPreflight(projectDir, rootId) {
  const ids = new Set([rootId]);
  const entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  const nodeDirectories = [
    { dir: projectDir, dirName: "_project", ownerId: rootId, reserved: "_project.md" },
  ];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const indexPath = path.join(projectDir, entry.name, "_index.md");
    let raw;
    try {
      raw = await fs.promises.readFile(indexPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`Cannot read legacy task ${entry.name}: ${error.message}`);
    }
    const id = workspace.parseFrontmatter(raw).data.id;
    if (!id || typeof id !== "string") throw new Error(`Invalid legacy task: ${entry.name}`);
    if (ids.has(id)) throw new Error(`Duplicate node id in legacy project: ${id}`);
    ids.add(id);
    nodeDirectories.push({
      dir: path.join(projectDir, entry.name),
      dirName: entry.name,
      ownerId: id,
      reserved: "_index.md",
    });
  }
  const memoFiles = new Map();
  for (const { dir, dirName, ownerId, reserved } of nodeDirectories) {
    const files = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || file.name === reserved || !file.name.endsWith(".md")) continue;
      const filePath = path.join(dir, file.name);
      let raw;
      try {
        raw = await fs.promises.readFile(filePath, "utf8");
      } catch (error) {
        throw new Error(`Cannot read legacy memo ${file.name}: ${error.message}`);
      }
      const declaredId = workspace.parseFrontmatter(raw).data.id;
      const id = workspace.legacyMemoId(declaredId, dir, file.name);
      if (ids.has(id) && !memoFiles.has(id))
        throw new Error(`Duplicate legacy memo node id: ${id}`);
      ids.add(id);
      if (!memoFiles.has(id)) memoFiles.set(id, []);
      memoFiles.get(id).push({ ownerId, dirName, fileName: file.name });
    }
  }
  const duplicateMemos = new Map(
    [...memoFiles].filter(([, occurrences]) => occurrences.length > 1)
  );
  return { ids, duplicateMemos };
}

/**
 * 同じ id のメモファイルのうち、`readProjectAsync` がノードにしなかったものを
 * 新しい id のノードとして組み立てる。並び順と中身の読み方は
 * `promoteLegacyMemos` に合わせる。`taskDirs` には置き場所を足すので、
 * 画像や添付は元のタスクのディレクトリから取り込まれる。
 */
async function importDuplicateLegacyMemos(projectDir, loaded, duplicateMemos) {
  const nodes = [];
  const memosByOwner = new Map();
  for (const [memoId, occurrences] of duplicateMemos) {
    const kept = loaded.legacyMemoFiles.get(memoId);
    for (const { ownerId, dirName, fileName } of occurrences) {
      if (kept && kept.dirName === dirName && kept.fileName === fileName) continue;
      if (!memosByOwner.has(ownerId))
        memosByOwner.set(
          ownerId,
          await workspace.readTaskMemosAsync(projectDir, ownerId, loaded.taskDirs)
        );
      const memos = memosByOwner.get(ownerId);
      const index = memos.findIndex((memo) => memo.fileName === fileName);
      if (index < 0) throw new Error(`Legacy memo was not imported: ${memoId}`);
      const memo = memos[index];
      const id = crypto.randomUUID();
      nodes.push({
        id,
        name: memo.title || "memo",
        status: undefined,
        parents: [{ id: ownerId, order: workspace.LEGACY_MEMO_ORDER_BASE + index }],
        body: memo.content,
        format: memo.format,
        bodyLoaded: true,
        tags: memo.tags ?? [],
        attachments: [],
        createdAt: loaded.tasks.get(ownerId)?.createdAt || "",
      });
      loaded.taskDirs.set(id, dirName);
    }
  }
  return nodes;
}

async function atomicWriteJson(filePath, value) {
  // 字下げはしない。編集のたびにファイル全体を書くので、字下げの分（約 35%）
  // だけ書き込みと同期（OneDrive など）の量が増える。
  await workspace.atomicWriteFile(filePath, JSON.stringify(value) + "\n", "utf8");
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
 * ワークスペース直下の旧 Markdown プロジェクト（`<dir>/_project.md`）を並び順で返す。
 * グラフの初回作成と、既存グラフへの追加取り込みの両方がこれを使う。
 */
async function listLegacyMarkdownProjects(workspacePath) {
  const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === GRAPH_DIR) continue;
    const projectDir = path.join(workspacePath, entry.name);
    const projectFile = path.join(projectDir, "_project.md");
    let raw;
    try {
      raw = await fs.promises.readFile(projectFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`Cannot read legacy project ${entry.name}: ${error.message}`);
    }
    const metadata = workspace.parseFrontmatter(raw).data;
    if (!metadata.id || typeof metadata.id !== "string")
      throw new Error(`Invalid legacy project: ${entry.name}`);
    projects.push({
      projectDir,
      dirName: entry.name,
      name: typeof metadata.name === "string" && metadata.name ? metadata.name : entry.name,
      rootId: metadata.id,
      order: Number(metadata.order),
      inbox: metadata.kind === "inbox" || entry.name === "_inbox",
    });
  }
  projects.sort(
    (a, b) =>
      (Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER) -
        (Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER) ||
      a.projectDir.localeCompare(b.projectDir)
  );
  return projects;
}

/**
 * 旧 Markdown プロジェクト 1 つを `nodes` へ足し、取り込んだルートの id を返す。
 *
 * ルートの親は呼び出し側が決める（ここでは空にしておく）。画像と添付は
 * 正本の置き場所 `.task-manage/assets/<nodeId>/` へ写す。
 */
async function importLegacyProjectNodes(workspacePath, project, nodes, today) {
  const { ids: expectedIds, duplicateMemos } = await strictProjectPreflight(
    project.projectDir,
    project.rootId
  );
  const loaded = await workspace.readProjectAsync(project.projectDir, {
    includeMemoContent: false,
  });
  const loadedIds = new Set(loaded.tasks.keys());
  for (const id of expectedIds)
    if (!loadedIds.has(id)) throw new Error(`Legacy task was not imported: ${id}`);
  const tasks = [
    ...(await workspace.loadNodeBodiesAsync(
      project.projectDir,
      [...loaded.tasks.values()],
      loaded.taskDirs
    )),
    ...(await importDuplicateLegacyMemos(project.projectDir, loaded, duplicateMemos)),
  ];
  // 旧形式はプロジェクトごとに独立して読んでいたので、id が一意なのは
  // プロジェクトの中だけだった。v0.40 までのエクスポートはルート以外の id を
  // db.json から引き継いだため、同じプロジェクトを 2 回エクスポートすると
  // 別プロジェクトに同じ id が並ぶ。1 つのグラフに入れるときは、後から来た
  // 側に新しい id を振り、同じプロジェクト内の親参照もそれに合わせる。
  const renamed = new Map();
  for (const task of tasks) if (nodes[task.id]) renamed.set(task.id, crypto.randomUUID());
  const importedId = (id) => renamed.get(id) ?? id;
  for (const legacyTask of tasks) {
    const legacyId = legacyTask.id;
    const task = {
      ...legacyTask,
      id: importedId(legacyId),
      parents: (legacyTask.parents || []).map((parent) => ({
        ...parent,
        id: importedId(parent.id),
      })),
    };
    if (nodes[task.id]) throw new Error(`Duplicate node id in legacy workspace: ${task.id}`);
    const canonicalNodeDir = assetDir(workspacePath, task.id);
    const legacyTaskDir =
      loaded.taskDirs.get(legacyId) === "_project"
        ? project.projectDir
        : path.join(project.projectDir, loaded.taskDirs.get(legacyId));
    await copyDirectoryStrict(
      path.join(legacyTaskDir, "assets"),
      path.join(canonicalNodeDir, "assets"),
      project.projectDir
    );
    await copyDirectoryStrict(
      path.join(legacyTaskDir, "attachments"),
      path.join(canonicalNodeDir, "attachments"),
      project.projectDir
    );
    const legacyAssetPrefix = "assets/";
    const canonicalAssetPrefix = `assets/${task.id}/assets/`;
    const attachments = (task.attachments || []).map((attachment) => ({
      ...attachment,
      relativePath: `assets/${task.id}/${String(attachment.relativePath).replace(/^\.\//, "")}`,
    }));
    nodes[task.id] = {
      ...task,
      body: rewriteAssetReferences(
        rewriteAssetReferences(task.body, legacyAssetPrefix, canonicalAssetPrefix),
        "attachments/",
        `assets/${task.id}/attachments/`
      ),
      attachments,
      createdAt: /^\d{4}-\d{2}-\d{2}$/.test(task.createdAt || "") ? task.createdAt : today,
      assetOwnerId: task.id,
      parents: legacyId === project.rootId ? [] : task.parents,
    };
  }
  return importedId(project.rootId);
}

async function importLegacyGraph(workspacePath) {
  const projects = await listLegacyMarkdownProjects(workspacePath);
  const workspaceId = crypto.randomUUID();
  const rootId = `workspace-${workspaceId}`;
  const today = new Date().toISOString().slice(0, 10);
  const nodes = {
    [rootId]: {
      id: rootId,
      name: path.basename(workspacePath) || "Workspace",
      parents: [],
      createdAt: today,
    },
  };
  const importedRootIds = new Map();
  for (const [projectIndex, project] of projects.entries()) {
    const importedRootId = await importLegacyProjectNodes(workspacePath, project, nodes, today);
    importedRootIds.set(project, importedRootId);
    nodes[importedRootId].parents = [
      { id: rootId, order: Number.isFinite(project.order) ? project.order : projectIndex },
    ];
  }
  const graph = { schemaVersion: 1, workspaceId, rootId, revision: 0, nodes };
  const inboxProject = projects.find((project) => project.inbox);
  if (inboxProject) graph.inboxId = importedRootIds.get(inboxProject);
  identifyInbox(graph);
  repairRootReachability(graph);
  validateGraph(graph);
  return graph;
}

/**
 * 履歴の 1 段は「グラフ全体の写し」ではなく「戻すのに要るノードと欄だけ」を持つ。
 *
 * 以前は 1 段ごとにグラフ全体を `undo` に積んでいたので、`graph-v1.json` は
 * グラフの最大 51 倍になった（本文の多い旧ワークスペースで数百 MB）。
 * 名前の変更 1 回ごとにそれを丸ごと読み直して書き直すため、操作のたびに
 * 数秒止まっていた。
 *
 * パッチの形: `{ nodes: { [id]: node | null }, fields: { [key]: { value } | null } }`。
 * `null` は「その時点では無かった」を表す。`revision` は戻しても巻き戻さない
 * （古いリビジョンを持つ画面が上書きしないよう、常に増やす）。
 */
/** ディスクに書いたものと同じ形の写し（`undefined` の欄は消える）。 */
function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

/** `from` と `to` で中身が違うノード id と、ノード以外の欄の名前。 */
function changedParts(from, to) {
  const nodeIds = [];
  for (const id of new Set([...Object.keys(from.nodes), ...Object.keys(to.nodes)])) {
    const before = from.nodes[id];
    const after = to.nodes[id];
    if (before === after) continue;
    if (!before || !after || JSON.stringify(before) !== JSON.stringify(after)) nodeIds.push(id);
  }
  const fieldKeys = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter(
    (key) =>
      key !== "nodes" && key !== "revision" && JSON.stringify(from[key]) !== JSON.stringify(to[key])
  );
  return { nodeIds, fieldKeys };
}

/** `parts` に挙がった部分を `source` の値にするパッチ。 */
function patchFrom(source, { nodeIds, fieldKeys }) {
  const patch = { nodes: {}, fields: {} };
  for (const id of nodeIds)
    patch.nodes[id] = source.nodes[id] === undefined ? null : jsonCopy(source.nodes[id]);
  for (const key of fieldKeys)
    patch.fields[key] = source[key] === undefined ? null : { value: jsonCopy(source[key]) };
  return patch;
}

/** `from` を `to` にするパッチ。 */
function diffGraphs(from, to) {
  return patchFrom(to, changedParts(from, to));
}

/** `patch` を `graph` にその場で当て、当てる前へ戻すパッチを返す。 */
function applyGraphPatch(graph, patch) {
  const inverse = { nodes: {}, fields: {} };
  for (const [id, node] of Object.entries(patch.nodes)) {
    inverse.nodes[id] = graph.nodes[id] ?? null;
    if (node === null) delete graph.nodes[id];
    else graph.nodes[id] = jsonCopy(node);
  }
  for (const [key, entry] of Object.entries(patch.fields)) {
    inverse.fields[key] = key in graph ? { value: graph[key] } : null;
    if (entry === null) delete graph[key];
    else graph[key] = jsonCopy(entry.value);
  }
  return inverse;
}

function isGraphPatch(entry) {
  return Boolean(entry && entry.nodes && entry.fields && !("rootId" in entry));
}

/**
 * 以前の形式（1 段 = グラフ全体）の履歴をパッチに置き換える。
 * `undo` の末尾が直前の状態、`redo` の末尾が次の状態。どちらも隣の段
 * （末尾は現在のグラフ）からの差分にする。
 */
function migrateSnapshotHistory(document) {
  const convert = (stack) => {
    if (stack.every(isGraphPatch)) return stack;
    const patches = new Array(stack.length);
    let next = document.graph;
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const entry = stack[index];
      if (isGraphPatch(entry)) {
        // 形式が混ざることはないはずだが、混ざっていても段を落とさない。
        const state = structuredClone(next);
        applyGraphPatch(state, entry);
        patches[index] = entry;
        next = state;
      } else {
        patches[index] = diffGraphs(next, entry);
        next = entry;
      }
    }
    return patches;
  };
  const undo = document.undo || [];
  const redo = document.redo || [];
  document.undo = convert(undo);
  document.redo = convert(redo);
  return document.undo !== undo || document.redo !== redo;
}

/**
 * ワークスペースごとの読み出し結果。ファイルの更新時刻と大きさが変わって
 * いなければ、読み直さずにこれを使う（別プロセスや同期ソフトが書き換えたら
 * 読み直す）。書き込みに失敗したときは捨てる。
 */
const documentCache = new Map();

async function readDocument(workspacePath) {
  const filePath = graphPath(workspacePath);
  const key = workspaceQueueKey(workspacePath);
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    documentCache.delete(key);
    const graph = await importLegacyGraph(workspacePath);
    const document = { schemaVersion: 1, graph, undo: [], redo: [] };
    await writeDocument(workspacePath, document);
    return document;
  }
  const cached = documentCache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size)
    return cached.document;
  documentCache.delete(key);
  const document = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  identifyInbox(document.graph);
  validateGraph(document.graph);
  if (migrateSnapshotHistory(document)) {
    // 変換した結果をすぐ書き戻す。書かないと、次に編集するまで起動のたびに
    // 大きな旧形式のファイルを読み直すことになる。書けなくても読み出しは
    // 成功させる（次の編集で改めて書く）。
    try {
      await writeDocument(workspacePath, document);
    } catch {
      documentCache.delete(key);
    }
    return document;
  }
  documentCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, document });
  return document;
}

async function writeDocument(workspacePath, document) {
  const filePath = graphPath(workspacePath);
  const key = workspaceQueueKey(workspacePath);
  documentCache.delete(key);
  await atomicWriteJson(filePath, document);
  const stat = await fs.promises.stat(filePath);
  documentCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, document });
}

/**
 * レンダラーへ渡す graph に、永続化しない「元に戻す / やり直しの残り段数」を
 * 添える。
 *
 * 履歴は `graph-v1.json` の `undo` / `redo` 配列にあり、これまでレンダラーには
 * `graph` しか渡っていなかった。そのためツールバーの「元に戻す」「やり直し」は
 * 履歴が空でも常に有効で、押しても何も起きなかった。
 *
 * `document.graph` 自体には足さない。足すとそのままディスクへ書かれてしまう。
 * ここで作る浅いコピーは読み出し専用の経路（read / execute / history の戻り値と
 * ブロードキャスト）にしか流れず、書き戻しには使われない。
 */
function withHistoryDepth(document) {
  return {
    ...document.graph,
    history: { undo: document.undo.length, redo: document.redo.length },
  };
}

async function readWorkspaceGraph(workspacePath) {
  return enqueue(workspacePath, async () => withHistoryDepth(await readDocument(workspacePath)));
}

async function mutate(workspacePath, expectedRevision, action) {
  return enqueue(workspacePath, async () => {
    const document = await readDocument(workspacePath);
    if (Number.isFinite(expectedRevision) && document.graph.revision !== expectedRevision) {
      throw new Error(
        `Workspace graph changed (expected revision ${expectedRevision}, found ${document.graph.revision})`
      );
    }
    // エンジンは渡したグラフを書き換えず、新しいグラフを返す。
    const before = document.graph;
    const history = { undo: document.undo, redo: document.redo };
    try {
      const result = await action(document);
      // エンジンを通った操作はエンジンが確かめ済み。ここで全体をもう一度
      // 確かめると、1 回の操作ごとにノード数ぶんの仕事が増える。
      if (!result?.validated) validateGraph(document.graph);
      // 変わったノードだけ JSON を通した写しに差し替え、読み出し結果を
      // ディスク上の内容と同じ形に保つ。
      const changed = changedParts(before, document.graph);
      applyGraphPatch(document.graph, patchFrom(document.graph, changed));
      document.undo = [...document.undo, patchFrom(before, changed)].slice(-HISTORY_LIMIT);
      document.redo = [];
      await writeDocument(workspacePath, document);
      const { validated: _validated, ...rest } = result ?? {};
      return { ...rest, graph: withHistoryDepth(document) };
    } catch (error) {
      // 読み出し結果を共有しているので、失敗したら手元の変更も戻す。
      document.graph = before;
      document.undo = history.undo;
      document.redo = history.redo;
      documentCache.delete(workspaceQueueKey(workspacePath));
      throw error;
    }
  });
}

async function executeWorkspaceGraphCommand(workspacePath, command, origin, expectedRevision) {
  return mutate(workspacePath, expectedRevision, async (document) => {
    const result = executeGraphCommand(document.graph, command, origin);
    document.graph = result.graph;
    for (const [copyId, sourceId] of Object.entries(result.copiedFrom || {})) {
      const source = document.graph.nodes[sourceId];
      const copy = document.graph.nodes[copyId];
      const ownerId = source?.assetOwnerId || sourceId;
      await copyDirectoryStrict(
        assetDir(workspacePath, ownerId),
        assetDir(workspacePath, copyId),
        path.join(workspacePath, GRAPH_DIR)
      );
      copy.body = rewriteAssetReferences(copy.body, `assets/${ownerId}/`, `assets/${copyId}/`);
      copy.attachments = (copy.attachments || []).map((attachment) => ({
        ...attachment,
        relativePath: String(attachment.relativePath).replace(
          `assets/${ownerId}/`,
          `assets/${copyId}/`
        ),
      }));
      copy.assetOwnerId = copyId;
    }
    return { selectedNodeIds: result.selectedNodeIds, validated: true };
  });
}

async function changeHistory(workspacePath, direction, expectedRevision) {
  return enqueue(workspacePath, async () => {
    const document = await readDocument(workspacePath);
    if (Number.isFinite(expectedRevision) && document.graph.revision !== expectedRevision)
      throw new Error("Workspace graph changed");
    const source = direction === "undo" ? document.undo : document.redo;
    const target = direction === "undo" ? document.redo : document.undo;
    if (!source.length) return { graph: withHistoryDepth(document), changed: false };
    const before = document.graph;
    const history = { undo: document.undo, redo: document.redo };
    try {
      // パッチはノードの表と最上位の欄を置き換えるだけなので、浅い写しで
      // 足りる（もとのグラフは書き換えない）。
      const restored = { ...before, nodes: { ...before.nodes } };
      const patch = source[source.length - 1];
      const inverse = applyGraphPatch(restored, patch);
      restored.revision = before.revision + 1;
      validateGraph(restored);
      document.graph = restored;
      if (direction === "undo") {
        document.undo = source.slice(0, -1);
        document.redo = [...target, inverse];
      } else {
        document.redo = source.slice(0, -1);
        document.undo = [...target, inverse];
      }
      await writeDocument(workspacePath, document);
      return { graph: withHistoryDepth(document), changed: true };
    } catch (error) {
      document.graph = before;
      document.undo = history.undo;
      document.redo = history.redo;
      documentCache.delete(workspaceQueueKey(workspacePath));
      throw error;
    }
  });
}

async function saveNodeAsset(workspacePath, nodeId, fileName, bytes) {
  const graph = await readWorkspaceGraph(workspacePath);
  if (!graph.nodes[nodeId]) throw new Error("Unknown node");
  const safeName = path
    .basename(String(fileName || "attachment"))
    // eslint-disable-next-line no-control-regex -- Windows では制御文字をファイル名に使えない
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "");
  if (!safeName || safeName === "." || safeName === "..") throw new Error("Invalid file name");
  const dir = assetDir(workspacePath, nodeId);
  await fs.promises.mkdir(dir, { recursive: true });
  const destination = path.join(dir, `${crypto.randomUUID()}-${safeName}`);
  await fs.promises.writeFile(destination, Buffer.from(bytes));
  return {
    relativePath: path
      .relative(path.join(workspacePath, GRAPH_DIR), destination)
      .split(path.sep)
      .join("/"),
  };
}

async function resolveNodeAsset(workspacePath, nodeId, relativePath) {
  const graph = await readWorkspaceGraph(workspacePath);
  const node = graph.nodes[nodeId];
  if (!node) throw new Error("Unknown node");
  const normalized = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  const ownerId = node.assetOwnerId || nodeId;
  const canonicalPrefix = `assets/${ownerId}/`;
  if (
    !normalized.startsWith(canonicalPrefix) &&
    (normalized.startsWith("assets/") || normalized.startsWith("attachments/")) &&
    node.sourceProjectDir
  ) {
    const projectReal = await fs.promises.realpath(node.sourceProjectDir);
    const taskBase =
      node.sourceTaskDir === "_project"
        ? node.sourceProjectDir
        : path.join(node.sourceProjectDir, node.sourceTaskDir || "");
    const candidate = path.resolve(taskBase, normalized);
    const real = await fs.promises.realpath(candidate);
    if (real !== projectReal && !real.startsWith(projectReal + path.sep))
      throw new Error("Legacy asset escapes project");
    if (!(await fs.promises.lstat(real)).isFile()) throw new Error("Asset is not a file");
    return real;
  }
  const base = path.resolve(path.join(workspacePath, GRAPH_DIR));
  const resolved = path.resolve(base, normalized);
  if (resolved !== base && !resolved.startsWith(base + path.sep))
    throw new Error("Asset path escapes workspace graph storage");
  if (!resolved.startsWith(path.resolve(assetDir(workspacePath, ownerId)) + path.sep))
    throw new Error("Asset does not belong to node");
  const realBase = await fs.promises.realpath(base);
  const real = await fs.promises.realpath(resolved);
  if (!real.startsWith(realBase + path.sep))
    throw new Error("Asset escapes workspace graph storage");
  if (!(await fs.promises.lstat(real)).isFile()) throw new Error("Asset is not a file");
  return real;
}

function nextRootOrder(graph) {
  let max = -1;
  for (const node of Object.values(graph.nodes)) {
    const link = (node.parents || []).find((parent) => parent.id === graph.rootId);
    if (Number.isFinite(link?.order)) max = Math.max(max, link.order);
  }
  return max + 1;
}

/**
 * グラフへ取り込めるワークスペース直下の旧 Markdown プロジェクト。
 *
 * グラフの初回作成で取り込まれたものも並ぶので、`imported` で区別する。
 * 後から置かれた（別の PC や別ワークスペースから写した）プロジェクトを
 * 既存のグラフへ足すために使う。
 */
async function listMarkdownImportSources(workspacePath) {
  const graph = await readWorkspaceGraph(workspacePath);
  const nodes = Object.values(graph.nodes);
  const sources = new Set(nodes.map((node) => node.importSource).filter(Boolean));
  return (await listLegacyMarkdownProjects(workspacePath)).map((project) => ({
    dirName: project.dirName,
    name: project.name,
    imported: Boolean(graph.nodes[project.rootId]) || sources.has(`markdown:${project.rootId}`),
  }));
}

/**
 * 旧 Markdown プロジェクトを既存のグラフへ、ワークスペースのルート直下の
 * ノードとして足す。
 *
 * 1 回の取り込みは 1 つの操作として保存され、「元に戻す」で取り消せる。
 * 取り込み元の Markdown ファイルは書き換えない。
 */
async function importMarkdownProjects(workspacePath, markdownDirs = [], expectedRevision) {
  return mutate(workspacePath, expectedRevision, async (document) => {
    const graph = structuredClone(document.graph);
    const today = new Date().toISOString().slice(0, 10);
    const selectedNodeIds = [];
    const attach = (rootId, importSource) => {
      graph.nodes[rootId].parents = [{ id: graph.rootId, order: nextRootOrder(graph) }];
      graph.nodes[rootId].importSource = importSource;
      selectedNodeIds.push(rootId);
    };
    const projects = await listLegacyMarkdownProjects(workspacePath);
    for (const dirName of markdownDirs) {
      const project = projects.find((item) => item.dirName === dirName);
      if (!project) throw new Error(`Markdown project not found: ${dirName}`);
      const rootId = await importLegacyProjectNodes(workspacePath, project, graph.nodes, today);
      attach(rootId, `markdown:${project.rootId}`);
    }
    if (!selectedNodeIds.length) throw new Error("取り込むプロジェクトが選ばれていません。");
    graph.revision = (graph.revision || 0) + 1;
    document.graph = graph;
    return { selectedNodeIds };
  });
}

/** 書き込み待ちのグラフ操作があるか。 */
function hasPendingWrites() {
  return queues.size > 0;
}

/** いま待ち行列にあるグラフ操作がすべて終わるまで待つ。 */
async function whenIdle() {
  while (queues.size) await Promise.all([...queues.values()]);
}

function isGraphActive(workspacePath) {
  return fs.existsSync(graphPath(workspacePath));
}

module.exports = {
  readWorkspaceGraph,
  executeWorkspaceGraphCommand,
  undoWorkspaceGraph: (workspacePath, revision) => changeHistory(workspacePath, "undo", revision),
  redoWorkspaceGraph: (workspacePath, revision) => changeHistory(workspacePath, "redo", revision),
  listMarkdownImportSources,
  importMarkdownProjects,
  saveNodeAsset,
  resolveNodeAsset,
  isGraphActive,
  hasPendingWrites,
  whenIdle,
  graphPath,
};
