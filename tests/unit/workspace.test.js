import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { pathToFileURL } from "url";
import {
  slugify,
  parseFrontmatter,
  stringifyFrontmatter,
  atomicWriteFile,
  writeFileIfChanged,
  retryFileOperation,
  wouldCreateCycle,
  bfsFromRoot,
  createProject,
  createProjectAsync,
  readProject,
  readTaskMemos,
  writeTask,
  writeTaskAsync,
  writeProjectAsync,
  writeProjectPatchAsync,
  saveMemoImage,
  saveMemoImageAsync,
  saveTaskAttachmentAsync,
  deleteTaskAttachmentAsync,
  resolveTaskAttachmentFilePath,
  resolveMemoAssetPath,
  deleteTaskDir,
  deleteTaskDirAsync,
  deleteProject,
  deleteProjectAsync,
  listProjects,
  setProjectOrderAsync,
  exportProjectData,
  legacyMemoContentToMarkdown,
  migrateProjectData,
} from "../../electron/workspace.js";

// ── slugify ──────────────────────────────────────────────────────────────────

describe("slugify", () => {
  it("converts spaces to hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes forbidden filesystem characters", () => {
    expect(slugify('task: foo/bar*"baz')).toBe("task-foobarbaz");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  -foo-  ")).toBe("foo");
  });

  it("falls back to 'task' for empty string", () => {
    expect(slugify("")).toBe("task");
    expect(slugify("???")).toBe("task");
  });

  it("truncates at 64 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBe(64);
  });
});

// ── parseFrontmatter / stringifyFrontmatter ───────────────────────────────────

describe("parseFrontmatter", () => {
  it("parses simple key-value pairs", () => {
    const md = "---\nid: abc\nname: My Task\nstatus: Open\n---\n";
    const { data, body } = parseFrontmatter(md);
    expect(data.id).toBe("abc");
    expect(data.name).toBe("My Task");
    expect(data.status).toBe("Open");
    expect(body).toBe("");
  });

  it("parses list values", () => {
    const md = "---\nparents:\n  - id-1\n  - id-2\n---\n";
    const { data } = parseFrontmatter(md);
    expect(data.parents).toEqual(["id-1", "id-2"]);
  });

  it("returns body text after frontmatter", () => {
    const md = "---\nid: x\n---\n\nHello body";
    const { body } = parseFrontmatter(md);
    expect(body).toBe("Hello body");
  });

  it("returns empty data when no frontmatter", () => {
    const { data, body } = parseFrontmatter("No frontmatter here");
    expect(data).toEqual({});
    expect(body).toBe("No frontmatter here");
  });
});

describe("stringifyFrontmatter", () => {
  it("round-trips scalar fields", () => {
    const data = { id: "abc", name: "Task", status: "Open" };
    const result = parseFrontmatter(stringifyFrontmatter(data));
    expect(result.data).toMatchObject(data);
  });

  it("round-trips array fields", () => {
    const data = { parents: ["p1", "p2"] };
    const result = parseFrontmatter(stringifyFrontmatter(data));
    expect(result.data.parents).toEqual(["p1", "p2"]);
  });

  it("omits null/undefined values", () => {
    const md = stringifyFrontmatter({ id: "x", due: null, name: undefined });
    expect(md).not.toContain("due:");
    expect(md).not.toContain("name:");
  });

  it("appends body after frontmatter", () => {
    const md = stringifyFrontmatter({ id: "x" }, "body content");
    expect(md).toContain("body content");
    expect(md.indexOf("---\n")).toBeLessThan(md.indexOf("body content"));
  });
});

// ── wouldCreateCycle ──────────────────────────────────────────────────────────

function makeTasks(spec) {
  // spec: { id: { parents: [ids] } }
  const tasks = new Map();
  for (const [id, { parents }] of Object.entries(spec)) {
    tasks.set(id, { id, parents, name: id, status: "Open", memos: [], createdAt: "" });
  }
  return tasks;
}

describe("wouldCreateCycle", () => {
  it("returns false for empty newParents", () => {
    const tasks = makeTasks({ root: { parents: [] }, a: { parents: ["root"] } });
    expect(wouldCreateCycle(tasks, "a", [])).toBe(false);
  });

  it("detects direct self-cycle", () => {
    const tasks = makeTasks({ root: { parents: [] }, a: { parents: ["root"] } });
    expect(wouldCreateCycle(tasks, "a", ["a"])).toBe(true);
  });

  it("detects indirect cycle (parent → child relationship reversed)", () => {
    // root → a → b; asking if we can set root's parent to b (b is descendant of root)
    const tasks = makeTasks({
      root: { parents: [] },
      a: { parents: ["root"] },
      b: { parents: ["a"] },
    });
    expect(wouldCreateCycle(tasks, "root", ["b"])).toBe(true);
  });

  it("returns false for a valid new parent", () => {
    const tasks = makeTasks({
      root: { parents: [] },
      a: { parents: ["root"] },
      b: { parents: ["root"] },
    });
    // Adding b as another parent of a is fine (diamond DAG)
    expect(wouldCreateCycle(tasks, "a", ["b"])).toBe(false);
  });

  it("returns false when tasks map is empty", () => {
    expect(wouldCreateCycle(new Map(), "x", ["y"])).toBe(false);
  });
});

