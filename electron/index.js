const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { LowSync, JSONFileSync } = require("@commonify/lowdb");
const log = require("electron-log/main");
const workspace = require("./workspace");

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
  });
  log.info(`[perf] BrowserWindow created: ${Date.now() - t0}ms`);

  ////////////// Low //////////////
  // init low db. read after.
  // data
  const file = resolveAppDataPath("db.json");
  log.info(file);
  const defaultData = [];
  const adapter = new JSONFileSync(file);
  const db = new LowSync(adapter);
  db.read();
  db.data ||= defaultData; // initialize
  db.write();
  // meta
  const file_meta = resolveAppDataPath("meta.json");
  log.info(file_meta);
  const defaultDataMeta = {
    theme: "dark",
  };
  const adapter_meta = new JSONFileSync(file_meta);
  const db_meta = new LowSync(adapter_meta);
  db_meta.read();
  db_meta.data ||= defaultDataMeta; // initialize
  db_meta.write();
  log.info(`[perf] DB init done: ${Date.now() - t0}ms`);

  const dbWriter = createAsyncWriter(db, file, "db");
  const dbMetaWriter = createAsyncWriter(db_meta, file_meta, "meta", 100);

  app.on("before-quit", () => {
    dbWriter.flush();
    dbMetaWriter.flush();
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
      };

      const existing = taskDetailWindows.get(safeDetailData.taskId);
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
          },
        });
      }

      bindFindInPageEvents(win.webContents);
      taskDetailWindows.set(safeDetailData.taskId, win);

      win.on("closed", () => {
        taskDetailWindows.delete(safeDetailData.taskId);
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

  ////////////// Workspace IPC //////////////
  // projectDir 竊・{ tasks: Map, taskDirs: Map } 縺ｮ繧､繝ｳ繝｡繝｢繝ｪ繧ｭ繝｣繝・す繝･
  const wsCache = new Map();

  ipcMain.handle("ws:get-workspaces", async () => {
    return {
      workspaces: db_meta.data.workspaces || [],
      activeWorkspace: db_meta.data.activeWorkspace || null,
    };
  });

  ipcMain.on("ws:set-workspaces", (event, { workspaces, activeWorkspace }) => {
    db_meta.data.workspaces = workspaces;
    if (activeWorkspace !== undefined) db_meta.data.activeWorkspace = activeWorkspace;
    try {
      db_meta.write();
    } catch (err) {
      showSaveError("ws:set-workspaces", err);
    }
  });

  ipcMain.handle("ws:list-projects", async (event, { workspacePath }) => {
    try {
      return workspace.listProjects(workspacePath);
    } catch (err) {
      log.error("ws:list-projects error:", err.message);
      return [];
    }
  });

  ipcMain.handle("ws:read-project", async (event, { projectDir }) => {
    try {
      const { tasks, taskDirs } = workspace.readProject(projectDir);
      wsCache.set(projectDir, { tasks, taskDirs });
      // Map 竊・plain object for IPC serialisation
      return { tasks: Object.fromEntries(tasks) };
    } catch (err) {
      log.error("ws:read-project error:", err.message);
      throw err;
    }
  });

  ipcMain.handle("ws:write-task", async (event, { projectDir, task }) => {
    try {
      let cached = wsCache.get(projectDir);
      if (!cached) {
        const { tasks, taskDirs } = workspace.readProject(projectDir);
        cached = { tasks, taskDirs };
        wsCache.set(projectDir, cached);
      }
      const { tasks, taskDirs } = cached;

      // Cycle check when parents are being set
      if (task.parents && task.parents.length > 0) {
        // Merge updated task into the map for a correct check
        const tasksWithUpdate = new Map(tasks);
        tasksWithUpdate.set(task.id, task);
        if (workspace.wouldCreateCycle(tasksWithUpdate, task.id, task.parents)) {
          return { success: false, error: "Cannot save because this would create a cycle" };
        }
      }

      workspace.writeTask(projectDir, task, taskDirs);
      tasks.set(task.id, task);
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
        let cached = wsCache.get(projectDir);
        if (!cached) {
          const { tasks, taskDirs } = workspace.readProject(projectDir);
          cached = { tasks, taskDirs };
          wsCache.set(projectDir, cached);
        }

        const result = workspace.saveMemoImage(
          projectDir,
          cached.taskDirs,
          taskId,
          bytes,
          mimeType
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
      let cached = wsCache.get(projectDir);
      if (!cached) {
        const { tasks, taskDirs } = workspace.readProject(projectDir);
        cached = { tasks, taskDirs };
        wsCache.set(projectDir, cached);
      }

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

  ipcMain.handle("ws:delete-task", async (event, { projectDir, taskId }) => {
    try {
      let cached = wsCache.get(projectDir);
      if (!cached) {
        const { tasks, taskDirs } = workspace.readProject(projectDir);
        cached = { tasks, taskDirs };
        wsCache.set(projectDir, cached);
      }
      const { tasks, taskDirs } = cached;

      // Orphan check: any task whose only parent is taskId would be orphaned
      const wouldOrphan = [...tasks.values()].some(
        (t) => t.parents.length === 1 && t.parents[0] === taskId
      );
      if (wouldOrphan) {
        return { success: false, error: "Cannot delete because this would orphan child tasks" };
      }

      workspace.deleteTaskDir(projectDir, taskDirs, taskId);
      tasks.delete(taskId);
      return { success: true };
    } catch (err) {
      log.error("ws:delete-task error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:write-project", async (event, { projectDir, tasks }) => {
    try {
      const { taskDirs } = workspace.readProject(projectDir);
      const newTaskIds = new Set(tasks.map((t) => t.id));

      // Delete task dirs no longer in the new task list
      for (const id of [...taskDirs.keys()]) {
        if (!newTaskIds.has(id)) {
          workspace.deleteTaskDir(projectDir, taskDirs, id);
        }
      }

      for (const task of tasks) {
        workspace.writeTask(projectDir, task, taskDirs);
      }

      // Invalidate cache so next read reflects the new state
      wsCache.delete(projectDir);

      return { success: true };
    } catch (err) {
      log.error("ws:write-project error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("ws:select-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select workspace folder",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("ws:create-project", async (event, { workspacePath, name, id }) => {
    try {
      const result = workspace.createProject(workspacePath, name, id);
      return { success: true, ...result };
    } catch (err) {
      log.error("ws:create-project error:", err.message);
      return { success: false, error: err.message };
    }
  });

  async function exportLegacyProjects(workspacePath) {
    const migrated = [];
    const errors = [];

    for (const projectData of db.data || []) {
      const name = projectData.data?.data?.name || "unknown";
      try {
        const { count } = workspace.exportProjectData(workspacePath, projectData);
        migrated.push({ name, count });
        log.info(`Exported legacy project "${name}" (${count} tasks)`);
      } catch (err) {
        log.error(`Legacy export error for "${name}":`, err.message);
        errors.push({ name, error: err.message });
      }
    }

    return { success: errors.length === 0, migrated, errors };
  }

  ipcMain.handle("ws:export-legacy-projects", async (event, { workspacePath }) => {
    return exportLegacyProjects(workspacePath);
  });

  ipcMain.handle("ws:migrate-projects", async (event, { workspacePath }) => {
    return exportLegacyProjects(workspacePath);
  });

  ipcMain.handle("ws:get-legacy-projects", async () => {
    return (db.data || []).map((p) => ({
      id: p.data?.id ?? "",
      name: p.data?.data?.name ?? "unnamed",
      taskCount: countNodes(p.data),
    }));
  });
});
