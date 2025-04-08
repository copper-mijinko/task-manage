const _ = require("lodash")
const { app, BrowserWindow, ipcMain } = require("electron");
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
  const file = path.join(__dirname, 'db.json');
  log.info(file);
  const adapter = new JSONFileSync(file);
  const defaultData = {}
  const db = new LowSyncWithLodash(adapter, defaultData);

  ////////////// IPC //////////////
  // on get-initial-tree-data.
  // return data to renderer.
  ipcMain.handle('get-initial-tree-data', async (event, arg) => {
    await db.read();
    return db.data[0];
  });
  // on get-tree-data.
  // return data to renderer.
  ipcMain.handle('get-tree-data', async (event, arg) => {
    return db.chain.find({ data: { id: arg } }).value();
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
  // on message.
  ipcMain.on('message', (event, arg) => {
    console.log(arg);
  });

  mainWindow.loadFile(path.join(__dirname, "../public/index.html"));
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  })
});