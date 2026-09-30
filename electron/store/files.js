/**
 * ノードのフォルダーの中身（画像・添付）を扱う小さな道具。
 */
const fs = require("fs");
const path = require("path");
const { retryFileOperation } = require("../workspace");

/** 画像の拡張子（MIME タイプから）。 */
function extensionFromMimeType(mimeType) {
  const known = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
  };
  return known[String(mimeType || "").toLowerCase()] ?? "png";
}

/** ファイル名として安全な名前にする（フォルダー部分・制御文字・禁止文字を落とす）。 */
function safeFileName(fileName, fallback = "attachment") {
  const baseName = path
    .basename(String(fileName || fallback).replace(/\\/g, "/"))
    // eslint-disable-next-line no-control-regex -- Windows では制御文字をファイル名に使えない
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .replace(/[. ]+$/, "");
  if (!baseName || baseName === "." || baseName === "..") return fallback;
  return baseName;
}

async function exists(target) {
  return fs.promises.access(target).then(
    () => true,
    () => false
  );
}

/** まだ無いファイル名にする（あれば `name-2.ext`、`name-3.ext`…）。 */
async function uniqueFileName(dir, fileName) {
  const safe = safeFileName(fileName);
  if (!(await exists(path.join(dir, safe)))) return safe;
  const extension = path.extname(safe);
  const stem = path.basename(safe, extension) || "attachment";
  for (let index = 2; ; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!(await exists(path.join(dir, candidate)))) return candidate;
  }
}

/**
 * `source` の中身を `destination` へ写す（すでにあるファイルは上書きしない）。
 * シンボリックリンクは写さない（ワークスペースの外を指せてしまう）。
 *
 * @returns {Promise<boolean>} 何かを写したか
 */
async function copyDirectory(source, destination) {
  let entries;
  try {
    entries = await fs.promises.readdir(source, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
  let copied = false;
  await fs.promises.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copied = (await copyDirectory(from, to)) || copied;
    } else if (entry.isFile() && !(await exists(to))) {
      await retryFileOperation(() => fs.promises.copyFile(from, to));
      copied = true;
    }
  }
  return copied;
}

/**
 * 本文が参照している `assets/` のファイル名を拾う。
 *
 * Markdown は `![](./assets/x.png)`、Quill は `{insert:{image:"./assets/x.png"}}`
 * の形で持つ。どちらも JSON 文字列にしてしまえば同じ 1 本の正規表現で拾える。
 */
function referencedAssetNames(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const names = new Set();
  const pattern = /(?:\.\/)?assets\/([^)\s"'\\]+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    try {
      names.add(decodeURIComponent(match[1]));
    } catch {
      names.add(match[1]);
    }
  }
  return [...names];
}

/**
 * 本文が参照している画像だけを、別のフォルダーの `assets/` へ写す。
 * 旧メモ（親のフォルダーの `assets/` を見ていた）を自分のフォルダーへ移すときに使う。
 * コピーであって移動ではない（同じ画像を親の本文も参照していることがある）。
 */
async function copyReferencedAssets(sourceDir, targetDir, body) {
  const targetAssets = path.join(targetDir, "assets");
  let created = false;
  for (const name of referencedAssetNames(body)) {
    // 外へ出る名前は運ばない（`assets/` 直下のファイルだけが対象）。
    if (name.includes("/") || name.includes("\\") || name.includes("\0")) continue;
    const from = path.join(sourceDir, "assets", name);
    const to = path.join(targetAssets, name);
    if (!(await exists(from)) || (await exists(to))) continue;
    if (!created) {
      await fs.promises.mkdir(targetAssets, { recursive: true });
      created = true;
    }
    await retryFileOperation(() => fs.promises.copyFile(from, to));
  }
}

module.exports = {
  extensionFromMimeType,
  safeFileName,
  uniqueFileName,
  copyDirectory,
  copyReferencedAssets,
  referencedAssetNames,
  exists,
};
