import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createProject,
  parseFrontmatter,
  readProject,
  stringifyFrontmatter,
} from "../../electron/workspace.js";
import { WorkspaceReconciler } from "../../electron/workspace-reconciler.js";

function makeWatcher() {
  return {
    on() {
      return this;
    },
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function modifyProjectFile(projectFile, newName) {
  const { data } = parseFrontmatter(fs.readFileSync(projectFile, "utf8"));
  fs.writeFileSync(projectFile, stringifyFrontmatter({ ...data, name: newName }));
}

describe("WorkspaceReconciler", () => {
  let tmpDir;
  let stateDir;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-reconcile-"));
    stateDir = path.join(tmpDir, "state");
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("suppresses watcher events caused by its own recent writes", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const updates = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read");
      },
      onProjectUpdated: (event) => updates.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);
    await reconciler.markProjectWritten(projectDir);

    await reconciler.handleFileEvent("change", path.join(projectDir, "_project.md"));
    await vi.runAllTimersAsync();

    expect(updates).toEqual([]);
    await reconciler.stop();
  });

  test("pushes an external update when no local write is pending", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");
    const updates = [];
    const notices = [];
    const reconciler = new WorkspaceReconciler({
      readProject,
      onProjectUpdated: (event) => updates.push(event),
      onNotice: (event) => notices.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    // External modification after the reconciler has captured the baseline.
    modifyProjectFile(projectFile, "Updated");

    await reconciler.handleFileEvent("change", projectFile);
    await vi.runAllTimersAsync();

    expect(updates).toHaveLength(1);
    expect(updates[0].projectDir).toBe(projectDir);
    expect(updates[0].tasks.get("root-id").name).toBe("Updated");
    expect(notices.map((event) => event.kind)).toContain("workspace-updated");
    await reconciler.stop();
  });

  test("reports a conflict when a local write is pending", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");
    const conflicts = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read while pending");
      },
      hasPendingWrite: () => true,
      onConflict: (event) => conflicts.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    // Real divergence on disk (else the new content-hash check would skip).
    modifyProjectFile(projectFile, "Updated");

    await reconciler.handleFileEvent("change", projectFile);
    await vi.runAllTimersAsync();

    expect(conflicts).toEqual([
      {
        projectDir,
        message: "Workspace changed on disk while local changes are waiting to save.",
      },
    ]);
    await reconciler.stop();
  });

  test("notifies conflicted copy files without trying to merge them", async () => {
    const notices = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read conflicted copies");
      },
      onNotice: (event) => notices.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    await reconciler.handleFileEvent("add", path.join(tmpDir, "Proj conflicted copy.md"));

    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("conflicted-copy");
    await reconciler.stop();
  });

  test("suppresses content-unchanged touches (OneDrive sync touch case)", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");
    const updates = [];
    const conflicts = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read for no-op touches");
      },
      // Even if we happen to have a pending write, content-unchanged touches
      // must NOT be reported as conflicts.
      hasPendingWrite: () => true,
      onProjectUpdated: (event) => updates.push(event),
      onConflict: (event) => conflicts.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    // Simulate OneDrive touching the file without changing content: re-write
    // identical bytes (mtime changes, hash does not).
    const original = fs.readFileSync(projectFile);
    fs.writeFileSync(projectFile, original);

    await reconciler.handleFileEvent("change", projectFile);
    await vi.runAllTimersAsync();

    expect(updates).toEqual([]);
    expect(conflicts).toEqual([]);
    await reconciler.stop();
  });

  test("skips reconcile when disk matches known by the time the timer fires", async () => {
    // Race scenario: chokidar fires a "change" event during our own batched
    // write; by the time the 100ms reconcile timer fires, markProjectWritten
    // has caught up and the disk state equals knownFileHashes. We must not
    // call readProject in that case.
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");
    const updates = [];
    const conflicts = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read when state matches known");
      },
      hasPendingWrite: () => true,
      onProjectUpdated: (event) => updates.push(event),
      onConflict: (event) => conflicts.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    // Stage real divergence — this would normally trigger a reconcile.
    modifyProjectFile(projectFile, "Updated");
    await reconciler.handleFileEvent("change", projectFile);

    // Before the reconcile timer fires, our own write completes and resyncs
    // knownFileHashes to the current disk state.
    await reconciler.markProjectWritten(projectDir);

    await vi.runAllTimersAsync();

    expect(updates).toEqual([]);
    expect(conflicts).toEqual([]);
    await reconciler.stop();
  });

  test("markProjectWritten clears entries for files that no longer exist", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");
    const extraFile = path.join(projectDir, "stray.md");
    fs.writeFileSync(extraFile, "hello");

    const reconciler = new WorkspaceReconciler({
      readProject,
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    expect(reconciler.knownFileHashes.has(path.resolve(extraFile))).toBe(true);

    // Remove the stray file and notify reconciler that we wrote the project.
    fs.unlinkSync(extraFile);
    await reconciler.markProjectWritten(projectDir);

    expect(reconciler.knownFileHashes.has(path.resolve(extraFile))).toBe(false);
    expect(reconciler.knownFileHashes.has(path.resolve(projectFile))).toBe(true);
    await reconciler.stop();
  });

  test("ignores unlink events for files we never tracked", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const updates = [];
    const conflicts = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read for untracked unlinks");
      },
      hasPendingWrite: () => true,
      onProjectUpdated: (event) => updates.push(event),
      onConflict: (event) => conflicts.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    // We never knew about this file (it isn't in knownFileHashes).
    const phantom = path.join(projectDir, "phantom.md");
    await reconciler.handleFileEvent("unlink", phantom);
    await vi.runAllTimersAsync();

    expect(updates).toEqual([]);
    expect(conflicts).toEqual([]);
    await reconciler.stop();
  });
});
