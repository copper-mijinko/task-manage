/**
 * 元に戻す / やり直しの履歴の保存。
 *
 * 履歴の 1 段は「戻すのに要るノードと欄だけ」のパッチで、1 段 1 ファイル。
 * 編集のたびに書くのはその 1 ファイルだけなので、履歴が長くなっても編集は
 * 重くならない。
 *
 * ```
 * .task-manage/history/undo/000000012.json   { seq, patch, trashed }
 * .task-manage/history/redo/000000013.json
 * .task-manage/trash/<seq>/<node-id>/...     削除したノードのファイル（画像・添付）
 * ```
 *
 * パッチの形: `{ nodes: { [id]: node | null }, fields: { [key]: { value } | null } }`。
 * `null` は「その時点では無かった」を表す。`trashed` は、その段を適用したときに
 * ごみ箱へ移したノードの置き場所（戻すときに同じ場所へ戻す）。
 *
 * ごみ箱は `seq` で分ける。履歴から消えた段のごみ箱は、あとから掃除する。
 */
const fs = require("fs");
const path = require("path");
const { atomicWriteFile } = require("../workspace");
const { STORE_DIR } = require("./loader");

const HISTORY_LIMIT = 50;

function historyDir(workspacePath, stack) {
  return path.join(workspacePath, STORE_DIR, "history", stack);
}

function stepPath(workspacePath, stack, seq) {
  return path.join(historyDir(workspacePath, stack), `${String(seq).padStart(9, "0")}.json`);
}

async function listSeqs(dirPath) {
  let names;
  try {
    names = await fs.promises.readdir(dirPath);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.match(/^(\d+)\.json$/))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}

/**
 * 履歴の段を数える。同じ `seq` が両方にあるのは、適用の途中で止まったとき
 * （やり直し側を書いたあと、元に戻す側を消す前）なので、古い方を捨てる。
 */
async function loadHistoryIndex(workspacePath) {
  const undo = await listSeqs(historyDir(workspacePath, "undo"));
  const redo = await listSeqs(historyDir(workspacePath, "redo"));
  const both = undo.filter((seq) => redo.includes(seq));
  for (const seq of both) await removeStep(workspacePath, "undo", seq);
  // 元に戻す側は新しい段が末尾（次に戻す段）、やり直し側は古い段が末尾（次にやり直す段）。
  return {
    undo: undo.filter((seq) => !both.includes(seq)),
    redo: redo.sort((a, b) => b - a),
  };
}

async function readStep(workspacePath, stack, seq) {
  const text = await fs.promises.readFile(stepPath(workspacePath, stack, seq), "utf8");
  return JSON.parse(text);
}

async function writeStep(workspacePath, stack, step) {
  await atomicWriteFile(
    stepPath(workspacePath, stack, step.seq),
    JSON.stringify(step) + "\n",
    "utf8"
  );
}

async function removeStep(workspacePath, stack, seq) {
  await fs.promises.rm(stepPath(workspacePath, stack, seq), { force: true });
}

/** 1 つの段の適用結果から、`trashed` を添えた履歴の段を作る。 */
function makeStep(seq, patch, trashed = {}) {
  return { seq, patch, trashed };
}

module.exports = {
  HISTORY_LIMIT,
  loadHistoryIndex,
  readStep,
  writeStep,
  removeStep,
  makeStep,
};
