const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");

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

function collectFileHashesSync(rootDir) {
  const result = new Map();

  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && !entry.name.includes(".tmp")) {
        try {
          result.set(fullPath, hashBuffer(fs.readFileSync(fullPath)));
        } catch {
          // Ignore files that disappear during a scan.
        }
      }
    }
  }

  walk(rootDir);
  return result;
}

function isFileWithinDir(filePath, dirPath) {
  const dir = path.resolve(dirPath);
  const file = path.resolve(filePath);
  if (file === dir) return false;
  const rel = path.relative(dir, file);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
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
    // Persistent file -> sha256 map. Updated whenever WE write to a file or
    // accept an external update; never expires by time alone. A file event
    // whose content hash matches the stored value is treated as a no-op
    // (e.g. OneDrive re-touching files after sync), avoiding spurious
    // "external update" / "conflict" notifications.
    this.knownFileHashes = new Map();
    this.projectTimers = new Map();
    this.workspacePath = null;
    this.watcher = null;
  }

  async start(workspacePath) {
    await this.stop();
    if (!workspacePath) return;

    this.workspacePath = workspacePath;
    // Treat the current disk state as the baseline. Any change while the app
    // was closed is implicitly accepted; subsequent divergence will be
    // detected by hash mismatch.
    await this.rebuildKnownHashesFromDisk(workspacePath);
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

  async rebuildKnownHashesFromDisk(rootDir) {
    const hashes = await collectFileHashes(rootDir);
    this.knownFileHashes = new Map();
    for (const [filePath, hash] of hashes) {
      this.knownFileHashes.set(path.resolve(filePath), hash);
    }
  }

  async markProjectWritten(projectDir) {
    const hashes = await collectFileHashes(projectDir);
    const resolvedProject = path.resolve(projectDir);

    // Remove stale entries: files that used to be in this project but no
    // longer exist (e.g. task deleted).
    for (const filePath of [...this.knownFileHashes.keys()]) {
      if (isFileWithinDir(filePath, resolvedProject) && !hashes.has(filePath)) {
        this.knownFileHashes.delete(filePath);
      }
    }

    for (const [filePath, hash] of hashes) {
      this.knownFileHashes.set(path.resolve(filePath), hash);
    }

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

    if (eventName === "unlink") {
      // If we don't know this file, we've already accepted the deletion
      // (either we deleted it, or it was never tracked).
      if (!this.knownFileHashes.has(resolvedPath)) return;
    } else {
      let fileHash;
      try {
        fileHash = await hashFile(resolvedPath);
      } catch {
        return;
      }
      // No content change since we last saw it — likely a sync-driven touch
      // (e.g. OneDrive). Suppress.
      if (this.knownFileHashes.get(resolvedPath) === fileHash) return;
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
    // Re-check at reconcile time: if everything matches knownFileHashes by
    // now, the triggering event was stale (e.g. raced with our own write
    // batch that has since completed and called markProjectWritten). This
    // check is intentionally synchronous so the subsequent side effects
    // (onConflict / onProjectUpdated) run before any await yields control.
    if (this.projectMatchesKnown(projectDir)) {
      return;
    }

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
      // Adopt the new disk state as the new baseline.
      await this.markProjectWritten(projectDir);
    } catch (err) {
      this.onNotice({
        kind: "error",
        projectDir,
        message: err.message,
      });
    }
  }

  projectMatchesKnown(projectDir) {
    const resolvedProject = path.resolve(projectDir);
    let currentHashes;
    try {
      currentHashes = collectFileHashesSync(projectDir);
    } catch {
      return false;
    }

    if (currentHashes.size !== this.countKnownFilesIn(resolvedProject)) {
      return false;
    }

    for (const [filePath, hash] of currentHashes) {
      if (this.knownFileHashes.get(path.resolve(filePath)) !== hash) {
        return false;
      }
    }
    return true;
  }

  countKnownFilesIn(resolvedProjectDir) {
    let count = 0;
    for (const filePath of this.knownFileHashes.keys()) {
      if (isFileWithinDir(filePath, resolvedProjectDir)) count += 1;
    }
    return count;
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

  async writeSnapshot() {
    if (!this.workspacePath || !this.stateRootDir) return;
    const files = {};
    for (const [filePath, hash] of this.knownFileHashes) {
      if (isFileWithinDir(filePath, this.workspacePath)) {
        files[path.relative(this.workspacePath, filePath)] = hash;
      }
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
