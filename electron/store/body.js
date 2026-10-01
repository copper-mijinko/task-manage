/**
 * ノードの本文をディスクから読む。
 *
 * 読み込みでは frontmatter までしか読まない（`bodyLoaded: false`）。本文が要るとき
 * （詳細を開く・書き戻す・コピーする）に、ここで読む。読めなかったときは、空の本文に
 * せず投げる。呼ぶ側はそれで保存を止める（空の本文で上書きしないため）。
 */
const fs = require("fs");
const path = require("path");
const { parseNodeBody, normalizeMemoFormat, buildMemoEntry } = require("../workspace");
const { parseFrontmatterDetailed, splitFrontmatterRaw } = require("./frontmatter");

function absoluteDir(workspacePath, location) {
  return path.join(workspacePath, ...location.dir.split("/").filter(Boolean));
}

/** ノードのファイル（旧メモならメモのファイル）。 */
function fileOfLocation(workspacePath, location) {
  return path.join(absoluteDir(workspacePath, location), location.file);
}

/**
 * ファイルの中身から本文を取り出す。読み込み（eager）で得られるものと同じ値になる。
 *
 * @param {string} text
 * @param {{ id: string }} node
 * @param {{ dir: string, file: string, memo?: boolean }} location
 * @returns {{ body: any, format: string }}
 */
function bodyFromText(text, node, location) {
  if (location.memo) {
    const memo = buildMemoEntry(location.file, 0, text, true, location.dir);
    return { body: memo.content, format: memo.format };
  }
  const { data, body } = parseFrontmatterDetailed(text);
  // 本文の読み方は、ファイルが宣言する形式に従う（メモリ上のノードの形式ではなく）。
  const format = normalizeMemoFormat(data.format, "markdown");
  return { body: parseNodeBody(body, format), format };
}

/**
 * ノードの本文を読む。
 *
 * @param {string} workspacePath
 * @param {{ id: string, format?: string }} node
 * @param {{ dir: string, file: string, memo?: boolean }} location
 * @returns {Promise<{ body: any, format: string, text: string }>} `text` はファイルの中身
 *   （外から変えられたかの照合に使う）
 */
async function readBody(workspacePath, node, location) {
  const file = fileOfLocation(workspacePath, location);
  let text;
  try {
    text = await fs.promises.readFile(file, "utf8");
  } catch (error) {
    throw new Error(
      `本文を読めませんでした: ${location.dir ? `${location.dir}/` : ""}${location.file}（${error.message}）`,
      { cause: error }
    );
  }
  return { ...bodyFromText(text, node, location), text };
}

/** 本文の照合用の値（外から変えられたかの判定）。 */
function bodyHashSource(text) {
  return splitFrontmatterRaw(text).body;
}

module.exports = { absoluteDir, fileOfLocation, bodyFromText, readBody, bodyHashSource };
