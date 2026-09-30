/**
 * 削除したノードのファイルを、履歴が戻せる間だけ取っておく場所。
 *
 * ノードを消す（元に戻すで作成を取り消す場合も同じ）と、そのノードの
 * フォルダーを `.task-manage/trash/<seq>/<node-id>/` へ移す。履歴の同じ段を
 * 戻す（やり直す）と、元の場所へ戻る。だから、削除を元に戻すと本文だけでなく
 * 画像と添付も戻る。履歴から消えた段のごみ箱は `collectTrash` が片付ける。
 */
const fs = require("fs");
const path = require("path");
const { retryFileOperation } = require("../workspace");
const { STORE_DIR, NODE_FILE } = require("./loader");
const { nodeDirName } = require("./layout");

/** ノードのファイルと一緒に動かすフォルダー（画像・添付）。 */
const OWN_DIRS = ["assets", "attachments"];

function trashRoot(workspacePath) {
  return path.join(workspacePath, STORE_DIR, "trash");
}

function trashDirFor(workspacePath, seq, id) {
  return path.join(trashRoot(workspacePath), String(seq), nodeDirName(id));
}

function absolute(workspacePath, location) {
  return path.join(workspacePath, ...location.dir.split("/").filter(Boolean));
}

async function exists(target) {
  return fs.promises.access(target).then(
    () => true,
    () => false
  );
}

/** 移す。元がもう無ければ（外で消された）何もしない。 */
async function move(from, to) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  try {
    await retryFileOperation(() => fs.promises.rename(from, to));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

/** ノードのファイルをごみ箱へ移す。 */
async function moveToTrash(workspacePath, location, id, seq) {
  const trashDir = trashDirFor(workspacePath, seq, id);
  await fs.promises.rm(trashDir, { recursive: true, force: true });
  const dir = absolute(workspacePath, location);
  if (location.memo) {
    // 旧メモのファイル 1 つ（フォルダーは親のもの）。
    await move(path.join(dir, location.file), path.join(trashDir, location.file));
    return;
  }
  if (location.file === NODE_FILE) {
    // ノードのフォルダーごと。
    await move(dir, trashDir);
    return;
  }
  // プロジェクトのルート: フォルダーには他のノードのフォルダーもあるので、
  // このノード自身のファイルだけを移す。
  await fs.promises.mkdir(trashDir, { recursive: true });
  for (const name of [location.file, ...OWN_DIRS]) {
    if (await exists(path.join(dir, name)))
      await move(path.join(dir, name), path.join(trashDir, name));
  }
  // 空になったプロジェクトのフォルダーは残さない。
  await fs.promises.rmdir(dir).catch(() => {});
}

/**
 * ごみ箱から元の場所へ戻す。ごみ箱に無ければ何もしない（null）。
 * 元の場所に別のフォルダーができていたら、別の名前で戻す。
 *
 * @returns {Promise<{ dir: string, file: string, memo?: boolean } | null>} 戻した場所
 */
async function restoreFromTrash(workspacePath, location, id, seq) {
  const trashDir = trashDirFor(workspacePath, seq, id);
  if (!(await exists(trashDir))) return null;
  let target = location;
  if (location.memo) {
    await move(
      path.join(trashDir, location.file),
      path.join(absolute(workspacePath, location), location.file)
    );
  } else if (location.file === NODE_FILE) {
    let dir = location.dir;
    for (let index = 2; await exists(absolute(workspacePath, { dir })); index += 1)
      dir = `${location.dir}-${index}`;
    target = { ...location, dir };
    await move(trashDir, absolute(workspacePath, target));
  } else {
    let dir = location.dir;
    // プロジェクトのフォルダーが別のものに使われていたら、別の名前にする。
    const project = absolute(workspacePath, location);
    if (await exists(path.join(project, location.file))) {
      for (let index = 2; await exists(absolute(workspacePath, { dir })); index += 1)
        dir = `${location.dir}-${index}`;
      target = { ...location, dir };
    }
    const destination = absolute(workspacePath, target);
    await fs.promises.mkdir(destination, { recursive: true });
    for (const name of await fs.promises.readdir(trashDir))
      await move(path.join(trashDir, name), path.join(destination, name));
  }
  await fs.promises.rm(trashDir, { recursive: true, force: true });
  return target;
}

/** 履歴に残っていない段のごみ箱を消す。 */
async function collectTrash(workspacePath, retainedSeqs) {
  let names;
  try {
    names = await fs.promises.readdir(trashRoot(workspacePath));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    if (retainedSeqs.has(Number(name))) continue;
    await fs.promises
      .rm(path.join(trashRoot(workspacePath), name), { recursive: true, force: true })
      .catch(() => {});
  }
}

module.exports = { moveToTrash, restoreFromTrash, collectTrash };
