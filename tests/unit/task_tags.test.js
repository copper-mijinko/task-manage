import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  createProject,
  normalizeTaskTags,
  parseFrontmatter,
  readProject,
  readProjectAsync,
  writeTask,
} from "../../electron/workspace.js";
import {
  normalizeTag,
  normalizeTagList,
  withTagAdded,
  withTagRemoved,
} from "../../src/lib/utils/tags";
import { filterTree } from "../../src/features/tasks/utils/tree_control";

describe("normalizeTaskTags (main process)", () => {
  it("drops blanks, '#' prefixes and duplicates", () => {
    expect(normalizeTaskTags(["  frontend ", "#design", "frontend", "", null])).toEqual([
      "frontend",
      "design",
    ]);
  });

  it("accepts a hand-written comma separated scalar", () => {
    expect(normalizeTaskTags("frontend, design")).toEqual(["frontend", "design"]);
  });

  it("returns an empty array for missing values", () => {
    expect(normalizeTaskTags(undefined)).toEqual([]);
    expect(normalizeTaskTags(null)).toEqual([]);
  });
});

describe("tag helpers (renderer)", () => {
  it("normalizes case, whitespace and leading hashes", () => {
    expect(normalizeTag("  #Frontend ")).toBe("frontend");
  });

  it("keeps tag lists unique", () => {
    expect(normalizeTagList(["a", "A", " a ", "b"])).toEqual(["a", "b"]);
    expect(normalizeTagList("not an array")).toEqual([]);
  });

  it("adds and removes without mutating the input", () => {
    const tags = ["a"];
    expect(withTagAdded(tags, "B")).toEqual(["a", "b"]);
    expect(withTagAdded(tags, "a")).toEqual(["a"]);
    expect(withTagRemoved(["a", "b"], "A")).toEqual(["b"]);
    expect(tags).toEqual(["a"]);
  });
});

describe("task tags persistence", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-tags-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const taskDirs = () => new Map([["root-id", "_project"]]);

  it("writes task tags into frontmatter and reads them back", async () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    writeTask(
      projectDir,
      {
        id: "root-id",
        name: "Proj",
        status: "Open",
        parents: [],
        memos: [],
        tags: ["frontend", "Frontend", "#design"],
        createdAt: "2026-04-24",
      },
      taskDirs()
    );

    const { data } = parseFrontmatter(
      fs.readFileSync(path.join(projectDir, "_project.md"), "utf8")
    );
    expect(data.tags).toEqual(["frontend", "design"]);

    expect(readProject(projectDir).tasks.get("root-id").tags).toEqual(["frontend", "design"]);
    const asyncTasks = (await readProjectAsync(projectDir)).tasks;
    expect(asyncTasks.get("root-id").tags).toEqual(["frontend", "design"]);
  });

  it("omits the frontmatter key entirely when a task has no tags", () => {
    const { projectDir } = createProject(tmpDir, "Proj", "root-id");
    writeTask(
      projectDir,
      {
        id: "root-id",
        name: "Proj",
        status: "Open",
        parents: [],
        memos: [],
        createdAt: "2026-04-24",
      },
      taskDirs()
    );

    const content = fs.readFileSync(path.join(projectDir, "_project.md"), "utf8");
    expect(content).not.toContain("tags:");
    expect(readProject(projectDir).tasks.get("root-id").tags).toEqual([]);
  });
});

describe("filterTree with the tags filter", () => {
  const node = (id, name, extra = {}) => ({
    id,
    data: {
      name,
      status: "Open",
      "start date": undefined,
      "due date": undefined,
      memo: [],
      ...extra,
    },
    children: [],
  });

  it("matches a tag on the task itself", () => {
    const tree = { ...node("root", "Root"), children: [node("a", "A", { tags: ["frontend"] })] };
    const result = filterTree(tree, { tags: ["frontend"] });
    expect(result.children.map((child) => child.id)).toEqual(["a"]);
  });

  // メモがノードになったので、タグの付いた記録は「タグの付いた子ノード」に
  // なる。親ではなくその子が一致する。
  it("子ノードに付いたタグで、その子ノードが残る", () => {
    const tree = {
      ...node("root", "Root"),
      children: [{ ...node("a", "A"), children: [node("m", "m", { tags: ["ops"] })] }],
    };
    const result = filterTree(tree, { tags: ["ops"] });
    expect(result.children.map((c) => c.id)).toEqual(["a"]);
    expect(result.children[0].children.map((c) => c.id)).toEqual(["m"]);
  });

  it("ignores case differences between filter and task tag", () => {
    const tree = { ...node("root", "Root"), children: [node("a", "A", { tags: ["Frontend"] })] };
    expect(filterTree(tree, { tags: ["frontend"] }).children.map((c) => c.id)).toEqual(["a"]);
  });
});
