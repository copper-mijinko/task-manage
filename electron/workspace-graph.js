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

async function strictProjectPreflight(projectDir, rootId) {
  const ids = new Set([rootId]);
  const entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  const nodeDirectories = [{ dir: projectDir, reserved: "_project.md" }];
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
    nodeDirectories.push({ dir: path.join(projectDir, entry.name), reserved: "_index.md" });
  }
  for (const { dir, reserved } of nodeDirectories) {
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
      if (ids.has(id)) throw new Error(`Duplicate legacy memo node id: ${id}`);
      ids.add(id);
    }
  }
  return ids;
}

async function atomicWriteJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.promises.rename(tmp, filePath);
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

async function importLegacyGraph(workspacePath) {
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
  for (const [projectIndex, project] of projects.entries()) {
    const expectedIds = await strictProjectPreflight(project.projectDir, project.rootId);
    const loaded = await workspace.readProjectAsync(project.projectDir, {
      includeMemoContent: false,
    });
    const loadedIds = new Set(loaded.tasks.keys());
    for (const id of expectedIds)
      if (!loadedIds.has(id)) throw new Error(`Legacy task was not imported: ${id}`);
    const tasks = await workspace.loadNodeBodiesAsync(
      project.projectDir,
      [...loaded.tasks.values()],
      loaded.taskDirs
    );
    for (const task of tasks) {
      if (nodes[task.id]) throw new Error(`Duplicate node id in legacy workspace: ${task.id}`);
      const canonicalNodeDir = assetDir(workspacePath, task.id);
      const legacyTaskDir =
        loaded.taskDirs.get(task.id) === "_project"
          ? project.projectDir
          : path.join(project.projectDir, loaded.taskDirs.get(task.id));
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
        parents:
          task.id === project.rootId
            ? [{ id: rootId, order: Number.isFinite(project.order) ? project.order : projectIndex }]
            : task.parents,
      };
    }
  }
  const graph = { schemaVersion: 1, workspaceId, rootId, revision: 0, nodes };
  const inboxProject = projects.find((project) => project.inbox);
  if (inboxProject) graph.inboxId = inboxProject.rootId;
  identifyInbox(graph);
  repairRootReachability(graph);
  validateGraph(graph);
  return graph;
}

async function readDocument(workspacePath) {
  const filePath = graphPath(workspacePath);
  try {
    const document = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    identifyInbox(document.graph);
    validateGraph(document.graph);
    return document;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const graph = await importLegacyGraph(workspacePath);
    const document = { schemaVersion: 1, graph, undo: [], redo: [] };
    await atomicWriteJson(filePath, document);
    return document;
  }
}

async function readWorkspaceGraph(workspacePath) {
  return enqueue(workspacePath, async () => (await readDocument(workspacePath)).graph);
}

async function mutate(workspacePath, expectedRevision, action) {
  return enqueue(workspacePath, async () => {
    const document = await readDocument(workspacePath);
    if (Number.isFinite(expectedRevision) && document.graph.revision !== expectedRevision) {
      throw new Error(
        `Workspace graph changed (expected revision ${expectedRevision}, found ${document.graph.revision})`
      );
    }
    const before = structuredClone(document.graph);
    const result = await action(document);
    validateGraph(document.graph);
    document.undo.push(before);
    if (document.undo.length > HISTORY_LIMIT) document.undo.shift();
    document.redo = [];
    await atomicWriteJson(graphPath(workspacePath), document);
    return { ...result, graph: document.graph };
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
    return { selectedNodeIds: result.selectedNodeIds };
  });
}

async function changeHistory(workspacePath, direction, expectedRevision) {
  return enqueue(workspacePath, async () => {
    const document = await readDocument(workspacePath);
    if (Number.isFinite(expectedRevision) && document.graph.revision !== expectedRevision)
      throw new Error("Workspace graph changed");
    const source = direction === "undo" ? document.undo : document.redo;
    const target = direction === "undo" ? document.redo : document.undo;
    if (!source.length) return { graph: document.graph, changed: false };
    const restored = source.pop();
    target.push(structuredClone(document.graph));
    restored.revision = document.graph.revision + 1;
    validateGraph(restored);
    document.graph = restored;
    await atomicWriteJson(graphPath(workspacePath), document);
    return { graph: document.graph, changed: true };
  });
}

async function saveNodeAsset(workspacePath, nodeId, fileName, bytes) {
  const graph = await readWorkspaceGraph(workspacePath);
  if (!graph.nodes[nodeId]) throw new Error("Unknown node");
  const safeName = path
    .basename(String(fileName || "attachment"))
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

function isGraphActive(workspacePath) {
  return fs.existsSync(graphPath(workspacePath));
}

module.exports = {
  readWorkspaceGraph,
  executeWorkspaceGraphCommand,
  undoWorkspaceGraph: (workspacePath, revision) => changeHistory(workspacePath, "undo", revision),
  redoWorkspaceGraph: (workspacePath, revision) => changeHistory(workspacePath, "redo", revision),
  saveNodeAsset,
  resolveNodeAsset,
  isGraphActive,
  graphPath,
};
