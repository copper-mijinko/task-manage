import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  gatherWorkspace,
  gatherWorkspaceSync,
  loadWorkspace,
  loadWorkspaceSync,
} from "../../electron/store/loader.js";

/**
 * ワークスペースのフォルダー（旧 Markdown 形式）を読む規則のテスト。
 *
 * フォルダーは人や生成 AI が置いたものでも、別の PC から写したものでも、旧バージョンが
 * 書いたものでもある。開けなくなるのではなく、読み込み時に直して開くこと。
 */
function write(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Array.isArray(lines) ? lines.join("\n") : lines);
}

function project(root, dir = "proj", { id = "root-id", name = "Proj", extra = [] } = {}) {
  const projectDir = path.join(root, dir);
  write(path.join(projectDir, "_project.md"), [
    "---",
    `id: ${id}`,
    `name: ${name}`,
    ...extra,
    "created: 2026-04-24",
    "---",
    "",
  ]);
  return projectDir;
}

function task(
  projectDir,
  id,
  { parents = "root-id", frontmatter = [], body = "", name = id } = {}
) {
  write(path.join(projectDir, id, "_index.md"), [
    "---",
    `id: ${id}`,
    `name: ${name}`,
    ...(parents === null ? [] : ["parents:", `  - id: ${parents}`]),
    ...frontmatter,
    "created: 2026-04-24",
    "---",
    body,
  ]);
}

/** ワークスペース自身（フォルダーに `_workspace.md` が無いと、読むたびに新しい id）を除いた id。 */
function ownIds(graph) {
  return Object.keys(graph.nodes)
    .filter((id) => id !== graph.rootId)
    .sort();
}

