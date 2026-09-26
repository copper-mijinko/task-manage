const fs = require("fs");
const path = require("path");

/**
 * アプリ設定（`meta.json`）の読み書き。
 *
 * 起動時に同期で読み、変更は少し待ってまとめて書く。書き込みは一時ファイルへ
 * 書いてから置き換えるので、途中で落ちても前の内容が残る。終了時は `flush()`
 * で待ち分を同期で書き切る。
 *
 * @param {object} options
 * @param {string} options.filePath
 * @param {Record<string, unknown>} options.defaults ファイルが無い・読めないときの初期値
 * @param {(error: Error) => void} [options.onError] 書き込みに失敗したとき
 * @param {number} [options.debounceMs]
 */
function createSettingsStore({ filePath, defaults, onError = () => {}, debounceMs = 100 }) {
  /** @type {Record<string, unknown>} */
  let data = readInitial(filePath, defaults);
  let timer = null;
  let writing = null;
  let dirty = false;
  // 非同期の書き込み中に flush() が同期で書くと、後から終わった非同期側の
  // 置き換えが古い内容で上書きしてしまう。版を数えて、そうなったら書き直す。
  let version = 0;
  let flushedVersion = -1;

  function serialized() {
    return JSON.stringify(data, null, 2);
  }

  async function writeNow() {
    if (writing) {
      dirty = true;
      return writing;
    }
    dirty = false;
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    const writtenVersion = version;
    writing = (async () => {
      try {
        await fs.promises.writeFile(tmpPath, serialized(), "utf8");
        await fs.promises.rename(tmpPath, filePath);
        if (flushedVersion > writtenVersion) writeSync();
      } catch (error) {
        await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
        onError(error);
      } finally {
        writing = null;
        if (dirty) void writeNow();
      }
    })();
    return writing;
  }

  function writeSync() {
    const tmpPath = `${filePath}.${process.pid}.sync.tmp`;
    try {
      fs.writeFileSync(tmpPath, serialized(), "utf8");
      fs.renameSync(tmpPath, filePath);
    } catch (error) {
      fs.rmSync(tmpPath, { force: true });
      onError(error);
    }
  }

  function schedule() {
    version += 1;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void writeNow();
    }, debounceMs);
  }

  return {
    get(key) {
      return data[key];
    },
    set(key, value) {
      data[key] = value;
      schedule();
    },
    delete(key) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
      delete data[key];
      schedule();
      return true;
    },
    /** 終了時に呼ぶ。待っている変更を同期で書き切る。 */
    flush() {
      if (!timer && !dirty && !writing) return;
      if (timer) clearTimeout(timer);
      timer = null;
      dirty = false;
      flushedVersion = version;
      writeSync();
    },
  };
}

function readInitial(filePath, defaults) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    if (error.code !== "ENOENT") {
      // 壊れたファイルは消さずに残しておき、初期値で起動する。
      const backup = `${filePath}.broken-${Date.now()}`;
      try {
        fs.copyFileSync(filePath, backup);
      } catch {
        // 退避できなくても起動は続ける。
      }
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return { ...defaults };
}

module.exports = { createSettingsStore };
