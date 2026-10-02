import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import graphStore from "../../electron/workspace-graph.js";
import {
  migrateGraphJson,
  rewriteBodyReferences,
} from "../../electron/store/migrate-graph-json.js";

/**
 * 以前の保存形式（`graph-v1.json`）から Markdown への一度きりの変換のテスト。
 *
 * 変換しても、ノードの中身・親子関係・画像と添付が変わらないこと。元のファイルは
 * 消さないこと（途中で止まっても続きから変換できること）。
 */
const UUID = "0f8e4c2a-1b3d-4e5f-8a9b-0c1d2e3f4a5b";

function node(id, name, parents, extra = {}) {
  return { id, name, parents, createdAt: "2026-01-01", ...extra };
}

function writeGraph(root, graph, extra = {}) {
  fs.mkdirSync(path.join(root, ".task-manage"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".task-manage", "graph-v1.json"),
    JSON.stringify({ schemaVersion: 1, graph, undo: [], redo: [], ...extra })
  );
}

function writeAsset(root, ownerId, relative, content) {
  const file = path.join(root, ".task-manage", "assets", ownerId, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const read = (file) => fs.readFileSync(file, "utf8");

describe("migrating graph-v1.json to Markdown files", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-migrate-"));
  });
  afterEach(() => {
    graphStore.forgetWorkspace(root);
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function fixture() {
    const graph = {
      schemaVersion: 1,
      workspaceId: "ws",
      rootId: "workspace-ws",
      revision: 9,
      inboxId: "inbox",
      positions: { "task-a": { x: 5, y: 6 } },
      nodes: {
        "workspace-ws": node("workspace-ws", "Mine", [], { body: "About this workspace" }),
        "project-a": node("project-a", "Alpha", [{ id: "workspace-ws", order: 0 }], {
          sourceProjectDir: path.join(root, "alpha"),
          sourceTaskDir: "_project",
          status: "Open",
        }),
        "task-a": node("task-a", "Task A", [{ id: "project-a", order: 0 }], {
          assetOwnerId: "task-a",
          status: "In Progress",
          dueDate: "2026-09-30",
          tags: ["design"],
          body: `Body\n![legacy](assets/task-a/assets/legacy.png)\n![pasted](assets/task-a/${UUID}-pasted.png)\n`,
          attachments: [
            {
              id: "1",
              name: "note.txt",
              relativePath: "assets/task-a/attachments/note.txt",
              size: 10,
            },
            { id: "2", name: "spec.pdf", relativePath: `assets/task-a/${UUID}-spec.pdf`, size: 3 },
          ],
        }),
        "task-b": node(
          "task-b",
          "Nested",
          [
            { id: "task-a", order: 0 },
            { id: "project-b", order: 2, archived: true, archivedAt: "2026-09-01T00:00:00.000Z" },
          ],
          { format: "quill", body: { ops: [{ insert: "Rich\n" }] } }
        ),
        "project-b": node("project-b", "Beta", [{ id: "workspace-ws", order: 1 }]),
        inbox: node("inbox", "Inbox", [{ id: "workspace-ws", order: 2 }], {
          sourceProjectDir: path.join(root, "_inbox"),
          sourceTaskDir: "_project",
        }),
        idea: node("idea", "Idea", [{ id: "inbox", order: 0 }]),
      },
    };
    writeGraph(root, graph);
    writeAsset(root, "task-a", "assets/legacy.png", "legacy-image");
    writeAsset(root, "task-a", "attachments/note.txt", "attachment");
    writeAsset(root, "task-a", `${UUID}-pasted.png`, "pasted-image");
    writeAsset(root, "task-a", `${UUID}-spec.pdf`, "pdf");
    // 取り込み元だった旧フォルダー（グラフで消したノードの古いファイルも残っている）。
    fs.mkdirSync(path.join(root, "alpha", "task-deleted"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "alpha", "_project.md"),
      "---\nid: project-a\nname: Alpha (old)\norder: 0\n---\n"
    );
    fs.writeFileSync(
      path.join(root, "alpha", "task-deleted", "_index.md"),
      "---\nid: task-deleted\nname: Deleted in the app\nparents:\n  - project-a\n---\n"
    );
    return graph;
  }

  it("keeps every node, edge and field", async () => {
    const original = fixture();
    const loaded = await graphStore.readWorkspaceGraph(root);
    for (const [id, before] of Object.entries(original.nodes)) {
      const after = loaded.nodes[id];
      expect(after, id).toBeTruthy();
      expect(after.name).toBe(before.name);
      expect(after.parents.map((link) => link.id)).toEqual(before.parents.map((link) => link.id));
      expect(after.status).toBe(before.status);
      expect(after.dueDate).toBe(before.dueDate);
      expect(after.tags ?? []).toEqual(before.tags ?? []);
    }
    expect(loaded.nodes["task-b"].parents[1]).toEqual({
      id: "project-b",
      order: 2,
      archived: true,
      archivedAt: "2026-09-01T00:00:00.000Z",
    });
    // 読み込みでは本文を読まない。本文は、読む操作で取り出す。
    expect(loaded.nodes["task-b"].bodyLoaded).toBe(false);
    expect((await graphStore.readNodeBody(root, "task-b")).body).toEqual({
      ops: [{ insert: "Rich\n" }],
    });
    expect((await graphStore.readNodeBody(root, "workspace-ws")).body).toBe("About this workspace");
    expect(loaded.inboxId).toBe("inbox");
    expect(loaded.positions).toEqual({ "task-a": { x: 5, y: 6 } });
    expect(loaded.rootId).toBe("workspace-ws");
  });

  it("lays the nodes out like the legacy format, reusing the folder the project came from", async () => {
    fixture();
    await graphStore.readWorkspaceGraph(root);
    expect(read(path.join(root, "alpha", "_project.md"))).toContain("id: project-a");
    expect(read(path.join(root, "alpha", "_project.md"))).toContain("name: Alpha\n");
    expect(fs.existsSync(path.join(root, "alpha", "task-a", "_index.md"))).toBe(true);
    // 2 段目のノードも、属するプロジェクトのフォルダーに置く。
    expect(fs.existsSync(path.join(root, "alpha", "task-b", "_index.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "beta", "_project.md"))).toBe(true);
    expect(read(path.join(root, "_workspace.md"))).toContain("id: workspace-ws");
    // 読みやすさのため、複数の親は frontmatter に並ぶ。
    expect(read(path.join(root, "alpha", "task-b", "_index.md"))).toContain("archived: true");
  });

  it("copies images and attachments into the node's folder and rewrites the references", async () => {
    fixture();
    const loaded = await graphStore.readWorkspaceGraph(root);
    const { body } = await graphStore.readNodeBody(root, "task-a");
    expect(body).toContain("![legacy](./assets/legacy.png)");
    expect(body).toContain(`![pasted](./assets/${UUID}-pasted.png)`);
    const folder = path.join(root, "alpha", "task-a");
    expect(read(path.join(folder, "assets", "legacy.png"))).toBe("legacy-image");
    expect(read(path.join(folder, "assets", `${UUID}-pasted.png`))).toBe("pasted-image");
    expect(loaded.nodes["task-a"].attachments.map((entry) => entry.relativePath)).toEqual([
      "./attachments/note.txt",
      "./attachments/spec.pdf",
    ]);
    expect(read(path.join(folder, "attachments", "note.txt"))).toBe("attachment");
    // 保存時に付けた id の接頭辞は外して、元のファイル名で置く。
    expect(read(path.join(folder, "attachments", "spec.pdf"))).toBe("pdf");
    await expect(
      graphStore.resolveNodeAsset(root, "task-a", "./assets/legacy.png")
    ).resolves.toMatch(/legacy\.png$/);
  });

  it("moves the old folders into a backup so the nodes deleted in the app do not come back", async () => {
    fixture();
    const loaded = await graphStore.readWorkspaceGraph(root);
    expect(loaded.nodes["task-deleted"]).toBeUndefined();
    expect(fs.existsSync(path.join(root, "alpha", "task-deleted"))).toBe(false);
    const backups = fs.readdirSync(path.join(root, ".task-manage", "backup"));
    expect(backups).toHaveLength(1);
    expect(
      read(
        path.join(root, ".task-manage", "backup", backups[0], "alpha", "task-deleted", "_index.md")
      )
    ).toContain("Deleted in the app");
  });

  it("does not delete the old file or the old assets", async () => {
    fixture();
    await graphStore.readWorkspaceGraph(root);
    expect(fs.existsSync(path.join(root, ".task-manage", "graph-v1.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".task-manage", "graph-v1.json.migrated"))).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".task-manage", "assets", "task-a", "assets", "legacy.png"))
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".task-manage", "migration.json"))).toBe(false);
  });

  it("starts without history, and leaves a legacy folder that was never imported in place", async () => {
    fixture();
    fs.mkdirSync(path.join(root, "later"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "later", "_project.md"),
      "---\nid: later\nname: Later project\norder: 9\n---\n"
    );
    const loaded = await graphStore.readWorkspaceGraph(root);
    expect(loaded.history).toEqual({ undo: 0, redo: 0 });
    expect(loaded.nodes.later.name).toBe("Later project");
    expect(loaded.nodes.later.parents[0].id).toBe("workspace-ws");
    expect(fs.existsSync(path.join(root, "later", "_project.md"))).toBe(true);
  });

  it("can be resumed when it stopped before the last step", async () => {
    fixture();
    const original = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, "rename").mockImplementation((from, ...rest) =>
      String(from).endsWith("graph-v1.json")
        ? Promise.reject(new Error("stopped"))
        : original(from, ...rest)
    );
    await expect(graphStore.readWorkspaceGraph(root)).rejects.toThrow(/stopped/);
    vi.restoreAllMocks();
    graphStore.forgetWorkspace(root);
    // 元のファイルが残っているので、もう一度開くと続きから変換する。
    expect(fs.existsSync(path.join(root, ".task-manage", "graph-v1.json"))).toBe(true);
    const loaded = await graphStore.readWorkspaceGraph(root);
    expect(Object.keys(loaded.nodes).sort()).toEqual(
      ["workspace-ws", "project-a", "task-a", "task-b", "project-b", "inbox", "idea"].sort()
    );
    expect(fs.existsSync(path.join(root, ".task-manage", "graph-v1.json.migrated"))).toBe(true);
    // 旧フォルダーの退避は 1 回だけ。
    expect(fs.readdirSync(path.join(root, ".task-manage", "backup"))).toHaveLength(1);
  });

  it("does nothing for a workspace that has no graph-v1.json", async () => {
    await expect(migrateGraphJson(root)).resolves.toBe(false);
  });
});

describe("rewriteBodyReferences", () => {
  it("rewrites references in Markdown text and in Quill deltas", () => {
    const toRelative = (rest) => `./assets/${rest}`;
    expect(rewriteBodyReferences("a ![x](assets/n1/pic.png) b", "n1", toRelative)).toBe(
      "a ![x](./assets/pic.png) b"
    );
    expect(
      rewriteBodyReferences(
        {
          ops: [{ insert: { image: "assets/n1/pic.png" } }, { insert: "see ./assets/n1/a.png\n" }],
        },
        "n1",
        toRelative
      )
    ).toEqual({
      ops: [{ insert: { image: "./assets/pic.png" } }, { insert: "see ./assets/a.png\n" }],
    });
  });

  it("leaves another node's references alone", () => {
    expect(rewriteBodyReferences("![x](assets/other/pic.png)", "n1", (rest) => rest)).toBe(
      "![x](assets/other/pic.png)"
    );
  });
});
