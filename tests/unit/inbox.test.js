import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

import {
  ensureInbox,
  readInbox,
  addInboxItem,
  sendInboxItemsToProject,
  getInboxDir,
} from "../../electron/inbox.js";
import {
  createProject,
  parseFrontmatter,
  readProject,
  writeTask,
} from "../../electron/workspace.js";

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inbox-test-"));
}

describe("ensureInbox", () => {
  let workspace;

  beforeEach(() => {
    workspace = mktemp();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("creates the _inbox directory and marker on first call", async () => {
    const { projectDir, rootId } = await ensureInbox(workspace);
    expect(projectDir).toBe(path.join(workspace, "_inbox"));
    expect(typeof rootId).toBe("string");
    expect(rootId.length).toBeGreaterThan(0);

    const marker = fs.readFileSync(path.join(projectDir, "_project.md"), "utf8");
    const { data } = parseFrontmatter(marker);
    expect(data.id).toBe(rootId);
    expect(data.kind).toBe("inbox");
    expect(data.name).toBe("Inbox");
  });

  it("returns the same rootId on subsequent calls", async () => {
    const first = await ensureInbox(workspace);
    const second = await ensureInbox(workspace);
    expect(second.rootId).toBe(first.rootId);
  });

  it("does not appear in the regular project list (starts with _)", async () => {
    await ensureInbox(workspace);
    // workspace.listProjects skips dirs starting with _, so Inbox is hidden.
    const { listProjects } = await import("../../electron/workspace.js");
    expect(listProjects(workspace)).toEqual([]);
  });
});

describe("addInboxItem", () => {
  let workspace;

  beforeEach(() => {
    workspace = mktemp();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("appends an item with parents = [rootId]", async () => {
    const { task, rootId } = await addInboxItem(workspace, { name: "first" });
    expect(task.name).toBe("first");
    expect(task.parents).toEqual([rootId]);
    expect(task.order).toBe(0);
    expect(task.status).toBe("Open");
  });

  it("assigns increasing order for sequential adds", async () => {
    const a = await addInboxItem(workspace, { name: "a" });
    const b = await addInboxItem(workspace, { name: "b" });
    const c = await addInboxItem(workspace, { name: "c" });
    expect(a.task.order).toBe(0);
    expect(b.task.order).toBe(1);
    expect(c.task.order).toBe(2);
  });

  it("persists items so readInbox sees them", async () => {
    await addInboxItem(workspace, { name: "alpha" });
    await addInboxItem(workspace, { name: "beta" });
    const state = await readInbox(workspace);
    const items = [...state.tasks.values()].filter((t) => t.id !== state.rootId);
    expect(items.map((t) => t.name).sort()).toEqual(["alpha", "beta"]);
  });
});

describe("sendInboxItemsToProject", () => {
  let workspace;
  let projectDir;
  let projectRootId;

  beforeEach(async () => {
    workspace = mktemp();
    // Create a target workspace project.
    projectRootId = "target-root-id";
    const created = createProject(workspace, "TargetProject", projectRootId);
    projectDir = created.projectDir;
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("moves an item directory from _inbox into the target project", async () => {
    const { task } = await addInboxItem(workspace, { name: "to-move" });
    const inboxBefore = path.join(getInboxDir(workspace), task.id);
    expect(fs.existsSync(inboxBefore)).toBe(true);

    const result = await sendInboxItemsToProject(workspace, projectDir, [task.id], projectRootId);
    expect(result.moved).toContain(task.id);
    expect(result.errors).toEqual([]);

    // No longer in inbox
    expect(fs.existsSync(inboxBefore)).toBe(false);
    // Now under the target project
    const movedPath = path.join(projectDir, task.id);
    expect(fs.existsSync(movedPath)).toBe(true);

    // _index.md frontmatter has the new parent
    const indexContent = fs.readFileSync(path.join(movedPath, "_index.md"), "utf8");
    const { data } = parseFrontmatter(indexContent);
    expect(data.parents).toEqual([projectRootId]);
  });

  it("preserves the moved task as a top-level child of the project root", async () => {
    const { task } = await addInboxItem(workspace, { name: "child" });
    await sendInboxItemsToProject(workspace, projectDir, [task.id], projectRootId);

    const { tasks } = readProject(projectDir);
    const movedTask = tasks.get(task.id);
    expect(movedTask).toBeTruthy();
    expect(movedTask.parents).toEqual([projectRootId]);
    expect(movedTask.name).toBe("child");
  });

  it("rejects sending the inbox root task itself", async () => {
    const { rootId } = await ensureInbox(workspace);
    const result = await sendInboxItemsToProject(workspace, projectDir, [rootId], projectRootId);
    expect(result.moved).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].taskId).toBe(rootId);
  });

  it("moves memo files and assets together with the item", async () => {
    const { projectDir: inboxDir } = await ensureInbox(workspace);
    const { task } = await addInboxItem(workspace, { name: "with-asset" });

    // Simulate an inbox memo + asset by writing files directly.
    const taskDir = path.join(inboxDir, task.id);
    fs.mkdirSync(path.join(taskDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(taskDir, "assets", "img.png"), Buffer.from([1, 2, 3]));
    fs.writeFileSync(
      path.join(taskDir, "memo-1.md"),
      "---\nid: memo-1\ntitle: m\nformat: markdown\n---\n\n![](./assets/img.png)\n"
    );

    const result = await sendInboxItemsToProject(workspace, projectDir, [task.id], projectRootId);
    expect(result.moved).toContain(task.id);

    const movedPath = path.join(projectDir, task.id);
    expect(fs.existsSync(path.join(movedPath, "assets", "img.png"))).toBe(true);
    expect(fs.existsSync(path.join(movedPath, "memo-1.md"))).toBe(true);
  });

  it("nests the moved task under targetParentId when supplied", async () => {
    // Add an intermediate task to the target project as a candidate parent.
    const targetState = readProject(projectDir);
    const parentTaskId = "candidate-parent-id";
    const today = new Date().toISOString().slice(0, 10);
    writeTask(
      projectDir,
      {
        id: parentTaskId,
        name: "candidate-parent",
        status: "Open",
        parents: [projectRootId],
        memos: [],
        createdAt: today,
        order: 0,
      },
      targetState.taskDirs
    );

    const { task } = await addInboxItem(workspace, { name: "nested-target" });
    const result = await sendInboxItemsToProject(workspace, projectDir, [task.id], projectRootId, {
      targetParentId: parentTaskId,
    });
    expect(result.moved).toContain(task.id);
    expect(result.errors).toEqual([]);

    const { tasks } = readProject(projectDir);
    const movedTask = tasks.get(task.id);
    expect(movedTask).toBeTruthy();
    expect(movedTask.parents).toEqual([parentTaskId]);
  });

  it("rejects sending when targetParentId is not in the project", async () => {
    const { task } = await addInboxItem(workspace, { name: "lonely" });
    await expect(
      sendInboxItemsToProject(workspace, projectDir, [task.id], projectRootId, {
        targetParentId: "ghost-id",
      })
    ).rejects.toThrow(/parent/i);

    // The inbox item must not be lost when the precondition check fails.
    const inboxBefore = path.join(getInboxDir(workspace), task.id);
    expect(fs.existsSync(inboxBefore)).toBe(true);
  });

  it("orders multiple nested items contiguously at the end of the parent's children", async () => {
    // Seed two existing siblings under a target parent.
    const targetState = readProject(projectDir);
    const parentId = "parent-with-kids";
    const today = new Date().toISOString().slice(0, 10);
    writeTask(
      projectDir,
      {
        id: parentId,
        name: "parent-with-kids",
        status: "Open",
        parents: [projectRootId],
        memos: [],
        createdAt: today,
        order: 0,
      },
      targetState.taskDirs
    );
    writeTask(
      projectDir,
      {
        id: "existing-1",
        name: "existing-1",
        status: "Open",
        parents: [parentId],
        memos: [],
        createdAt: today,
        order: 0,
      },
      targetState.taskDirs
    );
    writeTask(
      projectDir,
      {
        id: "existing-2",
        name: "existing-2",
        status: "Open",
        parents: [parentId],
        memos: [],
        createdAt: today,
        order: 1,
      },
      targetState.taskDirs
    );

    const a = await addInboxItem(workspace, { name: "new-a" });
    const b = await addInboxItem(workspace, { name: "new-b" });
    const result = await sendInboxItemsToProject(
      workspace,
      projectDir,
      [a.task.id, b.task.id],
      projectRootId,
      { targetParentId: parentId }
    );
    expect(result.moved).toEqual([a.task.id, b.task.id]);

    const { tasks } = readProject(projectDir);
    const movedA = tasks.get(a.task.id);
    const movedB = tasks.get(b.task.id);
    expect(movedA.parents).toEqual([parentId]);
    expect(movedB.parents).toEqual([parentId]);
    expect(movedA.order).toBe(2);
    expect(movedB.order).toBe(3);
  });
});