// ── bfsFromRoot ───────────────────────────────────────────────────────────────

describe("bfsFromRoot", () => {
  it("returns only root when no children", () => {
    const tasks = makeTasks({ root: { parents: [] } });
    expect(bfsFromRoot(tasks, "root")).toEqual(["root"]);
  });

  it("returns BFS order for linear chain", () => {
    const tasks = makeTasks({
      root: { parents: [] },
      a: { parents: ["root"] },
      b: { parents: ["a"] },
    });
    expect(bfsFromRoot(tasks, "root")).toEqual(["root", "a", "b"]);
  });

  it("visits each node exactly once in a diamond DAG", () => {
    // root → a, root → b, a → c, b → c
    const tasks = makeTasks({
      root: { parents: [] },
      a: { parents: ["root"] },
      b: { parents: ["root"] },
      c: { parents: ["a", "b"] },
    });
    const order = bfsFromRoot(tasks, "root");
    expect(order.filter((id) => id === "c")).toHaveLength(1);
    expect(order).toContain("root");
    expect(order).toContain("a");
    expect(order).toContain("b");
    expect(order).toContain("c");
  });

  it("does not infinite-loop on a cyclic graph", () => {
    // Simulate corrupt data: a ↔ b cycle
    const tasks = makeTasks({
      root: { parents: [] },
      a: { parents: ["root", "b"] },
      b: { parents: ["a"] },
    });
    const order = bfsFromRoot(tasks, "root");
    // Should terminate and visit each at most once
    const unique = new Set(order);
    expect(unique.size).toBe(order.length);
  });
});

// ── File system integration (createProject / readProject / writeTask / deleteTaskDir) ───

