/**
 * ワークスペースのフォルダーを読んで、グラフを組み立てる。
 *
 * 置き場所は旧 Markdown 形式と同じ。
 *
 * ```
 * <workspace>/
 *   _workspace.md            ワークスペース自身（ルートノード）
 *   <project>/_project.md    プロジェクトのルートノード
 *   <project>/<id>/_index.md 通常のノード
 *   <dir>/assets/            本文の画像、<dir>/attachments/ 添付ファイル
 *   .task-manage/            アプリの作業用（履歴・ごみ箱・グラフビューの座標）
 * ```
 *
 * 読みは 2 段に分ける。
 * 1. `gatherWorkspace`（I/O）: フォルダーを歩いて、ファイルの中身をそのまま集める。
 * 2. `assembleWorkspace`（純粋）: 集めた中身からグラフを作る。読み込み時の修復
 *    （重複 id・存在しない親・ルートから辿れないノード）もここ。
 *
 * 2 が I/O を持たないので、同じ規則をテストやツールから同期の読みでも使える
 * （`gatherWorkspaceSync`）。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildMemoEntry, sortMemoEntries, LEGACY_MEMO_ORDER_BASE } = require("../workspace");
const {
  identifyInbox,
  repairRootReachability,
  validateGraph,
} = require("../workspace-graph-engine");
const { parseNodeFile } = require("./node-file");

const STORE_DIR = ".task-manage";
const WORKSPACE_FILE = "_workspace.md";
const PROJECT_FILE = "_project.md";
const NODE_FILE = "_index.md";
const LAYOUT_FILE = "layout.json";
/** ノードのフォルダーではない名前（ノードの画像・添付の置き場所）。 */
const FILE_DIRS = new Set(["assets", "attachments"]);

/** 同時に開くファイル操作の上限（多すぎると EMFILE になる）。 */
const IO_CONCURRENCY = 32;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function isHiddenName(name) {
  return name.startsWith(".");
}

/** ワークスペース直下で、プロジェクトのフォルダーとして調べる名前か。 */
function isProjectDirName(name) {
  return !isHiddenName(name) && !FILE_DIRS.has(name) && name !== "node_modules";
}

/** プロジェクトの中で、ノードのフォルダーとして調べる名前か（`_` 始まりは予約）。 */
function isNodeDirName(name) {
  return !isHiddenName(name) && !name.startsWith("_") && !FILE_DIRS.has(name);
}

/** frontmatter に `attachments:` が書いてあるか（添付フォルダーを読むかの判断）。 */
function hasAttachmentsKey(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return Boolean(match && /^attachments:/m.test(match[1]));
}

/**
 * @typedef {object} RawNodeDir
 * @property {string} rel ワークスペースからの相対パス（`/` 区切り。ワークスペース自身は ""）
 * @property {string | null} text 予約ファイル（`_workspace.md` など）の中身
 * @property {{ fileName: string, text: string }[]} memos 旧メモ（それ以外の `.md`）
 * @property {{ name: string, size: number }[] | null} attachmentFiles 添付フォルダーの中身
 */

/**
 * @typedef {object} RawWorkspace
 * @property {RawNodeDir} workspace
 * @property {{ rel: string, project: RawNodeDir, nodes: RawNodeDir[] }[]} projects
 * @property {string | null} layoutText
 */

/** 同時実行数を制限する。 */
function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  };
  return async (task) => {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

function isMissing(error) {
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

/** 1 回で読み切る大きさ。ノードのファイルはほとんどこれに収まる。 */
const SMALL_FILE_BYTES = 64 * 1024;

/**
 * ファイルを文字列で読む。小さいファイルは open・read・close の 3 回で済ませる
 * （`fs.promises.readFile` は fstat も挟み、スレッドプールとの往復が 1 回多い。
 * 数千ファイルを読む起動時に効く）。読み切れなかった大きいファイルは普通に読み直す。
 */
function readSmallText(filePath) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, "r", (openError, fd) => {
      if (openError) {
        reject(openError);
        return;
      }
      const buffer = Buffer.allocUnsafe(SMALL_FILE_BYTES);
      fs.read(fd, buffer, 0, SMALL_FILE_BYTES, 0, (readError, bytesRead) => {
        fs.close(fd, () => {
          if (readError) reject(readError);
          else if (bytesRead < SMALL_FILE_BYTES) resolve(buffer.toString("utf8", 0, bytesRead));
          else fs.promises.readFile(filePath, "utf8").then(resolve, reject);
        });
      });
    });
  });
}

