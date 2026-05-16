class WorkspaceWriteQueue {
  constructor({
    writeProject,
    onStatus = () => {},
    onWritten = () => {},
    onError = () => {},
    maxPendingProjects = 8,
  }) {
    if (typeof writeProject !== "function") {
      throw new Error("writeProject is required");
    }

    this.writeProject = writeProject;
    this.onStatus = onStatus;
    this.onWritten = onWritten;
    this.onError = onError;
    this.maxPendingProjects = maxPendingProjects;
    this.pending = new Map();
    this.processing = false;
    this.activeProjectDir = null;
    this.flushResolvers = [];
  }

  enqueue(projectDir, tasks) {
    if (!projectDir) {
      throw new Error("projectDir is required");
    }

    const isKnownProject = projectDir === this.activeProjectDir || this.pending.has(projectDir);
    if (!isKnownProject && this.pending.size >= this.maxPendingProjects) {
      throw new Error("Workspace save queue is full");
    }

    this.pending.set(projectDir, tasks);
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
      const [projectDir, tasks] = this.pending.entries().next().value;
      this.pending.delete(projectDir);
      this.activeProjectDir = projectDir;
      this.emitStatus(projectDir, "writing");

      try {
        const result = await this.writeProject(projectDir, tasks);
        this.onWritten({ projectDir, tasks, result });
        this.emitStatus(projectDir, "saved");
      } catch (err) {
        this.emitStatus(projectDir, "error", err.message);
        this.onError({ projectDir, error: err });
      } finally {
        this.activeProjectDir = null;
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
