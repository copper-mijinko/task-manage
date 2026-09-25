import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import graphStore from "../../electron/workspace-graph.js";

function projectFixture(root) {
  const projectDir = path.join(root, "alpha");
  const taskDir = path.join(projectDir, "task-a");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "_project.md"),
    "---\nid: project-a\nname: Alpha\norder: 0\ncreatedAt: 2026-01-01\n---\nProject body\n"
  );
  fs.writeFileSync(
    path.join(taskDir, "_index.md"),
    "---\nid: task-a\nname: Task A\nparents:\n  - id: project-a\n    order: 0\ncreatedAt: 2026-01-02\n---\nTask body\n![legacy](./assets/legacy.png)\n![dotless](assets/legacy.png)\n[attachment](./attachments/note.txt)\n"
  );
  fs.mkdirSync(path.join(taskDir, "assets"));
  fs.writeFileSync(path.join(taskDir, "assets", "legacy.png"), "legacy-image");
  fs.mkdirSync(path.join(taskDir, "attachments"));
  fs.writeFileSync(path.join(taskDir, "attachments", "note.txt"), "attachment");
}

describe("workspace graph persistence", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-graph-"));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("imports legacy Markdown once and preserves bodies", async () => {
    projectFixture(tempDir);
    const first = await graphStore.readWorkspaceGraph(tempDir);
    expect(first.nodes["project-a"].parents[0].id).toBe(first.rootId);
    expect(first.nodes["task-a"].body).toContain("Task body");
    expect(first.nodes["task-a"].body).toContain("assets/task-a/assets/legacy.png");
    expect(first.nodes["task-a"].body.match(/assets\/task-a\/assets\/legacy\.png/g)).toHaveLength(
      2
    );
    expect(first.nodes["task-a"].body).toContain("assets/task-a/attachments/note.txt");
    expect(first.nodes["task-a"].sourceProjectDir).toBeUndefined();
    await expect(
      graphStore.resolveNodeAsset(tempDir, "task-a", "assets/task-a/assets/legacy.png")
    ).resolves.toMatch(/legacy\.png$/);
    fs.writeFileSync(path.join(tempDir, "alpha", "task-a", "_index.md"), "broken after activation");
    const second = await graphStore.readWorkspaceGraph(tempDir);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(second.nodes["task-a"].name).toBe("Task A");
  });

  it("serializes first initialization and rejects stale revisions", async () => {
    projectFixture(tempDir);
    const [a, b] = await Promise.all([
      graphStore.readWorkspaceGraph(tempDir),
      graphStore.readWorkspaceGraph(tempDir),
    ]);
    expect(a.rootId).toBe(b.rootId);
    const command = { type: "create-node", parentId: a.rootId, node: { name: "One" } };
    const first = await graphStore.executeWorkspaceGraphCommand(tempDir, command, "graph", 0);
    await expect(
      graphStore.executeWorkspaceGraphCommand(tempDir, command, "graph", 0)
    ).rejects.toThrow(/expected revision/);
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
      graphStore.executeWorkspaceGraphCommand(
        tempDir,
        command("Absolute"),
        "graph",
        initial.revision
      ),
      graphStore.executeWorkspaceGraphCommand(
        relative,
        command("Relative"),
        "graph",
        initial.revision
      ),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const after = await graphStore.readWorkspaceGraph(tempDir);
    expect(after.revision).toBe(initial.revision + 1);
    expect(
      Object.values(after.nodes).filter(
        (node) => node.name === "Absolute" || node.name === "Relative"
      )
    ).toHaveLength(1);
  });

  it("persists undo and redo across module reads", async () => {
    projectFixture(tempDir);
    const initial = await graphStore.readWorkspaceGraph(tempDir);
    const changed = await graphStore.executeWorkspaceGraphCommand(
      tempDir,
      { type: "update-node", nodeId: "task-a", changes: { name: "Changed" } },
      "graph",
      initial.revision
    );
    const undone = await graphStore.undoWorkspaceGraph(tempDir, changed.graph.revision);
    expect(undone.graph.nodes["task-a"].name).toBe("Task A");
    const redone = await graphStore.redoWorkspaceGraph(tempDir, undone.graph.revision);
    expect(redone.graph.nodes["task-a"].name).toBe("Changed");
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
    const sizeAfterImport = fs.statSync(graphStore.graphPath(tempDir)).size;
    for (let index = 0; index < 20; index += 1) {
      graph = (
        await graphStore.executeWorkspaceGraphCommand(
          tempDir,
          { type: "update-node", nodeId: "task-a", changes: { name: `Rename ${index}` } },
          "tree",
          graph.revision
        )
      ).graph;
    }
    // 1 段ごとにグラフ全体を積むと 20 倍を超える。
    expect(fs.statSync(graphStore.graphPath(tempDir)).size).toBeLessThan(sizeAfterImport * 1.5);
    const stored = JSON.parse(fs.readFileSync(graphStore.graphPath(tempDir), "utf8"));
    expect(stored.undo).toHaveLength(20);
    expect(Object.keys(stored.undo[19].nodes)).toEqual(["task-a"]);

    const undone = await graphStore.undoWorkspaceGraph(tempDir, graph.revision);
    expect(undone.graph.nodes["task-a"].name).toBe("Rename 18");
    expect(undone.graph.revision).toBe(graph.revision + 1);
    expect(undone.graph.nodes["big-task"].body).toHaveLength(200_000);
  });

  it("converts full-graph history written by older versions", async () => {
    projectFixture(tempDir);
    const initial = await graphStore.readWorkspaceGraph(tempDir);
    const named = (name, revision) => ({
      ...structuredClone(initial),
      revision,
      nodes: {
        ...structuredClone(initial.nodes),
        "task-a": { ...structuredClone(initial.nodes["task-a"]), name },
      },
    });
    const { history: _history, ...current } = named("Two", 2);
    fs.writeFileSync(
      graphStore.graphPath(tempDir),
      JSON.stringify({
        schemaVersion: 1,
        graph: current,
        undo: [named("Zero", 0), named("One", 1)],
        redo: [named("Three", 3)],
      })
    );

    const loaded = await graphStore.readWorkspaceGraph(tempDir);
    expect(loaded.nodes["task-a"].name).toBe("Two");
    expect(loaded.history).toEqual({ undo: 2, redo: 1 });
    // 読んだだけで新しい形式に書き戻されている。
    const converted = JSON.parse(fs.readFileSync(graphStore.graphPath(tempDir), "utf8"));
    expect(converted.undo.every((entry) => !("rootId" in entry))).toBe(true);
    expect(Object.keys(converted.undo[1].nodes)).toEqual(["task-a"]);
    const redone = await graphStore.redoWorkspaceGraph(tempDir, loaded.revision);
    expect(redone.graph.nodes["task-a"].name).toBe("Three");
    let state = redone.graph;
    for (const expected of ["Two", "One", "Zero"]) {
      state = (await graphStore.undoWorkspaceGraph(tempDir, state.revision)).graph;
      expect(state.nodes["task-a"].name).toBe(expected);
    }
    expect((await graphStore.undoWorkspaceGraph(tempDir, state.revision)).changed).toBe(false);
    const stored = JSON.parse(fs.readFileSync(graphStore.graphPath(tempDir), "utf8"));
    expect(stored.redo.every((entry) => !("rootId" in entry))).toBe(true);
  });

  it("reads the graph again when another process rewrites the file", async () => {
    projectFixture(tempDir);
    await graphStore.readWorkspaceGraph(tempDir);
    const filePath = graphStore.graphPath(tempDir);
    const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
    stored.graph.nodes["task-a"].name = "Edited elsewhere";
    stored.graph.revision += 1;
    fs.writeFileSync(filePath, JSON.stringify(stored, null, 2));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(filePath, later, later);
    expect((await graphStore.readWorkspaceGraph(tempDir)).nodes["task-a"].name).toBe(
      "Edited elsewhere"
    );
  });

  it("preserves explicit Undefined separately from an omitted status in JSON", async () => {
    projectFixture(tempDir);
    let current = await graphStore.readWorkspaceGraph(tempDir);
    current = (
      await graphStore.executeWorkspaceGraphCommand(
        tempDir,
        { type: "update-node", nodeId: "task-a", changes: { status: "Undefined" } },
        "graph",
        current.revision
      )
    ).graph;
    expect((await graphStore.readWorkspaceGraph(tempDir)).nodes["task-a"].status).toBe("Undefined");
    await graphStore.executeWorkspaceGraphCommand(
      tempDir,
      { type: "update-node", nodeId: "task-a", changes: { status: undefined } },
      "graph",
      current.revision
    );
    expect(
      Object.prototype.hasOwnProperty.call(
        (await graphStore.readWorkspaceGraph(tempDir)).nodes["task-a"],
        "status"
      )
    ).toBe(false);
  });

  it("keeps copied canonical assets usable after deleting the source node", async () => {
    projectFixture(tempDir);
    let graph = await graphStore.readWorkspaceGraph(tempDir);
    const saved = await graphStore.saveNodeAsset(
      tempDir,
      "task-a",
      "note.txt",
      Buffer.from("asset")
    );
    graph = (
      await graphStore.executeWorkspaceGraphCommand(
        tempDir,
        {
          type: "update-node",
          nodeId: "task-a",
          changes: {
            attachments: [{ id: "x", name: "note.txt", relativePath: saved.relativePath, size: 5 }],
          },
        },
        "graph",
        graph.revision
      )
    ).graph;
    const copied = await graphStore.executeWorkspaceGraphCommand(
      tempDir,
      { type: "copy", nodeId: "task-a", targetParentId: graph.rootId, mode: "node" },
      "graph",
      graph.revision
    );
    const copyId = copied.selectedNodeIds[0];
    const copySaved = await graphStore.saveNodeAsset(
      tempDir,
      copyId,
      "copy.txt",
      Buffer.from("copy")
    );
    await expect(
      graphStore.resolveNodeAsset(tempDir, copyId, copySaved.relativePath)
    ).resolves.toMatch(/copy\.txt$/);
    const deleted = await graphStore.executeWorkspaceGraphCommand(
      tempDir,
      { type: "delete-node", nodeId: "task-a" },
      "graph",
      copied.graph.revision
    );
    const copiedPath = deleted.graph.nodes[copyId].attachments[0].relativePath;
    expect(copiedPath).toContain(`assets/${copyId}/`);
    await expect(graphStore.resolveNodeAsset(tempDir, copyId, copiedPath)).resolves.toMatch(
      /note\.txt$/
    );
    await expect(graphStore.resolveNodeAsset(tempDir, copyId, "../outside.txt")).rejects.toThrow(
      /escapes|belong/
    );
    const undone = await graphStore.undoWorkspaceGraph(tempDir, deleted.graph.revision);
    await expect(
      graphStore.resolveNodeAsset(tempDir, "task-a", saved.relativePath)
    ).resolves.toMatch(/note\.txt$/);
    expect(undone.graph.nodes["task-a"]).toBeTruthy();
  });

  it("fails migration on a malformed task before activating graph storage", async () => {
    projectFixture(tempDir);
    const bad = path.join(tempDir, "alpha", "bad-task");
    fs.mkdirSync(bad);
    fs.writeFileSync(path.join(bad, "_index.md"), "---\nname: Missing id\n---\n");
    await expect(graphStore.readWorkspaceGraph(tempDir)).rejects.toThrow(/Invalid legacy task/);
    expect(fs.existsSync(graphStore.graphPath(tempDir))).toBe(false);
  });

  it("fails migration on duplicate ids inside one project", async () => {
    projectFixture(tempDir);
    const duplicate = path.join(tempDir, "alpha", "duplicate-task");
    fs.mkdirSync(duplicate);
    fs.writeFileSync(path.join(duplicate, "_index.md"), "---\nid: task-a\nname: Duplicate\n---\n");
    await expect(graphStore.readWorkspaceGraph(tempDir)).rejects.toThrow(/Duplicate node id/);
    expect(fs.existsSync(graphStore.graphPath(tempDir))).toBe(false);
  });

  it("imports two legacy projects that share task ids by renumbering the later copy", async () => {
    // v0.40 のエクスポートはルート以外の id を db.json から引き継いだので、
    // 同じプロジェクトを 2 回エクスポートすると別プロジェクトに同じ id が並ぶ。
    projectFixture(tempDir);
    const betaDir = path.join(tempDir, "beta");
    const betaTask = path.join(betaDir, "task-a");
    const betaChild = path.join(betaDir, "task-b");
    fs.mkdirSync(path.join(betaTask, "assets"), { recursive: true });
    fs.mkdirSync(betaChild, { recursive: true });
    fs.writeFileSync(
      path.join(betaDir, "_project.md"),
      "---\nid: project-b\nname: Beta\norder: 1\n---\n"
    );
    fs.writeFileSync(
      path.join(betaTask, "_index.md"),
      "---\nid: task-a\nname: Beta Task A\nparents:\n  - id: project-b\n    order: 0\n---\n![img](./assets/beta.png)\n"
    );
    fs.writeFileSync(path.join(betaTask, "assets", "beta.png"), "beta-image");
    fs.writeFileSync(
      path.join(betaTask, "memo.md"),
      "---\nid: memo-b\ntitle: Beta memo\n---\nMemo body\n"
    );
    fs.writeFileSync(
      path.join(betaChild, "_index.md"),
      "---\nid: task-b\nname: Beta Task B\nparents:\n  - id: task-a\n    order: 0\n---\n"
    );

    const graph = await graphStore.readWorkspaceGraph(tempDir);

    expect(graph.nodes["task-a"].name).toBe("Task A");
    expect(graph.nodes["task-a"].parents).toEqual([{ id: "project-a", order: 0 }]);
    const renamed = Object.values(graph.nodes).filter((node) => node.name === "Beta Task A");
    expect(renamed).toHaveLength(1);
    const betaTaskId = renamed[0].id;
    expect(betaTaskId).not.toBe("task-a");
    expect(renamed[0].parents).toEqual([{ id: "project-b", order: 0 }]);
    expect(renamed[0].assetOwnerId).toBe(betaTaskId);
    expect(renamed[0].body).toContain(`assets/${betaTaskId}/assets/beta.png`);
    expect(graph.nodes["task-b"].parents).toEqual([{ id: betaTaskId, order: 0 }]);
    expect(graph.nodes["memo-b"].parents[0].id).toBe(betaTaskId);
    await expect(
      graphStore.resolveNodeAsset(tempDir, betaTaskId, `assets/${betaTaskId}/assets/beta.png`)
    ).resolves.toMatch(/beta\.png$/);
    await expect(
      graphStore.resolveNodeAsset(tempDir, "task-a", "assets/task-a/assets/legacy.png")
    ).resolves.toMatch(/legacy\.png$/);
  });

  it("imports memos that a pasted task copy shares with its source", async () => {
    // v0.40 の貼り付けはタスクに新しい id を振るが、メモの配列はそのまま
    // コピーしたので、同じプロジェクトの別タスクに同じ id のメモ
    // ファイル（`<memo id>.md`）が並ぶ。
    projectFixture(tempDir);
    const alphaDir = path.join(tempDir, "alpha");
    fs.writeFileSync(
      path.join(alphaDir, "task-a", "memo-x.md"),
      "---\nid: memo-x\ntitle: Shared memo\norder: 0\n---\nOriginal body\n"
    );
    const pasted = path.join(alphaDir, "task-c");
    fs.mkdirSync(path.join(pasted, "assets"), { recursive: true });
    fs.writeFileSync(path.join(pasted, "assets", "pasted.png"), "pasted-image");
    fs.writeFileSync(
      path.join(pasted, "_index.md"),
      "---\nid: task-c\nname: Task A copy\nparents:\n  - id: project-a\n    order: 1\n---\n"
    );
    fs.writeFileSync(
      path.join(pasted, "memo-x.md"),
      "---\nid: memo-x\ntitle: Shared memo\norder: 0\n---\nEdited after paste\n![img](./assets/pasted.png)\n"
    );

    const graph = await graphStore.readWorkspaceGraph(tempDir);

    const memos = Object.values(graph.nodes).filter((node) => node.name === "Shared memo");
    expect(memos).toHaveLength(2);
    expect(memos.map((memo) => memo.parents[0].id).sort()).toEqual(["task-a", "task-c"]);
    const original = memos.find((memo) => memo.parents[0].id === "task-a");
    const copy = memos.find((memo) => memo.parents[0].id === "task-c");
    expect(original.body).toContain("Original body");
    expect(copy.body).toContain("Edited after paste");
    expect(new Set(memos.map((memo) => memo.id)).size).toBe(2);
    expect(memos.map((memo) => memo.id)).toContain("memo-x");
    expect(copy.body).toContain(`assets/${copy.id}/assets/pasted.png`);
    await expect(
      graphStore.resolveNodeAsset(tempDir, copy.id, `assets/${copy.id}/assets/pasted.png`)
    ).resolves.toMatch(/pasted\.png$/);
  });

  it("fails migration when a legacy memo id collides with a task id", async () => {
    projectFixture(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "alpha", "task-a", "memo.md"),
      "---\nid: project-a\ntitle: Collision\n---\nMemo\n"
    );
    await expect(graphStore.readWorkspaceGraph(tempDir)).rejects.toThrow(/Duplicate legacy memo/);
    expect(fs.existsSync(graphStore.graphPath(tempDir))).toBe(false);
  });

  it("fails migration when a legacy memo cannot be read", async () => {
    projectFixture(tempDir);
    const memoPath = path.join(tempDir, "alpha", "task-a", "memo.md");
    fs.writeFileSync(memoPath, "---\nid: memo-a\n---\nMemo\n");
    const originalReadFile = fs.promises.readFile.bind(fs.promises);
    const read = vi
      .spyOn(fs.promises, "readFile")
      .mockImplementation((file, ...args) =>
        path.resolve(String(file)) === path.resolve(memoPath)
          ? Promise.reject(Object.assign(new Error("access denied"), { code: "EACCES" }))
          : originalReadFile(file, ...args)
      );
    await expect(graphStore.readWorkspaceGraph(tempDir)).rejects.toThrow(/Cannot read legacy memo/);
    read.mockRestore();
    expect(fs.existsSync(graphStore.graphPath(tempDir))).toBe(false);
  });

  it("does not change the graph or history when atomic persistence fails", async () => {
    projectFixture(tempDir);
    const initial = await graphStore.readWorkspaceGraph(tempDir);
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(
      graphStore.executeWorkspaceGraphCommand(
        tempDir,
        { type: "update-node", nodeId: "task-a", changes: { name: "Must not persist" } },
        "graph",
        initial.revision
      )
    ).rejects.toThrow(/disk unavailable/);
    rename.mockRestore();
    const after = await graphStore.readWorkspaceGraph(tempDir);
    expect(after.revision).toBe(initial.revision);
    expect(after.nodes["task-a"].name).toBe("Task A");
    const undo = await graphStore.undoWorkspaceGraph(tempDir, after.revision);
    expect(undo.changed).toBe(false);
  });

  it("retries a transient Windows rename lock without duplicating history", async () => {
    projectFixture(tempDir);
    const initial = await graphStore.readWorkspaceGraph(tempDir);
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EPERM" }));
    try {
      const result = await graphStore.executeWorkspaceGraphCommand(
        tempDir,
        { type: "update-node", nodeId: "task-a", changes: { name: "Saved after retry" } },
        "tree",
        initial.revision
      );
      expect(result.graph.revision).toBe(initial.revision + 1);
      const undo = await graphStore.undoWorkspaceGraph(tempDir, result.graph.revision);
      expect(undo.graph.nodes["task-a"].name).toBe("Task A");
      expect((await graphStore.undoWorkspaceGraph(tempDir, undo.graph.revision)).changed).toBe(
        false
      );
      const redo = await graphStore.redoWorkspaceGraph(tempDir, undo.graph.revision);
      expect(redo.graph.nodes["task-a"].name).toBe("Saved after retry");
    } finally {
      rename.mockRestore();
    }
  });
});
