import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  readProjectAsync,
  readTaskBody,
  readTaskBodyAsync,
  writeTask,
  writeTaskAsync,
  writeProjectAsync,
  writeProjectPatchAsync,
  saveMemoImage,
  saveMemoImageAsync,
  saveTaskAttachmentAsync,
  deleteTaskAttachmentAsync,
  resolveTaskAttachmentFilePath,
  resolveTaskAttachmentFilePathAsync,
  resolveMemoAssetPath,
  resolveMemoAssetPathAsync,
  deleteTaskDir,
  deleteTaskDirAsync,
  deleteProject,
  deleteProjectAsync,
  listProjects,
  listProjectsAsync,
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

  it("round-trips scalar and map array fields", () => {
    // タグのようなスカラー配列と、親リンクのようなマップ配列の両方を扱う。
    const data = {
      tags: ["a", "b"],
      parents: [{ id: "p1", order: 1 }, "p2"],
    };
    const result = parseFrontmatter(stringifyFrontmatter(data));
    expect(result.data.tags).toEqual(["a", "b"]);
    // 自前パーサなので数値は文字列で返る（読み込み側で正規化する）。
    expect(result.data.parents).toEqual([{ id: "p1", order: "1" }, "p2"]);
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
  // spec: { id: { parents: [{ id: ids }] } }
  const tasks = new Map();
  for (const [id, { parents }] of Object.entries(spec)) {
    tasks.set(id, { id, parents, name: id, status: "Open", memos: [], createdAt: "" });
  }
  return tasks;
}

describe("wouldCreateCycle", () => {
  it("returns false for empty newParents", () => {
    const tasks = makeTasks({ root: { parents: [] }, a: { parents: [{ id: "root" }] } });
    expect(wouldCreateCycle(tasks, "a", [])).toBe(false);
  });

  it("detects direct self-cycle", () => {
    const tasks = makeTasks({ root: { parents: [] }, a: { parents: [{ id: "root" }] } });
    expect(wouldCreateCycle(tasks, "a", ["a"])).toBe(true);
  });

  it("detects indirect cycle (parent → child relationship reversed)", () => {
    // root → a → b; asking if we can set root's parent to b (b is descendant of root)
    const tasks = makeTasks({
      root: { parents: [] },
      a: { parents: [{ id: "root" }] },
      b: { parents: [{ id: "a" }] },
    });
    expect(wouldCreateCycle(tasks, "root", ["b"])).toBe(true);
  });

  it("returns false for a valid new parent", () => {
    const tasks = makeTasks({
      root: { parents: [] },
      a: { parents: [{ id: "root" }] },
      b: { parents: [{ id: "root" }] },
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
      a: { parents: [{ id: "root" }] },
      b: { parents: [{ id: "a" }] },
    });
    expect(bfsFromRoot(tasks, "root")).toEqual(["root", "a", "b"]);
  });

  it("visits each node exactly once in a diamond DAG", () => {
    // root → a, root → b, a → c, b → c
    const tasks = makeTasks({
      root: { parents: [] },
      a: { parents: [{ id: "root" }] },
      b: { parents: [{ id: "root" }] },
      c: { parents: [{ id: "a" }, { id: "b" }] },
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
      a: { parents: [{ id: "root" }, { id: "b" }] },
      b: { parents: [{ id: "a" }] },
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

  it("writeTask + readProject round-trips the root node body", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      {
        id: "root-id",
        name: "Proj",
        status: "Open",
        parents: [],
        body: "# Root Notes\n\nStored here",
        format: "markdown",
        createdAt: "2026-04-24",
      },
      taskDirs
    );

    const { tasks } = readProject(projectDir);
    expect(tasks.get("root-id").body).toContain("Stored here");
  });

  // 旧メモはタスクの属性ではなくノードになる。ルート直下に置かれていた
  // メモファイルも、ルートの子ノードとして現れる。
  it("ルート直下の旧メモファイルは、ルートの子ノードとして読まれる", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    fs.writeFileSync(
      path.join(projectDir, "root-memo.md"),
      "---\nid: root-memo\ntitle: Root Notes\n---\n\nStored here\n"
    );

    const { tasks, legacyMemoFiles } = readProject(projectDir);
    const promoted = tasks.get("root-memo");
    expect(promoted.name).toBe("Root Notes");
    expect(promoted.body).toContain("Stored here");
    expect(promoted.parents.map((parent) => parent.id)).toEqual(["root-id"]);
    // メモは進み具合を持たない。
    expect(promoted.status).toBeUndefined();
    expect(legacyMemoFiles.has("root-memo")).toBe(true);
  });

  it("readProjectAsync matches readProject for a multi-task project with memos", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      {
        id: "root-id",
        name: "Proj",
        status: "Open",
        parents: [],
        memos: [{ id: "root-memo", title: "Root Notes", content: "# Root Notes\n\nbody" }],
        createdAt: "2026-04-24",
      },
      taskDirs
    );
    writeTask(
      projectDir,
      {
        id: "child-a",
        name: "Child A",
        status: "Open",
        parents: [{ id: "root-id" }],
        memos: [{ id: "memo-a", title: "A", content: "alpha" }],
        createdAt: "2026-04-24",
      },
      taskDirs
    );
    writeTask(
      projectDir,
      {
        id: "child-b",
        name: "Child B",
        status: "Open",
        parents: [{ id: "root-id" }],
        memos: [],
        createdAt: "2026-04-24",
      },
      taskDirs
    );

    const sync = readProject(projectDir);
    const asyncResult = await readProjectAsync(projectDir);

    expect([...asyncResult.taskDirs.entries()].sort()).toEqual([...sync.taskDirs.entries()].sort());
    expect([...asyncResult.tasks.keys()].sort()).toEqual([...sync.tasks.keys()].sort());
    for (const [id, task] of sync.tasks) {
      expect(asyncResult.tasks.get(id)).toEqual(task);
    }
  });

  it("readProjectAsync returns empty maps for a missing project dir", async () => {
    const result = await readProjectAsync(path.join(tmpDir, "does-not-exist"));
    expect(result.tasks.size).toBe(0);
    expect(result.taskDirs.size).toBe(0);
  });

  it("readTaskBodyAsync matches readTaskBody", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      {
        id: "child-a",
        name: "Child A",
        status: "Open",
        parents: [{ id: "root-id" }],
        body: "first and second",
        format: "markdown",
        createdAt: "2026-04-24",
      },
      taskDirs
    );

    const sync = readTaskBody(projectDir, "child-a", taskDirs);
    const asyncResult = await readTaskBodyAsync(projectDir, "child-a", taskDirs);
    expect(asyncResult).toEqual(sync);
    expect(sync.body).toBe("first and second");
  });

  it("listProjectsAsync matches listProjects including order", async () => {
    createProject(tmpDir, "Alpha", "alpha-id", 1);
    createProject(tmpDir, "Beta", "beta-id", 0);
    createProject(tmpDir, "Gamma", "gamma-id", 2);

    const sync = listProjects(tmpDir);
    const asyncResult = await listProjectsAsync(tmpDir);
    expect(asyncResult).toEqual(sync);
  });

  it("listProjectsAsync returns [] for a missing workspace dir", async () => {
    const result = await listProjectsAsync(path.join(tmpDir, "nope"));
    expect(result).toEqual([]);
  });

  // 旧メモの `order:` は、取り込んだノードの「親の下での並び順」になる。
  // ファイル名の辞書順ではなく order が効くことを確かめる。
  it("旧メモの order が、子ノードの並び順として引き継がれる", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      {
        id: "task-memo-order",
        name: "Memo Order",
        status: "Open",
        parents: [{ id: "root-id" }],
        createdAt: "2026-04-24",
      },
      taskDirs
    );
    const taskDir = path.join(projectDir, "task-memo-order");
    // ファイル名は z が先、a が後。order は逆に付けてある。
    fs.writeFileSync(
      path.join(taskDir, "z-memo.md"),
      "---\nid: z-memo\ntitle: First\norder: 0\n---\n"
    );
    fs.writeFileSync(
      path.join(taskDir, "a-memo.md"),
      "---\nid: a-memo\ntitle: Second\norder: 1\n---\n"
    );

    const { tasks } = readProject(projectDir);
    const orderUnder = (id) =>
      tasks.get(id).parents.find((parent) => parent.id === "task-memo-order").order;
    expect(orderUnder("z-memo")).toBeLessThan(orderUnder("a-memo"));
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
      parents: [{ id: "root-id" }],
      body: "# Notes\n\nSome content",
      format: "markdown",
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    // Task directory should be named after task.id (UUID)
    expect(fs.existsSync(path.join(projectDir, "task-1"))).toBe(true);

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-1");
    expect(loaded).toBeDefined();
    expect(loaded.name).toBe("First Task");
    expect(loaded.status).toBe("In Progress");
    expect(loaded.startDate).toBe("2026-05-20");
    expect(loaded.dueDate).toBe("2026-06-01");
    expect(loaded.parents).toEqual([{ id: "root-id" }]);
    expect(loaded.body).toContain("Some content");
  });

  it("readProject can defer node bodies and read one later", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      {
        id: "task-lazy",
        name: "Lazy Node",
        status: "Open",
        parents: [{ id: "root-id" }],
        body: "# Lazy Notes\n\nLoaded later",
        format: "markdown",
        tags: ["lazy"],
        createdAt: "2026-04-24",
      },
      taskDirs
    );

    const summary = readProject(projectDir, { includeMemoContent: false });
    const summaryTask = summary.tasks.get("task-lazy");
    expect(summaryTask.name).toBe("Lazy Node");
    expect(summaryTask.tags).toEqual(["lazy"]);
    expect(summaryTask.body).toBe("");
    expect(summaryTask.bodyLoaded).toBe(false);

    const loaded = readTaskBody(projectDir, "task-lazy", summary.taskDirs);
    expect(loaded.body).toContain("Loaded later");
  });

  it("writeTask + readProject round-trips the order on the parent link", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-order",
      name: "Ordered Task",
      status: "Open",
      // 並び順は辺の属性なので、親リンクに載せて往復させる。
      parents: [{ id: "root-id", order: 2 }],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-order");
    expect(loaded).toBeDefined();
    expect(loaded.parents).toEqual([{ id: "root-id", order: 2 }]);
  });

  it("writeTask + readProject: 旧形式（id の配列 + タスク直下の order）も読める", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDir = path.join(projectDir, "legacy-task");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(
      path.join(taskDir, "_index.md"),
      [
        "---",
        "id: legacy-task",
        "name: Legacy",
        "status: Open",
        "parents:",
        "  - root-id",
        "order: 3",
        "created: 2026-04-24",
        "---",
        "",
      ].join("\n")
    );

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("legacy-task");
    // 旧形式のタスク直下 order は、全ての辺に配られる。
    expect(loaded.parents).toEqual([{ id: "root-id", order: 3 }]);
  });

  it("writeTask + readProject: task without order reads as undefined", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-no-order",
      name: "No Order Task",
      status: "Open",
      parents: [{ id: "root-id" }],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, task, taskDirs);

    const { tasks } = readProject(projectDir);
    const loaded = tasks.get("task-no-order");
    expect(loaded).toBeDefined();
    expect(loaded.order).toBeUndefined();
  });

  // 旧メモのタグは、取り込んだノード自身のタグになる（メモという別の持ち主が
  // 無くなったので、タグの行き先はノードしかない）。
  it("旧メモのタグは、取り込んだノードのタグとして残る", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      {
        id: "task-tags",
        name: "Tagged",
        status: "Open",
        parents: [{ id: "root-id" }],
        createdAt: "2026-04-24",
      },
      taskDirs
    );
    fs.writeFileSync(
      path.join(projectDir, "task-tags", "memo-tagged.md"),
      "---\nid: memo-tagged\ntitle: Notes\ntags:\n  - design\n  - frontend\n---\n\nSome content\n"
    );

    const { tasks } = readProject(projectDir);
    expect(tasks.get("memo-tagged").tags).toEqual(["design", "frontend"]);
  });

  // 取り込んだノードを保存すると、タグはノードの `tags:` として書かれる。
  it("ノードのタグは frontmatter に往復する", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      {
        id: "node-tags",
        name: "Tagged Node",
        status: "Open",
        parents: [{ id: "root-id" }],
        tags: ["design", "frontend"],
        createdAt: "2026-04-24",
      },
      taskDirs
    );

    const file = fs.readFileSync(path.join(projectDir, "node-tags", "_index.md"), "utf8");
    expect(file).toContain("tags:");
    expect(file).toContain("- design");
    expect(readProject(projectDir).tasks.get("node-tags").tags).toEqual(["design", "frontend"]);
  });

  it("writeTask + readProject round-trips a Quill node body as JSON in the markdown file", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const delta = { ops: [{ insert: "Rich body\n", attributes: { bold: true } }] };
    writeTask(
      projectDir,
      {
        id: "task-quill",
        name: "Quill Node",
        status: "Open",
        parents: [{ id: "root-id" }],
        body: delta,
        format: "quill",
        tags: ["rich"],
        createdAt: "2026-04-24",
      },
      taskDirs
    );

    const file = fs.readFileSync(path.join(projectDir, "task-quill", "_index.md"), "utf8");
    expect(file).toContain("format: quill");
    expect(file).toContain("```json");
    expect(file).toContain('"ops"');

    const loaded = readProject(projectDir).tasks.get("task-quill");
    expect(loaded.format).toBe("quill");
    expect(loaded.body).toEqual(delta);
  });

  it("node tags default to an empty array when absent from frontmatter", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      {
        id: "task-no-tags",
        name: "Untagged",
        status: "Open",
        parents: [{ id: "root-id" }],
        createdAt: "2026-04-24",
      },
      taskDirs
    );

    expect(readProject(projectDir).tasks.get("task-no-tags").tags).toEqual([]);
  });

  // 取り込んだノードの名前は「frontmatter の title → 先頭の見出し →
  // ファイル名 → memo」の順で決める。作成時に名前を要求しない方針の裏返しで、
  // ここが崩れると Inbox 的に書いたメモが id で並ぶことになる。
  it("旧メモの title は、取り込んだノードの名前になる", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      { id: "t", name: "T", status: "Open", parents: [{ id: "root-id" }], createdAt: "2026-04-24" },
      taskDirs
    );
    fs.writeFileSync(
      path.join(projectDir, "t", "memo-uuid-empty.md"),
      "---\nid: memo-uuid-empty\ntitle: Scratch\n---\n"
    );

    const promoted = readProject(projectDir).tasks.get("memo-uuid-empty");
    expect(promoted.name).toBe("Scratch");
  });

  it("title も見出しも無い旧メモは、id ではなく memo という名前になる", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      { id: "t", name: "T", status: "Open", parents: [{ id: "root-id" }], createdAt: "2026-04-24" },
      taskDirs
    );
    fs.writeFileSync(
      path.join(projectDir, "t", "memo-uuid-old.md"),
      "---\nid: memo-uuid-old\n---\n"
    );

    expect(readProject(projectDir).tasks.get("memo-uuid-old").name).toBe("memo");
  });

  it("frontmatter の無い旧メモは、先頭の見出しを名前にして id を発行する", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      { id: "t", name: "T", status: "Open", parents: [{ id: "root-id" }], createdAt: "2026-04-24" },
      taskDirs
    );
    fs.writeFileSync(path.join(projectDir, "t", "old-memo.md"), "# Old Memo\n\nLegacy content");

    const { tasks } = readProject(projectDir);
    const promoted = [...tasks.values()].find((task) => task.name === "Old Memo");
    expect(promoted).toBeDefined();
    expect(typeof promoted.id).toBe("string");
    expect(promoted.id.length).toBeGreaterThan(0);
    expect(promoted.body).toContain("Legacy content");
  });

  it("deleteTaskDir removes the task directory", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-del",
      name: "To Delete",
      status: "Open",
      parents: [{ id: "root-id" }],
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
      parents: [{ id: "root-id" }],
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

  it("resolveMemoAssetPath returns a file URL for existing task assets", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-preview",
      name: "Preview",
      status: "Open",
      parents: [{ id: "root-id" }],
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
    await expect(
      resolveMemoAssetPathAsync(projectDir, taskDirs, "task-preview", "./assets/diagram.png")
    ).resolves.toBe(fileUrl);
  });

  it("saveTaskAttachmentAsync copies files into task attachments and readProject lists them", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-attachments",
      name: "Attachments",
      status: "Open",
      parents: [{ id: "root-id" }],
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
      parents: [{ id: "root-id" }],
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
    await expect(
      resolveTaskAttachmentFilePathAsync(
        projectDir,
        taskDirs,
        "task-delete-attachment",
        attachment.relativePath
      )
    ).resolves.toBe(attachmentPath);
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
      parents: [{ id: "root-id" }],
      body: "Async content",
      format: "markdown",
      createdAt: "2026-04-24",
    };

    await writeTaskAsync(projectDir, task, taskDirs);

    const { tasks } = readProject(projectDir);
    expect(tasks.get("task-async").body).toBe("Async content");
    expect(
      fs.readdirSync(path.join(projectDir, "task-async")).some((e) => e.includes(".tmp"))
    ).toBe(false);
  });

  it("writeTaskAsync rejects task ids that escape the project directory", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "../outside",
      name: "Unsafe",
      status: "Open",
      parents: [{ id: "root-id" }],
      memos: [],
    };

    await expect(writeTaskAsync(projectDir, task, taskDirs)).rejects.toThrow(/Invalid task id/);
  });

  // 旧メモの id はこれからディレクトリ名になる。手書きファイルに危険な id が
  // 入っていても、保存のたびに例外が出て**プロジェクト全体が保存できなくなる**
  // ことがあってはいけない。中身は捨てず、id だけ振り直す。
  it("危険な id の旧メモは、id を振り直して取り込む", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      { id: "t", name: "T", status: "Open", parents: [{ id: "root-id" }], createdAt: "2026-04-24" },
      taskDirs
    );
    fs.writeFileSync(
      path.join(projectDir, "t", "evil.md"),
      "---\nid: ../outside\ntitle: Evil\n---\n\nbody\n"
    );

    const { tasks, legacyMemoFiles } = readProject(projectDir);
    const promoted = [...tasks.values()].find((task) => task.name === "Evil");
    expect(promoted.id).not.toBe("../outside");
    expect(promoted.body).toContain("body");
    // 消す対象は**ディスク上の実際のファイル名**であること。id から組み立てると
    // ディレクトリの外を指してしまう。
    expect([...legacyMemoFiles.values()].map((entry) => entry.fileName)).toEqual(["evil.md"]);
  });

  it("移行はディレクトリの外へ書き出さない", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    writeTask(
      projectDir,
      { id: "t", name: "T", status: "Open", parents: [{ id: "root-id" }], createdAt: "2026-04-24" },
      taskDirs
    );
    fs.writeFileSync(
      path.join(projectDir, "t", "evil.md"),
      "---\nid: ../outside\ntitle: Evil\n---\n\nbody\n"
    );

    const { tasks } = readProject(projectDir);
    await writeProjectAsync(projectDir, [...tasks.values()]);

    expect(fs.existsSync(path.join(projectDir, "..", "outside.md"))).toBe(false);
    expect(fs.readdirSync(path.join(projectDir, "t"))).toEqual(["_index.md"]);
  });

  it("saveMemoImageAsync writes pasted images atomically", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-async-assets",
      name: "Assets",
      status: "Open",
      parents: [{ id: "root-id" }],
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
      parents: [{ id: "root-id" }],
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

  it("keeps interactive async project operations free of synchronous filesystem calls", async () => {
    const { projectDir } = createProject(tmpDir, "Async I/O", "async-io-root", 0);
    const taskDirs = new Map([["async-io-root", "_project"]]);
    const childTask = {
      id: "async-io-child",
      name: "Child",
      status: "Open",
      parents: [{ id: "async-io-root" }],
      memos: [],
      createdAt: "2026-04-24",
    };
    writeTask(projectDir, childTask, taskDirs);
    const initialTasks = [...readProject(projectDir).tasks.values()];
    const initialProjects = listProjects(tmpDir);

    const blockedMethods = ["existsSync", "readdirSync", "readFileSync", "statSync"];
    for (const method of blockedMethods) {
      vi.spyOn(fs, method).mockImplementation(() => {
        throw new Error(`Unexpected synchronous filesystem call: ${method}`);
      });
    }

    try {
      await writeProjectAsync(projectDir, initialTasks);
      await writeProjectPatchAsync(projectDir, {
        tasks: [{ ...childTask, name: "Updated child" }],
      });
      await setProjectOrderAsync(tmpDir, initialProjects);
      const image = await saveMemoImageAsync(
        projectDir,
        taskDirs,
        childTask.id,
        Uint8Array.from([137, 80, 78, 71]),
        "image/png"
      );
      await resolveMemoAssetPathAsync(projectDir, taskDirs, childTask.id, image.relativePath);
      const attachment = await saveTaskAttachmentAsync(
        projectDir,
        taskDirs,
        childTask.id,
        "async.txt",
        Uint8Array.from([1, 2, 3])
      );
      await resolveTaskAttachmentFilePathAsync(
        projectDir,
        taskDirs,
        childTask.id,
        attachment.relativePath
      );
      await deleteTaskAttachmentAsync(projectDir, taskDirs, childTask.id, attachment.relativePath);
      const created = await createProjectAsync(tmpDir, "Second Async Project", "async-io-second");
      await deleteProjectAsync(created.projectDir);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("writeProjectAsync skips unchanged node files", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const rootTask = {
      id: "root-id",
      name: "Proj",
      status: "Open",
      parents: [],
      createdAt: "2026-04-24",
    };
    const childTask = {
      id: "task-stable",
      name: "Stable",
      status: "Open",
      parents: [{ id: "root-id" }],
      body: "Stable content",
      format: "markdown",
      createdAt: "2026-04-24",
    };
    await writeProjectAsync(projectDir, [rootTask, childTask]);

    const taskFile = path.join(projectDir, "task-stable", "_index.md");
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(taskFile, oldTime, oldTime);

    await writeProjectAsync(projectDir, [rootTask, childTask]);

    expect(fs.statSync(taskFile).mtimeMs).toBe(oldTime.getTime());
  });

  it("writeProjectAsync touches only changed nodes and deletes removed ones", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const rootTask = {
      id: "root-id",
      name: "Proj",
      status: "Open",
      parents: [],
      createdAt: "2026-04-24",
    };
    const keepTask = {
      id: "node-keep",
      name: "Keep",
      status: "Open",
      parents: [{ id: "root-id" }],
      body: "Keep content",
      format: "markdown",
      createdAt: "2026-04-24",
    };
    const changeTask = {
      id: "node-change",
      name: "Change",
      status: "Open",
      parents: [{ id: "root-id" }],
      body: "Before",
      format: "markdown",
      createdAt: "2026-04-24",
    };
    const removedTask = {
      id: "task-remove",
      name: "Remove",
      status: "Open",
      parents: [{ id: "root-id" }],
      createdAt: "2026-04-24",
    };
    await writeProjectAsync(projectDir, [rootTask, keepTask, changeTask, removedTask]);

    const keepFile = path.join(projectDir, "node-keep", "_index.md");
    const changeFile = path.join(projectDir, "node-change", "_index.md");
    const removedTaskDir = path.join(projectDir, "task-remove");
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(keepFile, oldTime, oldTime);
    fs.utimesSync(changeFile, oldTime, oldTime);

    await writeProjectAsync(projectDir, [rootTask, keepTask, { ...changeTask, body: "After" }]);

    expect(fs.statSync(keepFile).mtimeMs).toBe(oldTime.getTime());
    expect(fs.statSync(changeFile).mtimeMs).not.toBe(oldTime.getTime());
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
      parents: [{ id: "root-id" }],
      body: "Stable content",
      format: "markdown",
      createdAt: "2026-04-24",
      order: 0,
    };
    const changingTask = {
      id: "task-changing",
      name: "Changing",
      status: "Open",
      parents: [{ id: "root-id" }],
      body: "Before",
      format: "markdown",
      createdAt: "2026-04-24",
      order: 1,
    };
    const removedTask = {
      id: "task-remove",
      name: "Remove",
      status: "Open",
      parents: [{ id: "root-id" }],
      memos: [],
      createdAt: "2026-04-24",
      order: 2,
    };
    await writeProjectAsync(projectDir, [rootTask, stableTask, changingTask, removedTask]);

    const stableTaskFile = path.join(projectDir, "task-stable", "_index.md");
    const changingTaskFile = path.join(projectDir, "task-changing", "_index.md");
    const removedTaskDir = path.join(projectDir, "task-remove");
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(stableTaskFile, oldTime, oldTime);
    fs.utimesSync(changingTaskFile, oldTime, oldTime);

    const result = await writeProjectPatchAsync(projectDir, {
      tasks: [{ ...changingTask, name: "Changed" }],
      deletedTaskIds: ["task-remove"],
    });

    expect(fs.statSync(stableTaskFile).mtimeMs).toBe(oldTime.getTime());
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
    expect(tasks.get("child-a").parents.map((p) => p.id)).toEqual([root.id]);
    expect(tasks.get("child-b").parents.map((p) => p.id)).toEqual([root.id]);
    expect(tasks.get("grandchild").parents.map((p) => p.id)).toEqual(["child-b"]);
    expect(tasks.get("child-a").startDate).toBe("2026-04-20");
    expect(tasks.get("child-a").dueDate).toBe("2026-05-01");
    expect(tasks.get("child-b").status).toBe("Completed");
    // 並び順は「その親へのリンク」に載る。
    expect(tasks.get("child-a").parents[0].order).toBe(0);
    expect(tasks.get("child-b").parents[0].order).toBe(1);
    expect(tasks.get("grandchild").parents[0].order).toBe(0);
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
    // メモはノードになったので、エクスポート先では子ノードのディレクトリになる。
    const memoDirs = fs
      .readdirSync(projectDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    expect(memoDirs).toHaveLength(1);
    expect(memoDirs[0].name).not.toBe("delta-memo");
    const memoFile = fs.readFileSync(path.join(projectDir, memoDirs[0].name, "_index.md"), "utf8");
    const { data: memoData } = parseFrontmatter(memoFile);

    expect(memoData.id).not.toBe("delta-memo");
    expect(memoData.name).toBe("Delta Memo");
    expect(memoFile).toContain("# Title");
    expect(memoFile).toContain("**bold**");
    expect(memoFile).toContain("[link](https://example.com)");
    expect(memoFile).toMatch(/-\s+item/);
    expect(memoFile).toContain("![](data:image/png;base64,abc)");
    expect(memoFile).not.toContain('"ops"');
  });

  it("exports Quill table Delta content as GFM Markdown table", () => {
    const delta = {
      ops: [
        { insert: "Task" },
        { insert: "\n", attributes: { table: "row-a" } },
        { insert: "Done" },
        { insert: "\n", attributes: { table: "row-a", align: "center" } },
        { insert: "One" },
        { insert: "\n", attributes: { table: "row-b" } },
        { insert: "Yes" },
        { insert: "\n", attributes: { table: "row-b", align: "center" } },
      ],
    };

    expect(legacyMemoContentToMarkdown(delta, "Table")).toBe(
      "| Task | Done |\n| --- | :---: |\n| One | Yes |"
    );
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
    const memoDirs = fs
      .readdirSync(projectDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    expect(memoDirs).toHaveLength(1);
    expect(memoDirs[0].name).not.toBe("preserve-memo");
    const memoFile = fs.readFileSync(path.join(projectDir, memoDirs[0].name, "_index.md"), "utf8");
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
