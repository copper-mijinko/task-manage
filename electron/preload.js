const { contextBridge, ipcRenderer } = require("electron");

/** @typedef {import("../src/types/app").ElectronAPI} ElectronAPI */
/** @typedef {import("../src/types/app").FindInPageResult} FindInPageResult */
/** @typedef {import("../src/types/workspace").WorkspaceTask} WorkspaceTask */
/** @typedef {import("../src/types/workspace").WorkspaceInfo} WorkspaceInfo */

/** @type {ElectronAPI} */
const electronAPI = {
  setTreeData: (tree_data) => ipcRenderer.send("set-tree-data", tree_data),
  getTreeData: (project_name) => ipcRenderer.invoke("get-tree-data", project_name),
  getMetaData: (key) => ipcRenderer.invoke("get-meta-data", key),
  setMetaData: (key, value) => ipcRenderer.send("set-meta-data", key, value),
  deleteMetaData: (key) => ipcRenderer.send("delete-meta-data", key),
  getInitialTreeData: () => ipcRenderer.invoke("get-initial-tree-data"),
  getProjectIDs: () => ipcRenderer.invoke("get-project-ids"),
  setProjectOrder: (projects) => ipcRenderer.send("set-project-order", projects),
  addProject: (project) => ipcRenderer.send("add-project", project),
  deleteProject: (project_id) => ipcRenderer.send("delete-project", project_id),
  message: (message) => {
    ipcRenderer.send("message", message);
  },
  openExternalLink: (url) => {
    ipcRenderer.send("open-external-link", url);
  },
  // タスク詳細ウィンドウを開く
  openTaskDetailWindow: (detailData) => {
    ipcRenderer.send("open-task-detail-window", detailData);
  },
  // 画面内検索機能 - シンプル実装
  findInPage: (text, options) => {
    return ipcRenderer.invoke("find-in-page", text, options);
  },
  findInPageNext: (text) => {
    return ipcRenderer.invoke("find-in-page-next", text);
  },
  findInPagePrevious: (text) => {
    return ipcRenderer.invoke("find-in-page-previous", text);
  },
  stopFindInPage: () => {
    ipcRenderer.send("stop-find-in-page");
  },
  // 検索結果更新イベント
  onSearchResultUpdated: (callback) => {
    ipcRenderer.on("search-result-updated", (event, result) => {
      callback(/** @type {FindInPageResult} */ (result));
    });
  },
  // テーマ変更の通知を受け取る
  onThemeChanged: (callback) => {
    ipcRenderer.on("theme-changed", (event, theme) => {
      callback(theme);
    });
  },
  onTreeDataUpdated: (callback) => {
    ipcRenderer.on("tree-data-updated", (event, treeData) => {
      callback(treeData);
    });
  },
  onProjectDeleted: (callback) => {
    ipcRenderer.on("project-deleted", (event, projectId) => {
      callback(projectId);
    });
  },
  onSaveError: (callback) => {
    ipcRenderer.on("save-error", (event, message) => {
      callback(/** @type {string} */ (message));
    });
  },
  // 現在のテーマを取得する
  getCurrentTheme: () => {
    return ipcRenderer.invoke("get-current-theme");
  },

  // ワークスペース操作
  wsGetWorkspaces: () => ipcRenderer.invoke("ws:get-workspaces"),
  wsSetWorkspaces: (config) => ipcRenderer.send("ws:set-workspaces", config),
  wsListProjects: (workspacePath) => ipcRenderer.invoke("ws:list-projects", { workspacePath }),
  wsReadProject: (projectDir) => ipcRenderer.invoke("ws:read-project", { projectDir }),
  wsWriteTask: (projectDir, task) => ipcRenderer.invoke("ws:write-task", { projectDir, task }),
  wsSaveMemoImage: (projectDir, taskId, bytes, mimeType) =>
    ipcRenderer.invoke("ws:save-memo-image", { projectDir, taskId, bytes, mimeType }),
  wsResolveMemoAsset: (projectDir, taskId, assetPath) =>
    ipcRenderer.invoke("ws:resolve-memo-asset", { projectDir, taskId, assetPath }),
  wsWriteProject: (projectDir, tasks) =>
    ipcRenderer.invoke("ws:write-project", { projectDir, tasks }),
  wsDeleteTask: (projectDir, taskId) =>
    ipcRenderer.invoke("ws:delete-task", { projectDir, taskId }),
  wsCreateProject: (workspacePath, name, id) =>
    ipcRenderer.invoke("ws:create-project", { workspacePath, name, id }),
  wsDeleteProject: (projectDir) =>
    ipcRenderer.invoke("ws:delete-project", { projectDir }),
  wsSelectDirectory: () => ipcRenderer.invoke("ws:select-directory"),
  wsGetLegacyProjects: () => ipcRenderer.invoke("ws:get-legacy-projects"),
  wsExportLegacyProjects: (workspacePath) =>
    ipcRenderer.invoke("ws:export-legacy-projects", { workspacePath }),
  wsMigrateProjects: (workspacePath) =>
    ipcRenderer.invoke("ws:migrate-projects", { workspacePath }),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
