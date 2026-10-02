/**
 * グラフの変更を、ファイルに反映する。
 *
 * 操作の前後のグラフ（`before` と `after`）を比べて、変わったノードのファイル
 * だけを書く（エンジンは変えないノードを前のグラフと共有するので、比べるのは
 * 参照だけで済む）。ノードが消えたらそのフォルダーをごみ箱へ、増えたら
 * 置き場所を決めて書く。
 *
 * 複数のファイルにまたがるので、途中で失敗したら巻き戻す（`rollback`）。
 * 巻き戻せなかった場合も、読み込み時の修復（loader）で開けなくなることはない。
 */
const fs = require("fs");
const path = require("path");
const { atomicWriteFile } = require("../workspace");
const { extraBlocksOf, renderNodeFile } = require("./node-file");
const { sha1, contentHashes, STORE_DIR, LAYOUT_FILE, NODE_FILE } = require("./loader");
const { splitFrontmatterRaw } = require("./frontmatter");
const { absoluteDir, fileOfLocation, bodyFromText } = require("./body");
const { assignLocations, nodeDirName, projectOf } = require("./layout");
const { moveToTrash, restoreFromTrash } = require("./trash");
const { copyDirectory, copyReferencedAssets, exists } = require("./files");

const WRITE_CONCURRENCY = 8;

/** 画面やファイルに持たない、旧保存方式の名残のフィールド。 */
const OBSOLETE_FIELDS = ["assetOwnerId", "sourceProjectDir", "sourceTaskDir", "importSource"];

/** ディスクに書いたものと同じ形の写し（`undefined` の欄は消える）。 */
function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeNode(node) {
  const copy = jsonCopy(node);
  for (const key of OBSOLETE_FIELDS) delete copy[key];
  // 本文を読んでいない印（`bodyLoaded: false`）は残す。読んでいるときは印を付けない。
  if (copy.bodyLoaded !== false) delete copy.bodyLoaded;
  return copy;
}

function samePositions(a, b) {
  if (a === b) return true;
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b ?? {});
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const p = a[key];
    const q = b?.[key];
    if (!q || p.x !== q.x || p.y !== q.y) return false;
  }
  return true;
}

/** 変わった（増えた・消えた）ノードの id。ノードは参照で比べる。 */
function changedNodeIds(before, after) {
  const ids = [];
  for (const id of Object.keys(after.nodes)) if (before.nodes[id] !== after.nodes[id]) ids.push(id);
  for (const id of Object.keys(before.nodes)) if (!after.nodes[id]) ids.push(id);
  return ids;
}

const NON_FIELD_KEYS = new Set([
  "nodes",
  "revision",
  "history",
  "schemaVersion",
  "workspaceId",
  "rootId",
]);

/** ノード以外の欄（Inbox の指定・グラフビューの座標）で変わったものの名前。 */
function changedFields(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  for (const key of keys) {
    if (NON_FIELD_KEYS.has(key)) continue;
    if (key === "positions") {
      if (!samePositions(before.positions, after.positions)) changed.push(key);
    } else if (before[key] !== after[key]) changed.push(key);
  }
  return changed;
}

/**
 * `source` の、挙げた部分だけのパッチ。履歴の 1 段になる。
 * 形: `{ nodes: { [id]: node | null }, fields: { [key]: { value } | null } }`
 */
