const _ = require("lodash")
const { app, BrowserWindow, ipcMain, shell, WebContents } = require("electron");
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

      // テーマが変更された場合、他のウィンドウにも通知
      if (key === 'theme') {
        if (taskDetailWindow && !taskDetailWindow.isDestroyed()) {
          taskDetailWindow.webContents.send('theme-changed', value);
        }
      }
    } catch (err) {
      log.error('Failed to write meta_data (set-meta-data):', err.message);
    }
  });
  // on delete-meta-data.
  // completely remove a key from meta data.
  ipcMain.on('delete-meta-data', (event, key) => {
    if (key && db_meta.data.hasOwnProperty(key)) {
      delete db_meta.data[key];
      try {
        db_meta.write();
        log.info(`Metadata key deleted: ${key}`);
      } catch (err) {
        log.error('Failed to write meta_data (delete-meta-data):', err.message);
      }
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

      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed() && window.webContents !== event.sender) {
          window.webContents.send('tree-data-updated', arg);
        }
      });
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

      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed() && window.webContents !== event.sender) {
          window.webContents.send('project-deleted', arg);
        }
      });
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

  // タスク詳細ウィンドウの変数
  let taskDetailWindow = null;

  function bindFindInPageEvents(targetWebContents) {
    targetWebContents.on('found-in-page', (event, result) => {
      console.log('Search Result:', result);
      targetWebContents.send('search-result-updated', result);
    });
  }

  function resolveSearchWebContents(event) {
    return event?.sender || mainWindow.webContents;
  }

  // 検索ハイライトをリセット
  async function resetHighlights(targetWebContents, notifyResult = false) {
    console.log('Reset HighLights');
    targetWebContents.stopFindInPage('clearSelection');

    if (notifyResult) {
      const result = { matches: 0, activeMatchOrdinal: 0 };
      targetWebContents.send('search-result-updated', result);
    }

    return true;
  }

  bindFindInPageEvents(mainWindow.webContents);

  // find-in-page
  ipcMain.handle('find-in-page', async (event, text, options = {}) => {
    console.log('Execute Search:', text);
    const targetWebContents = resolveSearchWebContents(event);

    // 空の検索テキストの場合は検索をクリア
    if (!text || !text.trim()) {
      await resetHighlights(targetWebContents, true);
      return { matches: 0, activeMatchOrdinal: 0 };
    }

    try {
      // 前回の検索をクリア (通知なし)
      await resetHighlights(targetWebContents, false);

      // 少し待機
      await new Promise(resolve => setTimeout(resolve, 200));

      // 検索実行
      console.log('Execute findInPage():', text, options);
      targetWebContents.findInPage(text.trim(), {
        ...options,
        findNext: false // 新規検索
      });
      // 検索実行（次へ）　※ 新規検索時は一度次へを実行しないと更新されない
      targetWebContents.findInPage(text.trim(), {
        findNext: true,
        forward: true
      });

      return;
    } catch (error) {
      console.error('検索エラー:', error);
      return;
    }
  });

  // 次の検索
  ipcMain.handle('find-in-page-next', async (event, text = '') => {
    console.log('Search next');
    const targetWebContents = resolveSearchWebContents(event);

    // 検索テキストを決定
    if (!text || !text.trim()) {
      return;
    }

    try {
      // 次の検索を実行
      targetWebContents.findInPage(text.trim(), {
        findNext: true,
        forward: true
      });

      return;
    } catch (error) {
      console.error('次の検索エラー:', error);
      return;
    }
  });

  // 前の検索
  ipcMain.handle('find-in-page-previous', async (event, text = '') => {
    console.log('Search Previous');
    const targetWebContents = resolveSearchWebContents(event);

    // 検索テキストを決定
    if (!text || !text.trim()) {
      return { matches: 0, activeMatchOrdinal: 0 };
    }

    try {
      // 前の検索を実行
      targetWebContents.findInPage(text.trim(), {
        findNext: true,
        forward: false
      });

      return;
    } catch (error) {
      console.error('前の検索エラー:', error);
      return;
    }
  });

  // 検索のクリア
  ipcMain.on('stop-find-in-page', async (event) => {
    console.log('Execute stopFindInPage()');
    const targetWebContents = resolveSearchWebContents(event);

    try {
      await resetHighlights(targetWebContents, true);
    } catch (error) {
      console.error('検索クリアエラー:', error);
    }
  });

  // タスク詳細用のウィンドウを作成する関数
  function createTaskDetailWindow(detailData) {
    try {
      const safeDetailData = {
        projectId: detailData?.projectId ? String(detailData.projectId) : '',
        taskId: detailData?.taskId ? String(detailData.taskId) : '',
        taskName: detailData?.taskName ? String(detailData.taskName) : 'Task Detail',
      };

      if (taskDetailWindow && !taskDetailWindow.isDestroyed()) {
        taskDetailWindow.close();
      }

      taskDetailWindow = new BrowserWindow({
        width: 960,
        height: 720,
        modal: false,
        frame: true,
        resizable: true,
        minimizable: true,
        maximizable: true,
        alwaysOnTop: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      taskDetailWindow.loadFile(path.join(__dirname, "../public/index.html"), {
        hash: '#task-detail-window',
        query: {
          projectId: safeDetailData.projectId,
          taskId: safeDetailData.taskId,
          taskName: safeDetailData.taskName,
        }
      });

      bindFindInPageEvents(taskDetailWindow.webContents);

      global.currentTaskDetailWindowData = safeDetailData;

      taskDetailWindow.on('closed', () => {
        taskDetailWindow = null;
        global.currentTaskDetailWindowData = null;
      });

      log.info(`Task detail window created for task: ${safeDetailData.taskId}`);
      return taskDetailWindow;
    } catch (error) {
      console.error('タスク詳細ウィンドウの作成に失敗しました:', error);
      return null;
    }
  }

  ipcMain.handle('get-task-detail-window-data', async () => {
    return (
      global.currentTaskDetailWindowData || {
        projectId: '',
        taskId: '',
        taskName: 'Task Detail',
      }
    );
  });

  // 別ウィンドウでタスク詳細を開く
  ipcMain.on('open-task-detail-window', async (event, detailData) => {
    try {
      global.currentTaskDetailWindowData = detailData;
      const window = createTaskDetailWindow(detailData);

      await new Promise(resolve => setTimeout(resolve, 500));

      if (window && !window.isDestroyed()) {
        window.show();
        window.focus();
        log.info(`Task detail window shown for task: ${detailData?.taskId || ''}`);
      }
    } catch (error) {
      console.error('タスク詳細ウィンドウを開く際にエラーが発生しました:', error);
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../public/index.html"));
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (taskDetailWindow && !taskDetailWindow.isDestroyed()) {
      taskDetailWindow.destroy();
    }
  });

  // 検索ウィンドウからテーマ情報を要求された場合
  ipcMain.handle('get-current-theme', async (event) => {
    return db_meta.data.theme || 'dark';
  });
});
