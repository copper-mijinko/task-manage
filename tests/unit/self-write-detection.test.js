import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import graphStore from "../../electron/workspace-graph.js";

/**
 * 自分の書き込み（編集・元に戻す・やり直し）を、アプリの外での変更と取り違えないこと。
 * 保存の直前の照合は、最後に読んだ・書いたときのハッシュと比べる。元に戻す／やり直しも
 * 同じ書き込みの経路を通り、確定後にそのハッシュを更新する。
 */
const exec = (root, command, revision) =>
  graphStore.executeWorkspaceGraphCommand(root, command, "tree", revision);
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe("telling our own writes from external changes", () => {
  let root;
  const t1 = () => path.join(root, "alpha", "t1", "_index.md");
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-self-"));
    write(path.join(root, "_workspace.md"), "---\nid: ws\nname: WS\n---\n");
    write(path.join(root, "alpha", "_project.md"), "---\nid: proj\nname: Alpha\n---\n");
    for (const id of ["t1", "t2"])
      write(
        path.join(root, "alpha", id, "_index.md"),
        `---\nid: ${id}\nname: Task ${id}\nparents:\n  - id: proj\n    order: ${id === "t1" ? 0 : 1}\ncreated: 2026-01-02\n---\n\nbody of ${id}\n`
      );
  });
  afterEach(() => {
    graphStore.forgetWorkspace(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("never reports an external change across edits, undo and redo", async () => {
    let revision = (await graphStore.readWorkspaceGraph(root)).revision;
    const run = async (promise) => {
      const result = await promise;
      revision = result.delta.revision;
      return result;
    };
    const edit = (nodeId, changes) =>
      run(exec(root, { type: "update-node", nodeId, changes }, revision));
    const undo = () => run(graphStore.undoWorkspaceGraph(root, revision));
    const redo = () => run(graphStore.redoWorkspaceGraph(root, revision));

    await edit("t1", { name: "A" });
    await edit("t1", { body: "B" }); // 本文を読んでから書く
    await undo();
    await undo();
    await redo();
    await edit("t1", { name: "C" }); // 元に戻したあとの新しい編集（やり直しは捨てられる）
    await edit("t2", { name: "D" });
    await undo();
    await edit("t1", { body: "E" });
    await undo();
    await redo();
    await redo().catch(() => {}); // やり直す段が無いこともある
    expect(fs.readFileSync(t1(), "utf8")).toContain("name: C");
    expect(fs.readFileSync(t1(), "utf8")).toContain("E");
  });

  it("keeps working after deleting a node and undoing the deletion", async () => {
    let revision = (await graphStore.readWorkspaceGraph(root)).revision;
    const deleted = await exec(root, { type: "delete-node", nodeId: "t1" }, revision);
    const restored = await graphStore.undoWorkspaceGraph(root, deleted.delta.revision);
    const renamed = await exec(
      root,
      { type: "update-node", nodeId: "t1", changes: { name: "After restore" } },
      restored.delta.revision
    );
    expect(fs.readFileSync(t1(), "utf8")).toContain("name: After restore");
    await graphStore.undoWorkspaceGraph(root, renamed.delta.revision);
    expect(fs.readFileSync(t1(), "utf8")).toContain("name: Task t1");
  });

  it("still catches an external change made after an undo", async () => {
    const graph = await graphStore.readWorkspaceGraph(root);
    const edited = await exec(
      root,
      { type: "update-node", nodeId: "t1", changes: { name: "A" } },
      graph.revision
    );
    const undone = await graphStore.undoWorkspaceGraph(root, edited.delta.revision);
    fs.writeFileSync(t1(), fs.readFileSync(t1(), "utf8").replace("Task t1", "Edited outside"));
    await expect(
      exec(
        root,
        { type: "update-node", nodeId: "t1", changes: { name: "B" } },
        undone.delta.revision
      )
    ).rejects.toThrow(/アプリの外で変更/);
    expect(fs.readFileSync(t1(), "utf8")).toContain("Edited outside");
  });
});