describe("file system operations", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createProject writes _project.md with correct fields", () => {
    const { projectDir } = createProject(tmpDir, "My Project", "proj-id-1");
    const content = fs.readFileSync(path.join(projectDir, "_project.md"), "utf8");
    const { data } = parseFrontmatter(content);
    expect(data.id).toBe("proj-id-1");
    expect(data.name).toBe("My Project");
    expect(data.status).toBe("Open");
  });

  it("listProjects finds created project", () => {
    createProject(tmpDir, "Alpha", "alpha-id");
    createProject(tmpDir, "Beta", "beta-id");
    const projects = listProjects(tmpDir);
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.name)).toEqual(expect.arrayContaining(["Alpha", "Beta"]));
  });

  it("setProjectOrderAsync persists workspace project order in root frontmatter", async () => {
    createProject(tmpDir, "Alpha", "alpha-id");
    createProject(tmpDir, "Beta", "beta-id");
    createProject(tmpDir, "Gamma", "gamma-id");
    const initial = listProjects(tmpDir);

    const result = await setProjectOrderAsync(tmpDir, [
      initial.find((p) => p.rootId === "gamma-id"),
      initial.find((p) => p.rootId === "alpha-id"),
      initial.find((p) => p.rootId === "beta-id"),
    ]);

    expect(result.changedProjectDirs).toHaveLength(3);
    expect(listProjects(tmpDir).map((p) => p.rootId)).toEqual(["gamma-id", "alpha-id", "beta-id"]);

    const gamma = listProjects(tmpDir).find((p) => p.rootId === "gamma-id");
    const gammaProject = fs.readFileSync(path.join(gamma.projectDir, "_project.md"), "utf8");
    expect(parseFrontmatter(gammaProject).data.order).toBe("0");
  });

  it("setProjectOrderAsync keeps unknown or newly discovered projects after the saved order", async () => {
    createProject(tmpDir, "Alpha", "alpha-id");
    createProject(tmpDir, "Beta", "beta-id");
    createProject(tmpDir, "Gamma", "gamma-id");

    await setProjectOrderAsync(tmpDir, [{ rootId: "beta-id" }, { rootId: "missing-id" }]);

    expect(listProjects(tmpDir).map((p) => p.rootId)).toEqual(["beta-id", "alpha-id", "gamma-id"]);
  });

  it("deleteProject removes the project directory recursively", () => {
    const { projectDir } = createProject(tmpDir, "Doomed", "doomed-id");
    // Throw in a few nested files / dirs so we know it really walks the tree.
    fs.mkdirSync(path.join(projectDir, "sub-task"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "sub-task", "task.md"), "# nested");
    fs.writeFileSync(path.join(projectDir, "extra.txt"), "leftover");
    expect(fs.existsSync(projectDir)).toBe(true);

    const result = deleteProject(projectDir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(projectDir)).toBe(false);
  });

  it("deleteProject returns alreadyMissing=true when the directory is gone", () => {
    const missing = path.join(tmpDir, "never-existed");
    const result = deleteProject(missing);
    expect(result.success).toBe(true);
    expect(result.alreadyMissing).toBe(true);
  });

  it("deleteProject throws when projectDir is invalid", () => {
    expect(() => deleteProject("")).toThrow(/Invalid projectDir/);
    expect(() => deleteProject(null)).toThrow(/Invalid projectDir/);
  });

  it("deleteProject throws when target is not a directory", () => {
    const filePath = path.join(tmpDir, "just-a-file.txt");
    fs.writeFileSync(filePath, "hello");
    expect(() => deleteProject(filePath)).toThrow(/not a directory/);
  });

  it("deleteProject leaves other projects in the same workspace alone", () => {
    const { projectDir: keepDir } = createProject(tmpDir, "Keep", "keep-id");
    const { projectDir: dropDir } = createProject(tmpDir, "Drop", "drop-id");

    deleteProject(dropDir);

    expect(fs.existsSync(dropDir)).toBe(false);
    expect(fs.existsSync(keepDir)).toBe(true);
    expect(listProjects(tmpDir).map((p) => p.name)).toEqual(["Keep"]);
  });

  it("readProject returns root task with empty parents", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const { tasks } = readProject(projectDir);
    const root = tasks.get("root-id");
    expect(root).toBeDefined();
    expect(root.parents).toEqual([]);
  });

  it("writeTask + readProject round-trips root memos", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const rootTask = {
      id: "root-id",
      name: "Proj",
      status: "Open",
      parents: [],
      memos: [{ id: "root-memo", title: "Root Notes", content: "# Root Notes\n\nStored here" }],
      createdAt: "2026-04-24",
    };

    writeTask(projectDir, rootTask, taskDirs);

    expect(fs.existsSync(path.join(projectDir, "root-memo.md"))).toBe(true);

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("root-id");
    expect(loaded.memos).toHaveLength(1);
    expect(loaded.memos[0].id).toBe("root-memo");
    expect(loaded.memos[0].title).toBe("Root Notes");
    expect(loaded.memos[0].content).toContain("Stored here");
  });

  it("writeTask + readProject preserves memo order independently of filenames", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-memo-order",
      name: "Memo Order",
      status: "Open",
      parents: ["root-id"],
      memos: [
        { id: "z-memo", title: "First", content: "First content" },
        { id: "a-memo", title: "Second", content: "Second content" },
      ],
      createdAt: "2026-04-24",
    };

    writeTask(projectDir, task, taskDirs);

    const firstFile = fs.readFileSync(
      path.join(projectDir, "task-memo-order", "z-memo.md"),
      "utf8"
    );
    const secondFile = fs.readFileSync(
      path.join(projectDir, "task-memo-order", "a-memo.md"),
      "utf8"
    );
    expect(firstFile).toContain("order: 0");
    expect(secondFile).toContain("order: 1");

    const { tasks } = readProject(projectDir);
    expect(tasks.get("task-memo-order").memos.map((memo) => memo.id)).toEqual(["z-memo", "a-memo"]);
  });

  it("writeTask + readProject round-trips a regular task", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-1",
      name: "First Task",
      status: "In Progress",
      startDate: "2026-05-20",
      dueDate: "2026-06-01",
      parents: ["root-id"],
      memos: [{ id: "memo-uuid-1", title: "Notes", content: "# Notes\n\nSome content" }],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    // Task directory should be named after task.id (UUID)
    expect(fs.existsSync(path.join(projectDir, "task-1"))).toBe(true);
    // Memo file should be named after memo.id
    expect(fs.existsSync(path.join(projectDir, "task-1", "memo-uuid-1.md"))).toBe(true);

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-1");
    expect(loaded).toBeDefined();
    expect(loaded.name).toBe("First Task");
    expect(loaded.status).toBe("In Progress");
    expect(loaded.startDate).toBe("2026-05-20");
    expect(loaded.dueDate).toBe("2026-06-01");
    expect(loaded.parents).toEqual(["root-id"]);
    expect(loaded.memos).toHaveLength(1);
    expect(loaded.memos[0].id).toBe("memo-uuid-1");
    expect(loaded.memos[0].title).toBe("Notes");
  });

  it("readProject can defer memo bodies and read them for one task later", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-lazy-memo",
      name: "Lazy Memo Task",
      status: "Open",
      parents: ["root-id"],
      memos: [
        {
          id: "memo-lazy",
          title: "Lazy Notes",
          content: "# Lazy Notes\n\nLoaded later",
          tags: ["lazy"],
        },
      ],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const summary = readProject(projectDir, { includeMemoContent: false });
    const summaryMemo = summary.tasks.get("task-lazy-memo").memos[0];
    expect(summaryMemo.title).toBe("Lazy Notes");
    expect(summaryMemo.tags).toEqual(["lazy"]);
    expect(summaryMemo.content).toBe("");
    expect(summaryMemo.bodyLoaded).toBe(false);

    const loadedMemos = readTaskMemos(projectDir, "task-lazy-memo", summary.taskDirs);
    expect(loadedMemos[0].content).toContain("Loaded later");
    expect(loadedMemos[0].bodyLoaded).toBe(true);
  });

  it("writeTask + readProject round-trips order field", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-order",
      name: "Ordered Task",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
      order: 2,
    };
    writeTask(projectDir, task, taskDirs);

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-order");
    expect(loaded).toBeDefined();
    expect(loaded.order).toBe(2);
  });

  it("writeTask + readProject: task without order reads as undefined", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-no-order",
      name: "No Order Task",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-no-order");
    expect(loaded).toBeDefined();
    expect(loaded.order).toBeUndefined();
  });

  it("writeTask + readProject round-trips memo tags", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-tags",
      name: "Tagged Task",
      status: "Open",
      parents: ["root-id"],
      memos: [
        {
          id: "memo-tagged",
          title: "Notes",
          content: "Some content",
          tags: ["design", "frontend"],
        },
      ],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const memoFile = fs.readFileSync(path.join(projectDir, "task-tags", "memo-tagged.md"), "utf8");
    expect(memoFile).toContain("tags:");
    expect(memoFile).toContain("- design");
    expect(memoFile).toContain("- frontend");

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-tags");
    expect(loaded.memos[0].tags).toEqual(["design", "frontend"]);
  });

  it("writeTask + readProject round-trips a Quill memo in markdown file JSON", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const delta = { ops: [{ insert: "Rich memo\n", attributes: { bold: true } }] };
    const task = {
      id: "task-quill",
      name: "Quill Task",
      status: "Open",
      parents: ["root-id"],
      memos: [
        {
          id: "memo-quill",
          title: "Quill",
          content: delta,
          tags: ["rich"],
          format: "quill",
        },
      ],
      createdAt: "2026-04-24",
    };

    writeTask(projectDir, task, taskDirs);

    const memoFile = fs.readFileSync(path.join(projectDir, "task-quill", "memo-quill.md"), "utf8");
    expect(memoFile).toContain("format: quill");
    expect(memoFile).toContain("```json");
    expect(memoFile).toContain('"ops"');

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-quill");
    expect(loaded.memos[0].format).toBe("quill");
    expect(loaded.memos[0].content).toEqual(delta);
  });

  it("memo tags default to empty array when absent from frontmatter", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-no-tags",
      name: "Untagged Task",
      status: "Open",
      parents: ["root-id"],
      memos: [{ id: "memo-no-tags", title: "Notes", content: "Content" }],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-no-tags");
    expect(loaded.memos[0].tags).toEqual([]);
  });

  it("preserves memo tab titles for empty workspace memos", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-empty-memo",
      name: "Task With Empty Memo",
      status: "Open",
      parents: ["root-id"],
      memos: [{ id: "memo-uuid-empty", title: "Scratch", content: "" }],
      createdAt: "2026-04-24",
    };

    writeTask(projectDir, task, taskDirs);

    const memoFile = fs.readFileSync(
      path.join(projectDir, "task-empty-memo", "memo-uuid-empty.md"),
      "utf8"
    );
    expect(memoFile).toContain("title: Scratch");

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-empty-memo");
    expect(loaded.memos[0].id).toBe("memo-uuid-empty");
    expect(loaded.memos[0].title).toBe("Scratch");
  });

  it("does not expose ids as tab titles for old empty workspace memos", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-old-empty-memo",
      name: "Task With Old Empty Memo",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const taskDir = path.join(projectDir, "task-old-empty-memo");
    fs.writeFileSync(path.join(taskDir, "memo-uuid-old.md"), "---\nid: memo-uuid-old\n---\n");

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-old-empty-memo");
    expect(loaded.memos[0].id).toBe("memo-uuid-old");
    expect(loaded.memos[0].title).toBe("memo");
  });

  it("readMemos assigns a generated id to legacy memo files without frontmatter", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-legacy",
      name: "Legacy",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    // Write an old-format memo file directly (no frontmatter)
    const taskDir = path.join(projectDir, "task-legacy");
    fs.writeFileSync(path.join(taskDir, "old-memo.md"), "# Old Memo\n\nLegacy content");

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-legacy");
    expect(loaded.memos).toHaveLength(1);
    expect(loaded.memos[0].title).toBe("Old Memo");
    expect(typeof loaded.memos[0].id).toBe("string");
    expect(loaded.memos[0].id.length).toBeGreaterThan(0);
  });

  it("deleteTaskDir removes the task directory", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-del",
      name: "To Delete",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const dirName = taskDirs.get("task-del");
    expect(fs.existsSync(path.join(projectDir, dirName))).toBe(true);

    deleteTaskDir(projectDir, taskDirs, "task-del");
    expect(fs.existsSync(path.join(projectDir, dirName))).toBe(false);
    expect(taskDirs.has("task-del")).toBe(false);
  });

  it("saveMemoImage writes pasted images into task assets and returns a relative path", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-assets",
      name: "Assets",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const result = saveMemoImage(
      projectDir,
      taskDirs,
      "task-assets",
      Uint8Array.from([137, 80, 78, 71]),
      "image/png"
    );

    expect(result.relativePath).toMatch(/^\.\/assets\/pasted-.+\.png$/);
    expect(fs.existsSync(result.assetPath)).toBe(true);
    expect(path.dirname(result.assetPath)).toBe(path.join(projectDir, "task-assets", "assets"));
  });

  it("resolveMemoAssetPath returns a file URL for existing task assets", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-preview",
      name: "Preview",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const assetDir = path.join(projectDir, "task-preview", "assets");
    fs.mkdirSync(assetDir, { recursive: true });
    const assetPath = path.join(assetDir, "diagram.png");
    fs.writeFileSync(assetPath, "png-data");

    const fileUrl = resolveMemoAssetPath(
      projectDir,
      taskDirs,
      "task-preview",
      "./assets/diagram.png"
    );

    expect(fileUrl).toBe(pathToFileURL(assetPath).toString());
  });

  it("saveTaskAttachmentAsync copies files into task attachments and readProject lists them", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-attachments",
      name: "Attachments",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const first = await saveTaskAttachmentAsync(
      projectDir,
      taskDirs,
      "task-attachments",
      "Spec?.pdf",
      Uint8Array.from([1, 2, 3])
    );
    const second = await saveTaskAttachmentAsync(
      projectDir,
      taskDirs,
      "task-attachments",
      "Spec?.pdf",
      Uint8Array.from([4, 5])
    );

    expect(first).toMatchObject({
      name: "Spec.pdf",
      relativePath: "./attachments/Spec.pdf",
      size: 3,
    });
    expect(second.relativePath).toBe("./attachments/Spec-2.pdf");
    expect(
      fs.existsSync(path.join(projectDir, "task-attachments", "attachments", "Spec.pdf"))
    ).toBe(true);

    const { tasks } = readProject(projectDir);
    expect(tasks.get("task-attachments").attachments.map((entry) => entry.relativePath)).toEqual(
      expect.arrayContaining(["./attachments/Spec.pdf", "./attachments/Spec-2.pdf"])
    );
  });

  it("deleteTaskAttachmentAsync removes a task attachment and blocks path traversal", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-delete-attachment",
      name: "Attachments",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const attachment = await saveTaskAttachmentAsync(
      projectDir,
      taskDirs,
      "task-delete-attachment",
      "note.txt",
      Uint8Array.from([1])
    );
    const attachmentPath = path.join(
      projectDir,
      "task-delete-attachment",
      "attachments",
      "note.txt"
    );

    expect(
      resolveTaskAttachmentFilePath(
        projectDir,
        taskDirs,
        "task-delete-attachment",
        "../_project.md"
      )
    ).toBeNull();
    expect(
      resolveTaskAttachmentFilePath(
        projectDir,
        taskDirs,
        "task-delete-attachment",
        "./attachments/../_index.md"
      )
    ).toBeNull();

    const attachments = await deleteTaskAttachmentAsync(
      projectDir,
      taskDirs,
      "task-delete-attachment",
      attachment.relativePath
    );

    expect(attachments).toEqual([]);
    expect(fs.existsSync(attachmentPath)).toBe(false);
  });

  it("atomicWriteFile replaces files without leaving temp files", async () => {
    const target = path.join(tmpDir, "note.md");

    await atomicWriteFile(target, "hello", "utf8");
    await atomicWriteFile(target, "updated", "utf8");

    expect(fs.readFileSync(target, "utf8")).toBe("updated");
    expect(fs.readdirSync(tmpDir).filter((entry) => entry.includes(".tmp"))).toEqual([]);
  });

  it("writeFileIfChanged skips unchanged content", async () => {
    const target = path.join(tmpDir, "stable.md");
    await writeFileIfChanged(target, "same", "utf8");
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(target, oldTime, oldTime);

    const changed = await writeFileIfChanged(target, "same", "utf8");

    expect(changed).toBe(false);
    expect(fs.statSync(target).mtimeMs).toBe(oldTime.getTime());
  });

  it("retryFileOperation retries temporary OneDrive-style filesystem errors", async () => {
    let attempts = 0;

    const result = await retryFileOperation(
      () => {
        attempts += 1;
        if (attempts < 2) {
          const err = new Error("locked");
          err.code = "EPERM";
          throw err;
        }
        return "ok";
      },
      { attempts: 3, baseDelay: 1 }
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("createProjectAsync writes the root file through the async save path", async () => {
    const { projectDir } = await createProjectAsync(tmpDir, "Async Project", "async-root");
    const { tasks } = readProject(projectDir);

    expect(tasks.get("async-root").name).toBe("Async Project");
    expect(fs.readdirSync(projectDir).filter((entry) => entry.includes(".tmp"))).toEqual([]);
  });

  it("writeTaskAsync + readProject round-trips a regular task", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-async",
      name: "Async Task",
      status: "Open",
      parents: ["root-id"],
      memos: [{ id: "memo-async", title: "Notes", content: "Async content" }],
      createdAt: "2026-04-24",
    };

    await writeTaskAsync(projectDir, task, taskDirs);

    const { tasks } = readProject(projectDir);
    expect(tasks.get("task-async").memos[0].content).toBe("Async content");
    expect(
      fs.readdirSync(path.join(projectDir, "task-async")).some((e) => e.includes(".tmp"))
    ).toBe(false);
  });

  it("saveMemoImageAsync writes pasted images atomically", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-async-assets",
      name: "Assets",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const result = await saveMemoImageAsync(
      projectDir,
      taskDirs,
      "task-async-assets",
      Uint8Array.from([137, 80, 78, 71]),
      "image/png"
    );

    expect(result.relativePath).toMatch(/^\.\/assets\/pasted-.+\.png$/);
    expect(fs.existsSync(result.assetPath)).toBe(true);
  });

  it("deleteTaskDirAsync and deleteProjectAsync remove directories", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-del-async",
      name: "Delete",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    await deleteTaskDirAsync(projectDir, taskDirs, "task-del-async");
    expect(taskDirs.has("task-del-async")).toBe(false);
    expect(fs.existsSync(path.join(projectDir, "task-del-async"))).toBe(false);

    const result = await deleteProjectAsync(projectDir);
    expect(result.success).toBe(true);
    expect(fs.existsSync(projectDir)).toBe(false);
  });

  it("writeProjectAsync skips unchanged task and memo files", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const rootTask = {
      id: "root-id",
      name: "Proj",
      status: "Open",
      parents: [],
      memos: [],
      createdAt: "2026-04-24",
    };
    const childTask = {
      id: "task-stable",
      name: "Stable",
      status: "Open",
      parents: ["root-id"],
      memos: [{ id: "memo-stable", title: "Notes", content: "Stable content" }],
      createdAt: "2026-04-24",
    };
    await writeProjectAsync(projectDir, [rootTask, childTask]);

    const taskFile = path.join(projectDir, "task-stable", "_index.md");
    const memoFile = path.join(projectDir, "task-stable", "memo-stable.md");
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(taskFile, oldTime, oldTime);
    fs.utimesSync(memoFile, oldTime, oldTime);

    await writeProjectAsync(projectDir, [rootTask, childTask]);

    expect(fs.statSync(taskFile).mtimeMs).toBe(oldTime.getTime());
    expect(fs.statSync(memoFile).mtimeMs).toBe(oldTime.getTime());
  });

  it("writeProjectAsync touches only changed memo files and deletes removed tasks", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const rootTask = {
      id: "root-id",
      name: "Proj",
      status: "Open",
      parents: [],
      memos: [],
      createdAt: "2026-04-24",
    };
    const childTask = {
      id: "task-change",
      name: "Changing",
      status: "Open",
      parents: ["root-id"],
      memos: [
        { id: "memo-keep", title: "Keep", content: "Keep content" },
        { id: "memo-change", title: "Change", content: "Before" },
      ],
      createdAt: "2026-04-24",
    };
    const removedTask = {
      id: "task-remove",
      name: "Remove",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
    };
    await writeProjectAsync(projectDir, [rootTask, childTask, removedTask]);

    const taskFile = path.join(projectDir, "task-change", "_index.md");
    const keepMemoFile = path.join(projectDir, "task-change", "memo-keep.md");
    const changedMemoFile = path.join(projectDir, "task-change", "memo-change.md");
    const removedTaskDir = path.join(projectDir, "task-remove");
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(taskFile, oldTime, oldTime);
    fs.utimesSync(keepMemoFile, oldTime, oldTime);
    fs.utimesSync(changedMemoFile, oldTime, oldTime);

    await writeProjectAsync(projectDir, [
      rootTask,
      {
        ...childTask,
        memos: [
          { id: "memo-keep", title: "Keep", content: "Keep content" },
          { id: "memo-change", title: "Change", content: "After" },
        ],
      },
    ]);

    expect(fs.statSync(taskFile).mtimeMs).toBe(oldTime.getTime());
    expect(fs.statSync(keepMemoFile).mtimeMs).toBe(oldTime.getTime());
    expect(fs.statSync(changedMemoFile).mtimeMs).not.toBe(oldTime.getTime());
    expect(fs.existsSync(removedTaskDir)).toBe(false);
  });

  it("writeProjectPatchAsync writes only patched tasks and deletes requested tasks", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const rootTask = {
      id: "root-id",
      name: "Proj",
      status: "Open",
      parents: [],
      memos: [],
      createdAt: "2026-04-24",
    };
    const stableTask = {
      id: "task-stable",
      name: "Stable",
      status: "Open",
      parents: ["root-id"],
      memos: [{ id: "memo-stable", title: "Stable", content: "Stable content" }],
      createdAt: "2026-04-24",
      order: 0,
    };
    const changingTask = {
      id: "task-changing",
      name: "Changing",
      status: "Open",
      parents: ["root-id"],
      memos: [{ id: "memo-changing", title: "Changing", content: "Before" }],
      createdAt: "2026-04-24",
      order: 1,
    };
    const removedTask = {
      id: "task-remove",
      name: "Remove",
      status: "Open",
      parents: ["root-id"],
      memos: [],
      createdAt: "2026-04-24",
      order: 2,
    };
    await writeProjectAsync(projectDir, [rootTask, stableTask, changingTask, removedTask]);

    const stableTaskFile = path.join(projectDir, "task-stable", "_index.md");
    const stableMemoFile = path.join(projectDir, "task-stable", "memo-stable.md");
    const changingTaskFile = path.join(projectDir, "task-changing", "_index.md");
    const removedTaskDir = path.join(projectDir, "task-remove");
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(stableTaskFile, oldTime, oldTime);
    fs.utimesSync(stableMemoFile, oldTime, oldTime);
    fs.utimesSync(changingTaskFile, oldTime, oldTime);

    const result = await writeProjectPatchAsync(projectDir, {
      tasks: [{ ...changingTask, name: "Changed" }],
      deletedTaskIds: ["task-remove"],
    });

    expect(fs.statSync(stableTaskFile).mtimeMs).toBe(oldTime.getTime());
    expect(fs.statSync(stableMemoFile).mtimeMs).toBe(oldTime.getTime());
    expect(fs.statSync(changingTaskFile).mtimeMs).not.toBe(oldTime.getTime());
    expect(fs.existsSync(removedTaskDir)).toBe(false);
    expect(result.tasks.get("task-changing").name).toBe("Changed");
    expect(result.tasks.has("task-remove")).toBe(false);
  });
});

