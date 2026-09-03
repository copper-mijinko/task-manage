import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

/**
 * `npm run dev` / `npm run dev:agent` から Electron を起動するときの、
 * 環境差を吸収するヘルパー。開発時の vite プラグインからのみ使う。
 *
 * 吸収する差分は 2 つだけで、どちらも「Electron がそもそも起動できない」
 * ケースに限る。
 *
 * 1. root 実行（コンテナ / CI ワークスペース）
 *    Electron は root では `--no-sandbox` なしの起動を拒否する
 *    （`Running as root without --no-sandbox is not supported`）。
 *    root のときだけ dev 起動に限りこのフラグを足す。パッケージ版の
 *    起動経路（`npm run start` 単体、electron-builder 成果物）は通らない。
 *
 * 2. ヘッドレス（$DISPLAY なし）
 *    Xvfb があれば仮想ディスプレイを 1 つ立ち上げ、その DISPLAY を
 *    Electron にだけ渡す。無ければ何もしない（Electron 側のエラーで気付ける）。
 */

const XVFB_DISPLAY_RANGE = { start: 98, end: 120 };

export function isLinux() {
  return process.platform === "linux";
}

export function isRoot() {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/** root 実行時だけ `--no-sandbox` を足した electron 引数を返す。 */
export function electronLaunchArgs(baseArgs = [], { root = isRoot() } = {}) {
  if (!root || baseArgs.includes("--no-sandbox")) return [...baseArgs];
  return [...baseArgs, "--no-sandbox"];
}

export function hasDisplay(env = process.env) {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

function commandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
  return result.status === 0;
}

function displayInUse(displayNumber) {
  return existsSync(`/tmp/.X11-unix/X${displayNumber}`);
}

/**
 * ヘッドレス Linux で Xvfb を起動し、使うべき DISPLAY を返す。
 * 起動できない・不要な場合は null を返す（呼び出し側はそのまま続行する）。
 */
export function ensureVirtualDisplay({ env = process.env, log = () => {} } = {}) {
  if (!isLinux() || hasDisplay(env)) return null;
  if (!commandExists("Xvfb")) {
    log("[agent-ui] $DISPLAY が無く Xvfb も見つかりません。Electron は起動できません。");
    return null;
  }

  for (let display = XVFB_DISPLAY_RANGE.start; display <= XVFB_DISPLAY_RANGE.end; display += 1) {
    if (displayInUse(display)) continue;
    const child = spawn(
      "Xvfb",
      [`:${display}`, "-screen", "0", "1600x1000x24", "-nolisten", "tcp"],
      {
        stdio: "ignore",
        detached: true,
      }
    );
    child.unref();
    process.on("exit", () => {
      try {
        process.kill(-child.pid);
      } catch {
        // 既に終了している場合は何もしない。
      }
    });
    log(`[agent-ui] Xvfb を :${display} で起動しました（$DISPLAY 未設定のため）`);
    return `:${display}`;
  }

  log("[agent-ui] 空いている X ディスプレイ番号が見つかりませんでした。");
  return null;
}

/** CDP ポートが既に使われているかを確認する（多重起動の検知用）。 */
export function isPortListening(port, host = "127.0.0.1", timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
