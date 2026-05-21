const DEFAULT_MAX_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class WorkspaceWriteQueue {
  constructor({
    writeProject,
    onStatus = () => {},
    onWritten = () => {},
    onError = () => {},
    maxPendingProjects = 8,
    maxRetryAttempts = DEFAULT_MAX_RETRY_ATTEMPTS,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  }) {
    if (typeof writeProject !== "function") {
      throw new Error("writeProject is required");
    }

    this.writeProject = writeProject;
    this.onStatus = onStatus;
    this.onWritten = onWritten;
    this.onError = onError;
    this.maxPendingProjects = maxPendingProjects;
    this.maxRetryAttempts = maxRetryAttempts;
    this.retryBaseDelayMs = retryBaseDelayMs;
    // pending: projectDir -> { tasks, options }
    this.pending = new Map();
    this.processing = false;
    this.activeProjectDir = null;
    this.activeOptions = null;
    this.flushResolvers = [];
  }

  enqueue(projectDir, tasks, options = {}) {
    if (!projectDir) {
      throw new Error("projectDir is required");
    }

    const isKnownProject = projectDir === this.activeProjectDir || this.pending.has(projectDir);
    if (!isKnownProject && this.pending.size >= this.maxPendingProjects) {
      throw new Error("Workspace save queue is full");
    }

    const normalizedOptions = {
      forceLocal: Boolean(options?.forceLocal),
    };
    this.pending.set(projectDir, { tasks, options: normalizedOptions });
    this.emitStatus(projectDir, "queued");
    this.drain();
    return { success: true, queued: true };
  }

  hasPending(projectDir) {
    if (projectDir) {
      return this.activeProjectDir === projectDir || this.pending.has(projectDir);
    }
    return this.activeProjectDir !== null || this.pending.size > 0 || this.processing;
  }

  isWriting(projectDir) {
    return this.activeProjectDir === projectDir;
  }

  /**
   * Return the options of the active job for projectDir, or — if no active
   * job — the options of the queued snapshot. Returns null if neither exists.
   * Used by WorkspaceReconciler to decide whether to fire conflict or just
   * a notice (forceLocal mode).
   */
  getActiveOptions(projectDir) {
    if (projectDir && this.activeProjectDir === projectDir) {
      return this.activeOptions;
    }
    if (projectDir && this.pending.has(projectDir)) {
      return this.pending.get(projectDir).options;
    }
    return null;
  }

  discard(projectDir) {
    return this.pending.delete(projectDir);
  }

  pendingSize(projectDir) {
    if (projectDir) {
      return this.pending.has(projectDir) ? 1 : 0;
    }
    return this.pending.size;
  }

  async flush() {
    if (!this.hasPending()) {
      return;
    }

    return new Promise((resolve) => {
      this.flushResolvers.push(resolve);
      this.drain();
    });
  }

  drain() {
    if (this.processing) {
      return;
    }
    this.processing = true;
    void this.processLoop();
  }

  async processLoop() {
    while (this.pending.size > 0) {
      const [projectDir, entry] = this.pending.entries().next().value;
      this.pending.delete(projectDir);
      const { tasks, options } = entry;
      this.activeProjectDir = projectDir;
      this.activeOptions = options;
      this.emitStatus(projectDir, "writing");

      let attempt = 0;
      let succeeded = false;
      let lastError = null;

      // Retry loop: only retries when the job is marked forceLocal AND the
      // queue hasn't received a fresher snapshot for the same project (in
      // which case the newer snapshot takes precedence).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const result = await this.writeProject(projectDir, tasks);
          this.onWritten({ projectDir, tasks, result });
          this.emitStatus(projectDir, "saved");
          succeeded = true;
          break;
        } catch (err) {
          lastError = err;
          attempt += 1;
          const canRetry =
            options.forceLocal && attempt < this.maxRetryAttempts && !this.pending.has(projectDir);
          if (!canRetry) {
            this.emitStatus(projectDir, "error", err.message);
            this.onError({ projectDir, error: err, attempts: attempt });
            break;
          }
          this.emitStatus(projectDir, "retrying", err.message);
          const delay = this.retryBaseDelayMs * 2 ** (attempt - 1);
          await sleep(delay);
        }
      }

      this.activeProjectDir = null;
      this.activeOptions = null;
      if (!succeeded && lastError) {
        // already emitted error; loop continues with next pending project
      }
    }

    this.processing = false;
    this.resolveFlushes();

    if (this.pending.size > 0) {
      this.drain();
    }
  }

  emitStatus(projectDir, status, message) {
    this.onStatus({ projectDir, status, message });
  }

  resolveFlushes() {
    const resolvers = this.flushResolvers;
    this.flushResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }
}

module.exports = {
  WorkspaceWriteQueue,
};