// ── migrateProjectData ────────────────────────────────────────────────────────

describe("migrateProjectData", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-migrate-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrates a flat project (root only)", () => {
    const projectData = {
      headers: [],
      data: {
        id: "root-1",
        data: { name: "My Project", status: "Open", "due date": undefined, memo: [] },
        children: [],
      },
    };

    const { count } = migrateProjectData(tmpDir, projectData);
    expect(count).toBe(1);

    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const projectDir = path.join(tmpDir, entries.find((e) => e.isDirectory()).name);
    const { tasks } = readProject(projectDir);

    expect(tasks.size).toBe(1);
    expect(tasks.has("root-1")).toBe(false);
    const root = Array.from(tasks.values()).find((task) => task.parents.length === 0);
    expect(root.id).not.toBe("root-1");
    expect(root.name).toBe("My Project");
    expect(root.parents).toEqual([]);
  });

  it("migrates a tree and preserves parent links", () => {
    const projectData = {
      headers: [],
      data: {
        id: "root-2",
        data: { name: "Root", status: "Open", "due date": undefined, memo: [] },
        children: [
          {
            id: "child-a",
            data: {
              name: "Child A",
              status: "In Progress",
              "start date": "2026-04-20",
              "due date": "2026-05-01",
              memo: [],
            },
            children: [],
          },
          {
            id: "child-b",
            data: { name: "Child B", status: "Completed", "due date": undefined, memo: [] },
            children: [
              {
                id: "grandchild",
                data: { name: "Grandchild", status: "Open", "due date": undefined, memo: [] },
                children: [],
              },
            ],
          },
        ],
      },
    };

    const { count } = migrateProjectData(tmpDir, projectData);
    expect(count).toBe(4);

    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const projectDir = path.join(tmpDir, entries.find((e) => e.isDirectory()).name);
    const { tasks } = readProject(projectDir);

    expect(tasks.size).toBe(4);
    expect(tasks.has("root-2")).toBe(false);
    const root = Array.from(tasks.values()).find((task) => task.parents.length === 0);
    expect(root.id).not.toBe("root-2");
    expect(tasks.get("child-a").parents).toEqual([root.id]);
    expect(tasks.get("child-b").parents).toEqual([root.id]);
    expect(tasks.get("grandchild").parents).toEqual(["child-b"]);
    expect(tasks.get("child-a").startDate).toBe("2026-04-20");
    expect(tasks.get("child-a").dueDate).toBe("2026-05-01");
    expect(tasks.get("child-b").status).toBe("Completed");
    expect(tasks.get("child-a").order).toBe(0);
    expect(tasks.get("child-b").order).toBe(1);
    expect(tasks.get("grandchild").order).toBe(0);
  });

  it("exports Quill Delta memo content to Markdown without mutating source data", () => {
    const delta = {
      ops: [
        { insert: "Title" },
        { insert: "\n", attributes: { header: 1 } },
        { insert: "bold", attributes: { bold: true } },
        { insert: " link", attributes: { link: "https://example.com" } },
        { insert: "\n" },
        { insert: "item" },
        { insert: "\n", attributes: { list: "bullet" } },
        { insert: { image: "data:image/png;base64,abc" } },
        { insert: "\n" },
      ],
    };
    const projectData = {
      headers: [],
      data: {
        id: "root-3",
        data: {
          name: "Project With Memo",
          status: "Open",
          "due date": undefined,
          memo: [{ id: "delta-memo", title: "Delta Memo", content: delta }],
        },
        children: [],
      },
    };
    const before = JSON.stringify(projectData);

    exportProjectData(tmpDir, projectData, { memoFormat: "markdown" });

    expect(JSON.stringify(projectData)).toBe(before);

    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const projectDir = path.join(tmpDir, entries.find((e) => e.isDirectory()).name);
    const memoFiles = fs
      .readdirSync(projectDir)
      .filter((entry) => entry.endsWith(".md") && entry !== "_project.md");
    expect(memoFiles).toHaveLength(1);
    expect(memoFiles[0]).not.toBe("delta-memo.md");
    const memoFile = fs.readFileSync(path.join(projectDir, memoFiles[0]), "utf8");
    const { data: memoData } = parseFrontmatter(memoFile);

    expect(memoData.id).not.toBe("delta-memo");
    expect(memoFile).toContain("# Title");
    expect(memoFile).toContain("**bold**");
    expect(memoFile).toContain("[link](https://example.com)");
    expect(memoFile).toMatch(/-\s+item/);
    expect(memoFile).toContain("![](data:image/png;base64,abc)");
    expect(memoFile).not.toContain('"ops"');
  });

  it("exports memo format unchanged by default", () => {
    const delta = { ops: [{ insert: "Keep rich\n", attributes: { italic: true } }] };
    const projectData = {
      headers: [],
      data: {
        id: "root-preserve",
        data: {
          name: "Project Preserve",
          status: "Open",
          "due date": undefined,
          memo: [{ id: "preserve-memo", title: "Preserve", content: delta }],
        },
        children: [],
      },
    };

    exportProjectData(tmpDir, projectData);

    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const projectDir = path.join(tmpDir, entries.find((e) => e.isDirectory()).name);
    const memoFiles = fs
      .readdirSync(projectDir)
      .filter((entry) => entry.endsWith(".md") && entry !== "_project.md");
    expect(memoFiles).toHaveLength(1);
    expect(memoFiles[0]).not.toBe("preserve-memo.md");
    const memoFile = fs.readFileSync(path.join(projectDir, memoFiles[0]), "utf8");
    const { data: memoData } = parseFrontmatter(memoFile);

    expect(memoData.id).not.toBe("preserve-memo");
    expect(memoFile).toContain("format: quill");
    expect(memoFile).toContain("```json");
    expect(memoFile).toContain('"ops"');
    expect(memoFile).toContain("Keep rich");
  });

  it("falls back to a JSON fenced block for unknown legacy memo objects", () => {
    const markdown = legacyMemoContentToMarkdown({ custom: true }, "Custom");

    expect(markdown).toContain("# Custom");
    expect(markdown).toContain("```json");
    expect(markdown).toContain('"custom": true');
  });

  it("throws on invalid projectData", () => {
    expect(() => migrateProjectData(tmpDir, null)).toThrow();
    expect(() => migrateProjectData(tmpDir, {})).toThrow();
  });
});
