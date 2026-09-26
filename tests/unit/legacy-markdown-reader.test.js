import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  atomicWriteFile,
  loadNodeBodiesAsync,
  parseFrontmatter,
  readProjectAsync,
} from "../../electron/workspace.js";

/**
 * 旧 Markdown ワークスペースの読み手のテスト。
 *
 * 旧形式はもう書かない。グラフの初回作成と「Markdown から取り込む」で
 * 読むだけなので、フィクスチャは Markdown をそのまま書いて作る。
 */

function writeFile(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Array.isArray(lines) ? lines.join("\n") : lines);
}

function project(root, id = "root-id", extra = []) {
  const projectDir = path.join(root, "proj");
  writeFile(path.join(projectDir, "_project.md"), [
    "---",
    `id: ${id}`,
    "name: Proj",
    ...extra,
    "createdAt: 2026-04-24",
    "---",
    "",
  ]);
  return projectDir;
}

function task(projectDir, id, { parents = "root-id", frontmatter = [], body = "" } = {}) {
  writeFile(path.join(projectDir, id, "_index.md"), [
    "---",
    `id: ${id}`,
    `name: ${id}`,
    "parents:",
    `  - id: ${parents}`,
    ...frontmatter,
    "createdAt: 2026-04-24",
    "---",
    body,
  ]);
}

describe("parseFrontmatter", () => {
  it("parses scalars, lists and the body", () => {
    const { data, body } = parseFrontmatter("---\nid: a\ntags:\n  - x\n  - y\n---\nbody text\n");
    expect(data.id).toBe("a");
    expect(data.tags).toEqual(["x", "y"]);
    expect(body).toContain("body text");
  });

  it("returns empty data when there is no frontmatter", () => {
    expect(parseFrontmatter("# Title").data).toEqual({});
  });

  it("keeps colons inside tags while still parsing parent link maps", () => {
    const { data } = parseFrontmatter(
      "---\ntags:\n  - scope:work\n  - owner: team\n  - https://example.test\nparents:\n  - id: p\n    order: 2\n---\n"
    );
    expect(data.tags).toEqual(["scope:work", "owner: team", "https://example.test"]);
    expect(data.parents).toEqual([{ id: "p", order: "2" }]);
  });
});

describe("readProjectAsync", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-reader-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads the root with no parents and a regular task", async () => {
    const projectDir = project(tmpDir);
    task(projectDir, "task-1", {
      frontmatter: ["status: In Progress", "start: 2026-05-20", "due: 2026-06-01"],
      body: "# Notes\n\nSome content",
    });
    const { tasks, taskDirs } = await readProjectAsync(projectDir);
    expect(tasks.get("root-id").parents).toEqual([]);
    expect(taskDirs.get("root-id")).toBe("_project");
    const loaded = tasks.get("task-1");
    expect(loaded).toMatchObject({
      name: "task-1",
      status: "In Progress",
      startDate: "2026-05-20",
      dueDate: "2026-06-01",
      parents: [{ id: "root-id" }],
    });
    expect(loaded.body).toContain("Some content");
  });

  it("returns empty maps for a missing project directory", async () => {
    const result = await readProjectAsync(path.join(tmpDir, "missing"));
    expect(result.tasks.size).toBe(0);
    expect(result.taskDirs.size).toBe(0);
  });

  it("keeps the order on the parent link", async () => {
    const projectDir = project(tmpDir);
    writeFile(path.join(projectDir, "t", "_index.md"), [
      "---",
      "id: t",
      "name: T",
      "parents:",
      "  - id: root-id",
      "    order: 2",
      "---",
    ]);
    const { tasks } = await readProjectAsync(projectDir);
    expect(tasks.get("t").parents).toEqual([{ id: "root-id", order: 2 }]);
  });

  it("reads the older id-list parents with a node-level order", async () => {
    const projectDir = project(tmpDir);
    writeFile(path.join(projectDir, "legacy", "_index.md"), [
      "---",
      "id: legacy",
      "name: Legacy",
      "parents:",
      "  - root-id",
      "order: 3",
      "---",
    ]);
    const { tasks } = await readProjectAsync(projectDir);
    expect(tasks.get("legacy").parents).toEqual([{ id: "root-id", order: 3 }]);
  });

  it("reads a missing status as no status, not Open", async () => {
    const projectDir = project(tmpDir);
    task(projectDir, "plain");
    task(projectDir, "tracked", { frontmatter: ["status: Undefined"] });
    const { tasks } = await readProjectAsync(projectDir);
    expect(tasks.get("plain").status).toBeUndefined();
    expect(tasks.get("tracked").status).toBe("Undefined");
  });

  it("reads tags, defaulting to an empty list", async () => {
    const projectDir = project(tmpDir);
    task(projectDir, "tagged", { frontmatter: ["tags:", "  - design", "  - frontend"] });
    task(projectDir, "untagged");
    const { tasks } = await readProjectAsync(projectDir);
    expect(tasks.get("tagged").tags).toEqual(["design", "frontend"]);
    expect(tasks.get("untagged").tags).toEqual([]);
  });

  it("reads a Quill body stored as fenced JSON", async () => {
    const projectDir = project(tmpDir);
    const delta = { ops: [{ insert: "Rich body\n", attributes: { bold: true } }] };
    task(projectDir, "quill", {
      frontmatter: ["format: quill"],
      body: "```json\n" + JSON.stringify(delta) + "\n```\n",
    });
    const loaded = (await readProjectAsync(projectDir)).tasks.get("quill");
    expect(loaded.format).toBe("quill");
    expect(loaded.body).toEqual(delta);
  });

  it("defers bodies on request and loads them later", async () => {
    const projectDir = project(tmpDir);
    task(projectDir, "lazy", { body: "Loaded later" });
    const summary = await readProjectAsync(projectDir, { includeMemoContent: false });
    const lazy = summary.tasks.get("lazy");
    expect(lazy.body).toBe("");
    expect(lazy.bodyLoaded).toBe(false);
    const [loaded] = await loadNodeBodiesAsync(projectDir, [lazy], summary.taskDirs);
    expect(loaded.body).toContain("Loaded later");
  });

  it("lists files in a task's attachments folder", async () => {
    const projectDir = project(tmpDir);
    task(projectDir, "files");
    writeFile(path.join(projectDir, "files", "attachments", "Spec.pdf"), "pdf");
    const { tasks } = await readProjectAsync(projectDir);
    expect(tasks.get("files").attachments.map((entry) => entry.relativePath)).toEqual([
      "./attachments/Spec.pdf",
    ]);
  });
});

