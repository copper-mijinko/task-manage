const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { LowSync, JSONFileSync } = require("@commonify/lowdb");
const log = require("electron-log/main");
const workspace = require("./workspace");
const inbox = require("./inbox");
const { WorkspaceReconciler } = require("./workspace-reconciler");
const { WorkspaceWriteQueue } = require("./workspace-write-queue");

function countNodes(treeData) {
  if (!treeData) return 0;
  let n = 1;
  for (const child of treeData.children || []) n += countNodes(child);
  return n;
}

function resolveAppDataPath(fileName) {
  const customDataDir = process.env.TASK_MANAGE_DATA_DIR;

  if (customDataDir) {
    fs.mkdirSync(customDataDir, { recursive: true });
    return path.join(customDataDir, fileName);
  }

  return path.join(__dirname, fileName);
}

function showSaveError(context, err) {
  log.error(`Failed to write data (${context}):`, err.message);
  const message = `Failed to save data: ${err.message}`;
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send("save-error", message);
    }
  });
}

function openPathWithProgramPicker(filePath) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Open with is only supported on Windows"));
  }

  return new Promise((resolve, reject) => {
    const child = spawn("rundll32.exe", ["shell32.dll,OpenAs_RunDLL", filePath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    let settled = false;

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}

function createAsyncWriter(db, filePath, context, debounceDelay = 300) {
  let debounceTimer = null;
  let writing = false;
  let hasPending = false;

  async function doWrite() {
    if (writing) {
      hasPending = true;
      return;
    }
    writing = true;
    hasPending = false;
    try {
      const json = JSON.stringify(db.data, null, 2);
      await fs.promises.writeFile(filePath, json);
    } catch (err) {
      showSaveError(context, err);
    } finally {
      writing = false;
      if (hasPending) {
        doWrite();
      }
    }
  }

  return {
    write() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        doWrite();
      }, debounceDelay);
    },
    flush() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      try {
        db.write();
      } catch (err) {
        showSaveError(context, err);
      }
    },
  };
}

function shouldOpenDevTools() {
  const testLikeEnvironment =
    process.env.NODE_ENV === "test" ||
    process.env.PLAYWRIGHT_TEST === "true" ||
    process.env.TASK_MANAGE_OPEN_DEVTOOLS === "false";

  return !app.isPackaged && !testLikeEnvironment;
}

