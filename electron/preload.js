const { contextBridge, ipcRenderer } = require('electron')

/** @typedef {import("../src/types/app").ElectronAPI} ElectronAPI */
/** @typedef {import("../src/types/app").FindInPageResult} FindInPageResult */

/** @type {ElectronAPI} */
const electronAPI = {
  setTreeData: (tree_data) => ipcRenderer.send('set-tree-data', tree_data),
  getTreeData: (project_name) => ipcRenderer.invoke('get-tree-data', project_name),
  getMetaData: (key) => ipcRenderer.invoke('get-meta-data', key),
  setMetaData: (key, value) => ipcRenderer.send('set-meta-data', key, value),
  deleteMetaData: (key) => ipcRenderer.send('delete-meta-data', key),
  getInitialTreeData: () => ipcRenderer.invoke('get-initial-tree-data'),
  getProjectIDs: () => ipcRenderer.invoke('get-project-ids'),
  setProjectOrder: (projects) => ipcRenderer.send('set-project-order', projects),
  addProject: (project) => ipcRenderer.send('add-project', project),
  deleteProject: (project_id) => ipcRenderer.send('delete-project', project_id),
  message: (message) => {
    ipcRenderer.send('message', message);
  },
  openExternalLink: (url) => {
    ipcRenderer.send('open-external-link', url);
  },
  // タスク詳細ウィンドウを開く
  openTaskDetailWindow: (detailData) => {
    ipcRenderer.send('open-task-detail-window', detailData);
  },
  getTaskDetailWindowData: () => {
    return ipcRenderer.invoke('get-task-detail-window-data');
  },
  // 画面内検索機能 - シンプル実装
  findInPage: (text, options) => {
    console.log('Execute find-in-page:', text);
    return ipcRenderer.invoke('find-in-page', text, options);
  },
  findInPageNext: (text) => {
    console.log('Execute find-in-page-next:', text);
    return ipcRenderer.invoke('find-in-page-next', text);
  },
  findInPagePrevious: (text) => {
    console.log('Execute find-in-page-previous:', text);
    return ipcRenderer.invoke('find-in-page-previous', text);
  },
  stopFindInPage: () => {
    console.log('Execute stop-find-in-page:');
    ipcRenderer.send('stop-find-in-page');
  },
  // 検索結果更新イベント
  onSearchResultUpdated: (callback) => {
    ipcRenderer.on('search-result-updated', (event, result) => {
      console.log('Receive search-result-updated:', result);
      callback(/** @type {FindInPageResult} */ (result));
    });
  },
  // テーマ変更の通知を受け取る
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (event, theme) => {
      console.log('Theme changed:', theme);
      callback(theme);
    });
  },
  onTreeDataUpdated: (callback) => {
    ipcRenderer.on('tree-data-updated', (event, treeData) => {
      callback(treeData);
    });
  },
  onProjectDeleted: (callback) => {
    ipcRenderer.on('project-deleted', (event, projectId) => {
      callback(projectId);
    });
  },
  // 現在のテーマを取得する
  getCurrentTheme: () => {
    return ipcRenderer.invoke('get-current-theme');
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