describe("loading a workspace folder", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "md-loader-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("puts a legacy project under a workspace root and keeps its order", async () => {
    project(root, "alpha", { id: "a", name: "Alpha", extra: ["order: 1"] });
    project(root, "beta", { id: "b", name: "Beta", extra: ["order: 0"] });
    const { graph, rootCreated, locations } = await loadWorkspace(root);
    expect(rootCreated).toBe(true);
    expect(graph.nodes[graph.rootId].parents).toEqual([]);
    expect(graph.nodes.a.parents).toEqual([{ id: graph.rootId, order: 1 }]);
    expect(graph.nodes.b.parents).toEqual([{ id: graph.rootId, order: 0 }]);
    expect(locations.get("a")).toEqual({ dir: "alpha", file: "_project.md" });
    expect(locations.get(graph.rootId)).toEqual({ dir: "", file: "_workspace.md" });
  });

  it("keeps the workspace id from _workspace.md", async () => {
    write(path.join(root, "_workspace.md"), "---\nid: workspace-fixed\nname: Mine\n---\nNotes\n");
    project(root);
    const { graph, rootCreated } = await loadWorkspace(root);
    expect(rootCreated).toBe(false);
    expect(graph.rootId).toBe("workspace-fixed");
    expect(graph.workspaceId).toBe("fixed");
    expect(graph.nodes["workspace-fixed"]).toMatchObject({ name: "Mine", body: "Notes" });
  });

  it("reads tasks with status, dates, tags, parents and a body", async () => {
    const dir = project(root);
    task(dir, "task-1", {
      frontmatter: [
        "status: In Progress",
        "start: 2026-05-20",
        "due: 2026-06-01",
        "tags:",
        "  - x",
      ],
      body: "# Notes\n\nSome content",
    });
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes["task-1"]).toMatchObject({
      name: "task-1",
      status: "In Progress",
      startDate: "2026-05-20",
      dueDate: "2026-06-01",
      tags: ["x"],
      parents: [{ id: "root-id", order: 0 }],
    });
    expect(graph.nodes["task-1"].body).toContain("Some content");
  });

  it("reads a missing status as no status, not Open", async () => {
    const dir = project(root);
    task(dir, "plain");
    task(dir, "tracked", { frontmatter: ["status: Undefined"] });
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes.plain.status).toBeUndefined();
    expect(graph.nodes.tracked.status).toBe("Undefined");
  });

  it("reads the older id-list parents with a node-level order", async () => {
    const dir = project(root);
    write(path.join(dir, "legacy", "_index.md"), [
      "---",
      "id: legacy",
      "name: Legacy",
      "parents:",
      "  - root-id",
      "order: 3",
      "---",
    ]);
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes.legacy.parents).toEqual([{ id: "root-id", order: 3 }]);
  });

  it("numbers the edges that have no order, after the ones that do", async () => {
    const dir = project(root);
    write(path.join(dir, "b", "_index.md"), "---\nid: b\nname: B\nparents:\n  - root-id\n---\n");
    write(path.join(dir, "a", "_index.md"), "---\nid: a\nname: A\nparents:\n  - root-id\n---\n");
    write(
      path.join(dir, "c", "_index.md"),
      "---\nid: c\nname: C\nparents:\n  - id: root-id\n    order: 5\n---\n"
    );
    const { graph } = await loadWorkspace(root);
    const order = (id) => graph.nodes[id].parents.find((link) => link.id === "root-id").order;
    expect(order("c")).toBe(5);
    expect(order("a")).toBe(6);
    expect(order("b")).toBe(7);
  });

  it("reads a Quill body stored as fenced JSON", async () => {
    const dir = project(root);
    const delta = { ops: [{ insert: "Rich body\n", attributes: { bold: true } }] };
    task(dir, "quill", {
      frontmatter: ["format: quill"],
      body: "```json\n" + JSON.stringify(delta) + "\n```\n",
    });
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes.quill.format).toBe("quill");
    expect(graph.nodes.quill.body).toEqual(delta);
  });

  it("lists the files in an attachments folder when the file has no list", async () => {
    const dir = project(root);
    task(dir, "files");
    write(path.join(dir, "files", "attachments", "Spec.pdf"), "pdf");
    const { graph, fileInfo } = await loadWorkspace(root);
    expect(graph.nodes.files.attachments).toEqual([
      {
        id: "./attachments/Spec.pdf",
        name: "Spec.pdf",
        relativePath: "./attachments/Spec.pdf",
        size: 3,
      },
    ]);
    expect(fileInfo.get("files").attachmentKey).toBe(true);
  });

  it("trusts the attachments list in the file over the folder", async () => {
    const dir = project(root);
    task(dir, "files", {
      frontmatter: ["attachments:", "  - name: Listed.pdf", "    path: ./attachments/Listed.pdf"],
    });
    write(path.join(dir, "files", "attachments", "Listed.pdf"), "pdf");
    write(path.join(dir, "files", "attachments", "Removed.pdf"), "pdf");
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes.files.attachments.map((entry) => entry.name)).toEqual(["Listed.pdf"]);
  });

  it("reads an empty attachments list as a list, not as a missing key", async () => {
    const dir = project(root);
    task(dir, "files", { frontmatter: ["attachments: []"] });
    write(path.join(dir, "files", "attachments", "Removed.pdf"), "pdf");
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes.files.attachments).toEqual([]);
  });

  it("keeps an edge that points into another project", async () => {
    const a = project(root, "alpha", { id: "a", name: "Alpha" });
    project(root, "beta", { id: "b", name: "Beta" });
    write(
      path.join(a, "shared", "_index.md"),
      "---\nid: shared\nname: Shared\nparents:\n  - id: a\n    order: 0\n  - id: b\n    order: 4\n---\n"
    );
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes.shared.parents).toEqual([
      { id: "a", order: 0 },
      { id: "b", order: 4 },
    ]);
  });

  it("puts a node whose parent is missing under its project root", async () => {
    const dir = project(root);
    task(dir, "lost", { parents: "gone" });
    task(dir, "rootless", { parents: null });
    const { graph, warnings } = await loadWorkspace(root);
    expect(graph.nodes.lost.parents).toEqual([{ id: "root-id", order: 0 }]);
    expect(graph.nodes.rootless.parents.map((link) => link.id)).toEqual(["root-id"]);
    expect(warnings.some((message) => message.includes("lost"))).toBe(true);
  });

  it("puts a project root with a missing parent under the workspace root", async () => {
    project(root, "proj", { id: "root-id", extra: ["parents:", "  - id: workspace-elsewhere"] });
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes["root-id"].parents.map((link) => link.id)).toEqual([graph.rootId]);
  });

  it("reaches a cycle that nothing else points to", async () => {
    const dir = project(root);
    write(path.join(dir, "x", "_index.md"), "---\nid: x\nname: X\nparents:\n  - y\n---\n");
    write(path.join(dir, "y", "_index.md"), "---\nid: y\nname: Y\nparents:\n  - x\n---\n");
    const { graph } = await loadWorkspace(root);
    const reachable = new Set();
    const children = (id) =>
      Object.values(graph.nodes).filter((node) => node.parents.some((link) => link.id === id));
    const visit = (id) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      children(id).forEach((child) => visit(child.id));
    };
    visit(graph.rootId);
    expect(reachable.size).toBe(Object.keys(graph.nodes).length);
  });

  it("skips a file without an id and says so", async () => {
    const dir = project(root);
    write(path.join(dir, "bad", "_index.md"), "---\nname: Missing id\n---\n");
    task(dir, "good");
    const { graph, warnings } = await loadWorkspace(root);
    expect(Object.keys(graph.nodes).sort()).toEqual([graph.rootId, "good", "root-id"].sort());
    expect(warnings.some((message) => message.includes("bad/_index.md"))).toBe(true);
  });

  it("does not open because of a wrong value in one file", async () => {
    const dir = project(root);
    task(dir, "odd", { frontmatter: ["status: Done", "due: someday"] });
    const { graph, warnings } = await loadWorkspace(root);
    expect(graph.nodes.odd.status).toBeUndefined();
    expect(graph.nodes.odd.dueDate).toBeUndefined();
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores hidden folders and the asset folders of the workspace itself", async () => {
    project(root);
    write(path.join(root, ".git", "_project.md"), "---\nid: git\nname: Git\n---\n");
    write(path.join(root, "assets", "_project.md"), "---\nid: assets\nname: Assets\n---\n");
    write(path.join(root, "docs", "readme.txt"), "not a project");
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes.git).toBeUndefined();
    expect(graph.nodes.assets).toBeUndefined();
  });

  it("finds the Inbox by its folder name or by kind: inbox", async () => {
    project(root, "_inbox", { id: "inbox-root", name: "Inbox" });
    task(path.join(root, "_inbox"), "idea", { parents: "inbox-root" });
    project(root, "other", { id: "other-root", name: "Other", extra: ["kind: inbox"] });
    const { graph } = await loadWorkspace(root);
    expect(graph.inboxId).toBe("inbox-root");
    const second = fs.mkdtempSync(path.join(os.tmpdir(), "md-loader-inbox-"));
    try {
      project(second, "plain", { id: "p", name: "Plain", extra: ["kind: inbox"] });
      expect((await loadWorkspace(second)).graph.inboxId).toBe("p");
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });

  it("loads the graph view positions, dropping the ones of nodes that are gone", async () => {
    project(root);
    write(
      path.join(root, ".task-manage", "layout.json"),
      JSON.stringify({ positions: { "root-id": { x: 1, y: 2 }, gone: { x: 3, y: 4 } } })
    );
    const { graph } = await loadWorkspace(root);
    expect(graph.positions).toEqual({ "root-id": { x: 1, y: 2 } });
  });

  it("reads the same graph synchronously and asynchronously", async () => {
    const dir = project(root);
    task(dir, "t1", { body: "body" });
    write(path.join(dir, "t1", "memo.md"), "---\nid: memo-1\ntitle: Memo\n---\nmemo body\n");
    write(path.join(dir, "t1", "attachments", "a.txt"), "a");
    const asyncRaw = await gatherWorkspace(root);
    expect(gatherWorkspaceSync(root)).toEqual(asyncRaw);
    const a = await loadWorkspace(root);
    const b = loadWorkspaceSync(root);
    expect(ownIds(b.graph)).toEqual(ownIds(a.graph));
  });

  it("fails clearly when the folder is missing", async () => {
    await expect(loadWorkspace(path.join(root, "missing"))).rejects.toThrow(/見つかりません/);
  });
});

