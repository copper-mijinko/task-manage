import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { pathToFileURL } from "url";
import {
  slugify,
  parseFrontmatter,
  stringifyFrontmatter,
  wouldCreateCycle,
  bfsFromRoot,
  createProject,
  readProject,
  writeTask,
  saveMemoImage,
  resolveMemoAssetPath,
  deleteTaskDir,
  deleteProject,
  listProjects,
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
    const root = tasks.get("root-1");
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
    expect(tasks.get("child-a").parents).toEqual(["root-2"]);
    expect(tasks.get("child-b").parents).toEqual(["root-2"]);
    expect(tasks.get("grandchild").parents).toEqual(["child-b"]);
    expect(tasks.get("child-a").startDate).toBe("2026-04-20");
    expect(tasks.get("child-a").dueDate).toBe("2026-05-01");
    expect(tasks.get("child-b").status).toBe("Completed");
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

    exportProjectData(tmpDir, projectData);

    expect(JSON.stringify(projectData)).toBe(before);

    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const projectDir = path.join(tmpDir, entries.find((e) => e.isDirectory()).name);
    const memoFile = fs.readFileSync(path.join(projectDir, "delta-memo.md"), "utf8");

    expect(memoFile).toContain("# Title");
    expect(memoFile).toContain("**bold**");
    expect(memoFile).toContain("[link](https://example.com)");
    expect(memoFile).toMatch(/-\s+item/);
    expect(memoFile).toContain("![](data:image/png;base64,abc)");
    expect(memoFile).not.toContain('"ops"');
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
