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
  onWorkspaceSaveStatus: (callback) => {
    ipcRenderer.on("workspace-save-status", (event, payload) => {
      callback(payload);
    });
  },
  onWorkspaceProjectUpdated: (callback) => {
    ipcRenderer.on("workspace-project-updated", (event, payload) => {
      callback(payload);
    });
  },
  onWorkspaceConflict: (callback) => {
    ipcRenderer.on("workspace-conflict", (event, payload) => {
      callback(payload);
    });
  },
  onWorkspaceNotice: (callback) => {
    ipcRenderer.on("workspace-notice", (event, payload) => {
      callback(payload);
    });
  },
  onWorkspaceFlushStart: (callback) => {
    ipcRenderer.on("workspace-flush-start", (event, payload) => {
      callback(payload);
    });
  },
  onWorkspaceFlushComplete: (callback) => {
    ipcRenderer.on("workspace-flush-complete", (event, payload) => {
      callback(payload);
    });
  },
  // 現在のテーマを取得する
  getCurrentTheme: () => {
    return ipcRenderer.invoke("get-current-theme");
  },

  // ウィンドウ制御
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  windowClose: () => ipcRenderer.send("window:close"),
  windowGetState: () => ipcRenderer.invoke("window:get-state"),
  onWindowStateChanged: (callback) => {
    ipcRenderer.on("window-state-changed", (event, state) => {
      callback(state);
    });
  },

  // ワークスペース操作
  wsGetWorkspaces: () => ipcRenderer.invoke("ws:get-workspaces"),
  wsSetWorkspaces: (config) => ipcRenderer.send("ws:set-workspaces", config),
  wsListProjects: (workspacePath) => ipcRenderer.invoke("ws:list-projects", { workspacePath }),
  wsSetProjectOrder: (workspacePath, projects) =>
    ipcRenderer.invoke("ws:set-project-order", { workspacePath, projects }),
  wsReadProject: (projectDir) => ipcRenderer.invoke("ws:read-project", { projectDir }),
  wsWriteTask: (projectDir, task) => ipcRenderer.invoke("ws:write-task", { projectDir, task }),
  wsSaveMemoImage: (projectDir, taskId, bytes, mimeType) =>
    ipcRenderer.invoke("ws:save-memo-image", { projectDir, taskId, bytes, mimeType }),
  wsResolveMemoAsset: (projectDir, taskId, assetPath) =>
    ipcRenderer.invoke("ws:resolve-memo-asset", { projectDir, taskId, assetPath }),
  wsWriteProject: (projectDir, tasks, options) =>
    ipcRenderer.invoke("ws:write-project", { projectDir, tasks, options }),
  wsDeleteTask: (projectDir, taskId) =>
    ipcRenderer.invoke("ws:delete-task", { projectDir, taskId }),
  wsCreateProject: (workspacePath, name, id, order) =>
    ipcRenderer.invoke("ws:create-project", { workspacePath, name, id, order }),
  wsDeleteProject: (projectDir) => ipcRenderer.invoke("ws:delete-project", { projectDir }),
  wsResolveConflict: (projectDir, action) =>
    ipcRenderer.invoke("ws:resolve-conflict", { projectDir, action }),
  wsOpenWorkspace: (workspacePath) => ipcRenderer.invoke("ws:open-workspace", { workspacePath }),
  wsOpenTaskFolder: (projectDir, taskId) =>
    ipcRenderer.invoke("ws:open-task-folder", { projectDir, taskId }),
  wsSelectDirectory: () => ipcRenderer.invoke("ws:select-directory"),
  wsGetLegacyProjects: () => ipcRenderer.invoke("ws:get-legacy-projects"),
  wsExportLegacyProjects: (workspacePath, options) =>
    ipcRenderer.invoke("ws:export-legacy-projects", { workspacePath, options }),
  wsMigrateProjects: (workspacePath, options) =>
    ipcRenderer.invoke("ws:migrate-projects", { workspacePath, options }),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