function patchFrom(source, nodeIds, fieldKeys) {
  const patch = { nodes: {}, fields: {} };
  for (const id of nodeIds)
    patch.nodes[id] = source.nodes[id] === undefined ? null : jsonCopy(source.nodes[id]);
  for (const key of fieldKeys)
    patch.fields[key] = source[key] === undefined ? null : { value: jsonCopy(source[key]) };
  return patch;
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

/** 全部が終わるまで待ってから、最初のエラーを投げる（途中の書き込みを残さないため）。 */
async function runAll(items, limit, fn) {
  let next = 0;
  let failure;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await fn(item);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure;
}

const absolute = absoluteDir;
const fileOf = fileOfLocation;

async function readTextIfExists(filePath) {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

class ExternalChangeError extends Error {
  constructor(relativePath) {
    super(
      `ファイルがアプリの外で変更されています: ${relativePath}。ワークスペース管理の「ディスクから読み込み直す」で読み直してから操作してください。`
    );
    this.name = "ExternalChangeError";
  }
}

/**
 * 保存の直前に、ファイルが最後に読んだ・書いたときのままかを確かめる。違えば、外で
 * 変えられている（古い内容で上書きしてしまう）ので、何も書かずに止める。frontmatter は
 * 必ず、本文は読んでいる（照合の値がある）ときだけ照合する。読んでいない本文は、
 * ディスクの最新のものをそのまま残すので、外で変えられていても構わない。
 *
 * @param {string | null} existing ディスクの中身（無ければ null）
 * @param {{ fmHash?: string, bodyHash?: string } | undefined} info
 * @param {string} relativePath
 */
function assertUnchanged(existing, info, relativePath) {
  if (existing === null || !info) return;
  const { head, body } = splitFrontmatterRaw(existing);
  if (info.fmHash !== undefined && sha1(head) !== info.fmHash)
    throw new ExternalChangeError(relativePath);
  if (info.bodyHash !== undefined && sha1(body) !== info.bodyHash)
    throw new ExternalChangeError(relativePath);
}

/**
 * 書くノード。本文を読んでいなければ、ディスクの本文で補う（読めなければ投げて、
 * 空の本文で上書きしない）。
 *
 * @param {any} node
 * @param {{ dir: string, file: string, memo?: boolean }} location 本文を読むファイル
 * @param {string | null} text その場所のファイルの中身（読んであれば）
 */
function withBodyFromDisk(node, location, text) {
  if (node.bodyLoaded !== false) return node;
  if (text === null)
    throw new Error(
      `本文を読めないため保存しませんでした: ${location.dir ? `${location.dir}/` : ""}${location.file}`
    );
  const { body } = bodyFromText(text, node, location);
  const { bodyLoaded: _unloaded, ...rest } = node;
  return { ...rest, body };
}

/**
 * グラフの変更をファイルに反映する。
 *
 * 戻り値の `rollback()` は反映を取り消し、`finalize()` は確定後の後片付け
 * （旧メモのファイルを消す・ファイルの記録を更新する）をする。
 *
 * @param {any} state
 * @param {any} before
 * @param {any} after 書き換えてよい（変わったノードは正規化した写しに差し替える）
 * @param {{ seq: number, trashedIn?: Record<string, any>, copiedFrom?: Record<string, string> }} context
 */
async function applyToDisk(state, before, after, { seq, trashedIn = {}, copiedFrom = {} }) {
  const workspacePath = state.workspacePath;
  /** @type {(() => Promise<void>)[]} */
  const undoThunks = [];
  /** @type {[string, any][]} */
  const locationUndo = [];
  /** @type {Map<string, { fmHash: string, bodyHash?: string, attachmentKey: boolean }>} */
  const pendingInfo = new Map();
  /** @type {Record<string, any>} */
  const trashed = {};

  const setLocation = (id, location) => {
    locationUndo.push([id, state.locations.get(id)]);
    if (location) state.locations.set(id, location);
    else state.locations.delete(id);
  };
  const rollback = async () => {
    for (const thunk of undoThunks.reverse()) {
      try {
        await thunk();
      } catch {
        // できる範囲で戻す。読み込み時の修復が残りを受け止める。
      }
    }
    for (const [id, previous] of locationUndo.reverse()) {
      if (previous) state.locations.set(id, previous);
      else state.locations.delete(id);
    }
  };

  const changedIds = changedNodeIds(before, after);
  const fieldKeys = changedFields(before, after);
  for (const id of changedIds)
    if (after.nodes[id]) after.nodes[id] = normalizeNode(after.nodes[id]);
  const removed = changedIds.filter((id) => !after.nodes[id] && before.nodes[id]);
  const added = changedIds.filter((id) => after.nodes[id] && !before.nodes[id]);

  try {
    // 増えたノード。ごみ箱にあれば元の場所へ戻し、無ければ置き場所を決める。
    const needLocation = [];
    for (const id of added) {
      const recorded = trashedIn[id];
      const restored = recorded ? await restoreFromTrash(workspacePath, recorded, id, seq) : null;
      if (restored) {
        undoThunks.push(async () => void (await moveToTrash(workspacePath, restored, id, seq)));
        setLocation(id, restored);
      } else needLocation.push(id);
    }
    if (needLocation.length > 0) {
      const assigned = await assignLocations({
        workspacePath,
        graph: after,
        locations: state.locations,
        ids: needLocation,
      });
      for (const [id, location] of assigned) setLocation(id, location);
    }

    // 変わったノードのファイルを書く。Inbox の指定が変わったら、その 2 つも書き直す
    // （`kind: inbox` の印を付け替える）。
    const writeIds = new Set(changedIds.filter((id) => after.nodes[id]));
    if (before.inboxId !== after.inboxId)
      for (const id of [before.inboxId, after.inboxId]) if (id && after.nodes[id]) writeIds.add(id);
    const today = new Date().toISOString().slice(0, 10);
    await runAll([...writeIds], WRITE_CONCURRENCY, async (id) => {
      const listed = after.nodes[id];
      let location = state.locations.get(id);
      if (!location) return;
      const info = state.fileInfo.get(id);
      const readFrom = location;
      /** @type {string | null} */
      let migrateFrom = null;
      /** @type {string | null} */
      let oldMemoFile = null;
      if (location.memo) {
        // 旧メモは、保存するときに自分のフォルダーへ移る（元のファイルは確定後に消す）。
        migrateFrom = location.dir;
        const moved = { dir: `${projectOf(location)}/${nodeDirName(id)}`, file: NODE_FILE };
        oldMemoFile = fileOf(workspacePath, location);
        setLocation(id, moved);
        location = moved;
      }
      const file = fileOf(workspacePath, location);
      const existing = await readTextIfExists(file);
      assertUnchanged(existing, info, `${location.dir ? `${location.dir}/` : ""}${location.file}`);
      // 旧メモは移る前のファイルから本文を読む。それ以外は、書くファイルそのもの。
      const node = withBodyFromDisk(
        listed,
        readFrom,
        readFrom.memo ? await readTextIfExists(fileOf(workspacePath, readFrom)) : existing
      );
      const attachmentKey = Boolean(info?.attachmentKey) || (node.attachments?.length ?? 0) > 0;
      const text = renderNodeFile(node, {
        inbox: after.inboxId === id,
        keepAttachments: attachmentKey,
        extraBlocks: existing === null ? [] : extraBlocksOf(existing),
        today,
      });
      if (migrateFrom !== null) {
        const dir = absolute(workspacePath, location);
        const existedBefore = await exists(dir);
        await copyReferencedAssets(
          path.join(workspacePath, ...migrateFrom.split("/")),
          dir,
          node.body
        );
        undoThunks.push(async () => {
          if (!existedBefore) await fs.promises.rm(dir, { recursive: true, force: true });
        });
      }
      if (existing !== text) {
        await atomicWriteFile(file, text, "utf8");
        undoThunks.push(async () => {
          if (existing === null) await fs.promises.rm(file, { force: true });
          else await atomicWriteFile(file, existing, "utf8");
        });
      }
      pendingInfo.set(id, {
        ...contentHashes(text, listed.bodyLoaded === false),
        attachmentKey,
      });
      if (oldMemoFile !== null) {
        // 移し終えたので、元のメモのファイルは消す（親のフォルダーに残すと、読み込みのたびに
        // 同じメモが別のノードとして現れる）。戻すときのため、中身を控えておく。
        const memoText = await readTextIfExists(oldMemoFile);
        await fs.promises.rm(oldMemoFile, { force: true });
        undoThunks.push(async () => {
          if (memoText !== null) await atomicWriteFile(oldMemoFile, memoText, "utf8");
        });
      }
    });

    // 消えたノードのファイルはごみ箱へ（履歴が戻せる間は取っておく）。書き込みのあとに行う
    // （旧メモの移行が、消えるノードのフォルダーの画像を読むため）。
    for (const id of removed) {
      const location = state.locations.get(id);
      if (!location) continue;
      await moveToTrash(workspacePath, location, id, seq);
      undoThunks.push(async () => void (await restoreFromTrash(workspacePath, location, id, seq)));
      trashed[id] = location;
      setLocation(id, undefined);
    }

    // コピーしたノードへ、画像と添付を写す。
    for (const [copyId, sourceId] of Object.entries(copiedFrom)) {
      const from = state.locations.get(sourceId);
      const to = state.locations.get(copyId);
      if (!from || !to || !after.nodes[copyId]) continue;
      const fromDir = absolute(workspacePath, from);
      const toDir = absolute(workspacePath, to);
      const existedAssets = await exists(path.join(toDir, "assets"));
      const existedAttachments = await exists(path.join(toDir, "attachments"));
      if (from.memo) {
        await copyReferencedAssets(fromDir, toDir, after.nodes[copyId].body);
      } else {
        await copyDirectory(path.join(fromDir, "assets"), path.join(toDir, "assets"));
        await copyDirectory(path.join(fromDir, "attachments"), path.join(toDir, "attachments"));
      }
      undoThunks.push(async () => {
        if (!existedAssets)
          await fs.promises.rm(path.join(toDir, "assets"), { recursive: true, force: true });
        if (!existedAttachments)
          await fs.promises.rm(path.join(toDir, "attachments"), { recursive: true, force: true });
      });
    }

    // グラフビューの座標。
    if (fieldKeys.includes("positions")) {
      const layoutFile = path.join(workspacePath, STORE_DIR, LAYOUT_FILE);
      const previous = await readTextIfExists(layoutFile);
      const positions = after.positions ?? {};
      if (Object.keys(positions).length > 0) {
        await atomicWriteFile(layoutFile, JSON.stringify({ positions }) + "\n", "utf8");
      } else {
        await fs.promises.rm(layoutFile, { force: true });
      }
      undoThunks.push(async () => {
        if (previous === null) await fs.promises.rm(layoutFile, { force: true });
        else await atomicWriteFile(layoutFile, previous, "utf8");
      });
    }
  } catch (error) {
    await rollback();
    throw error;
  }

  return {
    changedIds,
    fieldKeys,
    trashed,
    rollback,
    /** 確定後の後片付け。 */
    async finalize() {
      for (const id of removed) state.fileInfo.delete(id);
      for (const [id, info] of pendingInfo) state.fileInfo.set(id, info);
    },
  };
}

/**
 * 読み込み時の修復で、ノードのファイルだけを書き直す（履歴は作らない）。
 *
 * @param {any} state
 * @param {string[]} ids
 */
async function rewriteNodes(state, ids) {
  const today = new Date().toISOString().slice(0, 10);
  await runAll(ids, WRITE_CONCURRENCY, async (id) => {
    const listed = state.graph.nodes[id];
    const location = state.locations.get(id);
    if (!listed || !location || location.memo) return;
    const file = fileOf(state.workspacePath, location);
    const existing = await readTextIfExists(file);
    const node = withBodyFromDisk(listed, location, existing);
    const info = state.fileInfo.get(id);
    const attachmentKey = Boolean(info?.attachmentKey) || (node.attachments?.length ?? 0) > 0;
    const text = renderNodeFile(node, {
      inbox: state.graph.inboxId === id,
      keepAttachments: attachmentKey,
      extraBlocks: existing === null ? [] : extraBlocksOf(existing),
      today,
    });
    if (existing !== text) await atomicWriteFile(file, text, "utf8");
    state.fileInfo.set(id, {
      ...contentHashes(text, listed.bodyLoaded === false),
      attachmentKey,
    });
  });
}

module.exports = {
  ExternalChangeError,
  jsonCopy,
  normalizeNode,
  changedNodeIds,
  changedFields,
  patchFrom,
  applyGraphPatch,
  applyToDisk,
  rewriteNodes,
  absolute,
  fileOf,
};
