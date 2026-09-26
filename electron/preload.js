const { contextBridge, ipcRenderer } = require("electron");

/** @typedef {import("../src/types/app").ElectronAPI} ElectronAPI */
/** @typedef {import("../src/types/app").FindInPageResult} FindInPageResult */

/** @param {string} channel */
const listen = (channel) => (callback) => {
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
};

/** @type {ElectronAPI} */
const electronAPI = {
  // 設定（meta.json）
  getMetaData: (key) => ipcRenderer.invoke("get-meta-data", key),
  setMetaData: (key, value) => ipcRenderer.send("set-meta-data", key, value),
  deleteMetaData: (key) => ipcRenderer.send("delete-meta-data", key),
  getCurrentTheme: () => ipcRenderer.invoke("get-current-theme"),
  onThemeChanged: listen("theme-changed"),
  onSaveError: listen("save-error"),
  message: (message) => ipcRenderer.send("message", message),

  // リンク・画像
  openExternalLink: (url) => ipcRenderer.send("open-external-link", url),
  openImageWindow: (src) => ipcRenderer.send("open-image-window", src),
  openImageExternal: (src) => ipcRenderer.invoke("open-image-external", src),

  // ノード詳細ウィンドウ・計測
  openTaskDetailWindow: (detailData) => ipcRenderer.send("open-task-detail-window", detailData),
  reportPerformanceMilestone: (payload) => ipcRenderer.send("perf:renderer-milestone", payload),

  // 画面内検索
  findInPage: (text, options) => ipcRenderer.invoke("find-in-page", text, options),
  findInPageNext: (text) => ipcRenderer.invoke("find-in-page-next", text),
  findInPagePrevious: (text) => ipcRenderer.invoke("find-in-page-previous", text),
  stopFindInPage: () => ipcRenderer.send("stop-find-in-page"),
  onSearchResultUpdated: listen("search-result-updated"),

  // ウィンドウ制御
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  windowClose: () => ipcRenderer.send("window:close"),
  windowGetState: () => ipcRenderer.invoke("window:get-state"),
  windowZoom: (action) => ipcRenderer.invoke("window:zoom", action),
  onWindowStateChanged: listen("window-state-changed"),

  // ワークスペース
  wsGetWorkspaces: () => ipcRenderer.invoke("ws:get-workspaces"),
  wsSetWorkspaces: (config) => ipcRenderer.send("ws:set-workspaces", config),
  wsOpenWorkspace: (workspacePath) => ipcRenderer.invoke("ws:open-workspace", { workspacePath }),
  wsSelectDirectory: () => ipcRenderer.invoke("ws:select-directory"),
  wsReadGraph: (workspacePath) => ipcRenderer.invoke("ws:read-graph", { workspacePath }),
  wsExecuteGraphCommand: (workspacePath, command, origin, expectedRevision) =>
    ipcRenderer.invoke("ws:execute-graph-command", {
      workspacePath,
      command,
      origin,
      expectedRevision,
    }),
  wsUndoGraph: (workspacePath, expectedRevision) =>
    ipcRenderer.invoke("ws:undo-graph", { workspacePath, expectedRevision }),
  wsRedoGraph: (workspacePath, expectedRevision) =>
    ipcRenderer.invoke("ws:redo-graph", { workspacePath, expectedRevision }),
  onWorkspaceGraphUpdated: listen("workspace-graph-updated"),
  wsListMarkdownImports: (workspacePath) =>
    ipcRenderer.invoke("ws:list-markdown-imports", { workspacePath }),
  wsImportMarkdownProjects: (workspacePath, dirNames, expectedRevision) =>
    ipcRenderer.invoke("ws:import-markdown-projects", {
      workspacePath,
      dirNames,
      expectedRevision,
    }),
  wsSaveGraphAsset: (workspacePath, nodeId, fileName, bytes) =>
    ipcRenderer.invoke("ws:save-graph-asset", { workspacePath, nodeId, fileName, bytes }),
  wsResolveGraphAsset: (workspacePath, nodeId, relativePath) =>
    ipcRenderer.invoke("ws:resolve-graph-asset", { workspacePath, nodeId, relativePath }),
  wsOpenGraphAsset: (workspacePath, nodeId, relativePath, chooseProgram) =>
    ipcRenderer.invoke("ws:open-graph-asset", {
      workspacePath,
      nodeId,
      relativePath,
      chooseProgram,
    }),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