describe("loading ids that collide", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "md-loader-dup-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // v0.40 のエクスポートはルート以外の id を引き継いだので、同じプロジェクトを
  // 2 回エクスポートすると、別のプロジェクトに同じ id のタスクが並ぶ。
  function twoProjectsSharingTaskIds() {
    const alpha = project(root, "alpha", { id: "project-a", name: "Alpha" });
    task(alpha, "task-a", { parents: "project-a", name: "Task A" });
    const beta = project(root, "beta", { id: "project-b", name: "Beta" });
    task(beta, "task-a", { parents: "project-b", name: "Beta Task A" });
    task(beta, "task-b", { parents: "task-a", name: "Beta Task B" });
  }

  it("renumbers the later copy and points its own references at the new id", async () => {
    twoProjectsSharingTaskIds();
    const { graph, dirtyIds } = await loadWorkspace(root);
    expect(graph.nodes["task-a"].name).toBe("Task A");
    const renamed = Object.values(graph.nodes).find((node) => node.name === "Beta Task A");
    expect(renamed.id).not.toBe("task-a");
    expect(renamed.parents).toEqual([{ id: "project-b", order: 0 }]);
    expect(graph.nodes["task-b"].parents).toEqual([{ id: renamed.id, order: 0 }]);
    // 直した 2 つは、読み込み時にファイルへ書き直す。
    expect([...dirtyIds].sort()).toEqual([renamed.id, "task-b"].sort());
  });

  it("gives the same new id every time, so nothing depends on when it was loaded", async () => {
    twoProjectsSharingTaskIds();
    const first = await loadWorkspace(root);
    const second = await loadWorkspace(root);
    expect(ownIds(second.graph)).toEqual(ownIds(first.graph));
  });

  it("renumbers a duplicate inside one project too", async () => {
    const dir = project(root);
    task(dir, "one", { name: "First" });
    write(
      path.join(dir, "two", "_index.md"),
      "---\nid: one\nname: Second\nparents:\n  - root-id\n---\n"
    );
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes.one.name).toBe("First");
    expect(Object.values(graph.nodes).filter((node) => node.name === "Second")).toHaveLength(1);
  });
});

