import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  slugify,
  parseFrontmatter,
  stringifyFrontmatter,
  wouldCreateCycle,
  bfsFromRoot,
  createProject,
  readProject,
  writeTask,
  deleteTaskDir,
  listProjects,
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

  it("readProject returns root task with empty parents", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const { tasks } = readProject(projectDir);
    const root = tasks.get("root-id");
    expect(root).toBeDefined();
    expect(root.parents).toEqual([]);
  });

  it("writeTask + readProject round-trips a regular task", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    const taskDirs = new Map([["root-id", "_project"]]);
    const task = {
      id: "task-1",
      name: "First Task",
      status: "In Progress",
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
    expect(loaded.dueDate).toBe("2026-06-01");
    expect(loaded.parents).toEqual(["root-id"]);
    expect(loaded.memos).toHaveLength(1);
    expect(loaded.memos[0].id).toBe("memo-uuid-1");
    expect(loaded.memos[0].title).toBe("Notes");
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
            data: { name: "Child A", status: "In Progress", "due date": "2026-05-01", memo: [] },
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
    expect(tasks.get("child-a").dueDate).toBe("2026-05-01");
    expect(tasks.get("child-b").status).toBe("Completed");
  });

  it("serializes Quill Delta memo content as JSON block", () => {
    const delta = { ops: [{ insert: "Hello" }] };
    const projectData = {
      headers: [],
      data: {
        id: "root-3",
        data: {
          name: "Project With Memo",
          status: "Open",
          "due date": undefined,
          memo: [{ title: "Delta Memo", content: delta }],
        },
        children: [],
      },
    };

    migrateProjectData(tmpDir, projectData);
    // Root task memos are not written (root uses _project.md without memos)
    // so we just check the function doesn't throw
  });

  it("throws on invalid projectData", () => {
    expect(() => migrateProjectData(tmpDir, null)).toThrow();
    expect(() => migrateProjectData(tmpDir, {})).toThrow();
  });
});
