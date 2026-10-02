import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import graphStore from "../../electron/workspace-graph.js";

/**
 * ワークスペースのグラフの保存（Markdown ファイル + 履歴）のテスト。
 *
 * 編集のたびに書くのは、変わったノードのファイルと履歴の 1 段だけ。
 */
function projectFixture(root) {
  const projectDir = path.join(root, "alpha");
  const taskDir = path.join(projectDir, "task-a");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "_project.md"),
    "---\nid: project-a\nname: Alpha\norder: 0\ncreated: 2026-01-01\n---\nProject body\n"
  );
  fs.writeFileSync(
    path.join(taskDir, "_index.md"),
    "---\nid: task-a\nname: Task A\nparents:\n  - id: project-a\n    order: 0\ncreated: 2026-01-02\n---\nTask body\n![legacy](./assets/legacy.png)\n[attachment](./attachments/note.txt)\n"
  );
  fs.mkdirSync(path.join(taskDir, "assets"));
  fs.writeFileSync(path.join(taskDir, "assets", "legacy.png"), "legacy-image");
  fs.mkdirSync(path.join(taskDir, "attachments"));
  fs.writeFileSync(path.join(taskDir, "attachments", "note.txt"), "attachment");
}

const read = (file) => fs.readFileSync(file, "utf8");
const exec = (root, command, revision, origin = "tree") =>
  graphStore.executeWorkspaceGraphCommand(root, command, origin, revision);

