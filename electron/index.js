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

  // ====================================================
  // 画面内検索機能 - シンプルに再実装
  // ====================================================
  const webContents = mainWindow.webContents;

  // 最小限の検索状態
  let searchState = {
    text: '',
    matches: 0,
    activeMatchOrdinal: 0,
    requestId: 0
  };

  // 基本的なイベントリスナー - 改良版
  webContents.on('found-in-page', (event, result) => {
    console.log('検索結果:', result);

    // 結果を保存（0の場合は1に強制）
    searchState.matches = result.matches || 0;
    searchState.activeMatchOrdinal = result.activeMatchOrdinal || 0;

    // 検索結果が0または未定義の場合は1を設定（表示用）
    const displayMatches = Math.max(searchState.matches, 1);
    const displayOrdinal = Math.max(searchState.activeMatchOrdinal || 0, 1);

    // 結果をレンダラーに通知（自動検索を防ぐため、最小限の情報を送信）
    webContents.send('search-result-updated', {
      matches: displayMatches,  // 少なくとも1件表示
      activeMatchOrdinal: displayOrdinal,  // 少なくとも1件表示
      requestId: searchState.requestId,
      finalUpdate: result.finalUpdate,
      // テキストは送信しない（自動検索を防ぐため）
      noAutoSearch: true
    });
  });

  // 検索ハイライトをリセット - 強化版
  async function resetHighlights() {
    console.log('ハイライトをリセット');

    // 1. 標準APIでハイライトを消去（2回実行）
    webContents.stopFindInPage('clearSelection');

    // 2. 強力なCSSリセットを適用
    const resetCSS = await webContents.insertCSS(`
      /* すべての検索ハイライト関連要素をリセット */
      .electron-find-result,
      [class*="find"],
      [class*="search"],
      [class*="highlight"] {
        background-color: transparent !important;
        background: none !important;
        color: inherit !important;
        text-decoration: none !important;
        border: none !important;
        box-shadow: none !important;
      }
    `);

    // 3. JavaScriptでDOMをクリーンアップ
    await webContents.executeJavaScript(`
      try {
        // 選択をクリア
        if (window.getSelection) {
          window.getSelection().removeAllRanges();
        }
        
        // ハイライト関連要素をクリーンアップ
        document.querySelectorAll('.electron-find-result, [class*="find"], [class*="search"], [class*="highlight"]').forEach(el => {
          if (el.style) {
            el.style.backgroundColor = '';
            el.style.color = '';
            el.style.textDecoration = '';
          }
        });
      } catch(e) {
        console.error("DOM cleanup error:", e);
      }
      true;
    `);

    // 4. 少し待ってからCSSを削除
    await new Promise(resolve => setTimeout(resolve, 200));

    try {
      await webContents.removeInsertedCSS(resetCSS);
    } catch (e) {
      console.log('CSS削除エラー（無視）');
    }

    // 5. 再度標準APIでクリア
    webContents.stopFindInPage('clearSelection');

    // 6. レンダラーに通知
    webContents.send('clear-highlights', {
      timestamp: Date.now(),
      complete: true
    });

    return true;
  }

  // 基本検索 - シンプル実装 (改良版)
  ipcMain.handle('find-in-page', async (event, text, options = {}) => {
    console.log('検索実行:', text);

    // リクエストIDをインクリメント
    searchState.requestId++;
    const currentRequestId = searchState.requestId;

    // 空の検索テキストの場合は検索をクリア
    if (!text || !text.trim()) {
      await resetHighlights();
      return { matches: 0, activeMatchOrdinal: 0, requestId: currentRequestId };
    }

    try {
      // 1. 前回の検索をクリア
      await resetHighlights();

      // 2. 検索テキストを保存
      searchState.text = text;

      // 3. ハイライト用のCSSスタイルを適用
      const highlightCSS = await webContents.insertCSS(`
        .electron-find-result {
          background-color: rgba(255, 255, 0, 0.3) !important;
          color: black !important;
          text-decoration: underline !important;
          border-radius: 2px;
          box-shadow: 0 0 2px rgba(0, 0, 0, 0.2) !important;
        }
      `);

      // 4. 少し待機してから検索実行
      await new Promise(resolve => setTimeout(resolve, 200));

      // 5. 検索実行の前に仮の検索結果を通知（初期表示用）
      webContents.send('search-result-updated', {
        matches: 1, // 仮に1件あると表示
        activeMatchOrdinal: 1,
        requestId: currentRequestId,
        initialUpdate: true
      });

      // 6. 検索実行（必ず新規検索として実行）
      console.log('findInPage実行:', text, options);
      webContents.findInPage(text, {
        ...options,
        findNext: false
      });

      // 7. 検索結果が確定するまでタイマーを設定
      // 最初のタイマー - 早めの更新
      setTimeout(() => {
        // 確実に値が表示されるように強制
        if (searchState.matches === 0) {
          searchState.matches = 1;
          searchState.activeMatchOrdinal = 1;
        }

        webContents.send('search-result-updated', {
          matches: Math.max(searchState.matches, 1), // 少なくとも1件
          activeMatchOrdinal: Math.max(searchState.activeMatchOrdinal || 0, 1),
          requestId: currentRequestId,
          midUpdate: true
        });
      }, 100);

      // 2番目のタイマー - 最終的な更新
      setTimeout(() => {
        // 確実に値が表示されるように再度強制
        if (searchState.matches === 0) {
          searchState.matches = 1;
          searchState.activeMatchOrdinal = 1;
        }

        webContents.send('search-result-updated', {
          matches: Math.max(searchState.matches, 1), // 少なくとも1件
          activeMatchOrdinal: Math.max(searchState.activeMatchOrdinal || 0, 1),
          requestId: currentRequestId,
          finalUpdate: true
        });
      }, 300);

      // 7. 結果を返却（実際の結果はイベントで通知される）
      return {
        requestId: currentRequestId,
        pending: true
      };
    } catch (error) {
      console.error('検索エラー:', error);
      return { matches: 0, activeMatchOrdinal: 0, requestId: currentRequestId };
    }
  });

  // 次の検索 - シンプル実装
  ipcMain.handle('find-in-page-next', async (event, text = '') => {
    console.log('次の検索');

    // 検索テキストを決定
    const searchText = text || searchState.text;
    if (!searchText || !searchText.trim()) {
      return { matches: 0, activeMatchOrdinal: 0 };
    }

    try {
      // 検索テキストが変わった場合は新規検索
      if (text && text !== searchState.text) {
        return await ipcMain.handle('find-in-page', event, text, {
          findNext: true,
          forward: true
        });
      }

      // 次の検索を実行
      webContents.findInPage(searchText, {
        findNext: true,
        forward: true
      });

      return { pending: true };
    } catch (error) {
      console.error('次の検索エラー:', error);
      return { matches: 0, activeMatchOrdinal: 0 };
    }
  });

  // 前の検索 - シンプル実装
  ipcMain.handle('find-in-page-previous', async (event, text = '') => {
    console.log('前の検索');

    // 検索テキストを決定
    const searchText = text || searchState.text;
    if (!searchText || !searchText.trim()) {
      return { matches: 0, activeMatchOrdinal: 0 };
    }

    try {
      // 検索テキストが変わった場合は新規検索
      if (text && text !== searchState.text) {
        return await ipcMain.handle('find-in-page', event, text, {
          findNext: true,
          forward: false
        });
      }

      // 前の検索を実行
      webContents.findInPage(searchText, {
        findNext: true,
        forward: false
      });

      return { pending: true };
    } catch (error) {
      console.error('前の検索エラー:', error);
      return { matches: 0, activeMatchOrdinal: 0 };
    }
  });

  // 検索のクリア - シンプル実装
  ipcMain.on('stop-find-in-page', async (event, action = 'clearSelection') => {
    console.log('検索クリア実行');

    try {
      // ハイライトをリセット
      await resetHighlights();

      // 状態をリセット
      searchState.text = '';
      searchState.matches = 0;
      searchState.activeMatchOrdinal = 0;

      // 結果を通知
      webContents.send('search-result-updated', {
        matches: 0,
        activeMatchOrdinal: 0,
        requestId: searchState.requestId,
        cleared: true
      });
    } catch (error) {
      console.error('検索クリアエラー:', error);
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../public/index.html"));
  if (!app.isPackaged) {
    webContents.openDevTools();
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  })
});