describe("legacy memo files", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "md-loader-memo-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("are read as nodes under the node they were written in", async () => {
    const dir = project(root);
    write(
      path.join(dir, "root-memo.md"),
      "---\nid: root-memo\ntitle: Root Notes\ntags:\n  - design\n---\n\nStored here\n"
    );
    const { graph, locations } = await loadWorkspace(root);
    const promoted = graph.nodes["root-memo"];
    expect(promoted.name).toBe("Root Notes");
    expect(promoted.body).toContain("Stored here");
    expect(promoted.parents.map((link) => link.id)).toEqual(["root-id"]);
    expect(promoted.tags).toEqual(["design"]);
    // メモは進み具合を持たない。
    expect(promoted.status).toBeUndefined();
    expect(locations.get("root-memo")).toEqual({ dir: "proj", file: "root-memo.md", memo: true });
  });

  it("come after the real children, in their own order", async () => {
    const dir = project(root);
    task(dir, "child");
    write(path.join(dir, "z-memo.md"), "---\nid: z-memo\ntitle: First\norder: 0\n---\n");
    write(path.join(dir, "a-memo.md"), "---\nid: a-memo\ntitle: Second\norder: 1\n---\n");
    const { graph } = await loadWorkspace(root);
    const order = (id) => graph.nodes[id].parents.find((link) => link.id === "root-id").order;
    expect(order("child")).toBeLessThan(order("z-memo"));
    expect(order("z-memo")).toBeLessThan(order("a-memo"));
  });

  it("are named by title, then the first heading, then memo", async () => {
    const dir = project(root);
    write(path.join(dir, "titled.md"), "---\nid: titled\ntitle: Scratch\n---\n");
    write(path.join(dir, "untitled.md"), "---\nid: untitled\n---\n");
    write(path.join(dir, "old-memo.md"), "# Old Memo\n\nLegacy content");
    const { graph } = await loadWorkspace(root);
    expect(graph.nodes.titled.name).toBe("Scratch");
    expect(graph.nodes.untitled.name).toBe("memo");
    const headed = Object.values(graph.nodes).find((node) => node.name === "Old Memo");
    expect(headed.body).toContain("Legacy content");
  });

  it("get a safe id when the file names a dangerous one", async () => {
    const dir = project(root);
    write(path.join(dir, "evil.md"), "---\nid: ../../escape\ntitle: Evil\n---\n");
    const { graph } = await loadWorkspace(root);
    const evil = Object.values(graph.nodes).find((node) => node.name === "Evil");
    expect(evil.id).not.toContain("/");
    expect(evil.id).not.toContain("..");
  });

  it("keep both when two tasks hold a memo with the same id (a pasted copy)", async () => {
    const dir = project(root);
    task(dir, "task-a");
    task(dir, "task-c");
    write(
      path.join(dir, "task-a", "memo-x.md"),
      "---\nid: memo-x\ntitle: Shared memo\n---\nOriginal body\n"
    );
    write(
      path.join(dir, "task-c", "memo-x.md"),
      "---\nid: memo-x\ntitle: Shared memo\n---\nEdited after paste\n"
    );
    const { graph } = await loadWorkspace(root);
    const memos = Object.values(graph.nodes).filter((node) => node.name === "Shared memo");
    expect(memos).toHaveLength(2);
    expect(memos.map((memo) => memo.parents[0].id).sort()).toEqual(["task-a", "task-c"]);
    expect(memos.find((memo) => memo.parents[0].id === "task-c").body).toContain(
      "Edited after paste"
    );
    expect(new Set(memos.map((memo) => memo.id)).size).toBe(2);
  });

  it("are not taken from the workspace folder itself (a README there is not a node)", async () => {
    project(root);
    write(path.join(root, "README.md"), "# Notes about this folder\n");
    const { graph } = await loadWorkspace(root);
    expect(Object.values(graph.nodes).some((node) => node.name?.includes("Notes about"))).toBe(
      false
    );
  });
});
