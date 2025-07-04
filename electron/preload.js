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
  }
})
