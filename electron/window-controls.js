const { BrowserWindow } = require("electron");

const ZOOM_STEP = 0.5;
const MIN_ZOOM_LEVEL = -5;
const MAX_ZOOM_LEVEL = 5;

function clampZoom(level) {
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, level));
}

/** 表示倍率を 1 段変える。戻り値は変更後の倍率（%）。 */
function changeWindowZoom(contents, action) {
  const current = contents.getZoomLevel();
  const next =
    action === "reset"
      ? 0
      : action === "in"
        ? current + ZOOM_STEP
        : action === "out"
          ? current - ZOOM_STEP
          : current;
  contents.setZoomLevel(clampZoom(next));
  return Math.round(contents.getZoomFactor() * 100);
}

/**
 * すべての BrowserWindow に共通の倍率操作。Ctrl/Cmd と + / = / - / 0 で倍率を
 * 変え、Ctrl + ホイールは Chromium が zoom-changed として送ってくる。
 * `allowEscapeClose` は Esc で閉じてよいウィンドウ（画像ビューア）だけに使う。
 */
function attachZoomControls(win, { allowEscapeClose = false } = {}) {
  win.webContents.setVisualZoomLevelLimits(1, 5).catch(() => {});

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = input.control || input.meta;
    if (mod) {
      if (input.key === "=" || input.key === "+") {
        changeWindowZoom(win.webContents, "in");
        event.preventDefault();
      } else if (input.key === "-") {
        changeWindowZoom(win.webContents, "out");
        event.preventDefault();
      } else if (input.key === "0") {
        changeWindowZoom(win.webContents, "reset");
        event.preventDefault();
      }
    } else if (allowEscapeClose && input.key === "Escape") {
      win.close();
      event.preventDefault();
    }
  });

  win.webContents.on("zoom-changed", (_, zoomDirection) => {
    const current = win.webContents.getZoomLevel();
    win.webContents.setZoomLevel(
      clampZoom(current + (zoomDirection === "in" ? ZOOM_STEP : -ZOOM_STEP))
    );
  });
}

function denyRendererNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
}

/** 最大化・全画面の変化を、そのウィンドウのレンダラーへ知らせる。 */
function forwardWindowState(win) {
  const send = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("window-state-changed", {
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
    });
  };
  for (const eventName of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    win.on(eventName, send);
  }
}

/** フレームなしウィンドウ用の最小化・最大化・閉じる・倍率の IPC。 */
function registerWindowControlIpc(ipc) {
  const targetWindow = (event) => BrowserWindow.fromWebContents(event.sender);

  ipc.on("window:minimize", (event) => {
    const win = targetWindow(event);
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipc.on("window:toggle-maximize", (event) => {
    const win = targetWindow(event);
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipc.on("window:close", (event) => {
    const win = targetWindow(event);
    if (win && !win.isDestroyed()) win.close();
  });
  ipc.handle("window:zoom", (event, action) => changeWindowZoom(event.sender, action));
  ipc.handle("window:get-state", (event) => {
    const win = targetWindow(event);
    if (!win || win.isDestroyed()) return { isMaximized: false, isFullScreen: false };
    return { isMaximized: win.isMaximized(), isFullScreen: win.isFullScreen() };
  });
}

module.exports = {
  attachZoomControls,
  changeWindowZoom,
  denyRendererNavigation,
  forwardWindowState,
  registerWindowControlIpc,
};