describe("旧メモの取り込み（読み）", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-memo-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("旧メモはノードとして読まれ、書いてあったノードの子になる", async () => {
    const projectDir = project(tmpDir);
    writeFile(
      path.join(projectDir, "root-memo.md"),
      "---\nid: root-memo\ntitle: Root Notes\ntags:\n  - design\n---\n\nStored here\n"
    );
    const { tasks, legacyMemoFiles } = await readProjectAsync(projectDir);
    const promoted = tasks.get("root-memo");
    expect(promoted.name).toBe("Root Notes");
    expect(promoted.body).toContain("Stored here");
    expect(promoted.parents.map((parent) => parent.id)).toEqual(["root-id"]);
    expect(promoted.tags).toEqual(["design"]);
    // メモは進み具合を持たない。
    expect(promoted.status).toBeUndefined();
    expect(legacyMemoFiles.has("root-memo")).toBe(true);
  });

  it("旧メモは実ノードの子の後ろに、order の順で並ぶ", async () => {
    const projectDir = project(tmpDir);
    task(projectDir, "child");
    writeFile(path.join(projectDir, "z-memo.md"), "---\nid: z-memo\ntitle: First\norder: 0\n---\n");
    writeFile(
      path.join(projectDir, "a-memo.md"),
      "---\nid: a-memo\ntitle: Second\norder: 1\n---\n"
    );
    const { tasks } = await readProjectAsync(projectDir);
    const orderUnder = (id) => tasks.get(id).parents.find((p) => p.id === "root-id").order ?? -1;
    expect(orderUnder("z-memo")).toBeLessThan(orderUnder("a-memo"));
    expect(orderUnder("child")).toBeLessThan(orderUnder("z-memo"));
  });

  it("名前は title → 先頭の見出し → memo の順で決める", async () => {
    const projectDir = project(tmpDir);
    writeFile(path.join(projectDir, "titled.md"), "---\nid: titled\ntitle: Scratch\n---\n");
    writeFile(path.join(projectDir, "untitled.md"), "---\nid: untitled\n---\n");
    writeFile(path.join(projectDir, "old-memo.md"), "# Old Memo\n\nLegacy content");
    const { tasks } = await readProjectAsync(projectDir);
    expect(tasks.get("titled").name).toBe("Scratch");
    expect(tasks.get("untitled").name).toBe("memo");
    const headed = [...tasks.values()].find((node) => node.name === "Old Memo");
    expect(headed.id).toBeTruthy();
    expect(headed.body).toContain("Legacy content");
  });

  it("危険な id の旧メモは、id を振り直して取り込む", async () => {
    const projectDir = project(tmpDir);
    writeFile(path.join(projectDir, "evil.md"), "---\nid: ../../escape\ntitle: Evil\n---\n");
    const { tasks } = await readProjectAsync(projectDir);
    const evil = [...tasks.values()].find((node) => node.name === "Evil");
    expect(evil.id).not.toContain("/");
    expect(evil.id).not.toContain("..");
  });
});

describe("atomicWriteFile", () => {
  it("replaces files without leaving temp files", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));
    const filePath = path.join(tmpDir, "graph.json");
    await atomicWriteFile(filePath, "one", "utf8");
    await atomicWriteFile(filePath, "two", "utf8");
    expect(fs.readFileSync(filePath, "utf8")).toBe("two");
    expect(fs.readdirSync(tmpDir)).toEqual(["graph.json"]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
