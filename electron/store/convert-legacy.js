/**
 * 旧形式のフォルダーを、別の場所へ変換して書き出す（移行のための一時的な機能）。
 *
 * 旧形式のメモ（ノードのフォルダーの `<名前>.md`）は、読み込みではそのノードの子ノード
 * になる。メモを 1 つだけ持つノードが多いと、行が「memo」だらけになって見づらい。
 * そこで、書き出すときだけ、次の 1 つの規則で整える。
 *
 * - ノードが持つメモが 1 つだけで、その名前が「memo」（タイトルも見出しも無いメモ）、
 *   かつノードの本文が空なら、メモの内容をそのノードの本文にして、メモのノードは作らない
 *
 * 複数のメモがあるとき、名前のあるメモ、ノードに本文があるときは、特別な扱いをしない
 * （メモは今までどおり子ノードになる。本文を上書きして失わないため）。
 *
 * 元のフォルダーは読むだけで、変更しない。書き出し先は空のフォルダー。
 */
const fs = require("fs");
const path = require("path");
const { loadWorkspaceSync, STORE_DIR } = require("./loader");

/** 名前の決まらない旧メモの名前（`buildMemoEntry` が付ける）。 */
const UNTITLED_MEMO = "memo";
/** 写さないもの。 */
const SKIPPED = new Set([STORE_DIR, ".git", "node_modules"]);

function isEmptyBody(body) {
  if (body == null) return true;
  if (typeof body === "string") return body.trim() === "";
  if (Array.isArray(body?.ops)) {
    const { ops } = body;
    return (
      ops.length === 0 || (ops.length === 1 && (ops[0].insert === "" || ops[0].insert === "\n"))
    );
  }
  return false;
}

/**
 * 変換の計画。何も書かない。
 *
 * @param {string} sourcePath
 * @returns {{
 *   merge: { ownerId: string, ownerName: string, memoId: string, body: any, format: string, tags: string[] }[],
 *   keep: { ownerId: string, ownerName: string, reason: string }[],
 *   memoNodes: number,
 * }}
 */
function planConversion(sourcePath) {
  const { graph, locations } = loadWorkspaceSync(sourcePath);
  /** @type {Map<string, any[]>} */
  const byOwner = new Map();
  let memoNodes = 0;
  for (const node of Object.values(graph.nodes)) {
    if (!locations.get(node.id)?.memo) continue;
    memoNodes += 1;
    const ownerId = node.parents[0]?.id;
    if (!ownerId || !graph.nodes[ownerId]) continue;
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId).push(node);
  }
  const merge = [];
  const keep = [];
  for (const [ownerId, memos] of byOwner) {
    if (memos.length !== 1 || memos[0].name !== UNTITLED_MEMO) continue;
    const owner = graph.nodes[ownerId];
    const memo = memos[0];
    if (!isEmptyBody(owner.body)) {
      keep.push({ ownerId, ownerName: owner.name, reason: "has-body" });
      continue;
    }
    merge.push({
      ownerId,
      ownerName: owner.name,
      memoId: memo.id,
      body: memo.body ?? "",
      format: memo.format ?? "markdown",
      tags: memo.tags ?? [],
    });
  }
  return { merge, keep, memoNodes };
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * 変換して書き出す。
 *
 * @param {string} sourcePath 旧形式のフォルダー（変更しない）
 * @param {string} destPath 書き出し先（空のフォルダー、または無いフォルダー）
 * @param {{ read: Function, execute: Function, forget: Function }} store `workspace-graph.js` の
 *   `executeWorkspaceGraphCommand` と `forgetWorkspace`（循環を避けるため渡してもらう）
 */
async function convertLegacyWorkspace(sourcePath, destPath, store) {
  if (isInside(sourcePath, destPath) || isInside(destPath, sourcePath))
    throw new Error("書き出し先は、元のフォルダーとは別の場所にしてください。");
  const existing = await fs.promises.readdir(destPath).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (existing.length > 0) throw new Error("書き出し先のフォルダーが空ではありません。");

  const plan = planConversion(sourcePath);
  await fs.promises.mkdir(destPath, { recursive: true });
  await fs.promises.cp(sourcePath, destPath, {
    recursive: true,
    filter: (source) => !SKIPPED.has(path.basename(source)) || source === sourcePath,
  });

  try {
    for (const item of plan.merge) {
      const graph = await store.read(destPath);
      const owner = graph.nodes[item.ownerId];
      const tags = [...new Set([...(owner.tags ?? []), ...item.tags])];
      await store.execute(
        destPath,
        {
          type: "batch",
          commands: [
            {
              type: "update-node",
              nodeId: item.ownerId,
              changes: { body: item.body, format: item.format, tags },
            },
            { type: "delete-node", nodeId: item.memoId },
          ],
        },
        "tree",
        graph.revision
      );
    }
  } finally {
    store.forget(destPath);
    // 変換のための履歴とごみ箱は、書き出し先に残さない。
    for (const name of ["history", "trash"])
      await fs.promises.rm(path.join(destPath, STORE_DIR, name), { recursive: true, force: true });
  }
  return plan;
}

module.exports = { planConversion, convertLegacyWorkspace, UNTITLED_MEMO };