describe("workspace graph persistence", () => {
  let tempDir;
  let taskFile;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-graph-"));
    taskFile = path.join(tempDir, "alpha", "task-a", "_index.md");
  });
  afterEach(() => {
    graphStore.forgetWorkspace(tempDir);
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("opening", () => {
    it("opens a legacy folder and only adds the workspace file", async () => {
      projectFixture(tempDir);
      const before = read(taskFile);
      const first = await graphStore.readWorkspaceGraph(tempDir);
      expect(first.nodes["project-a"].parents[0].id).toBe(first.rootId);
      // 読み込みでは本文を読まない（`bodyLoaded: false`）。本文は、読む操作で取り出す。
      expect(first.nodes["task-a"].bodyLoaded).toBe(false);
      expect(first.nodes["task-a"].body).toBeUndefined();
      const { body } = await graphStore.readNodeBody(tempDir, "task-a");
      expect(body).toContain("Task body");
      // 画像への参照は、ノードのフォルダーからの相対のまま（書き換えない）。
      expect(body).toContain("./assets/legacy.png");
      expect(read(taskFile)).toBe(before);
      expect(fs.existsSync(path.join(tempDir, "_workspace.md"))).toBe(true);
      await expect(
        graphStore.resolveNodeAsset(tempDir, "task-a", "./assets/legacy.png")
      ).resolves.toMatch(/legacy\.png$/);

      graphStore.forgetWorkspace(tempDir);
      const second = await graphStore.readWorkspaceGraph(tempDir);
      expect(second.workspaceId).toBe(first.workspaceId);
      expect(second.rootId).toBe(first.rootId);
    });

    it("serializes first initialization and rejects stale revisions", async () => {
      projectFixture(tempDir);
      const [a, b] = await Promise.all([
        graphStore.readWorkspaceGraph(tempDir),
        graphStore.readWorkspaceGraph(tempDir),
      ]);
      expect(a.rootId).toBe(b.rootId);
      const command = { type: "create-node", parentId: a.rootId, node: { name: "One" } };
      const first = await exec(tempDir, command, 0, "graph");
      await expect(exec(tempDir, command, 0, "graph")).rejects.toThrow(/expected revision/);
      const disk = await graphStore.readWorkspaceGraph(tempDir);
      expect(disk.revision).toBe(first.graph.revision);
      expect(Object.values(disk.nodes).filter((node) => node.name === "One")).toHaveLength(1);
    });

    it("uses one queue for relative and absolute aliases of the same workspace", async () => {
      projectFixture(tempDir);
      const relative = path.relative(process.cwd(), tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const command = (name) => ({ type: "create-node", parentId: initial.rootId, node: { name } });
      const outcomes = await Promise.allSettled([
        exec(tempDir, command("Absolute"), initial.revision, "graph"),
        exec(relative, command("Relative"), initial.revision, "graph"),
      ]);
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
      const after = await graphStore.readWorkspaceGraph(tempDir);
      expect(after.revision).toBe(initial.revision + 1);
    });

    it("recognizes a workspace folder", async () => {
      expect(graphStore.isWorkspaceFolder(tempDir)).toBe(false);
      projectFixture(tempDir);
      await graphStore.readWorkspaceGraph(tempDir);
      expect(graphStore.isWorkspaceFolder(tempDir)).toBe(true);
    });
  });

  describe("writing", () => {
    it("writes only the file of the node that changed, plus one history step", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const projectFile = path.join(tempDir, "alpha", "_project.md");
      const projectBefore = read(projectFile);
      const result = await exec(
        tempDir,
        {
          type: "update-node",
          nodeId: "task-a",
          changes: { name: "Renamed: with colon" },
        },
        initial.revision
      );
      expect(read(taskFile)).toContain('name: "Renamed: with colon"');
      expect(read(taskFile)).toContain("Task body");
      expect(read(projectFile)).toBe(projectBefore);
      // 結果は、変わったノードだけの差分。
      expect(Object.keys(result.delta.nodes)).toEqual(["task-a"]);
      expect(result.delta.baseRevision).toBe(initial.revision);
      expect(result.delta.revision).toBe(initial.revision + 1);
      expect(result.delta.history).toEqual({ undo: 1, redo: 0 });
      expect(fs.readdirSync(path.join(tempDir, ".task-manage", "history", "undo"))).toEqual([
        "000000001.json",
      ]);
    });

    it("keeps the keys it does not know when it rewrites a file", async () => {
      projectFixture(tempDir);
      fs.writeFileSync(
        taskFile,
        "---\nid: task-a\nname: Task A\nparents:\n  - id: project-a\n    order: 0\nsummary: by an assistant\ncreated: 2026-01-02\n---\nTask body\n"
      );
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      await exec(
        tempDir,
        {
          type: "update-node",
          nodeId: "task-a",
          changes: { status: "Open" },
        },
        initial.revision
      );
      expect(read(taskFile)).toContain("summary: by an assistant");
      expect(read(taskFile)).toContain("status: Open");
    });

    it("preserves explicit Undefined separately from an omitted status", async () => {
      projectFixture(tempDir);
      let current = await graphStore.readWorkspaceGraph(tempDir);
      current = (
        await exec(
          tempDir,
          {
            type: "update-node",
            nodeId: "task-a",
            changes: { status: "Undefined" },
          },
          current.revision
        )
      ).graph;
      expect(read(taskFile)).toContain("status: Undefined");
      graphStore.forgetWorkspace(tempDir);
      expect((await graphStore.readWorkspaceGraph(tempDir)).nodes["task-a"].status).toBe(
        "Undefined"
      );
      current = await graphStore.readWorkspaceGraph(tempDir);
      const result = await exec(
        tempDir,
        {
          type: "update-node",
          nodeId: "task-a",
          changes: { status: undefined },
        },
        current.revision
      );
      expect(Object.prototype.hasOwnProperty.call(result.graph.nodes["task-a"], "status")).toBe(
        false
      );
      expect(read(taskFile)).not.toContain("status:");
    });

    it("puts a new node beside its parent and a new project in its own folder", async () => {
      projectFixture(tempDir);
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      const child = await exec(
        tempDir,
        {
          type: "create-node",
          parentId: "task-a",
          node: { name: "Child" },
        },
        graph.revision
      );
      const childId = child.selectedNodeIds[0];
      expect(fs.existsSync(path.join(tempDir, "alpha", childId, "_index.md"))).toBe(true);
      graph = child.graph;
      const created = await exec(
        tempDir,
        {
          type: "create-node",
          parentId: graph.rootId,
          node: { name: "New Project" },
        },
        graph.revision
      );
      const projectId = created.selectedNodeIds[0];
      expect(read(path.join(tempDir, "new-project", "_project.md"))).toContain(`id: ${projectId}`);
      // 名前を変えても、フォルダーは動かさない。
      await exec(
        tempDir,
        {
          type: "update-node",
          nodeId: projectId,
          changes: { name: "Renamed project" },
        },
        created.graph.revision
      );
      expect(read(path.join(tempDir, "new-project", "_project.md"))).toContain(
        "name: Renamed project"
      );
      graphStore.forgetWorkspace(tempDir);
      const reopened = await graphStore.readWorkspaceGraph(tempDir);
      expect(reopened.nodes[projectId].name).toBe("Renamed project");
      expect(reopened.nodes[childId].parents).toEqual([{ id: "task-a", order: 0 }]);
    });

    it("keeps a node that belongs to several parents, each with its own order", async () => {
      projectFixture(tempDir);
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      graph = (
        await exec(
          tempDir,
          { type: "create-node", parentId: graph.rootId, node: { name: "Beta" } },
          graph.revision
        )
      ).graph;
      const beta = Object.values(graph.nodes).find((node) => node.name === "Beta");
      graph = (
        await exec(
          tempDir,
          { type: "link", childId: "task-a", parentId: beta.id, order: 7 },
          graph.revision
        )
      ).graph;
      graph = (
        await exec(
          tempDir,
          {
            type: "archive-edge",
            childId: "task-a",
            parentId: "project-a",
            archived: true,
          },
          graph.revision
        )
      ).graph;
      graphStore.forgetWorkspace(tempDir);
      const reopened = await graphStore.readWorkspaceGraph(tempDir);
      expect(reopened.nodes["task-a"].parents).toEqual([
        expect.objectContaining({ id: "project-a", order: 0, archived: true }),
        { id: beta.id, order: 7 },
      ]);
    });

    it("keeps the Inbox mark and the graph view positions across restarts", async () => {
      projectFixture(tempDir);
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      graph = (
        await exec(
          tempDir,
          { type: "create-node", parentId: graph.rootId, node: { name: "Inbox" } },
          graph.revision
        )
      ).graph;
      const inbox = Object.values(graph.nodes).find((node) => node.name === "Inbox");
      // 次の操作で Inbox が見つかり、その指定がファイルに残る。
      graph = (
        await exec(
          tempDir,
          { type: "set-position", nodeId: "task-a", x: 10, y: 20 },
          graph.revision,
          "graph"
        )
      ).graph;
      expect(graph.inboxId).toBe(inbox.id);
      graphStore.forgetWorkspace(tempDir);
      const reopened = await graphStore.readWorkspaceGraph(tempDir);
      expect(reopened.inboxId).toBe(inbox.id);
      expect(reopened.positions).toEqual({ "task-a": { x: 10, y: 20 } });
    });
  });

  describe("undo and redo", () => {
    it("persists undo and redo across restarts", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const changed = await exec(
        tempDir,
        {
          type: "update-node",
          nodeId: "task-a",
          changes: { name: "Changed" },
        },
        initial.revision,
        "graph"
      );
      const undone = await graphStore.undoWorkspaceGraph(tempDir, changed.graph.revision);
      expect(undone.graph.nodes["task-a"].name).toBe("Task A");
      expect(read(taskFile)).toContain("name: Task A");
      expect(undone.delta.nodes["task-a"].name).toBe("Task A");

      graphStore.forgetWorkspace(tempDir);
      const reopened = await graphStore.readWorkspaceGraph(tempDir);
      expect(reopened.history).toEqual({ undo: 0, redo: 1 });
      const redone = await graphStore.redoWorkspaceGraph(tempDir, reopened.revision);
      expect(redone.graph.nodes["task-a"].name).toBe("Changed");
      expect(read(taskFile)).toContain("name: Changed");
    });

    it("redoes in the order the steps were undone, even after a restart", async () => {
      projectFixture(tempDir);
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      for (const name of ["One", "Two", "Three"]) {
        graph = (
          await exec(
            tempDir,
            {
              type: "update-node",
              nodeId: "task-a",
              changes: { name },
            },
            graph.revision
          )
        ).graph;
      }
      for (let index = 0; index < 3; index += 1)
        graph = (await graphStore.undoWorkspaceGraph(tempDir, graph.revision)).graph;
      expect(graph.nodes["task-a"].name).toBe("Task A");
      graphStore.forgetWorkspace(tempDir);
      graph = await graphStore.readWorkspaceGraph(tempDir);
      const seen = [];
      for (let index = 0; index < 3; index += 1) {
        graph = (await graphStore.redoWorkspaceGraph(tempDir, graph.revision)).graph;
        seen.push(graph.nodes["task-a"].name);
      }
      expect(seen).toEqual(["One", "Two", "Three"]);
      expect((await graphStore.redoWorkspaceGraph(tempDir, graph.revision)).changed).toBe(false);
    });

    it("keeps only the changed nodes in each history step", async () => {
      projectFixture(tempDir);
      const bigDir = path.join(tempDir, "alpha", "big-task");
      fs.mkdirSync(bigDir);
      fs.writeFileSync(
        path.join(bigDir, "_index.md"),
        `---\nid: big-task\nname: Big\nparents:\n  - id: project-a\n    order: 1\n---\n${"x".repeat(200_000)}\n`
      );
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      for (let index = 0; index < 20; index += 1) {
        graph = (
          await exec(
            tempDir,
            {
              type: "update-node",
              nodeId: "task-a",
              changes: { name: `Rename ${index}` },
            },
            graph.revision
          )
        ).graph;
      }
      const steps = fs.readdirSync(path.join(tempDir, ".task-manage", "history", "undo"));
      expect(steps).toHaveLength(20);
      for (const name of steps) {
        const file = path.join(tempDir, ".task-manage", "history", "undo", name);
        // 1 段は、名前を変えたノード 1 つぶんだけ（200KB の本文は入らない）。
        expect(fs.statSync(file).size).toBeLessThan(2000);
        expect(Object.keys(JSON.parse(read(file)).patch.nodes)).toEqual(["task-a"]);
      }
      const undone = await graphStore.undoWorkspaceGraph(tempDir, graph.revision);
      expect(undone.graph.nodes["task-a"].name).toBe("Rename 18");
      expect(undone.graph.revision).toBe(graph.revision + 1);
      expect((await graphStore.readNodeBody(tempDir, "big-task")).body).toHaveLength(200_000);
    });

    it("drops the oldest steps beyond the limit", async () => {
      projectFixture(tempDir);
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      for (let index = 0; index < 55; index += 1) {
        graph = (
          await exec(
            tempDir,
            {
              type: "update-node",
              nodeId: "task-a",
              changes: { name: `Rename ${index}` },
            },
            graph.revision
          )
        ).graph;
      }
      expect(graph.history.undo).toBe(50);
      expect(fs.readdirSync(path.join(tempDir, ".task-manage", "history", "undo"))).toHaveLength(
        50
      );
    });

    it("drops the redo steps when a new operation is made", async () => {
      projectFixture(tempDir);
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      graph = (
        await exec(
          tempDir,
          { type: "update-node", nodeId: "task-a", changes: { name: "One" } },
          graph.revision
        )
      ).graph;
      graph = (await graphStore.undoWorkspaceGraph(tempDir, graph.revision)).graph;
      expect(graph.history).toEqual({ undo: 0, redo: 1 });
      graph = (
        await exec(
          tempDir,
          { type: "update-node", nodeId: "task-a", changes: { name: "Two" } },
          graph.revision
        )
      ).graph;
      expect(graph.history).toEqual({ undo: 1, redo: 0 });
      expect(fs.readdirSync(path.join(tempDir, ".task-manage", "history", "redo"))).toEqual([]);
    });
  });

  describe("deleting and the trash", () => {
    it("brings a deleted node back with its images and attachments", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const deleted = await exec(
        tempDir,
        { type: "delete-node", nodeId: "task-a" },
        initial.revision
      );
      expect(fs.existsSync(path.join(tempDir, "alpha", "task-a"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, ".task-manage", "trash"))).toBe(true);
      expect(deleted.delta.nodes["task-a"]).toBeNull();

      // 再起動しても、戻すと画像も添付も戻る。
      graphStore.forgetWorkspace(tempDir);
      const reopened = await graphStore.readWorkspaceGraph(tempDir);
      const undone = await graphStore.undoWorkspaceGraph(tempDir, reopened.revision);
      expect(undone.graph.nodes["task-a"].name).toBe("Task A");
      expect(read(path.join(tempDir, "alpha", "task-a", "attachments", "note.txt"))).toBe(
        "attachment"
      );
      await expect(
        graphStore.resolveNodeAsset(tempDir, "task-a", "./assets/legacy.png")
      ).resolves.toMatch(/legacy\.png$/);
      expect(read(taskFile)).toContain("Task body");
    });

    it("removes a node created by a step when that step is undone, and restores it on redo", async () => {
      projectFixture(tempDir);
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      const created = await exec(
        tempDir,
        {
          type: "create-node",
          parentId: "project-a",
          node: { name: "Made" },
        },
        graph.revision
      );
      const id = created.selectedNodeIds[0];
      const saved = await graphStore.saveNodeAsset(tempDir, id, "spec.pdf", Buffer.from("pdf"));
      expect(saved.relativePath).toBe("./attachments/spec.pdf");
      graph = created.graph;
      const undone = await graphStore.undoWorkspaceGraph(tempDir, graph.revision);
      expect(undone.graph.nodes[id]).toBeUndefined();
      expect(fs.existsSync(path.join(tempDir, "alpha", id))).toBe(false);
      const redone = await graphStore.redoWorkspaceGraph(tempDir, undone.graph.revision);
      expect(redone.graph.nodes[id].name).toBe("Made");
      expect(read(path.join(tempDir, "alpha", id, "attachments", "spec.pdf"))).toBe("pdf");
    });

    it("deletes a project's own files without touching the nodes it held", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const result = await exec(
        tempDir,
        { type: "delete-node", nodeId: "project-a" },
        initial.revision
      );
      expect(fs.existsSync(path.join(tempDir, "alpha", "_project.md"))).toBe(false);
      expect(fs.existsSync(taskFile)).toBe(true);
      // 親を失った子は、ワークスペース直下へ（プロジェクトになる）。
      expect(result.graph.nodes["task-a"].parents.map((link) => link.id)).toEqual([
        result.graph.rootId,
      ]);
      graphStore.forgetWorkspace(tempDir);
      const reopened = await graphStore.readWorkspaceGraph(tempDir);
      expect(reopened.nodes["task-a"].parents.map((link) => link.id)).toEqual([reopened.rootId]);
      expect(reopened.nodes["project-a"]).toBeUndefined();
      const undone = await graphStore.undoWorkspaceGraph(tempDir, reopened.revision);
      expect(undone.graph.nodes["project-a"].name).toBe("Alpha");
      expect(undone.graph.nodes["task-a"].parents).toEqual([{ id: "project-a", order: 0 }]);
    });
  });

  describe("legacy memo files", () => {
    it("keep their images and do not come back twice when the node they were written in is deleted", async () => {
      projectFixture(tempDir);
      fs.writeFileSync(
        path.join(tempDir, "alpha", "task-a", "memo-x.md"),
        "---\nid: memo-x\ntitle: A memo\n---\nmemo ![i](./assets/legacy.png)\n"
      );
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const deleted = await exec(
        tempDir,
        { type: "delete-node", nodeId: "task-a" },
        initial.revision
      );
      // メモは親を失うのでワークスペース直下に付け直され、自分のフォルダーへ移る。
      expect(deleted.graph.nodes["memo-x"].parents.map((link) => link.id)).toEqual([
        deleted.graph.rootId,
      ]);
      const moved = path.join(tempDir, "alpha", "memo-x");
      expect(read(path.join(moved, "assets", "legacy.png"))).toBe("legacy-image");
      expect(fs.existsSync(path.join(tempDir, "alpha", "task-a"))).toBe(false);

      graphStore.forgetWorkspace(tempDir);
      const reopened = await graphStore.readWorkspaceGraph(tempDir);
      expect((await graphStore.readNodeBody(tempDir, "memo-x")).body).toContain(
        "./assets/legacy.png"
      );
      const undone = await graphStore.undoWorkspaceGraph(tempDir, reopened.revision);
      expect(undone.graph.nodes["task-a"].name).toBe("Task A");
      expect(undone.graph.nodes["memo-x"].parents.map((link) => link.id)).toEqual(["task-a"]);
      // 戻したフォルダーに古いメモのファイルは無いので、もう一度開いても 1 つだけ。
      expect(fs.existsSync(path.join(tempDir, "alpha", "task-a", "memo-x.md"))).toBe(false);
      graphStore.forgetWorkspace(tempDir);
      const again = await graphStore.readWorkspaceGraph(tempDir);
      expect(Object.values(again.nodes).filter((node) => node.name === "A memo")).toHaveLength(1);
    });
  });

  describe("a corrupt history step", () => {
    it("is dropped with a message instead of failing every time", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const changed = await exec(
        tempDir,
        { type: "update-node", nodeId: "task-a", changes: { name: "Changed" } },
        initial.revision
      );
      fs.writeFileSync(
        path.join(tempDir, ".task-manage", "history", "undo", "000000001.json"),
        "{ not json"
      );
      await expect(graphStore.undoWorkspaceGraph(tempDir, changed.graph.revision)).rejects.toThrow(
        /履歴の 1 段を読めなかった/
      );
      const after = await graphStore.readWorkspaceGraph(tempDir);
      expect(after.history).toEqual({ undo: 0, redo: 0 });
      expect((await graphStore.undoWorkspaceGraph(tempDir, after.revision)).changed).toBe(false);
    });
  });

  describe("copying", () => {
    it("copies the node's images and attachments, and they stay after the source is deleted", async () => {
      projectFixture(tempDir);
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      const copied = await exec(
        tempDir,
        {
          type: "copy",
          nodeId: "task-a",
          targetParentId: "project-a",
          mode: "node",
        },
        graph.revision
      );
      const copyId = copied.selectedNodeIds[0];
      expect(copyId).not.toBe("task-a");
      expect(read(path.join(tempDir, "alpha", copyId, "attachments", "note.txt"))).toBe(
        "attachment"
      );
      graph = copied.graph;
      const deleted = await exec(
        tempDir,
        { type: "delete-node", nodeId: "task-a" },
        graph.revision
      );
      await expect(
        graphStore.resolveNodeAsset(tempDir, copyId, "./assets/legacy.png")
      ).resolves.toMatch(/legacy\.png$/);
      await expect(graphStore.resolveNodeAsset(tempDir, copyId, "../outside.txt")).rejects.toThrow(
        /escapes/
      );
      expect(deleted.graph.nodes[copyId].body).toContain("./assets/legacy.png");
    });
  });

  describe("images and attachments", () => {
    it("saves images under assets and attachments under attachments, with unique names", async () => {
      projectFixture(tempDir);
      await graphStore.readWorkspaceGraph(tempDir);
      const image = await graphStore.saveNodeAsset(
        tempDir,
        "task-a",
        "pasted-image.png",
        Buffer.from("png"),
        "image"
      );
      expect(image.relativePath).toMatch(/^\.\/assets\/pasted-\d+-[0-9a-f]{8}\.png$/);
      const one = await graphStore.saveNodeAsset(tempDir, "task-a", "note.txt", Buffer.from("a"));
      const two = await graphStore.saveNodeAsset(tempDir, "task-a", "note.txt", Buffer.from("b"));
      // 読みやすいよう、元のファイル名を残す（`note.txt` はすでにあるので `-2`、`-3`）。
      expect([one.relativePath, two.relativePath]).toEqual([
        "./attachments/note-2.txt",
        "./attachments/note-3.txt",
      ]);
      await expect(
        graphStore.resolveNodeAsset(tempDir, "task-a", two.relativePath)
      ).resolves.toMatch(/note-3\.txt$/);
    });

    it("refuses to read outside the node's folder", async () => {
      projectFixture(tempDir);
      await graphStore.readWorkspaceGraph(tempDir);
      for (const bad of ["../_index.md", "assets/../_index.md", "_index.md", "/etc/passwd"]) {
        await expect(graphStore.resolveNodeAsset(tempDir, "task-a", bad)).rejects.toThrow();
      }
      await expect(
        graphStore.saveNodeAsset(tempDir, "missing", "a.txt", Buffer.from("a"))
      ).rejects.toThrow(/Unknown node/);
    });

    it("does not bring removed attachments back from the folder", async () => {
      projectFixture(tempDir);
      let graph = await graphStore.readWorkspaceGraph(tempDir);
      expect(graph.nodes["task-a"].attachments.map((entry) => entry.name)).toEqual(["note.txt"]);
      graph = (
        await exec(
          tempDir,
          {
            type: "update-node",
            nodeId: "task-a",
            changes: { attachments: [] },
          },
          graph.revision
        )
      ).graph;
      expect(read(taskFile)).toContain("attachments: []");
      graphStore.forgetWorkspace(tempDir);
      expect((await graphStore.readWorkspaceGraph(tempDir)).nodes["task-a"].attachments).toEqual(
        []
      );
      // ファイルは消さない（元に戻すで、添付を戻せる）。
      expect(fs.existsSync(path.join(tempDir, "alpha", "task-a", "attachments", "note.txt"))).toBe(
        true
      );
    });

    it("moves a legacy memo file into its own folder when the node is saved", async () => {
      projectFixture(tempDir);
      const memoFile = path.join(tempDir, "alpha", "task-a", "memo-x.md");
      fs.writeFileSync(
        memoFile,
        "---\nid: memo-x\ntitle: A memo\n---\nmemo ![i](./assets/legacy.png)\n"
      );
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      expect(initial.nodes["memo-x"].name).toBe("A memo");
      await exec(
        tempDir,
        {
          type: "update-node",
          nodeId: "memo-x",
          changes: { name: "Renamed memo" },
        },
        initial.revision
      );
      const moved = path.join(tempDir, "alpha", "memo-x");
      expect(read(path.join(moved, "_index.md"))).toContain("name: Renamed memo");
      // 参照していた画像は、新しいフォルダーへ写る。元のメモのファイルは消える。
      expect(read(path.join(moved, "assets", "legacy.png"))).toBe("legacy-image");
      expect(fs.existsSync(memoFile)).toBe(false);
      graphStore.forgetWorkspace(tempDir);
      const reopened = await graphStore.readWorkspaceGraph(tempDir);
      expect(reopened.nodes["memo-x"].name).toBe("Renamed memo");
      expect(reopened.nodes["memo-x"].parents[0].id).toBe("task-a");
    });
  });

  describe("failures", () => {
    it("does not change the graph, the files or the history when a write fails", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const before = read(taskFile);
      vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("disk unavailable"));
      await expect(
        exec(
          tempDir,
          {
            type: "update-node",
            nodeId: "task-a",
            changes: { name: "Must not persist" },
          },
          initial.revision,
          "graph"
        )
      ).rejects.toThrow(/disk unavailable/);
      vi.restoreAllMocks();
      const after = await graphStore.readWorkspaceGraph(tempDir);
      expect(after.revision).toBe(initial.revision);
      expect(after.nodes["task-a"].name).toBe("Task A");
      expect(read(taskFile)).toBe(before);
      expect((await graphStore.undoWorkspaceGraph(tempDir, after.revision)).changed).toBe(false);
      expect(fs.existsSync(path.join(tempDir, ".task-manage", "history", "undo"))).toBe(false);
    });

    it("puts back the files it already wrote when a later write of the same operation fails", async () => {
      projectFixture(tempDir);
      const projectFile = path.join(tempDir, "alpha", "_project.md");
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const before = [read(taskFile), read(projectFile)];
      const original = fs.promises.rename.bind(fs.promises);
      let calls = 0;
      vi.spyOn(fs.promises, "rename").mockImplementation((...args) => {
        calls += 1;
        return calls === 2 ? Promise.reject(new Error("disk unavailable")) : original(...args);
      });
      await expect(
        exec(
          tempDir,
          {
            type: "batch",
            commands: [
              { type: "update-node", nodeId: "task-a", changes: { name: "X" } },
              { type: "update-node", nodeId: "project-a", changes: { name: "Y" } },
            ],
          },
          initial.revision
        )
      ).rejects.toThrow(/disk unavailable/);
      vi.restoreAllMocks();
      expect([read(taskFile), read(projectFile)]).toEqual(before);
      const after = await graphStore.readWorkspaceGraph(tempDir);
      expect(after.revision).toBe(initial.revision);
      expect(after.nodes["task-a"].name).toBe("Task A");
    });

    it("retries a transient Windows rename lock without duplicating history", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(
        Object.assign(new Error("locked"), { code: "EPERM" })
      );
      const result = await exec(
        tempDir,
        {
          type: "update-node",
          nodeId: "task-a",
          changes: { name: "Saved after retry" },
        },
        initial.revision
      );
      vi.restoreAllMocks();
      expect(result.graph.revision).toBe(initial.revision + 1);
      const undo = await graphStore.undoWorkspaceGraph(tempDir, result.graph.revision);
      expect(undo.graph.nodes["task-a"].name).toBe("Task A");
      expect((await graphStore.undoWorkspaceGraph(tempDir, undo.graph.revision)).changed).toBe(
        false
      );
      const redo = await graphStore.redoWorkspaceGraph(tempDir, undo.graph.revision);
      expect(redo.graph.nodes["task-a"].name).toBe("Saved after retry");
    });
  });

  describe("files changed outside the app", () => {
    it("refuses to overwrite a file that was edited elsewhere, until the workspace is reloaded", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      fs.writeFileSync(
        taskFile,
        "---\nid: task-a\nname: Edited by an assistant\nparents:\n  - id: project-a\n    order: 0\ncreated: 2026-01-02\n---\nTask body\n"
      );
      await expect(
        exec(
          tempDir,
          { type: "update-node", nodeId: "task-a", changes: { status: "Open" } },
          initial.revision
        )
      ).rejects.toThrow(/アプリの外で変更/);
      expect(read(taskFile)).toContain("Edited by an assistant");
      // 読み直すと外の変更が見え、リビジョンは戻らない。
      const reloaded = await graphStore.reloadWorkspaceGraph(tempDir);
      expect(reloaded.nodes["task-a"].name).toBe("Edited by an assistant");
      expect(reloaded.revision).toBeGreaterThan(initial.revision);
      const result = await exec(
        tempDir,
        {
          type: "update-node",
          nodeId: "task-a",
          changes: { status: "Open" },
        },
        reloaded.revision
      );
      expect(read(taskFile)).toContain("name: Edited by an assistant");
      expect(read(taskFile)).toContain("status: Open");
      expect(result.graph.revision).toBe(reloaded.revision + 1);
    });

    it("does not mind a file that was only touched", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      const later = new Date(Date.now() + 5000);
      fs.utimesSync(taskFile, later, later);
      await expect(
        exec(
          tempDir,
          { type: "update-node", nodeId: "task-a", changes: { status: "Open" } },
          initial.revision
        )
      ).resolves.toBeTruthy();
    });

    it("keeps the history across a reload", async () => {
      projectFixture(tempDir);
      const initial = await graphStore.readWorkspaceGraph(tempDir);
      await exec(
        tempDir,
        { type: "update-node", nodeId: "task-a", changes: { name: "One" } },
        initial.revision
      );
      const reloaded = await graphStore.reloadWorkspaceGraph(tempDir);
      expect(reloaded.history).toEqual({ undo: 1, redo: 0 });
      const undone = await graphStore.undoWorkspaceGraph(tempDir, reloaded.revision);
      expect(undone.graph.nodes["task-a"].name).toBe("Task A");
    });
  });

  it("reports whether writes are pending", async () => {
    projectFixture(tempDir);
    expect(graphStore.hasPendingWrites()).toBe(false);
    const pending = graphStore.readWorkspaceGraph(tempDir);
    expect(graphStore.hasPendingWrites()).toBe(true);
    await graphStore.whenIdle();
    await pending;
    expect(graphStore.hasPendingWrites()).toBe(false);
  });
});