/** 非同期の読み（ファイル操作はまとめて同時実行数を制限する）。 */
function createAsyncReader() {
  const limit = createLimiter(IO_CONCURRENCY);
  return {
    async readText(filePath) {
      try {
        return await limit(() => readSmallText(filePath));
      } catch (error) {
        if (isMissing(error)) return null;
        throw new Error(`ファイルを読めませんでした: ${filePath}（${error.message}）`);
      }
    },
    async readDirents(dirPath) {
      try {
        return await limit(() => fs.promises.readdir(dirPath, { withFileTypes: true }));
      } catch (error) {
        if (isMissing(error)) return null;
        throw new Error(`フォルダーを読めませんでした: ${dirPath}（${error.message}）`);
      }
    },
    async fileSize(filePath) {
      return (await limit(() => fs.promises.stat(filePath))).size;
    },
  };
}

/** 同期の読み（テストとツール用）。`createAsyncReader` と同じ形で、値をそのまま返す。 */
function createSyncReader() {
  return {
    readText(filePath) {
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    readDirents(dirPath) {
      try {
        return fs.readdirSync(dirPath, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    fileSize(filePath) {
      return fs.statSync(filePath).size;
    },
  };
}

/**
 * ノード 1 つぶんのフォルダー（予約ファイル・旧メモ・添付フォルダー）を読む。
 * `reader` は同期・非同期のどちらでもよい（結果は `await` で受ける）。
 */
async function readNodeDir(reader, absDir, rel, reservedName, { memos }, knownEntries) {
  const entries = knownEntries ?? (await reader.readDirents(absDir));
  /** @type {RawNodeDir} */
  const result = { rel, text: null, memos: [], attachmentFiles: null };
  if (!entries) return result;
  const names = new Set(entries.map((entry) => entry.name));
  if (names.has(reservedName)) result.text = await reader.readText(path.join(absDir, reservedName));
  if (result.text === null) return result;
  if (memos) {
    const memoNames = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".md") &&
          entry.name !== reservedName &&
          !isHiddenName(entry.name)
      )
      .map((entry) => entry.name)
      .sort(compare);
    const read = await Promise.all(
      memoNames.map(async (fileName) => ({
        fileName,
        text: await reader.readText(path.join(absDir, fileName)),
      }))
    );
    result.memos = read.filter((memo) => memo.text !== null);
  }
  // 旧形式のノードは添付の一覧を持たず、フォルダーの中身が一覧になる。
  if (names.has("attachments") && !hasAttachmentsKey(result.text)) {
    const files = (await reader.readDirents(path.join(absDir, "attachments"))) ?? [];
    result.attachmentFiles = await Promise.all(
      files
        .filter((entry) => entry.isFile())
        .map(async (entry) => ({
          name: entry.name,
          size: await reader.fileSize(path.join(absDir, "attachments", entry.name)),
        }))
    );
  }
  return result;
}

async function gatherWith(reader, workspacePath) {
  const top = await reader.readDirents(workspacePath);
  if (!top) throw new Error(`ワークスペースのフォルダーが見つかりません: ${workspacePath}`);
  const workspace = await readNodeDir(reader, workspacePath, "", WORKSPACE_FILE, { memos: false });
  const dirNames = top
    .filter((entry) => entry.isDirectory() && isProjectDirName(entry.name))
    .map((entry) => entry.name)
    .sort(compare);

  const projects = await Promise.all(
    dirNames.map(async (name) => {
      const projectAbs = path.join(workspacePath, name);
      const entries = (await reader.readDirents(projectAbs)) ?? [];
      const project = await readNodeDir(
        reader,
        projectAbs,
        name,
        PROJECT_FILE,
        { memos: true },
        entries
      );
      const nodeDirNames = entries
        .filter((entry) => entry.isDirectory() && isNodeDirName(entry.name))
        .map((entry) => entry.name)
        .sort(compare);
      const nodes = await Promise.all(
        nodeDirNames.map((nodeName) =>
          readNodeDir(reader, path.join(projectAbs, nodeName), `${name}/${nodeName}`, NODE_FILE, {
            memos: true,
          })
        )
      );
      return { rel: name, project, nodes: nodes.filter((node) => node.text !== null) };
    })
  );

  return {
    workspace,
    projects: projects.filter((entry) => entry.project.text !== null || entry.nodes.length > 0),
    layoutText: await reader.readText(path.join(workspacePath, STORE_DIR, LAYOUT_FILE)),
  };
}

/**
 * フォルダーを歩いて、ファイルの中身を集める。
 *
 * @param {string} workspacePath
 * @returns {Promise<RawWorkspace>}
 */
function gatherWorkspace(workspacePath) {
  return gatherWith(createAsyncReader(), workspacePath);
}

/**
 * `gatherWorkspace` の同期版（テストとツール用。読む規則は同じ）。
 * 同期の読みは Promise を使わずに値を返すので、ここでは `await` を経由せず
 * 同じ手順を同期で実行する。
 *
 * @param {string} workspacePath
 * @returns {RawWorkspace}
 */
function gatherWorkspaceSync(workspacePath) {
  const reader = createSyncReader();
  const readNodeDirSync = (absDir, rel, reservedName, { memos }, knownEntries) => {
    const entries = knownEntries ?? reader.readDirents(absDir);
    /** @type {RawNodeDir} */
    const result = { rel, text: null, memos: [], attachmentFiles: null };
    if (!entries) return result;
    const names = new Set(entries.map((entry) => entry.name));
    if (names.has(reservedName)) result.text = reader.readText(path.join(absDir, reservedName));
    if (result.text === null) return result;
    if (memos) {
      result.memos = entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".md") &&
            entry.name !== reservedName &&
            !isHiddenName(entry.name)
        )
        .map((entry) => entry.name)
        .sort(compare)
        .map((fileName) => ({ fileName, text: reader.readText(path.join(absDir, fileName)) }))
        .filter((memo) => memo.text !== null);
    }
    if (names.has("attachments") && !hasAttachmentsKey(result.text)) {
      result.attachmentFiles = (reader.readDirents(path.join(absDir, "attachments")) ?? [])
        .filter((entry) => entry.isFile())
        .map((entry) => ({
          name: entry.name,
          size: reader.fileSize(path.join(absDir, "attachments", entry.name)),
        }));
    }
    return result;
  };

  const top = reader.readDirents(workspacePath);
  if (!top) throw new Error(`ワークスペースのフォルダーが見つかりません: ${workspacePath}`);
  const workspace = readNodeDirSync(workspacePath, "", WORKSPACE_FILE, { memos: false });
  const projects = top
    .filter((entry) => entry.isDirectory() && isProjectDirName(entry.name))
    .map((entry) => entry.name)
    .sort(compare)
    .map((name) => {
      const projectAbs = path.join(workspacePath, name);
      const entries = reader.readDirents(projectAbs) ?? [];
      const project = readNodeDirSync(projectAbs, name, PROJECT_FILE, { memos: true }, entries);
      const nodes = entries
        .filter((entry) => entry.isDirectory() && isNodeDirName(entry.name))
        .map((entry) => entry.name)
        .sort(compare)
        .map((nodeName) =>
          readNodeDirSync(path.join(projectAbs, nodeName), `${name}/${nodeName}`, NODE_FILE, {
            memos: true,
          })
        )
        .filter((node) => node.text !== null);
      return { rel: name, project, nodes };
    })
    .filter((entry) => entry.project.text !== null || entry.nodes.length > 0);
  return {
    workspace,
    projects,
    layoutText: reader.readText(path.join(workspacePath, STORE_DIR, LAYOUT_FILE)),
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** 重複した id の置き換え先。ファイルの場所から決めるので、読むたびに同じ値になる。 */
function derivedId(fileRel, id, taken) {
  for (let salt = 0; ; salt += 1) {
    const candidate = `dup-${sha1(`${fileRel}\0${id}\0${salt}`).slice(0, 24)}`;
    if (!taken(candidate)) return candidate;
  }
}

/** 添付の一覧。ファイルに書いてあればそれ、無ければ添付フォルダーの中身。 */
function attachmentsFor(parsedNode, dirRaw) {
  if (parsedNode.attachments) return parsedNode.attachments;
  return (dirRaw.attachmentFiles ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((entry) => ({
      id: `./attachments/${entry.name}`,
      name: entry.name,
      relativePath: `./attachments/${entry.name}`,
      size: entry.size,
    }));
}

/** 並び順の無い辺に、兄弟の末尾からの連番を付ける（id の昇順）。 */
function fillMissingOrders(graph) {
  const children = new Map();
  for (const node of Object.values(graph.nodes)) {
    for (const link of node.parents) {
      if (!children.has(link.id)) children.set(link.id, []);
      children.get(link.id).push({ node, link });
    }
  }
  for (const entries of children.values()) {
    const missing = entries.filter(({ link }) => !Number.isFinite(link.order));
    if (missing.length === 0) continue;
    // 旧メモの並び順（大きな基点から）は数えない。実際の子の後ろに旧メモが来る。
    let next =
      Math.max(
        -1,
        ...entries
          .filter(({ link }) => Number.isFinite(link.order) && link.order < LEGACY_MEMO_ORDER_BASE)
          .map(({ link }) => link.order)
      ) + 1;
    for (const { link } of missing.sort((a, b) => compare(a.node.id, b.node.id))) {
      link.order = next;
      next += 1;
    }
  }
}

/**
 * 集めた中身から、グラフを組み立てる。
 *
 * @param {RawWorkspace} raw
 * @param {{ workspacePath: string }} options
 */
function assembleWorkspace(raw, { workspacePath }) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Record<string, any>} */
  const nodes = {};
  /** @type {Map<string, { dir: string, file: string, memo?: boolean }>} */
  const locations = new Map();
  /** @type {Map<string, { hash?: string, attachmentKey: boolean }>} */
  const fileInfo = new Map();
  /** ノードが属するプロジェクトのルート（親を失ったノードの行き先）。 */
  const homeRoot = new Map();
  /** 読み込み時に書き直すノード（重複 id を振り直したもの）。 */
  const dirtyIds = new Set();

  // ── ワークスペース自身 ───────────────────────────────────────────────
  let rootNode;
  let rootCreated = false;
  const parsedRoot = raw.workspace.text === null ? null : parseNodeFile(raw.workspace.text);
  if (parsedRoot) {
    rootNode = { ...parsedRoot.node, parents: [] };
    // ルートはアーカイブできない。手で書かれていても無視する。
    if (rootNode.archived || rootNode.archivedAt) {
      delete rootNode.archived;
      delete rootNode.archivedAt;
      warnings.push(`${WORKSPACE_FILE}: ワークスペースはアーカイブできないため無視しました`);
    }
    if (!rootNode.createdAt) rootNode.createdAt = today();
    rootNode.attachments = attachmentsFor(rootNode, raw.workspace);
    fileInfo.set(rootNode.id, {
      hash: sha1(raw.workspace.text),
      attachmentKey: parsedRoot.hasAttachments || rootNode.attachments.length > 0,
    });
    warnings.push(...parsedRoot.warnings.map((message) => `${WORKSPACE_FILE}: ${message}`));
  } else {
    if (raw.workspace.text !== null)
      warnings.push(`${WORKSPACE_FILE} を読めませんでした（id がありません）`);
    rootCreated = true;
    rootNode = {
      id: `workspace-${crypto.randomUUID()}`,
      name: path.basename(workspacePath) || "Workspace",
      parents: [],
      createdAt: today(),
    };
  }
  nodes[rootNode.id] = rootNode;
  locations.set(rootNode.id, { dir: "", file: WORKSPACE_FILE });
  const rootId = rootNode.id;
  let inboxId;

  // ── プロジェクトごと ─────────────────────────────────────────────────
  raw.projects.forEach((projectRaw, projectIndex) => {
    /** @type {{ parsed: any, dirRaw: RawNodeDir, file: string, isRoot: boolean }[]} */
    const files = [];
    const add = (dirRaw, file, isRoot) => {
      const parsed = dirRaw.text === null ? null : parseNodeFile(dirRaw.text);
      if (!parsed) {
        if (dirRaw.text !== null)
          warnings.push(`${dirRaw.rel}/${file} を読めませんでした（id がありません）`);
        return;
      }
      warnings.push(...parsed.warnings.map((message) => `${dirRaw.rel}/${file}: ${message}`));
      files.push({ parsed, dirRaw, file, isRoot });
    };
    add(projectRaw.project, PROJECT_FILE, true);
    for (const nodeRaw of projectRaw.nodes) add(nodeRaw, NODE_FILE, false);

    // id の重複を振り直す。別のプロジェクトと重なったときは、このプロジェクトの
    // 中の参照もまとめて新しい id に向ける（旧形式では id はプロジェクトの中でだけ
    // 一意だった）。同じプロジェクトの中で重なったときは、先に読んだ方が元の id を持つ。
    const seenOriginal = new Set();
    const taken = new Set();
    const referenceRemap = new Map();
    const isTaken = (id) => Boolean(nodes[id]) || taken.has(id) || seenOriginal.has(id);
    const assigned = files.map(({ parsed, dirRaw, file }) => {
      const id = parsed.node.id;
      let finalId = id;
      if (seenOriginal.has(id)) {
        finalId = derivedId(`${dirRaw.rel}/${file}`, id, isTaken);
        warnings.push(`${dirRaw.rel}: 同じ id のノードが重複していたため振り直しました: ${id}`);
      } else if (nodes[id]) {
        finalId = derivedId(`${dirRaw.rel}/${file}`, id, isTaken);
        referenceRemap.set(id, finalId);
        warnings.push(
          `${dirRaw.rel}: 別のプロジェクトと id が重複していたため振り直しました: ${id}`
        );
      }
      seenOriginal.add(id);
      taken.add(finalId);
      return finalId;
    });

    const projectRootId = files[0]?.isRoot ? assigned[0] : undefined;
    files.forEach((file, index) => {
      const { parsed, dirRaw, isRoot } = file;
      const id = assigned[index];
      /** @type {any} */
      const node = { ...parsed.node, id };
      const parentsChanged = node.parents.some((link) => referenceRemap.has(link.id));
      node.parents = node.parents.map((link) =>
        referenceRemap.has(link.id) ? { ...link, id: referenceRemap.get(link.id) } : link
      );
      if (id !== parsed.node.id || parentsChanged) dirtyIds.add(id);
      if (!node.createdAt) node.createdAt = today();
      if (isRoot) {
        // 旧形式のルートは `parents` を持たず、ワークスペースの中での並び順だけを持つ。
        if (!parsed.hasParents)
          node.parents = [{ id: rootId, order: parsed.legacyOrder ?? projectIndex }];
        if (parsed.inbox || path.basename(dirRaw.rel) === "_inbox") inboxId ??= id;
      } else if (parsed.inbox) inboxId ??= id;
      node.attachments = attachmentsFor(node, dirRaw);
      nodes[id] = node;
      locations.set(id, { dir: dirRaw.rel, file: isRoot ? PROJECT_FILE : NODE_FILE });
      homeRoot.set(id, projectRootId);
      fileInfo.set(id, {
        hash: sha1(dirRaw.text),
        attachmentKey: parsed.hasAttachments || node.attachments.length > 0,
      });
    });

    // 旧メモ（`<dir>/<memo>.md`）をノードとして読む。ファイルは、そのノードを
    // 次に保存するときに自分のフォルダーへ移る。
    files.forEach((file, index) => {
      const ownerId = assigned[index];
      const memos = sortMemoEntries(
        file.dirRaw.memos.map((memo, fileIndex) =>
          buildMemoEntry(memo.fileName, fileIndex, memo.text, true, file.dirRaw.rel)
        )
      );
      memos.forEach((memo, memoIndex) => {
        let id = memo.id;
        if (nodes[id]) {
          id = derivedId(`${file.dirRaw.rel}/${memo.fileName}`, id, (candidate) =>
            Boolean(nodes[candidate])
          );
          warnings.push(`${file.dirRaw.rel}/${memo.fileName}: id が重複していたため振り直しました`);
        }
        nodes[id] = {
          id,
          name: memo.title || "memo",
          parents: [{ id: ownerId, order: LEGACY_MEMO_ORDER_BASE + memoIndex }],
          body: memo.content,
          format: memo.format,
          tags: memo.tags ?? [],
          attachments: [],
          createdAt: nodes[ownerId].createdAt || today(),
        };
        locations.set(id, { dir: file.dirRaw.rel, file: memo.fileName, memo: true });
        homeRoot.set(id, projectRootId);
      });
    });
  });

  // ── 親の検査 ─────────────────────────────────────────────────────────
  for (const node of Object.values(nodes)) {
    if (node.id === rootId) continue;
    const seen = new Set();
    node.parents = node.parents.filter((link) => {
      if (!nodes[link.id] || link.id === node.id || seen.has(link.id)) return false;
      seen.add(link.id);
      return true;
    });
    if (node.parents.length === 0) {
      // 親を失ったノード（手で置いたファイル・消した親の子）は、属するプロジェクトの
      // ルートの子にする。プロジェクトのルート自身ならワークスペース直下。
      const home = homeRoot.get(node.id);
      const target = home && home !== node.id && nodes[home] ? home : rootId;
      const location = locations.get(node.id);
      if (target === rootId || !location?.memo)
        warnings.push(
          `${location?.dir}/${location?.file}: 親が見つからないため、置き場所を補いました`
        );
      node.parents = [{ id: target }];
    }
  }

  /** @type {any} */
  const graph = {
    schemaVersion: 1,
    workspaceId: rootId.replace(/^workspace-/, ""),
    rootId,
    revision: 0,
    nodes,
  };
  if (inboxId) graph.inboxId = inboxId;
  fillMissingOrders(graph);
  if (raw.layoutText) {
    try {
      const layout = JSON.parse(raw.layoutText);
      const positions = {};
      for (const [id, point] of Object.entries(layout?.positions ?? {})) {
        const { x, y } = /** @type {any} */ (point) ?? {};
        if (nodes[id] && Number.isFinite(x) && Number.isFinite(y)) positions[id] = { x, y };
      }
      if (Object.keys(positions).length > 0) graph.positions = positions;
    } catch {
      warnings.push(`${STORE_DIR}/${LAYOUT_FILE} を読めませんでした`);
    }
  }
  identifyInbox(graph);
  repairRootReachability(graph);
  validateGraph(graph);

  return { graph, locations, fileInfo, warnings, rootCreated, dirtyIds };
}

/** ワークスペースを読む。 */
async function loadWorkspace(workspacePath) {
  return assembleWorkspace(await gatherWorkspace(workspacePath), { workspacePath });
}

/** ワークスペースを同期で読む（テストとツール用）。 */
function loadWorkspaceSync(workspacePath) {
  return assembleWorkspace(gatherWorkspaceSync(workspacePath), { workspacePath });
}

module.exports = {
  STORE_DIR,
  WORKSPACE_FILE,
  PROJECT_FILE,
  NODE_FILE,
  LAYOUT_FILE,
  FILE_DIRS,
  gatherWorkspace,
  gatherWorkspaceSync,
  assembleWorkspace,
  loadWorkspace,
  loadWorkspaceSync,
  sha1,
  hasAttachmentsKey,
};
