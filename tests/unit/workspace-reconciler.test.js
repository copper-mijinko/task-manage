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

  test("suppresses conflict and emits overwritten-external notice when forceLocal active", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");
    const conflicts = [];
    const notices = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read while pending");
      },
      hasPendingWrite: () => true,
      getActiveOptions: () => ({ forceLocal: true }),
      onConflict: (event) => conflicts.push(event),
      onNotice: (event) => notices.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    modifyProjectFile(projectFile, "External");

    await reconciler.handleFileEvent("change", projectFile);
    await vi.runAllTimersAsync();

    expect(conflicts).toEqual([]);
    expect(notices.map((event) => event.kind)).toContain("overwritten-external");
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

  test("skips reconcile when our write recorded the new hash before reconcile fires", async () => {
    // Race scenario: chokidar fires a "change" event during our own batched
    // write. With per-file recordWrite plumbed through atomicWriteFile, the
    // hash for the changed file is already in knownFileHashes by the time
    // handleFileEvent runs, so no reconcile should even be scheduled.
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

    // Simulate the writer chain: write the file and synchronously inform the
    // reconciler of the new hash (this is what atomicWriteFile's onWritten
    // hook does in production).
    const updated = stringifyFrontmatter({ id: "root-id", name: "Updated" });
    fs.writeFileSync(projectFile, updated);
    reconciler.recordWrite(projectFile, updated);

    await reconciler.handleFileEvent("change", projectFile);
    await reconciler.markProjectWritten(projectDir);
    await vi.runAllTimersAsync();

    expect(updates).toEqual([]);
    expect(conflicts).toEqual([]);
    await reconciler.stop();
  });

  test("skips reconcile when the changed file matches known by the time the debounced reconcile fires", async () => {
    // Race scenario covered by the targeted re-check: at event time the file
    // diverged from known (so a reconcile is scheduled), but before the
    // debounced timer fires our own write records the new hash, so the changed
    // path now matches known. The reconcile must bail out without reading the
    // project (and without re-hashing the whole tree).
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");
    const updates = [];
    const conflicts = [];
    const notices = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read when the changed path matches known");
      },
      hasPendingWrite: () => true,
      onProjectUpdated: (event) => updates.push(event),
      onConflict: (event) => conflicts.push(event),
      onNotice: (event) => notices.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    // Diverge on disk so handleFileEvent schedules a reconcile (known still
    // holds the original baseline at this point).
    const updated = stringifyFrontmatter({ id: "root-id", name: "Updated" });
    fs.writeFileSync(projectFile, updated);
    await reconciler.handleFileEvent("change", projectFile);

    // Before the debounced reconcile fires, our own write records the new hash.
    reconciler.recordWrite(projectFile, updated);
    await vi.runAllTimersAsync();

    expect(updates).toEqual([]);
    expect(conflicts).toEqual([]);
    expect(notices.map((event) => event.kind)).not.toContain("error");
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

  test("recordWrite synchronously updates knownFileHashes for one file", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");

    const updates = [];
    const conflicts = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read when recordWrite kept hashes fresh");
      },
      // Even when the queue is mid-write, recordWrite-updated hashes must
      // make handleFileEvent treat our own write as a no-op.
      hasPendingWrite: () => true,
      onProjectUpdated: (event) => updates.push(event),
      onConflict: (event) => conflicts.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    // Simulate the writer chain: modify the file on disk and tell the
    // reconciler about the new content synchronously, before chokidar fires.
    const newContent = stringifyFrontmatter({ id: "root-id", name: "Renamed" });
    fs.writeFileSync(projectFile, newContent);
    reconciler.recordWrite(projectFile, newContent);

    await reconciler.handleFileEvent("change", projectFile);
    await vi.runAllTimersAsync();

    expect(updates).toEqual([]);
    expect(conflicts).toEqual([]);
    await reconciler.stop();
  });

  test("recordWrite still allows external divergence to be detected", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");

    const conflicts = [];
    const reconciler = new WorkspaceReconciler({
      readProject: () => {
        throw new Error("should not read");
      },
      hasPendingWrite: () => true,
      onConflict: (event) => conflicts.push(event),
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    // We claim to have written content A, but actual disk content diverges
    // (e.g. an external editor stomped on it after our recordWrite).
    reconciler.recordWrite(projectFile, "expected content from our memory");
    modifyProjectFile(projectFile, "Stomped externally");

    await reconciler.handleFileEvent("change", projectFile);
    await vi.runAllTimersAsync();

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].projectDir).toBe(projectDir);
    await reconciler.stop();
  });

  test("markProjectWritten preserves hashes recorded mid-batch and prunes deletions", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const projectFile = path.join(projectDir, "_project.md");
    const strayFile = path.join(projectDir, "stray.md");
    fs.writeFileSync(strayFile, "stray content");

    const reconciler = new WorkspaceReconciler({
      readProject,
      stateRootDir: stateDir,
      watchFactory: () => makeWatcher(),
    });
    await reconciler.start(tmpDir);

    expect(reconciler.knownFileHashes.has(path.resolve(strayFile))).toBe(true);

    // Simulate a project write: per-file recordWrite for the surviving file,
    // followed by the stray file disappearing, then markProjectWritten.
    const updated = stringifyFrontmatter({ id: "root-id", name: "Renamed" });
    fs.writeFileSync(projectFile, updated);
    reconciler.recordWrite(projectFile, updated);

    fs.unlinkSync(strayFile);
    await reconciler.markProjectWritten(projectDir);

    expect(reconciler.knownFileHashes.has(path.resolve(strayFile))).toBe(false);
    // The hash from recordWrite must still be the one we recorded, not the
    // pre-existing baseline.
    const crypto = await import("crypto");
    const expectedHash = crypto.createHash("sha256").update(Buffer.from(updated)).digest("hex");
    expect(reconciler.knownFileHashes.get(path.resolve(projectFile))).toBe(expectedHash);
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
