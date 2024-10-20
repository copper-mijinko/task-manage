const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  setTreeData: (tree_data) => ipcRenderer.send('set-tree-data', tree_data),
  getTreeData: (project_name) => ipcRenderer.invoke('get-tree-data', project_name),
  getInitialTreeData: () => ipcRenderer.invoke('get-initial-tree-data'),
  getProjectIDs: () => ipcRenderer.invoke('get-project-ids'),
  addProject: (project) => ipcRenderer.send('add-project', project),
  deleteProject: (project_id) => ipcRenderer.send('delete-project', project_id),
  message: (message) => {
    ipcRenderer.send('message', message);
  }
})
