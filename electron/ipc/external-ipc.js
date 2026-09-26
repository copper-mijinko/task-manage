const { BrowserWindow, shell } = require("electron");
const fs = require("fs");
const { fileURLToPath } = require("url");
const log = require("electron-log/main");
const { parseAllowedExternalUrl } = require("../ipc-security");
const { attachZoomControls } = require("../window-controls");

/**
 * 外部リンクと画像を開く IPC。
 *
 * @param {ReturnType<import("../ipc-registrar").createIpcRegistrar>} ipc
 * @param {{ isInsideKnownWorkspace: (filePath: string) => Promise<boolean> }} workspaceAuthorizer
 */
function registerExternalIpc(ipc, workspaceAuthorizer) {
  ipc.on("open-external-link", (_event, url) => {
    const safeUrl = parseAllowedExternalUrl(url);
    if (!safeUrl) {
      log.warn("Blocked an external link with an unsupported protocol");
      return;
    }
    shell.openExternal(safeUrl).catch((err) => {
      log.error("Failed to open external link:", err);
    });
  });

  // 描画した Markdown の画像を OS の既定アプリで開く。file:// は登録済み
  // ワークスペースの内側だけを許し、レンダラーが渡した任意のパスへ
  // 出られないようにする。HTTP(S) は既定のブラウザに任せ、data URL は
  // 内部ビューア（open-image-window）へ回す。
  ipc.handle("open-image-external", async (_event, src) => {
    if (!src || typeof src !== "string") {
      return { success: false, fallback: true, error: "No image source was provided" };
    }

    try {
      const url = new URL(src);
      if (url.protocol === "http:" || url.protocol === "https:") {
        const safeUrl = parseAllowedExternalUrl(src);
        if (!safeUrl) throw new Error("Unsupported image URL");
        await shell.openExternal(safeUrl);
        return { success: true };
      }

      if (url.protocol !== "file:") {
        return { success: false, fallback: true, error: "Unsupported image source" };
      }

      const filePath = fileURLToPath(url);
      if (!(await workspaceAuthorizer.isInsideKnownWorkspace(filePath))) {
        return { success: false, error: "Image is outside a registered workspace" };
      }

      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        return { success: false, error: "Image file was not found" };
      }

      const openError = await shell.openPath(filePath);
      return openError ? { success: false, error: openError } : { success: true };
    } catch (err) {
      log.error("Failed to open image externally:", err);
      return { success: false, error: err.message };
    }
  });

  // 本文に埋め込まれたラスター画像の data URL を、隔離した BrowserWindow で
  // 拡大表示する。SVG や任意の文書 URL は受け付けない。
  let imageWindowSequence = 0;
  ipc.on("open-image-window", (_event, src) => {
    if (
      typeof src !== "string" ||
      !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src)
    ) {
      log.warn("Blocked an unsupported internal image source");
      return;
    }
    try {
      const win = new BrowserWindow({
        width: 960,
        height: 720,
        title: "Image",
        autoHideMenuBar: true,
        backgroundColor: "#1f1f1f",
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          zoomFactor: 1.0,
          // ウィンドウごとに使い捨てのメモリ上セッションにする。共有セッションは
          // キャッシュと倍率を持ち越すため、同じ画像を 2 回目に開くと白くなる
          // ことがあった。
          partition: `image-window-${++imageWindowSequence}`,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      attachZoomControls(win, { allowEscapeClose: true });

      let retried = false;
      win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
        // -3 (ERR_ABORTED) fires for benign cases (e.g. window closed mid-load).
        if (errorCode === -3) return;
        log.error(
          `Image window load failed (${errorCode} ${errorDescription}) for ${validatedURL}`
        );
        if (retried || win.isDestroyed()) return;
        retried = true;
        win.loadURL(src, { extraHeaders: "pragma: no-cache\n" }).catch((err) => {
          log.error("Image window retry load failed:", err);
        });
      });

      win.loadURL(src, { extraHeaders: "pragma: no-cache\n" }).catch((err) => {
        log.error("Failed to load image window:", err);
      });
    } catch (err) {
      log.error("Failed to open image window:", err);
    }
  });
}

module.exports = { registerExternalIpc };
