const { BrowserWindow } = require("electron");
const path = require("path");
const { performance } = require("perf_hooks");
const log = require("electron-log/main");
const { performanceMetrics } = require("./performance-metrics");
const {
  attachZoomControls,
  denyRendererNavigation,
  forwardWindowState,
} = require("./window-controls");
const { forwardFindInPageResults } = require("./ipc/find-in-page-ipc");

const ALLOWED_RENDERER_MILESTONES = new Set([
  "startup.mounted",
  "startup.initialWorkspaceVisible",
  "detail.taskDataLoaded",
  "detail.interactive",
]);

/**
 * ノード詳細を別ウィンドウで開く。同じノードのウィンドウが開いていれば
 * 前面に出すだけにする。起動時間の計測（`TASK_MANAGE_PERF`）もここで扱う。
 *
 * @param {ReturnType<import("./ipc-registrar").createIpcRegistrar>} ipc
 * @param {object} deps
 * @param {() => Electron.BrowserWindow | null} deps.getMainWindow
 * @param {(workspacePath: string) => Promise<{ nodes: Record<string, unknown> }>} deps.readGraph
 */
function registerTaskDetailWindows(ipc, { getMainWindow, readGraph }) {
  /** @type {Map<string, Electron.BrowserWindow>} */
  const windows = new Map();
  const performanceRuns = new Map();
  let performanceSequence = 0;

  function createWindow(detail, { requestReceivedAt, requestedAtEpochMs }) {
    const windowKey = `${detail.workspacePath}:${detail.taskId}`;
    const existing = windows.get(windowKey);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      performanceMetrics.record(
        "detail.requestToExistingWindowFocus",
        performance.now() - requestReceivedAt
      );
      return;
    }

    const performanceRunId = `detail-${++performanceSequence}`;
    const win = new BrowserWindow({
      width: 960,
      height: 720,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        zoomFactor: 1.0,
      },
    });
    performanceMetrics.record(
      "detail.requestToBrowserWindowCreated",
      performance.now() - requestReceivedAt
    );
    performanceRuns.set(performanceRunId, {
      requestReceivedAt,
      requestedAtEpochMs,
      webContentsId: win.webContents.id,
    });

    attachZoomControls(win);
    denyRendererNavigation(win);
    forwardWindowState(win);
    forwardFindInPageResults(win.webContents);
    win.webContents.once("dom-ready", () => {
      performanceMetrics.record("detail.requestToDomReady", performance.now() - requestReceivedAt);
    });
    win.webContents.once("did-finish-load", () => {
      performanceMetrics.record(
        "detail.requestToLoadFinished",
        performance.now() - requestReceivedAt
      );
    });

    const query = { ...detail, performanceRunId };
    if (process.env.VITE_DEV === "true") {
      const params = new URLSearchParams(query);
      win.loadURL(`http://localhost:5173/detail.html?${params.toString()}#task-detail-window`);
    } else {
      win.loadFile(path.join(__dirname, "../renderer/detail.html"), {
        hash: "#task-detail-window",
        query,
      });
    }

    windows.set(windowKey, win);
    win.on("closed", () => {
      windows.delete(windowKey);
      performanceRuns.delete(performanceRunId);
    });
    win.once("ready-to-show", () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
      const durationMs = performance.now() - requestReceivedAt;
      performanceMetrics.record("detail.requestToShown", durationMs);
      log.info(`[perf] Task detail shown: ${Math.round(durationMs)}ms (${detail.taskId})`);
    });
  }

  ipc.on("open-task-detail-window", async (_event, request) => {
    const requestReceivedAt = performance.now();
    const requestedAt = Number(request?.requestedAtEpochMs);
    const requestedAtEpochMs =
      Number.isFinite(requestedAt) && requestedAt > 0 && Math.abs(Date.now() - requestedAt) < 60_000
        ? requestedAt
        : null;
    if (requestedAtEpochMs) {
      performanceMetrics.record("detail.clickToRequestReceived", Date.now() - requestedAtEpochMs);
    }
    const detail = {
      workspacePath: String(request?.workspacePath ?? ""),
      projectId: String(request?.projectId ?? ""),
      taskId: String(request?.taskId ?? ""),
      taskName: request?.taskName ? String(request.taskName) : "Task Detail",
      occurrencePath: String(request?.occurrencePath ?? ""),
    };
    try {
      if (!detail.workspacePath || !detail.taskId) throw new Error("Invalid task detail request");
      // 登録済みワークスペースに実在するノードだけを開く。
      const graph = await readGraph(detail.workspacePath);
      if (!graph.nodes[detail.taskId]) throw new Error("Task does not exist in workspace");
      createWindow(detail, { requestReceivedAt, requestedAtEpochMs });
    } catch (error) {
      log.error("Failed to open task detail window:", error);
    }
  });

  ipc.on("perf:renderer-milestone", (event, payload) => {
    const name = payload?.name;
    const durationMs = Number(payload?.durationMs);
    if (!ALLOWED_RENDERER_MILESTONES.has(name) || !Number.isFinite(durationMs)) return;
    if (durationMs < 0 || durationMs > 10 * 60 * 1000) return;

    if (name.startsWith("startup.")) {
      if (event.sender !== getMainWindow()?.webContents) return;
      performanceMetrics.record(`renderer.${name}`, durationMs);
      performanceMetrics.record(
        name === "startup.mounted"
          ? "startup.processToRendererMount"
          : "startup.processToInitialWorkspaceVisible",
        performance.now()
      );
      return;
    }

    const run = performanceRuns.get(payload?.runId);
    if (!run || run.webContentsId !== event.sender.id) return;
    performanceMetrics.record(`renderer.${name}`, durationMs);
    const milestone = name === "detail.taskDataLoaded" ? "TaskDataLoaded" : "Interactive";
    performanceMetrics.record(
      `detail.requestTo${milestone}`,
      performance.now() - run.requestReceivedAt
    );
    if (run.requestedAtEpochMs) {
      performanceMetrics.record(`detail.clickTo${milestone}`, Date.now() - run.requestedAtEpochMs);
    }
  });

  return {
    closeAll() {
      for (const win of windows.values()) if (!win.isDestroyed()) win.destroy();
      windows.clear();
    },
  };
}

module.exports = { registerTaskDetailWindows };
