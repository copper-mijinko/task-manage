const _ = require("lodash")
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { LowSync, JSONFileSync } = require('@commonify/lowdb');
const log = require("electron-log");

app.on("ready", () => {
  let mainWindow = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    },
    width: 1000,
    height: 800,
    minWidth: 700,
    minHeight: 700,
  });

  ////////////// Low //////////////
  // Extend Low class with a new `chain` field
  class LowSyncWithLodash extends LowSync {
    chain = _.chain(this).get('data')
  }
  // init low db. read after.
  // data
  const file = path.join(__dirname, 'db.json');
  log.info(file);
  const defaultData = []
  const adapter = new JSONFileSync(file);
  const db = new LowSyncWithLodash(adapter);
  db.read();
  db.data ||= defaultData; // initialize
  db.write();
  // meta
  const file_meta = path.join(__dirname, 'meta.json');
  log.info(file_meta);
  const defaultDataMeta = {
    "theme": "dark"
  }
  const adapter_meta = new JSONFileSync(file_meta);
  const db_meta = new LowSyncWithLodash(adapter_meta);
  db_meta.read()
  db_meta.data ||= defaultDataMeta; // initialize
  db_meta.write();

  ////////////// IPC //////////////
  // on get-initial-tree-data.
  // return data to renderer.
  ipcMain.handle('get-initial-tree-data', async (event, arg) => {
    return db.data[0];
  });
  // on get-tree-data.
  // return data to renderer.
  ipcMain.handle('get-tree-data', async (event, arg) => {
    return db.chain.find({ data: { id: arg } }).value();
  });
  // on get-meta-data.
  // return data to renderer.
  ipcMain.handle('get-meta-data', async (event, key) => {
    return db_meta.data[key];
  });
  // on set-meta-data.
  // return data to renderer.
  ipcMain.on('set-meta-data', (event, key, value) => {
    db_meta.data[key] = value;
    try {
      db_meta.write();
    } catch (err) {
      log.error('Failed to write meta_data (set-meta-data):', err.message);
    }
  });
  // on set-tree-data.
  // return data to renderer.
  ipcMain.on('set-tree-data', (event, arg) => {
    if (arg) {
      db.data = db.chain.map((o) => {
        if (o.data.id == arg.data.id) {
          return arg;
        } else {
          return o;
        }
      }).value();
      try {
        db.write();
      } catch (err) {
        // Log the error but continue silently
        log.error('Failed to write data (set-tree-data):', err.message);
      }
    }
  });
  // on get-project-ids.
  // return data to renderer.
  ipcMain.handle('get-project-ids', async (event, arg) => {
    return db.chain.map((o) => { return { name: o.data.data.name, id: o.data.id } }).value();
  });
  // on add-project.
  ipcMain.on('add-project', (event, arg) => {
    if (arg) {
      db.data.push(arg);
      try {
        db.write();
      } catch (err) {
        // Log the error but continue silently
        log.error('Failed to write data (add-project):', err.message);
      }
    }
  });
  // on delete-project.
  ipcMain.on('delete-project', (event, arg) => {
    if (arg) {
      db.data = db.data.filter((node, i) => node.data.id !== arg);
      try {
        db.write();
      } catch (err) {
        // Log the error but continue silently
        log.error('Failed to write data (delete-project):', err.message);
      }
    }
  });

  // on set-project-order.
  ipcMain.on('set-project-order', (event, projects) => {
    if (projects && Array.isArray(projects) && projects.length > 0) {
      // 既存のプロジェクトデータをIDでインデックス化
      const projectMap = {};
      db.data.forEach(item => {
        projectMap[item.data.id] = item;
      });

      // 新しい順序でプロジェクトを並べ替え
      const newOrder = [];
      let hasChanges = false;

      projects.forEach(project => {
        if (projectMap[project.id]) {
          newOrder.push(projectMap[project.id]);
          delete projectMap[project.id]; // 処理済みのプロジェクトを削除
          hasChanges = true;
        }
      });

      // 残りのプロジェクト（配列に含まれていなかったプロジェクト）があれば追加
      Object.values(projectMap).forEach(project => {
        newOrder.push(project);
      });

      if (hasChanges) {
        db.data = newOrder;
        try {
          db.write();
        } catch (err) {
          log.error('Failed to write data (set-project-order):', err.message);
        }
      }
    }
  });
  // on message.
  ipcMain.on('message', (event, arg) => {
    console.log(arg);
  });

  // 外部リンクを開くためのハンドラ
  ipcMain.on('open-external-link', (event, url) => {
    if (url && typeof url === 'string') {
      shell.openExternal(url).catch(err => {
        log.error('外部リンクを開く際にエラーが発生しました:', err);
      });
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../public/index.html"));
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  })
});