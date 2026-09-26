const { app, BrowserWindow, screen } = require("electron");
const { usePortableDataDirectory, resolveAppDataPath } = require("./app-paths");
// ポータブル版（実行ファイルの隣に data フォルダがある）なら、利用者データ
// 領域をそこへ移す。ログや localStorage の置き場所も決まるので、ほかの
// モジュールを読み込む前に行う。
const portableDataDirectory = usePortableDataDirectory(app);
const path = require("path");
const { performance } = require("perf_hooks");
const log = require("electron-log/main");
const workspaceGraph = require("./workspace-graph");
const { createSettingsStore } = require("./settings-store");
const { createIpcRegistrar, broadcast } = require("./ipc-registrar");
const { loadWindowState, trackWindowState } = require("./window-state");
const { configureAgentDebugging } = require("./agent-debug");
const { performanceMetrics } = require("./performance-metrics");
const { createIpcSenderValidator, createWorkspaceAuthorizer } = require("./ipc-security");
const {
  attachZoomControls,
  denyRendererNavigation,
  forwardWindowState,
  registerWindowControlIpc,
} = require("./window-controls");
const { registerSettingsIpc } = require("./ipc/settings-ipc");
const { registerExternalIpc } = require("./ipc/external-ipc");
const { registerFindInPageIpc, forwardFindInPageResults } = require("./ipc/find-in-page-ipc");
const { registerWorkspaceIpc } = require("./ipc/workspace-ipc");
const { registerTaskDetailWindows } = require("./task-detail-window");

const agentDebugging = configureAgentDebugging(app);
if (portableDataDirectory) {
  log.info(`Portable mode: storing data in ${portableDataDirectory}`);
}
if (agentDebugging) {
  log.info(`Agent UI debugging enabled at http://${agentDebugging.host}:${agentDebugging.port}`);
}

function shouldOpenDevTools() {
  const testLikeEnvironment =
    process.env.NODE_ENV === "test" ||
    process.env.PLAYWRIGHT_TEST === "true" ||
    process.env.TASK_MANAGE_OPEN_DEVTOOLS === "false";
  return !app.isPackaged && !testLikeEnvironment;
}

function createMainWindow() {
  // 前回終了時の大きさ・位置を復元する。ウィンドウを作る前に要るので、
  // 専用の小さな状態ファイルだけを同期で読む。
  const windowStateFile = resolveAppDataPath("window-state.json");
  const windowState = loadWindowState(windowStateFile, screen.getAllDisplays());
  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      zoomFactor: 1.0,
      ...(agentDebugging ? { backgroundThrottling: false } : {}),
    },
    width: windowState.width,
    height: windowState.height,
    ...(windowState.x !== undefined && windowState.y !== undefined
      ? { x: windowState.x, y: windowState.y }
      : {}),
    minWidth: windowState.minWidth,
    minHeight: windowState.minHeight,
    frame: false,
    titleBarStyle: "hidden",
  });
  if (windowState.isMaximized) win.maximize();
  trackWindowState(win, windowStateFile);

  win.webContents.once("dom-ready", () => {
    performanceMetrics.record("startup.processToDomReady", performance.now());
  });
  win.webContents.once("did-finish-load", () => {
    performanceMetrics.record("startup.processToLoadFinished", performance.now());
  });
  attachZoomControls(win);
  denyRendererNavigation(win);
  forwardWindowState(win);
  forwardFindInPageResults(win.webContents);
  return win;
}

app.on("ready", () => {
  const appReadyAt = performance.now();
  performanceMetrics.record("startup.processToAppReady", appReadyAt);

  let mainWindow = createMainWindow();
  performanceMetrics.record("startup.appReadyToBrowserWindow", performance.now() - appReadyAt);

  const settings = createSettingsStore({
    filePath: resolveAppDataPath("meta.json"),
    defaults: { theme: "dark" },
    onError: (err) => {
      log.error("Failed to write settings:", err.message);
      broadcast("save-error", `Failed to save data: ${err.message}`);
    },
  });

  /** @returns {string[]} */
  const knownWorkspacePaths = () => {
    const workspaces = /** @type {{ path: string }[]} */ (settings.get("workspaces") || []);
    const active = /** @type {string | undefined} */ (settings.get("activeWorkspace"));
    return [...workspaces.map((item) => item.path), active].filter(Boolean);
  };
  const workspaceAuthorizer = createWorkspaceAuthorizer({ getWorkspacePaths: knownWorkspacePaths });
  const ipc = createIpcRegistrar(
    createIpcSenderValidator({
      rendererDirectory: path.join(__dirname, "../renderer"),
      devOrigins: process.env.VITE_DEV === "true" ? ["http://localhost:5173"] : [],
    })
  );

  registerSettingsIpc(ipc, settings);
  registerExternalIpc(ipc, workspaceAuthorizer);
  registerFindInPageIpc(ipc);
  registerWindowControlIpc(ipc);
  const workspaceApplication = registerWorkspaceIpc(ipc, {
    settings,
    workspaceAuthorizer,
    knownWorkspacePaths,
  });
  const detailWindows = registerTaskDetailWindows(ipc, {
    getMainWindow: () => mainWindow,
    readGraph: (workspacePath) => workspaceApplication.read(workspacePath),
  });

  if (process.env.VITE_DEV === "true") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  if (shouldOpenDevTools()) mainWindow.webContents.openDevTools();

  mainWindow.on("closed", () => {
    mainWindow = null;
    detailWindows.closeAll();
  });

  // グラフの保存は操作ごとに一時ファイルへ書いてから置き換えるので、途中で
  // 落ちても壊れない。それでも書きかけの操作は失いたくないので、終了前に
  // 待ち行列が空くのを待つ。
  let quitting = false;
  app.on("before-quit", (event) => {
    settings.flush();
    if (performanceMetrics.enabled) {
      log.info(`[perf-summary] ${JSON.stringify(performanceMetrics.summary())}`);
    }
    if (quitting || !workspaceGraph.hasPendingWrites()) return;
    event.preventDefault();
    quitting = true;
    workspaceGraph
      .whenIdle()
      .catch((err) => log.error("workspace graph flush error:", err.message))
      .finally(() => app.quit());
  });
});
