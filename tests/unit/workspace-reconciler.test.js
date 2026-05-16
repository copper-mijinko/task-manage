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
    const { data } = parseFrontmatter(fs.readFileSync(projectFile, "utf8"));
    fs.writeFileSync(projectFile, stringifyFrontmatter({ ...data, name: "Updated" }));
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

    await reconciler.handleFileEvent("change", path.join(projectDir, "_project.md"));
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
});
