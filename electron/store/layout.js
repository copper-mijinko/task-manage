/**
 * ノードのファイルをフォルダーのどこに置くか。
 *
 * 置き場所はノードを作ったときに決め、あとから変えない（名前を変えても、
 * 親を付け替えても、ファイルは動かさない）。ツリーの形はファイルの置き場所
 * ではなく `parents:` が表す。
 *
 * - ワークスペース直下に作るノード（= プロジェクト）: `<名前>/_project.md`
 * - それ以外: 最初の親と同じプロジェクトのフォルダーに `<id>/_index.md`
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { assertSafePathSegment } = require("../workspace");
const { PROJECT_FILE, NODE_FILE, FILE_DIRS } = require("./loader");

/** 置き場所を決められなかったノードの行き先。 */
const FALLBACK_PROJECT_DIR = "unsorted";

/** プロジェクトのフォルダー名にする（旧形式と同じく小文字・空白はハイフン）。 */
function projectDirBase(name) {
  let slug = String(name ?? "")
    .trim()
    .toLowerCase()
    // eslint-disable-next-line no-control-regex -- Windows では制御文字をファイル名に使えない
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, "-")
    // 先頭のドット・下線はフォルダーを隠す／予約にするので付けない。
    .replace(/^[-._]+/, "")
    .replace(/[-. ]+$/, "")
    .slice(0, 64);
  if (FILE_DIRS.has(slug) || slug === "node_modules") slug = `${slug}-project`;
  try {
    assertSafePathSegment(slug);
  } catch {
    slug = "project";
  }
  return slug;
}

/** ノードのフォルダー名。id がそのまま使えないときは id から決める。 */
function nodeDirName(id) {
  try {
    const segment = assertSafePathSegment(id, "node id");
    if (!segment.startsWith("_") && !segment.startsWith(".") && !FILE_DIRS.has(segment))
      return segment;
  } catch {
    // 下の代わりの名前を使う。
  }
  return `n-${crypto.createHash("sha1").update(String(id)).digest("hex").slice(0, 20)}`;
}

function pathExists(target) {
  return fs.promises.access(target).then(
    () => true,
    () => false
  );
}

/**
 * まだ使われていないプロジェクトのフォルダー名。大文字小文字は区別しない
 * （Windows・macOS で同じフォルダーになる）。
 *
 * @param {string} workspacePath
 * @param {string} name ノードの名前
 * @param {Set<string>} taken すでに使った名前（小文字）
 */
async function uniqueProjectDir(workspacePath, name, taken) {
  const base = projectDirBase(name);
  for (let index = 1; ; index += 1) {
    const candidate = index === 1 ? base : `${base}-${index}`;
    if (taken.has(candidate.toLowerCase())) continue;
    if (await pathExists(path.join(workspacePath, candidate))) continue;
    return candidate;
  }
}

/** 置き場所のプロジェクトのフォルダー（ワークスペース自身は null）。 */
function projectOf(location) {
  return location?.dir ? location.dir.split("/")[0] : null;
}

/**
 * 新しいノードの置き場所を決める。親が先に決まっている必要があるので、
 * 決まったものから順に決めていく。
 *
 * @param {object} args
 * @param {string} args.workspacePath
 * @param {any} args.graph
 * @param {Map<string, { dir: string, file: string }>} args.locations 決まっている置き場所
 * @param {string[]} args.ids 置き場所を決めるノード
 * @returns {Promise<Map<string, { dir: string, file: string }>>} 新しく決めた置き場所
 */
async function assignLocations({ workspacePath, graph, locations, ids }) {
  /** @type {Map<string, { dir: string, file: string }>} */
  const assigned = new Map();
  const taken = new Set();
  for (const location of locations.values())
    if (location.dir) taken.add(projectOf(location).toLowerCase());
  const projectOfNode = (id) =>
    id === graph.rootId ? null : projectOf(assigned.get(id) ?? locations.get(id));
  const known = (id) => id === graph.rootId || assigned.has(id) || locations.has(id);

  let pending = ids.filter((id) => graph.nodes[id]);
  while (pending.length > 0) {
    const stillPending = [];
    for (const id of pending) {
      const node = graph.nodes[id];
      const links = node.parents ?? [];
      const parent = links.find((link) => known(link.id));
      if (!parent) {
        stillPending.push(id);
        continue;
      }
      if (parent.id === graph.rootId) {
        const dir = await uniqueProjectDir(workspacePath, node.name, taken);
        taken.add(dir.toLowerCase());
        assigned.set(id, { dir, file: PROJECT_FILE });
      } else {
        const project = projectOfNode(parent.id) ?? FALLBACK_PROJECT_DIR;
        assigned.set(id, { dir: `${project}/${nodeDirName(id)}`, file: NODE_FILE });
      }
    }
    if (stillPending.length === pending.length) {
      // どの親も置き場所が無い（循環した新しいノードだけ、など）。まとめて 1 か所に置く。
      for (const id of stillPending)
        assigned.set(id, { dir: `${FALLBACK_PROJECT_DIR}/${nodeDirName(id)}`, file: NODE_FILE });
      break;
    }
    pending = stillPending;
  }
  return assigned;
}

module.exports = {
  FALLBACK_PROJECT_DIR,
  projectDirBase,
  nodeDirName,
  uniqueProjectDir,
  projectOf,
  assignLocations,
};
