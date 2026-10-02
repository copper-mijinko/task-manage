/**
 * `graph-v1.json`（以前の保存形式）から Markdown ファイルへ、一度だけ変換する。
 *
 * 変換の方針は「元のものを消さない」こと。
 * - `graph-v1.json` は変換が終わってから `graph-v1.json.migrated` に名前を変える。
 * - 取り込み元だった旧 Markdown のプロジェクト（ワークスペース直下のフォルダー）は、
 *   `.task-manage/backup/` へ移してから、グラフの内容で書き直す（古いファイルを
 *   残すと、グラフで消したノードが読み込みのたびに戻ってくる）。
 * - `.task-manage/assets/` の画像と添付は、各ノードのフォルダーへ写す（元は残す）。
 * - 元に戻す / やり直しの履歴は引き継がない。
 *
 * 途中で止まっても、もう一度開くと続きから変換できる（`.task-manage/migration.json`
 * に、書き終えたフォルダーを記録する）。
 */
const fs = require("fs");
const path = require("path");
const { atomicWriteFile, assertSafePathSegment } = require("../workspace");
const { identifyInbox, validateGraph } = require("../workspace-graph-engine");
const { renderNodeFile } = require("./node-file");
const {
  STORE_DIR,
  WORKSPACE_FILE,
  PROJECT_FILE,
  NODE_FILE,
  LAYOUT_FILE,
  FILE_DIRS,
  sha1,
} = require("./loader");
const { FALLBACK_PROJECT_DIR, nodeDirName, projectDirBase } = require("./layout");
const { parseFrontmatter } = require("./frontmatter");
const { copyDirectory, exists, uniqueFileName } = require("./files");

const GRAPH_JSON = "graph-v1.json";
const JOURNAL = "migration.json";
const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

function sameDir(a, b) {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** 文字列の中の値をすべて `map` で置き換える（本文は文字列か Quill の Delta）。 */
function mapStrings(value, map) {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, map)])
    );
  }
  return value;
}

/**
 * 本文の中の `assets/<ownerId>/...`（`.task-manage` からの相対）を、ノードのフォルダー
 * からの相対（`./assets/...`）に書き換える。
 *
 * @param {unknown} body
 * @param {string} ownerId
 * @param {(rest: string) => string} toRelative `assets/<ownerId>/` より後ろを受けて、新しい相対パスを返す
 */