app.on("ready", () => {
  const t0 = Date.now();

  let mainWindow = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
    width: 1000,
    height: 800,
    minWidth: 700,
    minHeight: 700,
    frame: false,
    titleBarStyle: "hidden",
  });
  log.info(`[perf] BrowserWindow created: ${Date.now() - t0}ms`);

  function sendWindowState(win) {
    if (!win || win.isDestroyed()) return;
    win.webContents.send("window-state-changed", {
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
    });
  }
  mainWindow.on("maximize", () => sendWindowState(mainWindow));
  mainWindow.on("unmaximize", () => sendWindowState(mainWindow));
  mainWindow.on("enter-full-screen", () => sendWindowState(mainWindow));
  mainWindow.on("leave-full-screen", () => sendWindowState(mainWindow));

  ////////////// Low //////////////
  // init low db. read after.
  // data
  const file = resolveAppDataPath("db.json");
  log.info(file);
  const defaultData = [];
  const adapter = new JSONFileSync(file);
  const db = new LowSync(adapter);
  db.read();
  if (!db.data) {
    db.data = defaultData; // initialize
    db.write();
  }
  // meta
  const file_meta = resolveAppDataPath("meta.json");
  log.info(file_meta);
  const defaultDataMeta = {
    theme: "dark",
    workspaceConflictPolicy: "ask",
  };
  const adapter_meta = new JSONFileSync(file_meta);
  const db_meta = new LowSync(adapter_meta);
  db_meta.read();
  if (!db_meta.data) {
    db_meta.data = defaultDataMeta; // initialize
    db_meta.write();
  }
  log.info(`[perf] DB init done: ${Date.now() - t0}ms`);

  const dbWriter = createAsyncWriter(db, file, "db");
  const dbMetaWriter = createAsyncWriter(db_meta, file_meta, "meta", 100);
  const wsCache = new Map();
  const optimisticWorkspaceProjectDirs = new Set();

  function normalizeForCompare(value) {
    const resolved = path.resolve(String(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  function knownWorkspacePaths() {
    return [
      ...(db_meta.data.workspaces || []).map((item) => item.path).filter(Boolean),
      db_meta.data.activeWorkspace,
    ].filter(Boolean);
  }

  function isKnownWorkspacePath(workspacePath) {
    const requestedPath = normalizeForCompare(workspacePath);
    return knownWorkspacePaths().some(
      (itemPath) => normalizeForCompare(itemPath) === requestedPath
    );
  }

  function isInsideKnownWorkspace(targetPath) {
    const requestedPath = normalizeForCompare(targetPath);
    return knownWorkspacePaths().some((workspacePath) => {
      const rootPath = normalizeForCompare(workspacePath);
      const relativePath = path.relative(rootPath, requestedPath);
      return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
    });
  }

  function sendWorkspaceSaveStatus(payload) {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("workspace-save-status", payload);
      }
    });
  }

  function sendWorkspaceProjectUpdated(payload, excludeWebContents = null) {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && win.webContents !== excludeWebContents) {
        win.webContents.send("workspace-project-updated", payload);
      }
    });
  }

  function sendWorkspaceConflict(payload) {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("workspace-conflict", payload);
      }
    });
  }

  function sendWorkspaceNotice(payload) {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("workspace-notice", payload);
      }
    });
  }

  let workspaceWriteQueue;
  const workspaceReconciler = new WorkspaceReconciler({
    readProject: workspace.readProject,
    stateRootDir: resolveAppDataPath("workspace-state"),
    hasPendingWrite: (projectDir) => workspaceWriteQueue?.hasPending(projectDir),
    getActiveOptions: (projectDir) => workspaceWriteQueue?.getActiveOptions(projectDir) ?? null,
    onProjectUpdated: ({ projectDir, tasks, taskDirs, reason }) => {
      wsCache.set(projectDir, { tasks, taskDirs });
      optimisticWorkspaceProjectDirs.delete(projectDir);
      sendWorkspaceProjectUpdated({
        projectDir,
        tasks: Object.fromEntries(tasks),
        reason,
      });
    },
    onConflict: (event) => {
      sendWorkspaceSaveStatus({
        projectDir: event.projectDir,
        status: "conflict",
        message: event.message,
      });
      sendWorkspaceConflict(event);
    },
    onNotice: sendWorkspaceNotice,
  });

  const recordWrite = (filePath, buffer) => workspaceReconciler.recordWrite(filePath, buffer);
  const INITIAL_WORKSPACE_WATCHER_DELAY_MS = 2500;
  let deferredWorkspaceWatcherPath = null;
  let deferredWorkspaceWatcherTimer = null;

  function readProjectSummary(projectDir) {
    return workspace.readProject(projectDir, { includeMemoContent: false });
  }

  // Async mirror used by interactive IPC handlers so a slow disk does not block
  // the main event loop (which would freeze ALL IPC, window controls included).
  function readProjectSummaryAsync(projectDir) {
    return workspace.readProjectAsync(projectDir, { includeMemoContent: false });
  }

  async function ensureWorkspaceCacheAsync(projectDir) {
    let cached = wsCache.get(projectDir);
    if (!cached) {
      const { tasks, taskDirs } = await readProjectSummaryAsync(projectDir);
      cached = { tasks, taskDirs };
      wsCache.set(projectDir, cached);
    }
    return cached;
  }

  function ensureWorkspaceCache(projectDir) {
    let cached = wsCache.get(projectDir);
    if (!cached) {
      const { tasks, taskDirs } = readProjectSummary(projectDir);
      cached = { tasks, taskDirs };
      wsCache.set(projectDir, cached);
    }
    return cached;
  }

  function normalizeWorkspaceTasksSnapshot(tasks) {
    if (!tasks || typeof tasks !== "object") {
      return new Map();
    }

    const entries = Array.isArray(tasks)
      ? tasks.map((task) => [task?.id, task])
      : Object.entries(tasks);
    const result = new Map();
    for (const [id, task] of entries) {
      if (typeof id === "string" && id && task?.id) {
        result.set(id, task);
      }
    }
    return result;
  }

  function buildOptimisticTaskDirs(projectDir, tasks) {
    let taskDirs = new Map();
    const cached = wsCache.get(projectDir);
    if (cached?.taskDirs) {
      taskDirs = new Map(cached.taskDirs);
    } else {
      try {
        taskDirs = new Map(readProjectSummary(projectDir).taskDirs);
      } catch {
        taskDirs = new Map();
      }
    }

    for (const id of [...taskDirs.keys()]) {
      if (!tasks.has(id)) {
        taskDirs.delete(id);
      }
    }

    for (const task of tasks.values()) {
      if (taskDirs.has(task.id)) continue;
      taskDirs.set(task.id, task.parents?.length === 0 ? "_project" : task.id);
    }

    return taskDirs;
  }

  function primeWorkspaceProjectSnapshot(projectDir, tasksSnapshot) {
    if (!projectDir || typeof projectDir !== "string") {
      return null;
    }

    const tasks = normalizeWorkspaceTasksSnapshot(tasksSnapshot);
    if (tasks.size === 0) {
      return null;
    }

    const taskDirs = buildOptimisticTaskDirs(projectDir, tasks);
    const cached = { tasks, taskDirs };
    wsCache.set(projectDir, cached);
    optimisticWorkspaceProjectDirs.add(projectDir);
    return cached;
  }

  function primeWorkspaceProjectPatch(projectDir, patch) {
    if (!projectDir || typeof projectDir !== "string") {
      return null;
    }

    const nextTasks = Array.isArray(patch?.tasks) ? patch.tasks : [];
    const deletedTaskIds = Array.isArray(patch?.deletedTaskIds) ? patch.deletedTaskIds : [];
    if (nextTasks.length === 0 && deletedTaskIds.length === 0) {
      return wsCache.get(projectDir) ?? null;
    }

    const cached = ensureWorkspaceCache(projectDir);
    const tasks = new Map(cached.tasks);
    for (const taskId of deletedTaskIds) {
      if (typeof taskId === "string") {
        tasks.delete(taskId);
      }
    }

    for (const task of nextTasks) {
      if (task?.id) {
        tasks.set(task.id, task);
      }
    }

    const taskDirs = buildOptimisticTaskDirs(projectDir, tasks);
    const nextCached = { tasks, taskDirs };
    wsCache.set(projectDir, nextCached);
    optimisticWorkspaceProjectDirs.add(projectDir);
    return nextCached;
  }

  async function readWorkspaceProjectForRendererAsync(projectDir) {
    const cached = wsCache.get(projectDir);
    if (
      cached &&
      (optimisticWorkspaceProjectDirs.has(projectDir) || workspaceWriteQueue.hasPending(projectDir))
    ) {
      return cached;
    }

    const { tasks, taskDirs } = await readProjectSummaryAsync(projectDir);
    const fresh = { tasks, taskDirs };
    wsCache.set(projectDir, fresh);
    optimisticWorkspaceProjectDirs.delete(projectDir);
    return fresh;
  }

  function withLoadedMemoBodies(projectDir, tasks, taskDirs) {
    return tasks.map((task) => {
      if (!task?.memos?.some((memo) => memo?.bodyLoaded === false)) {
        return task;
      }

      const diskMemos = workspace.readTaskMemos(projectDir, task.id, taskDirs);
      const diskMemoById = new Map(diskMemos.map((memo) => [memo.id, memo]));
      return {
        ...task,
        memos: task.memos.map((memo) => {
          if (memo?.bodyLoaded !== false) return memo;
          const diskMemo = diskMemoById.get(memo.id);
          return {
            ...memo,
            content: diskMemo?.content ?? memo.content,
            bodyLoaded: true,
          };
        }),
      };
    });
  }

  function cancelDeferredWorkspaceWatcher() {
    deferredWorkspaceWatcherPath = null;
    if (deferredWorkspaceWatcherTimer) {
      clearTimeout(deferredWorkspaceWatcherTimer);
      deferredWorkspaceWatcherTimer = null;
    }
  }

  function startWorkspaceWatcher(workspacePath) {
    cancelDeferredWorkspaceWatcher();
    if (!workspacePath) {
      workspaceReconciler.stop().catch((err) => {
        log.error("workspace watcher stop error:", err.message);
      });
      return;
    }
    workspaceReconciler.start(workspacePath).catch((err) => {
      log.error("workspace watcher start error:", err.message);
    });
  }

  function scheduleDeferredWorkspaceWatcher() {
    const workspacePath = deferredWorkspaceWatcherPath;
    if (!workspacePath) return;
    if (deferredWorkspaceWatcherTimer) clearTimeout(deferredWorkspaceWatcherTimer);
    deferredWorkspaceWatcherTimer = setTimeout(() => {
      deferredWorkspaceWatcherTimer = null;
      const pathToStart = deferredWorkspaceWatcherPath;
      deferredWorkspaceWatcherPath = null;
      if (pathToStart) {
        workspaceReconciler.start(pathToStart).catch((err) => {
          log.error("workspace watcher start error:", err.message);
        });
      }
    }, INITIAL_WORKSPACE_WATCHER_DELAY_MS);
  }

  function deferInitialWorkspaceWatcherStart(workspacePath) {
    if (!workspacePath) return;
    deferredWorkspaceWatcherPath = workspacePath;
    mainWindow.webContents.once("did-finish-load", scheduleDeferredWorkspaceWatcher);
    mainWindow.webContents.once("did-fail-load", scheduleDeferredWorkspaceWatcher);
  }

  workspaceWriteQueue = new WorkspaceWriteQueue({
    writeProject: async (projectDir, tasks) => {
      const cached = ensureWorkspaceCache(projectDir);
      const tasksToWrite = withLoadedMemoBodies(projectDir, tasks, cached.taskDirs);
      const updated = await workspace.writeProjectAsync(projectDir, tasksToWrite, {
        onWritten: recordWrite,
      });
      await workspaceReconciler.markProjectWritten(projectDir);
      wsCache.set(projectDir, updated);
      optimisticWorkspaceProjectDirs.delete(projectDir);
      return updated;
    },
    writeProjectPatch: async (projectDir, patch) => {
      const cached = ensureWorkspaceCache(projectDir);
      const tasksToWrite = withLoadedMemoBodies(projectDir, patch.tasks, cached.taskDirs);
      const updated = await workspace.writeProjectPatchAsync(
        projectDir,
        {
          tasks: tasksToWrite,
          deletedTaskIds: patch.deletedTaskIds,
        },
        {
          onWritten: recordWrite,
        }
      );
      await workspaceReconciler.markProjectWritten(projectDir);
      wsCache.set(projectDir, updated);
      optimisticWorkspaceProjectDirs.delete(projectDir);
      return updated;
    },
    onStatus: sendWorkspaceSaveStatus,
    onWritten: ({ projectDir, result, revision }) => {
      if (!result?.tasks) return;
      const payload = {
        projectDir,
        tasks: Object.fromEntries(result.tasks),
        reason: "local-write",
      };
      if (Number.isFinite(revision)) {
        payload.revision = revision;
      }
      sendWorkspaceProjectUpdated(payload);
    },
    onError: ({ projectDir, error }) => {
      log.error(`workspace write failed (${projectDir}):`, error.message);
    },
  });
  let shutdownFlushPromise = null;
  deferInitialWorkspaceWatcherStart(db_meta.data.activeWorkspace);

  // How long to wait for the workspace queue to flush before asking the user
  // whether to keep waiting or force-quit. Long enough to cover normal cloud
  // sync stalls; short enough that the user is not stuck staring at an opaque
  // overlay forever.
  const FLUSH_TIMEOUT_MS = 30000;

  /**
   * Flush all writers, keep the main window visible (with a blocking overlay)
   * while async writes drain. Returns once the queue is empty or the user
   * chose to force-quit at the timeout prompt.
   */
  function performShutdownFlush(reason) {
    if (shutdownFlushPromise) return shutdownFlushPromise;

    dbWriter.flush();
    dbMetaWriter.flush();

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("workspace-flush-start", { reason });
      }
    });

    shutdownFlushPromise = new Promise((resolve) => {
      let resolved = false;
      let timeoutHandle = null;

      function finish(forced) {
        if (resolved) return;
        resolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({ forced });
      }

      function scheduleTimeoutWarning() {
        timeoutHandle = setTimeout(async () => {
          const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
          try {
            const choice = await dialog.showMessageBox(targetWindow ?? undefined, {
              type: "warning",
              buttons: ["継続して待機", "強制終了"],
              defaultId: 0,
              cancelId: 0,
              title: "保存処理が完了していません",
              message:
                "ワークスペースの保存処理が完了していません。継続して待機すると未保存データを保護できます。強制終了すると未保存の変更は失われる可能性があります。",
            });
            if (choice.response === 1) {
              finish(true);
            } else {
              scheduleTimeoutWarning();
            }
          } catch (err) {
            log.error("flush timeout dialog error:", err.message);
            scheduleTimeoutWarning();
          }
        }, FLUSH_TIMEOUT_MS);
      }

      if (workspaceWriteQueue.hasPending()) {
        scheduleTimeoutWarning();
        workspaceWriteQueue
          .flush()
          .catch((err) => {
            log.error("workspace flush error:", err.message);
          })
          .then(() => finish(false));
      } else {
        // Nothing to drain; resolve on the next tick so any in-flight flush
        // emit can still reach the renderer for consistency.
        setImmediate(() => finish(false));
      }
    }).then(async (result) => {
      try {
        await workspaceReconciler.stop();
      } catch (err) {
        log.error("workspace reconciler stop error:", err.message);
      }
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("workspace-flush-complete", { forced: result.forced });
        }
      });
      return result;
    });

    return shutdownFlushPromise;
  }

  app.on("before-quit", (event) => {
    if (shutdownFlushPromise) return; // already in flight
    if (!workspaceWriteQueue.hasPending()) {
      // Synchronously flush low-level db writers; nothing to await.
      dbWriter.flush();
      dbMetaWriter.flush();
      return;
    }

    event.preventDefault();
    performShutdownFlush("before-quit").then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeAllListeners("close");
        mainWindow.destroy();
      }
      app.quit();
    });
  });

  ////////////// IPC //////////////
  // on get-initial-tree-data.
  // return data to renderer.
  ipcMain.handle("get-initial-tree-data", async () => {
    return db.data[0];
  });
  // on get-tree-data.
  // return data to renderer.
  ipcMain.handle("get-tree-data", async (event, arg) => {
    return db.data.find((o) => o?.data?.id === arg);
  });
  // on get-meta-data.
  // return data to renderer.
  ipcMain.handle("get-meta-data", async (event, key) => {
    return db_meta.data[key];
  });
  // on set-meta-data.
  // return data to renderer.
  ipcMain.on("set-meta-data", (event, key, value) => {
    db_meta.data[key] = value;
    dbMetaWriter.write();
    // 繝・・繝槭′螟画峩縺輔ｌ縺溷ｴ蜷医∽ｻ悶・繧ｦ繧｣繝ｳ繝峨え縺ｫ繧る夂衍
    if (key === "theme") {
      for (const win of taskDetailWindows.values()) {
        if (!win.isDestroyed()) {
          win.webContents.send("theme-changed", value);
        }
      }
    }
  });
  // on delete-meta-data.
  // completely remove a key from meta data.
  ipcMain.on("delete-meta-data", (_event, key) => {
    if (key && Object.prototype.hasOwnProperty.call(db_meta.data, key)) {
      delete db_meta.data[key];
      dbMetaWriter.write();
      log.info(`Metadata key deleted: ${key}`);
    }
  });
  // on set-tree-data.
  // return data to renderer.
  ipcMain.on("set-tree-data", (event, arg) => {
    if (arg) {
      db.data = db.data.map((o) => {
        if (o.data.id === arg.data.id) {
          return arg;
        } else {
          return o;
        }
      });
      dbWriter.write();

      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed() && window.webContents !== event.sender) {
          window.webContents.send("tree-data-updated", arg);
        }
      });
    }
  });
  // on get-project-ids.
  // return data to renderer.
  ipcMain.handle("get-project-ids", async () => {
    return db.data.map((o) => {
      return { name: o.data.data.name, id: o.data.id };
    });
  });
  // on add-project.
  ipcMain.on("add-project", (event, arg) => {
    if (arg) {
      db.data.push(arg);
      dbWriter.write();
    }
  });
  // on delete-project.
  ipcMain.on("delete-project", (event, arg) => {
    if (arg) {
      db.data = db.data.filter((node) => node.data.id !== arg);
      dbWriter.write();

      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed() && window.webContents !== event.sender) {
          window.webContents.send("project-deleted", arg);
        }
      });
    }
  });
  // on set-project-order.
  ipcMain.on("set-project-order", (event, projects) => {
    if (projects && Array.isArray(projects) && projects.length > 0) {
      const projectMap = {};
      db.data.forEach((item) => {
        projectMap[item.data.id] = item;
      });

      const newOrder = [];
      let hasChanges = false;

      projects.forEach((project) => {
        if (projectMap[project.id]) {
          newOrder.push(projectMap[project.id]);
          delete projectMap[project.id]; // 蜃ｦ逅・ｸ医∩縺ｮ繝励Ο繧ｸ繧ｧ繧ｯ繝医ｒ蜑企勁
          hasChanges = true;
        }
      });

      // 谿九ｊ縺ｮ繝励Ο繧ｸ繧ｧ繧ｯ繝茨ｼ磯・蛻励↓蜷ｫ縺ｾ繧後※縺・↑縺九▲縺溘・繝ｭ繧ｸ繧ｧ繧ｯ繝茨ｼ峨′縺ゅｌ縺ｰ霑ｽ蜉
      Object.values(projectMap).forEach((project) => {
        newOrder.push(project);
      });

      if (hasChanges) {
        db.data = newOrder;
        dbWriter.write();
      }
    }
  });
  // on message.
  ipcMain.on("message", (event, arg) => {
    log.info(arg);
  });
  // 螟夜Κ繝ｪ繝ｳ繧ｯ繧帝幕縺上◆繧√・繝上Φ繝峨Λ
  ipcMain.on("open-external-link", (event, url) => {
    if (url && typeof url === "string") {
      shell.openExternal(url).catch((err) => {
        log.error("Failed to open external link:", err);
      });
    }
  });

  // 繧ｿ繧ｹ繧ｯ隧ｳ邏ｰ繧ｦ繧｣繝ｳ繝峨え縺ｮ螟画焚
  const taskDetailWindows = new Map(); // taskId -> BrowserWindow

  function bindFindInPageEvents(targetWebContents) {
    targetWebContents.on("found-in-page", (event, result) => {
      log.info("Search Result:", result);
      targetWebContents.send("search-result-updated", result);
    });
  }

  function resolveSearchWebContents(event) {
    return event?.sender || mainWindow.webContents;
  }

  // 讀懃ｴ｢繝上う繝ｩ繧､繝医ｒ繝ｪ繧ｻ繝・ヨ
  async function resetHighlights(targetWebContents, notifyResult = false) {
    log.info("Reset HighLights");
    targetWebContents.stopFindInPage("clearSelection");

    if (notifyResult) {
      const result = { matches: 0, activeMatchOrdinal: 0 };
      targetWebContents.send("search-result-updated", result);
    }

    return true;
  }

  bindFindInPageEvents(mainWindow.webContents);

  // find-in-page
  ipcMain.handle("find-in-page", async (event, text, options = {}) => {
    log.info("Execute Search:", text);
    const targetWebContents = resolveSearchWebContents(event);

    // 遨ｺ縺ｮ讀懃ｴ｢繝・く繧ｹ繝医・蝣ｴ蜷医・讀懃ｴ｢繧偵け繝ｪ繧｢
    if (!text || !text.trim()) {
      await resetHighlights(targetWebContents, true);
      return { matches: 0, activeMatchOrdinal: 0 };
    }

    try {
      // 蜑榊屓縺ｮ讀懃ｴ｢繧偵け繝ｪ繧｢ (騾夂衍縺ｪ縺・
      await resetHighlights(targetWebContents, false);

      await new Promise((resolve) => setTimeout(resolve, 200));

      log.info("Execute findInPage():", text, options);
      targetWebContents.findInPage(text.trim(), {
        ...options,
        findNext: false, // 譁ｰ隕乗､懃ｴ｢
      });
      targetWebContents.findInPage(text.trim(), {
        findNext: true,
        forward: true,
      });

      return;
    } catch (error) {
      log.error("Search error:", error);
      return;
    }
  });

  // 谺｡縺ｮ讀懃ｴ｢
  ipcMain.handle("find-in-page-next", async (event, text = "") => {
    log.info("Search next");
    const targetWebContents = resolveSearchWebContents(event);

    if (!text || !text.trim()) {
      return;
    }

    try {
      targetWebContents.findInPage(text.trim(), {
        findNext: true,
        forward: true,
      });

      return;
    } catch (error) {
      log.error("谺｡縺ｮSearch error:", error);
      return;
    }
  });

  // 蜑阪・讀懃ｴ｢
  ipcMain.handle("find-in-page-previous", async (event, text = "") => {
    log.info("Search Previous");
    const targetWebContents = resolveSearchWebContents(event);

    if (!text || !text.trim()) {
      return { matches: 0, activeMatchOrdinal: 0 };
    }

    try {
      targetWebContents.findInPage(text.trim(), {
        findNext: true,
        forward: false,
      });

      return;
    } catch (error) {
      log.error("蜑阪・Search error:", error);
      return;
    }
  });

  // 讀懃ｴ｢縺ｮ繧ｯ繝ｪ繧｢
  ipcMain.on("stop-find-in-page", async (event) => {
    log.info("Execute stopFindInPage()");
    const targetWebContents = resolveSearchWebContents(event);

    try {
      await resetHighlights(targetWebContents, true);
    } catch (error) {
      log.error("Search reset error:", error);
    }
  });

  // 繧ｿ繧ｹ繧ｯ隧ｳ邏ｰ逕ｨ縺ｮ繧ｦ繧｣繝ｳ繝峨え繧剃ｽ懈・縺吶ｋ髢｢謨ｰ
  function createTaskDetailWindow(detailData) {
    try {
      const safeDetailData = {
        projectId: detailData?.projectId ? String(detailData.projectId) : "",
        taskId: detailData?.taskId ? String(detailData.taskId) : "",
        taskName: detailData?.taskName ? String(detailData.taskName) : "Task Detail",
        selectedType:
          detailData?.selectedType === "WorkspaceProject" ? "WorkspaceProject" : "Projects",
        projectDir: detailData?.projectDir ? String(detailData.projectDir) : "",
      };

      const windowKey = [
        safeDetailData.selectedType,
        safeDetailData.projectDir || safeDetailData.projectId,
        safeDetailData.taskId,
      ].join(":");
      const existing = taskDetailWindows.get(windowKey);
      if (existing && !existing.isDestroyed()) {
        existing.focus();
        return existing;
      }

      const win = new BrowserWindow({
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
          preload: path.join(__dirname, "preload.js"),
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      if (process.env.VITE_DEV === "true") {
        const params = new URLSearchParams(safeDetailData);
        win.loadURL(`http://localhost:5173/?${params.toString()}#task-detail-window`);
      } else {
        win.loadFile(path.join(__dirname, "../renderer/index.html"), {
          hash: "#task-detail-window",
          query: {
            projectId: safeDetailData.projectId,
            taskId: safeDetailData.taskId,
            taskName: safeDetailData.taskName,
            selectedType: safeDetailData.selectedType,
            projectDir: safeDetailData.projectDir,
          },
        });
      }

      bindFindInPageEvents(win.webContents);
      win.on("maximize", () => sendWindowState(win));
      win.on("unmaximize", () => sendWindowState(win));
      win.on("enter-full-screen", () => sendWindowState(win));
      win.on("leave-full-screen", () => sendWindowState(win));
      taskDetailWindows.set(windowKey, win);

      win.on("closed", () => {
        taskDetailWindows.delete(windowKey);
      });

      log.info(`Task detail window created for task: ${safeDetailData.taskId}`);
      return win;
    } catch (error) {
      log.error("Failed to create task detail window:", error);
      return null;
    }
  }

  ipcMain.on("open-task-detail-window", async (_event, detailData) => {
    try {
      const window = createTaskDetailWindow(detailData);

      await new Promise((resolve) => setTimeout(resolve, 500));

      if (window && !window.isDestroyed()) {
        window.show();
        window.focus();
        log.info(`Task detail window shown for task: ${detailData?.taskId || ""}`);
      }
    } catch (error) {
      log.error("Failed to open task detail window:", error);
    }
  });

  log.info(`[perf] IPC handlers registered: ${Date.now() - t0}ms`);

  if (process.env.VITE_DEV === "true") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  log.info(`[perf] loadURL called: ${Date.now() - t0}ms`);
  if (shouldOpenDevTools()) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.on("close", (event) => {
    if (shutdownFlushPromise) {
      // Already flushing — keep the window alive until the flush resolves
      // and explicitly calls destroy(); ignore secondary close clicks.
      event.preventDefault();
      return;
    }
    if (!workspaceWriteQueue.hasPending()) return;

    event.preventDefault();
    performShutdownFlush("window-close").then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeAllListeners("close");
        mainWindow.destroy();
      }
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    for (const win of taskDetailWindows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    taskDetailWindows.clear();
  });

  ipcMain.handle("get-current-theme", async () => {
    return db_meta.data.theme || "dark";
  });

  ////////////// Window Controls //////////////
  function targetWindow(event) {
    return BrowserWindow.fromWebContents(event.sender);
  }
  ipcMain.on("window:minimize", (event) => {
    const win = targetWindow(event);
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.on("window:toggle-maximize", (event) => {
    const win = targetWindow(event);
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.on("window:close", (event) => {
    const win = targetWindow(event);
    if (win && !win.isDestroyed()) win.close();
  });
  ipcMain.handle("window:get-state", (event) => {
    const win = targetWindow(event);
    if (!win || win.isDestroyed()) {
      return { isMaximized: false, isFullScreen: false };
    }
    return { isMaximized: win.isMaximized(), isFullScreen: win.isFullScreen() };
  });

  ////////////// Workspace IPC //////////////
  // projectDir 竊・{ tasks: Map, taskDirs: Map } 縺ｮ繧､繝ｳ繝｡繝｢繝ｪ繧ｭ繝｣繝・す繝･

  ipcMain.handle("ws:get-workspaces", async () => {
    return {
      workspaces: db_meta.data.workspaces || [],
      activeWorkspace: db_meta.data.activeWorkspace || null,
    };
  });

  ipcMain.on("ws:set-workspaces", (event, { workspaces, activeWorkspace }) => {
    db_meta.data.workspaces = workspaces;
    if (activeWorkspace !== undefined) {
      db_meta.data.activeWorkspace = activeWorkspace;
      startWorkspaceWatcher(activeWorkspace);
    }
    try {
      db_meta.write();
    } catch (err) {
      showSaveError("ws:set-workspaces", err);
    }
  });

  ipcMain.handle("ws:list-projects", async (event, { workspacePath }) => {
    try {
      return await workspace.listProjectsAsync(workspacePath);
    } catch (err) {
      log.error("ws:list-projects error:", err.message);
      return [];
    }
  });

  ipcMain.handle("ws:open-workspace", async (event, { workspacePath }) => {
    try {
      if (!workspacePath || typeof workspacePath !== "string") {
        return { success: false, error: "No workspace is selected" };
      }

      if (!isKnownWorkspacePath(workspacePath)) {
        return { success: false, error: "Workspace is not registered" };
      }

      const requestedPath = path.resolve(workspacePath);
      const stats = await fs.promises.stat(requestedPath);
      if (!stats.isDirectory()) {
        return { success: false, error: "Workspace path is not a directory" };
      }

      const openError = await shell.openPath(requestedPath);
      if (openError) {
        return { success: false, error: openError };
      }

      return { success: true };
    } catch (err) {
      log.error("ws:open-workspace error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:open-task-folder", async (event, { projectDir, taskId }) => {
    try {
      if (!projectDir || typeof projectDir !== "string") {
        return { success: false, error: "No workspace project is selected" };
      }
      if (!taskId || typeof taskId !== "string") {
        return { success: false, error: "No task is selected" };
      }
      if (!isInsideKnownWorkspace(projectDir)) {
        return { success: false, error: "Project is not inside a registered workspace" };
      }

      if (workspaceWriteQueue.hasPending(projectDir)) {
        await workspaceWriteQueue.flush();
      }

      let cached = await ensureWorkspaceCacheAsync(projectDir);
      if (!cached.taskDirs?.has(taskId)) {
        const { tasks, taskDirs } = await readProjectSummaryAsync(projectDir);
        cached = { tasks, taskDirs };
        wsCache.set(projectDir, cached);
      }

      const dirName = cached.taskDirs.get(taskId);
      if (!dirName) {
        return { success: false, error: "Task folder was not found" };
      }

      const resolvedProjectDir = path.resolve(projectDir);
      const targetDir =
        dirName === "_project" ? resolvedProjectDir : path.resolve(resolvedProjectDir, dirName);
      const relativePath = path.relative(resolvedProjectDir, targetDir);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return { success: false, error: "Task folder is outside the project" };
      }

      const stats = await fs.promises.stat(targetDir);
      if (!stats.isDirectory()) {
        return { success: false, error: "Task path is not a directory" };
      }

      const openError = await shell.openPath(targetDir);
      if (openError) {
        return { success: false, error: openError };
      }

      return { success: true };
    } catch (err) {
      log.error("ws:open-task-folder error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:set-project-order", async (event, { workspacePath, projects }) => {
    try {
      const result = await workspace.setProjectOrderAsync(workspacePath, projects, {
        onWritten: recordWrite,
      });
      for (const projectDir of result.changedProjectDirs) {
        await workspaceReconciler.markProjectWritten(projectDir);
      }
      return { success: true, projects: result.projects };
    } catch (err) {
      log.error("ws:set-project-order error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:read-project", async (event, { projectDir }) => {
    try {
      const { tasks } = await readWorkspaceProjectForRendererAsync(projectDir);
      // Map 竊・plain object for IPC serialisation
      return { tasks: Object.fromEntries(tasks) };
    } catch (err) {
      log.error("ws:read-project error:", err.message);
      throw err;
    }
  });

  ipcMain.handle("ws:read-task-memos", async (event, { projectDir, taskId }) => {
    try {
      const cached = await ensureWorkspaceCacheAsync(projectDir);
      const memos = await workspace.readTaskMemosAsync(projectDir, taskId, cached.taskDirs);
      const task = cached.tasks.get(taskId);
      if (task) {
        task.memos = memos;
      }
      return { memos };
    } catch (err) {
      log.error("ws:read-task-memos error:", err.message);
      return { memos: [], error: err.message };
    }
  });

  ipcMain.handle("ws:read-project-memos", async (event, { projectDir }) => {
    try {
      const cached = await ensureWorkspaceCacheAsync(projectDir);
      const memosByTaskId = {};
      // Read every task's memos concurrently so per-file disk latency overlaps
      // instead of serializing on the main event loop.
      const taskIds = [...cached.taskDirs.keys()];
      const memosList = await Promise.all(
        taskIds.map((taskId) => workspace.readTaskMemosAsync(projectDir, taskId, cached.taskDirs))
      );
      taskIds.forEach((taskId, index) => {
        const memos = memosList[index];
        memosByTaskId[taskId] = memos;
        const task = cached.tasks.get(taskId);
        if (task) {
          task.memos = memos;
        }
      });
      return { memosByTaskId };
    } catch (err) {
      log.error("ws:read-project-memos error:", err.message);
      return { memosByTaskId: {}, error: err.message };
    }
  });

  ipcMain.handle("ws:write-task", async (event, { projectDir, task }) => {
    try {
      const cached = ensureWorkspaceCache(projectDir);
      const { tasks, taskDirs } = cached;
      const [taskToWrite] = withLoadedMemoBodies(projectDir, [task], taskDirs);

      // Cycle check when parents are being set
      if (taskToWrite.parents && taskToWrite.parents.length > 0) {
        // Merge updated task into the map for a correct check
        const tasksWithUpdate = new Map(tasks);
        tasksWithUpdate.set(taskToWrite.id, taskToWrite);
        if (workspace.wouldCreateCycle(tasksWithUpdate, taskToWrite.id, taskToWrite.parents)) {
          return { success: false, error: "Cannot save because this would create a cycle" };
        }
      }

      await workspace.writeTaskAsync(projectDir, taskToWrite, taskDirs, recordWrite);
      tasks.set(taskToWrite.id, taskToWrite);
      return { success: true };
    } catch (err) {
      log.error("ws:write-task error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    "ws:save-memo-image",
    async (event, { projectDir, taskId, bytes, mimeType = "image/png" }) => {
      try {
        const cached = ensureWorkspaceCache(projectDir);

        const result = await workspace.saveMemoImageAsync(
          projectDir,
          cached.taskDirs,
          taskId,
          bytes,
          mimeType,
          recordWrite
        );
        return { success: true, path: result.relativePath };
      } catch (err) {
        log.error("ws:save-memo-image error:", err.message);
        return { success: false, error: err.message };
      }
    }
  );

  ipcMain.handle("ws:resolve-memo-asset", async (event, { projectDir, taskId, assetPath }) => {
    try {
      const cached = ensureWorkspaceCache(projectDir);

      const fileUrl = workspace.resolveMemoAssetPath(
        projectDir,
        cached.taskDirs,
        taskId,
        assetPath
      );

      return { success: Boolean(fileUrl), url: fileUrl ?? undefined };
    } catch (err) {
      log.error("ws:resolve-memo-asset error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    "ws:save-task-attachment",
    async (event, { projectDir, taskId, fileName, bytes }) => {
      try {
        const cached = ensureWorkspaceCache(projectDir);
        const attachment = await workspace.saveTaskAttachmentAsync(
          projectDir,
          cached.taskDirs,
          taskId,
          fileName,
          bytes,
          recordWrite
        );

        const task = cached.tasks.get(taskId);
        if (task) {
          task.attachments = [...(task.attachments ?? []), attachment];
        }

        return { success: true, attachment };
      } catch (err) {
        log.error("ws:save-task-attachment error:", err.message);
        return { success: false, error: err.message };
      }
    }
  );

  ipcMain.handle(
    "ws:delete-task-attachment",
    async (event, { projectDir, taskId, attachmentPath }) => {
      try {
        const cached = ensureWorkspaceCache(projectDir);
        const attachments = await workspace.deleteTaskAttachmentAsync(
          projectDir,
          cached.taskDirs,
          taskId,
          attachmentPath
        );
        await workspaceReconciler.markProjectWritten(projectDir);

        const task = cached.tasks.get(taskId);
        if (task) {
          task.attachments = attachments;
        }

        return { success: true, attachments };
      } catch (err) {
        log.error("ws:delete-task-attachment error:", err.message);
        return { success: false, error: err.message };
      }
    }
  );

  ipcMain.handle(
    "ws:open-task-attachment",
    async (event, { projectDir, taskId, attachmentPath }) => {
      try {
        const cached = ensureWorkspaceCache(projectDir);
        const resolvedPath = workspace.resolveTaskAttachmentFilePath(
          projectDir,
          cached.taskDirs,
          taskId,
          attachmentPath
        );

        if (!resolvedPath) {
          return { success: false, error: "Attachment was not found" };
        }

        const openError = await shell.openPath(resolvedPath);
        if (openError) {
          return { success: false, error: openError };
        }

        return { success: true };
      } catch (err) {
        log.error("ws:open-task-attachment error:", err.message);
        return { success: false, error: err.message };
      }
    }
  );

  ipcMain.handle(
    "ws:open-task-attachment-with",
    async (event, { projectDir, taskId, attachmentPath }) => {
      try {
        const cached = ensureWorkspaceCache(projectDir);
        const resolvedPath = workspace.resolveTaskAttachmentFilePath(
          projectDir,
          cached.taskDirs,
          taskId,
          attachmentPath
        );

        if (!resolvedPath) {
          return { success: false, error: "Attachment was not found" };
        }

        await openPathWithProgramPicker(resolvedPath);
        return { success: true };
      } catch (err) {
        log.error("ws:open-task-attachment-with error:", err.message);
        return { success: false, error: err.message };
      }
    }
  );

  ipcMain.handle("ws:delete-task", async (event, { projectDir, taskId }) => {
    try {
      const cached = ensureWorkspaceCache(projectDir);
      const { tasks, taskDirs } = cached;

      // Orphan check: any task whose only parent is taskId would be orphaned
      const wouldOrphan = [...tasks.values()].some(
        (t) => t.parents.length === 1 && t.parents[0] === taskId
      );
      if (wouldOrphan) {
        return { success: false, error: "Cannot delete because this would orphan child tasks" };
      }

      await workspace.deleteTaskDirAsync(projectDir, taskDirs, taskId);
      tasks.delete(taskId);
      return { success: true };
    } catch (err) {
      log.error("ws:delete-task error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.on("ws:broadcast-project-snapshot", (event, { projectDir, tasks, options }) => {
    try {
      if (!projectDir || !isInsideKnownWorkspace(projectDir)) {
        return;
      }

      const cached = primeWorkspaceProjectSnapshot(projectDir, tasks);
      if (!cached) return;

      const payload = {
        projectDir,
        tasks: Object.fromEntries(cached.tasks),
        reason: "local-update",
      };
      const revision = Number(options?.revision);
      if (Number.isFinite(revision)) {
        payload.revision = revision;
      }

      sendWorkspaceProjectUpdated(payload, event.sender);
    } catch (err) {
      log.error("ws:broadcast-project-snapshot error:", err.message);
    }
  });

  ipcMain.handle("ws:write-project", async (event, { projectDir, tasks, options }) => {
    try {
      primeWorkspaceProjectSnapshot(projectDir, tasks);
      return workspaceWriteQueue.enqueue(projectDir, tasks, options || {});
    } catch (err) {
      log.error("ws:write-project error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:write-project-patch", async (event, { projectDir, patch, options }) => {
    try {
      primeWorkspaceProjectPatch(projectDir, patch);
      return workspaceWriteQueue.enqueuePatch(projectDir, patch, options || {});
    } catch (err) {
      log.error("ws:write-project-patch error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:resolve-conflict", async (event, { projectDir, action }) => {
    try {
      if (action === "keep-local") {
        return { success: true };
      }

      if (action !== "reload") {
        return { success: false, error: "Unknown conflict action" };
      }

      if (workspaceWriteQueue.isWriting(projectDir)) {
        return { success: false, error: "Cannot reload while a workspace save is writing" };
      }

      workspaceWriteQueue.discard(projectDir);
      const { tasks, taskDirs } = await workspace.readProjectAsync(projectDir);
      wsCache.set(projectDir, { tasks, taskDirs });
      optimisticWorkspaceProjectDirs.delete(projectDir);
      sendWorkspaceProjectUpdated({
        projectDir,
        tasks: Object.fromEntries(tasks),
        reason: "conflict-reload",
      });
      sendWorkspaceSaveStatus({ projectDir, status: "saved" });
      return { success: true };
    } catch (err) {
      log.error("ws:resolve-conflict error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:select-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select workspace folder",
    });
    if (result.canceled || !result.filePaths[0]) return { path: null };

    const selected = result.filePaths[0];
    let entries;
    try {
      entries = await fs.promises.readdir(selected, { withFileTypes: true });
    } catch (err) {
      log.error("ws:select-directory readdir error:", err.message);
      return {
        path: null,
        error: `フォルダの読み取りに失敗しました: ${err.message}`,
      };
    }

    const isEmpty = entries.length === 0;
    const hasProjects = (await workspace.listProjectsAsync(selected)).length > 0;

    if (!isEmpty && !hasProjects) {
      return {
        path: null,
        error:
          "選択したフォルダは空でも既存のワークスペースでもありません。空のフォルダ、または _project.md を含むプロジェクトフォルダがあるディレクトリを選択してください。",
      };
    }
    return { path: selected };
  });

  ipcMain.handle("ws:create-project", async (event, { workspacePath, name, id, order }) => {
    try {
      const result = await workspace.createProjectAsync(workspacePath, name, id, order, {
        onWritten: recordWrite,
      });
      return { success: true, ...result };
    } catch (err) {
      log.error("ws:create-project error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:delete-project", async (event, { projectDir }) => {
    try {
      const result = await workspace.deleteProjectAsync(projectDir);
      wsCache.delete(projectDir);
      optimisticWorkspaceProjectDirs.delete(projectDir);
      return result;
    } catch (err) {
      log.error("ws:delete-project error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ////////////// Inbox IPC //////////////
  ipcMain.handle("ws:ensure-inbox", async (event, { workspacePath }) => {
    try {
      const result = await inbox.ensureInbox(workspacePath, { onWritten: recordWrite });
      return { success: true, projectDir: result.projectDir, rootId: result.rootId };
    } catch (err) {
      log.error("ws:ensure-inbox error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:read-inbox", async (event, { workspacePath }) => {
    try {
      const { projectDir, rootId, tasks, taskDirs } = await inbox.readInbox(workspacePath, {
        onWritten: recordWrite,
      });
      wsCache.set(projectDir, { tasks, taskDirs });
      return {
        success: true,
        projectDir,
        rootId,
        tasks: Object.fromEntries(tasks),
      };
    } catch (err) {
      log.error("ws:read-inbox error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:add-inbox-item", async (event, { workspacePath, item }) => {
    try {
      const { task, projectDir, rootId, tasks, taskDirs } = await inbox.addInboxItem(
        workspacePath,
        item || {},
        { onWritten: recordWrite }
      );
      await workspaceReconciler.markProjectWritten(projectDir);
      wsCache.set(projectDir, { tasks, taskDirs });
      sendWorkspaceProjectUpdated({
        projectDir,
        tasks: Object.fromEntries(tasks),
        reason: "external-update",
      });
      return { success: true, task, projectDir, rootId };
    } catch (err) {
      log.error("ws:add-inbox-item error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    "ws:send-inbox-items",
    async (event, { workspacePath, targetProjectDir, targetRootId, targetParentId, taskIds }) => {
      try {
        if (!Array.isArray(taskIds) || taskIds.length === 0) {
          return { success: false, error: "No items to send" };
        }
        if (!targetProjectDir || typeof targetProjectDir !== "string") {
          return { success: false, error: "Invalid target project" };
        }
        if (!targetRootId || typeof targetRootId !== "string") {
          return { success: false, error: "Invalid target project root" };
        }
        if (
          targetParentId !== undefined &&
          targetParentId !== null &&
          typeof targetParentId !== "string"
        ) {
          return { success: false, error: "Invalid target parent" };
        }

        const result = await inbox.sendInboxItemsToProject(
          workspacePath,
          targetProjectDir,
          taskIds,
          targetRootId,
          { onWritten: recordWrite, targetParentId: targetParentId || undefined }
        );

        await workspaceReconciler.markProjectWritten(result.inboxState.projectDir);
        await workspaceReconciler.markProjectWritten(result.targetState.projectDir);

        wsCache.set(result.inboxState.projectDir, {
          tasks: result.inboxState.tasks,
          taskDirs: result.inboxState.taskDirs,
        });
        wsCache.set(result.targetState.projectDir, {
          tasks: result.targetState.tasks,
          taskDirs: result.targetState.taskDirs,
        });

        sendWorkspaceProjectUpdated({
          projectDir: result.inboxState.projectDir,
          tasks: Object.fromEntries(result.inboxState.tasks),
          reason: "external-update",
        });
        sendWorkspaceProjectUpdated({
          projectDir: result.targetState.projectDir,
          tasks: Object.fromEntries(result.targetState.tasks),
          reason: "external-update",
        });

        return { success: true, moved: result.moved, errors: result.errors };
      } catch (err) {
        log.error("ws:send-inbox-items error:", err.message);
        return { success: false, error: err.message };
      }
    }
  );

  async function exportLegacyProjects(workspacePath, options = {}) {
    const migrated = [];
    const errors = [];

    for (const projectData of db.data || []) {
      const name = projectData.data?.data?.name || "unknown";
      try {
        const { count } = workspace.exportProjectData(workspacePath, projectData, options);
        migrated.push({ name, count });
        log.info(`Exported legacy project "${name}" (${count} tasks)`);
      } catch (err) {
        log.error(`Legacy export error for "${name}":`, err.message);
        errors.push({ name, error: err.message });
      }
    }

    return { success: errors.length === 0, migrated, errors };
  }

  ipcMain.handle("ws:export-legacy-projects", async (event, { workspacePath, options }) => {
    return exportLegacyProjects(workspacePath, options);
  });

  ipcMain.handle("ws:migrate-projects", async (event, { workspacePath, options }) => {
    return exportLegacyProjects(workspacePath, options);
  });

  ipcMain.handle("ws:get-legacy-projects", async () => {
    return (db.data || []).map((p) => ({
      id: p.data?.id ?? "",
      name: p.data?.data?.name ?? "unnamed",
      taskCount: countNodes(p.data),
    }));
  });
});
