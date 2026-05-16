const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");

const RECENT_WRITE_TTL_MS = 5000;

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function hashFile(filePath) {
  return hashBuffer(await fs.promises.readFile(filePath));
}

function isConflictCopy(filePath) {
  return /conflicted copy|conflict(ed)? copy/i.test(path.basename(filePath));
}

function workspaceStateId(workspacePath) {
  return crypto.createHash("sha256").update(path.resolve(workspacePath)).digest("hex").slice(0, 16);
}

async function collectFileHashes(rootDir) {
  const result = new Map();

  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && !entry.name.includes(".tmp")) {
        try {
          result.set(fullPath, await hashFile(fullPath));
        } catch {
          // Ignore files that disappear during a scan.
        }
      }
    }
  }

  await walk(rootDir);
  return result;
}

class WorkspaceReconciler {
  constructor({
    readProject,
    hasPendingWrite = () => false,
    onProjectUpdated = () => {},
    onConflict = () => {},
    onNotice = () => {},
    stateRootDir,
    watchFactory = (workspacePath, options) => chokidar.watch(workspacePath, options),
  }) {
    if (typeof readProject !== "function") {
      throw new Error("readProject is required");
    }

    this.readProject = readProject;
    this.hasPendingWrite = hasPendingWrite;
    this.onProjectUpdated = onProjectUpdated;
    this.onConflict = onConflict;
    this.onNotice = onNotice;
    this.stateRootDir = stateRootDir;
    this.watchFactory = watchFactory;
    this.recentlyWritten = new Map();
    this.projectTimers = new Map();
    this.workspacePath = null;
    this.watcher = null;
  }

  async start(workspacePath) {
    await this.stop();
    if (!workspacePath) return;

    this.workspacePath = workspacePath;
    await this.writeSnapshot();

    this.watcher = this.watchFactory(workspacePath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      ignored: (watchedPath) => path.basename(watchedPath).includes(".tmp"),
    });

    this.watcher
      .on("add", (filePath) => this.handleFileEvent("add", filePath))
      .on("change", (filePath) => this.handleFileEvent("change", filePath))
      .on("unlink", (filePath) => this.handleFileEvent("unlink", filePath));
  }

  async stop() {
    for (const timer of this.projectTimers.values()) {
      clearTimeout(timer);
    }
    this.projectTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.workspacePath = null;
  }

  async markProjectWritten(projectDir) {
    const hashes = await collectFileHashes(projectDir);
    const now = Date.now();
    for (const [filePath, hash] of hashes) {
      this.recentlyWritten.set(path.resolve(filePath), {
        hash,
        expiresAt: now + RECENT_WRITE_TTL_MS,
      });
    }
    this.cleanupRecentlyWritten(now);
    await this.writeSnapshot();
  }

  async handleFileEvent(eventName, filePath) {
    if (!this.workspacePath) return;

    const resolvedPath = path.resolve(filePath);
    if (isConflictCopy(resolvedPath)) {
      this.onNotice({
        kind: "conflicted-copy",
        path: resolvedPath,
        message: "Conflicted copy detected in workspace.",
      });
      return;
    }

    if (eventName !== "unlink") {
      let fileHash;
      try {
        fileHash = await hashFile(resolvedPath);
      } catch {
        return;
      }

      if (this.isRecentlyWritten(resolvedPath, fileHash)) {
        return;
      }
    }

    const projectDir = this.resolveProjectDir(resolvedPath);
    if (!projectDir) return;

    this.scheduleProjectReconcile(projectDir);
  }

  scheduleProjectReconcile(projectDir) {
    if (this.projectTimers.has(projectDir)) {
      clearTimeout(this.projectTimers.get(projectDir));
    }

    this.projectTimers.set(
      projectDir,
      setTimeout(() => {
        this.projectTimers.delete(projectDir);
        void this.reconcileProject(projectDir);
      }, 100)
    );
  }

  async reconcileProject(projectDir) {
    if (this.hasPendingWrite(projectDir)) {
      const event = {
        projectDir,
        message: "Workspace changed on disk while local changes are waiting to save.",
      };
      this.onConflict(event);
      return;
    }

    try {
      const { tasks, taskDirs } = this.readProject(projectDir);
      this.onProjectUpdated({
        projectDir,
        tasks,
        taskDirs,
        reason: "external-update",
      });
      this.onNotice({
        kind: "workspace-updated",
        projectDir,
        message: "Workspace updated on disk.",
      });
      await this.writeSnapshot();
    } catch (err) {
      this.onNotice({
        kind: "error",
        projectDir,
        message: err.message,
      });
    }
  }

  resolveProjectDir(filePath) {
    if (!this.workspacePath) return null;
    const relative = path.relative(this.workspacePath, filePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }

    const [projectName] = relative.split(path.sep);
    if (!projectName) return null;
    const projectDir = path.join(this.workspacePath, projectName);
    if (!fs.existsSync(path.join(projectDir, "_project.md"))) {
      return null;
    }
    return projectDir;
  }

  isRecentlyWritten(filePath, fileHash) {
    const now = Date.now();
    this.cleanupRecentlyWritten(now);
    const entry = this.recentlyWritten.get(path.resolve(filePath));
    return Boolean(entry && entry.hash === fileHash);
  }

  cleanupRecentlyWritten(now = Date.now()) {
    for (const [filePath, entry] of this.recentlyWritten) {
      if (entry.expiresAt <= now) {
        this.recentlyWritten.delete(filePath);
      }
    }
  }

  async writeSnapshot() {
    if (!this.workspacePath || !this.stateRootDir) return;
    const hashes = await collectFileHashes(this.workspacePath);
    const files = {};
    for (const [filePath, hash] of hashes) {
      files[path.relative(this.workspacePath, filePath)] = hash;
    }

    await fs.promises.mkdir(this.stateRootDir, { recursive: true });
    const statePath = path.join(this.stateRootDir, `${workspaceStateId(this.workspacePath)}.json`);
    await fs.promises.writeFile(
      statePath,
      JSON.stringify({ workspacePath: this.workspacePath, files }, null, 2)
    );
  }
}

module.exports = {
  WorkspaceReconciler,
  collectFileHashes,
  hashFile,
  isConflictCopy,
  workspaceStateId,
};