function rewriteBodyReferences(body, ownerId, toRelative) {
  const escaped = ownerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[\\s("'=])(?:\\./)?assets/${escaped}/([^)\\s"'\\\\]+)`, "g");
  return mapStrings(body, (text) =>
    text.replace(pattern, (_match, prefix, rest) => `${prefix}${toRelative(rest)}`)
  );
}

/** 旧保存方式の画像・添付を、ノードのフォルダーへ写して、本文と添付の参照を直す。 */
async function migrateNodeAssets({ workspacePath, node, nodeDir }) {
  const ownerId = node.assetOwnerId || node.id;
  const ownerDir = SAFE_ID.test(ownerId)
    ? path.join(workspacePath, STORE_DIR, "assets", ownerId)
    : null;
  if (!ownerDir || !(await exists(ownerDir)))
    return { body: node.body, attachments: node.attachments };

  /** 写したファイル（元の相対パス → 写し先の相対パス）。 */
  const copiedLoose = new Set();
  const copyFile = async (fromRel, toRel) => {
    const from = path.join(ownerDir, fromRel);
    const to = path.join(nodeDir, toRel);
    if (!from.startsWith(ownerDir + path.sep) || !(await exists(from))) return false;
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    if (!(await exists(to))) await fs.promises.copyFile(from, to);
    return true;
  };

  const references = [];
  const body = rewriteBodyReferences(node.body, ownerId, (rest) => {
    let decoded = rest;
    try {
      decoded = decodeURIComponent(rest);
    } catch {
      // そのまま使う。
    }
    const target =
      decoded.startsWith("assets/") || decoded.startsWith("attachments/")
        ? decoded
        : `assets/${decoded}`;
    references.push({ from: decoded, to: target });
    return `./${rest.startsWith("assets/") || rest.startsWith("attachments/") ? rest : `assets/${rest}`}`;
  });
  for (const { from, to } of references) {
    if (await copyFile(from, to)) copiedLoose.add(from);
  }

  const attachments = [];
  for (const attachment of node.attachments ?? []) {
    const rel = String(attachment.relativePath ?? "").replace(/^\.\//, "");
    const match = rel.match(new RegExp(`^assets/${ownerId}/(.+)$`));
    if (!match) {
      attachments.push(attachment);
      continue;
    }
    const rest = match[1];
    if (rest.startsWith("attachments/")) {
      await copyFile(rest, rest);
      attachments.push({ ...attachment, id: `./${rest}`, relativePath: `./${rest}` });
      copiedLoose.add(rest);
      continue;
    }
    // 保存時に付けた id の接頭辞を外した、元のファイル名で置く。
    const cleanName = rest.replace(UUID_PREFIX, "");
    const dir = path.join(nodeDir, "attachments");
    await fs.promises.mkdir(dir, { recursive: true });
    const name = await uniqueFileName(dir, cleanName || rest);
    if (await copyFile(rest, `attachments/${name}`)) {
      copiedLoose.add(rest);
      attachments.push({
        ...attachment,
        id: `./attachments/${name}`,
        name: attachment.name || name,
        relativePath: `./attachments/${name}`,
      });
    } else attachments.push(attachment);
  }

  // 参照されていないファイルも捨てない。
  await copyDirectory(path.join(ownerDir, "assets"), path.join(nodeDir, "assets"));
  await copyDirectory(path.join(ownerDir, "attachments"), path.join(nodeDir, "attachments"));
  for (const entry of await fs.promises.readdir(ownerDir, { withFileTypes: true })) {
    if (!entry.isFile() || copiedLoose.has(entry.name)) continue;
    await copyFile(entry.name, `assets/${entry.name}`);
  }
  return { body, attachments };
}

/** ノードが属するプロジェクト（ワークスペース直下の子）。辿れないものは null。 */
function projectOfNode(graph, projects, id) {
  const visited = new Set();
  let current = id;
  while (current && current !== graph.rootId) {
    if (projects.has(current)) return current;
    if (visited.has(current)) return null;
    visited.add(current);
    current = graph.nodes[current]?.parents?.[0]?.id;
  }
  return null;
}

async function readJournal(journalPath) {
  try {
    return JSON.parse(await fs.promises.readFile(journalPath, "utf8"));
  } catch {
    return { backedUp: false, written: [] };
  }
}

/** ワークスペース直下の、取り込み元だった旧 Markdown のフォルダーの名前。 */
async function legacyProjectDirs(workspacePath, graph) {
  const importedNames = new Set(
    Object.values(graph.nodes)
      .map((node) => node.sourceProjectDir)
      .filter(Boolean)
      .filter((dir) => sameDir(path.dirname(dir), workspacePath))
      .map((dir) => path.basename(dir))
  );
  const found = [];
  for (const entry of await fs.promises.readdir(workspacePath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || FILE_DIRS.has(entry.name)) continue;
    let id;
    try {
      const text = await fs.promises.readFile(
        path.join(workspacePath, entry.name, PROJECT_FILE),
        "utf8"
      );
      id = parseFrontmatter(text).data.id;
    } catch {
      continue;
    }
    if ((typeof id === "string" && graph.nodes[id]) || importedNames.has(entry.name))
      found.push(entry.name);
  }
  return found;
}

/**
 * `graph-v1.json` があれば Markdown へ変換する。
 *
 * @param {string} workspacePath
 * @param {{ onWarn?: (message: string) => void }} [options]
 * @returns {Promise<boolean>} 変換したか
 */
async function migrateGraphJson(workspacePath, { onWarn = () => {} } = {}) {
  const storeDir = path.join(workspacePath, STORE_DIR);
  const jsonPath = path.join(storeDir, GRAPH_JSON);
  if (!(await exists(jsonPath))) return false;

  const document = JSON.parse(await fs.promises.readFile(jsonPath, "utf8"));
  const graph = document.graph;
  identifyInbox(graph);
  validateGraph(graph);
  const journalPath = path.join(storeDir, JOURNAL);
  const journal = await readJournal(journalPath);
  const saveJournal = () => atomicWriteFile(journalPath, JSON.stringify(journal) + "\n", "utf8");

  // 1. 取り込み元だった旧フォルダーを、バックアップへ移す。
  if (!journal.backedUp) {
    const legacy = await legacyProjectDirs(workspacePath, graph);
    if (legacy.length > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backup = path.join(storeDir, "backup", `legacy-markdown-${stamp}`);
      await fs.promises.mkdir(backup, { recursive: true });
      for (const name of legacy)
        await fs.promises.rename(path.join(workspacePath, name), path.join(backup, name));
      onWarn(`旧 Markdown のフォルダーを ${path.relative(workspacePath, backup)} へ移しました`);
    }
    journal.backedUp = true;
    await saveJournal();
  }

  // 2. 置き場所を決める。ワークスペース直下の子がプロジェクトで、それ以外のノードは
  //    最初の親をたどった先のプロジェクトに置く。
  const rootId = graph.rootId;
  const projectNodes = Object.values(graph.nodes)
    .filter((node) => node.id !== rootId && node.parents.some((link) => link.id === rootId))
    .sort((a, b) => {
      const order = (node) => node.parents.find((link) => link.id === rootId)?.order ?? 0;
      return order(a) - order(b) || (a.id < b.id ? -1 : 1);
    });
  const projects = new Map(projectNodes.map((node) => [node.id, node]));
  /** @type {Map<string, string>} プロジェクトのノード id → フォルダー名 */
  const dirNames = new Map();
  const used = new Set();
  for (const node of projectNodes) {
    let preferred = projectDirBase(node.name);
    if (node.sourceProjectDir && sameDir(path.dirname(node.sourceProjectDir), workspacePath)) {
      const base = path.basename(node.sourceProjectDir);
      try {
        assertSafePathSegment(base);
        if (!base.startsWith(".") && !FILE_DIRS.has(base)) preferred = base;
      } catch {
        // 名前から決める。
      }
    }
    for (let index = 1; ; index += 1) {
      const candidate = index === 1 ? preferred : `${preferred}-${index}`;
      if (used.has(candidate.toLowerCase())) continue;
      const dir = path.join(workspacePath, candidate);
      if (await exists(dir)) {
        // 前の実行が途中まで書いたフォルダー（自分のもの）なら使う。他のものなら避ける。
        let ours = journal.written.includes(candidate);
        if (!ours) {
          try {
            const text = await fs.promises.readFile(path.join(dir, PROJECT_FILE), "utf8");
            ours = parseFrontmatter(text).data.id === node.id;
          } catch {
            ours = false;
          }
        }
        if (!ours) continue;
      }
      dirNames.set(node.id, candidate);
      used.add(candidate.toLowerCase());
      break;
    }
  }
  const groups = new Map();
  for (const node of Object.values(graph.nodes)) {
    if (node.id === rootId) continue;
    const projectId = projectOfNode(graph, projects, node.id);
    const key = projectId ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }

  // 3. 書く。
  const today = new Date().toISOString().slice(0, 10);
  const render = async (node, location, dirAbs) => {
    const assets = await migrateNodeAssets({ workspacePath, node, nodeDir: dirAbs });
    const migrated = { ...node, body: assets.body, attachments: assets.attachments };
    for (const key of [
      "assetOwnerId",
      "sourceProjectDir",
      "sourceTaskDir",
      "importSource",
      "bodyLoaded",
    ])
      delete migrated[key];
    const text = renderNodeFile(migrated, {
      inbox: graph.inboxId === node.id,
      keepAttachments: (migrated.attachments?.length ?? 0) > 0,
      today,
    });
    await atomicWriteFile(path.join(dirAbs, location.file), text, "utf8");
    return sha1(text);
  };

  await fs.promises.mkdir(workspacePath, { recursive: true });
  await render(graph.nodes[rootId], { file: WORKSPACE_FILE }, workspacePath);

  for (const [projectId, nodes] of groups) {
    const dirName = projectId ? dirNames.get(projectId) : FALLBACK_PROJECT_DIR;
    if (journal.written.includes(dirName)) continue;
    const projectAbs = path.join(workspacePath, dirName);
    // 前の実行が途中で止まったときの書きかけは、自分のものなので消してやり直す。
    await fs.promises.rm(projectAbs, { recursive: true, force: true });
    await fs.promises.mkdir(projectAbs, { recursive: true });
    for (const node of nodes) {
      if (node.id === projectId) {
        await render(node, { file: PROJECT_FILE }, projectAbs);
      } else {
        const nodeAbs = path.join(projectAbs, nodeDirName(node.id));
        await fs.promises.mkdir(nodeAbs, { recursive: true });
        await render(node, { file: NODE_FILE }, nodeAbs);
      }
    }
    journal.written.push(dirName);
    await saveJournal();
  }

  if (graph.positions && Object.keys(graph.positions).length > 0) {
    await atomicWriteFile(
      path.join(storeDir, LAYOUT_FILE),
      JSON.stringify({ positions: graph.positions }) + "\n",
      "utf8"
    );
  }

  // 4. 確定: 元のファイルは消さずに名前を変える。
  let migrated = path.join(storeDir, `${GRAPH_JSON}.migrated`);
  for (let index = 2; await exists(migrated); index += 1)
    migrated = path.join(storeDir, `${GRAPH_JSON}.migrated-${index}`);
  await fs.promises.rename(jsonPath, migrated);
  await fs.promises.rm(journalPath, { force: true });
  onWarn(
    `${GRAPH_JSON} を Markdown ファイルへ変換しました（元のファイルは ${path.basename(migrated)}）`
  );
  return true;
}

module.exports = {
  GRAPH_JSON,
  migrateGraphJson,
  rewriteBodyReferences,
};
