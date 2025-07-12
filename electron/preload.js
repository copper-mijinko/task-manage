const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
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
  // 画面内検索機能 - シンプル実装
  findInPage: (text, options) => {
    console.log('検索実行:', text);
    return ipcRenderer.invoke('find-in-page', text, options);
  },
  findInPageNext: (text) => {
    console.log('次を検索で使用するテキスト:', text);
    return ipcRenderer.invoke('find-in-page-next', text);
  },
  findInPagePrevious: (text) => {
    console.log('前を検索で使用するテキスト:', text);
    return ipcRenderer.invoke('find-in-page-previous', text);
  },
  stopFindInPage: (action) => {
    console.log('stopFindInPage呼び出し:', action);
    ipcRenderer.send('stop-find-in-page', action);
  },
  // ハイライトクリア用のイベントリスナー登録関数
  onClearHighlights: (callback) => {
    ipcRenderer.on('clear-highlights', (event, data) => callback(data));
  },
  // 検索結果更新イベント
  onSearchResultUpdated: (callback) => {
    ipcRenderer.on('search-result-updated', (event, result) => {
      console.log('検索結果更新イベント受信:', result);
      callback(result);
    });
  }
})
