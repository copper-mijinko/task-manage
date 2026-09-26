const { shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const log = require("electron-log/main");

/** Windows の「プログラムから開く」でファイルを開く。 */
function openPathWithProgramPicker(filePath) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Open with is only supported on Windows"));
  }

  return new Promise((resolve, reject) => {
    // Use the Windows Open With handler directly. Its normal argument parsing
    // supports quoted paths, including spaces and non-ASCII file names.
    const executable = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "OpenWith.exe"
    );
    const child = spawn(executable, [filePath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    let settled = false;

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}

/**
 * フォルダーを OS のファイルマネージャーで開く。
 *
 * Windows の `shell.openPath` は同期的なシェル連携を通るため 1〜3 秒以上
 * 止まることがある。explorer.exe を直接起動すればすぐ開く。`dir` の検証
 * （登録済みワークスペースの内側か）は呼び出し側の責任。
 */
function openDirectoryInExplorer(dir) {
  if (process.platform !== "win32") {
    return shell
      .openPath(dir)
      .then((openError) => (openError ? { success: false, error: openError } : { success: true }));
  }

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn("explorer.exe", [dir], {
      detached: true,
      stdio: "ignore",
    });

    // explorer.exe's exit code is unreliable — it frequently returns 1 even on
    // success — so we do NOT treat a nonzero exit as failure. Only a spawn error
    // (e.g. explorer.exe not found) is a real failure.
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      log.error("Failed to launch explorer.exe:", err.message);
      resolve({ success: false, error: err.message });
    });

    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve({ success: true });
    });
  });
}

module.exports = { openPathWithProgramPicker, openDirectoryInExplorer };
