import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import graphStore from "../../electron/workspace-graph.js";

function markdownProject(root, dirName, id, name) {
  const projectDir = path.join(root, dirName);
  const taskDir = path.join(projectDir, "task");
  fs.mkdirSync(path.join(taskDir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "_project.md"),
    `---\nid: ${id}\nname: ${name}\norder: 0\ncreatedAt: 2026-01-01\n---\n`
  );
  fs.writeFileSync(
    path.join(taskDir, "_index.md"),
    `---\nid: ${id}-task\nname: ${name} task\nparents:\n  - id: ${id}\n    order: 0\ncreatedAt: 2026-01-02\n---\n![img](./assets/a.png)\n`
  );
  fs.writeFileSync(path.join(taskDir, "assets", "a.png"), "image");
}

describe("importMarkdownProjects", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-import-"));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("imports a Markdown project added after the graph was created", async () => {
    markdownProject(tempDir, "alpha", "alpha", "Alpha");
    const initial = await graphStore.readWorkspaceGraph(tempDir);
    expect(initial.nodes.alpha).toBeDefined();

    markdownProject(tempDir, "beta", "beta", "Beta");
    expect(await graphStore.listMarkdownImportSources(tempDir)).toEqual([
      { dirName: "alpha", name: "Alpha", imported: true },
      { dirName: "beta", name: "Beta", imported: false },
    ]);

    const result = await graphStore.importMarkdownProjects(tempDir, ["beta"], initial.revision);
    expect(result.selectedNodeIds).toEqual(["beta"]);
    expect(result.graph.nodes.beta.parents).toEqual([{ id: initial.rootId, order: 1 }]);
    expect(result.graph.nodes["beta-task"].body).toContain("assets/beta-task/assets/a.png");
    expect(
      fs.existsSync(path.join(tempDir, ".task-manage", "assets", "beta-task", "assets", "a.png"))
    ).toBe(true);
    expect((await graphStore.listMarkdownImportSources(tempDir))[1].imported).toBe(true);
  });

  it("is one undoable step", async () => {
    const initial = await graphStore.readWorkspaceGraph(tempDir);
    markdownProject(tempDir, "beta", "beta", "Beta");
    const result = await graphStore.importMarkdownProjects(tempDir, ["beta"], initial.revision);
    const undone = await graphStore.undoWorkspaceGraph(tempDir, result.graph.revision);
    expect(undone.graph.nodes.beta).toBeUndefined();
    expect(undone.graph.nodes["beta-task"]).toBeUndefined();
  });

  it("gives a re-imported project fresh ids instead of overwriting", async () => {
    markdownProject(tempDir, "alpha", "alpha", "Alpha");
    const initial = await graphStore.readWorkspaceGraph(tempDir);
    const result = await graphStore.importMarkdownProjects(tempDir, ["alpha"], initial.revision);
    const [rootId] = result.selectedNodeIds;
    expect(rootId).not.toBe("alpha");
    expect(result.graph.nodes.alpha.name).toBe("Alpha");
    expect(result.graph.nodes[rootId].name).toBe("Alpha");
  });

  it("rejects an empty or unknown selection", async () => {
    const initial = await graphStore.readWorkspaceGraph(tempDir);
    await expect(
      graphStore.importMarkdownProjects(tempDir, [], initial.revision)
    ).rejects.toThrow();
    await expect(
      graphStore.importMarkdownProjects(tempDir, ["missing"], initial.revision)
    ).rejects.toThrow(/not found/);
  });
});
