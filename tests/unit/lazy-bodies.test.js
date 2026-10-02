import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import graphStore from "../../electron/workspace-graph.js";
import { loadWorkspace, loadWorkspaceSync } from "../../electron/store/loader.js";

/**
 * 本文の遅延ロードのテスト。
 *
 * 読み込みでは、ノードのファイルの frontmatter までしか読まない（`bodyLoaded: false`）。
 * 何より大事なのは、本文を読んでいないノードを書き戻しても、本文が失われたり空に
 * ならないこと。frontmatter は、全文を読んだときと同じ値になること。
 */
const read = (file) => fs.readFileSync(file, "utf8");
const exec = (root, command, revision) =>
  graphStore.executeWorkspaceGraphCommand(root, command, "tree", revision);

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const BODY =
  "# 設計メモ\n\n本文の 1 行目。\n\n---\n\n水平線のあとにも本文。\n![図](./assets/pic.png)\n";

function fixture(root) {
  write(path.join(root, "_workspace.md"), "---\nid: ws\nname: WS\n---\n");
  write(path.join(root, "alpha", "_project.md"), "---\nid: proj\nname: Alpha\n---\nProject body\n");
  write(
    path.join(root, "alpha", "t1", "_index.md"),
    `---\nid: t1\nname: Task 1\nstatus: Open\nparents:\n  - id: proj\n    order: 0\ntags:\n  - x\ncreated: 2026-01-02\nsummary: kept as is\n---\n\n${BODY}`
  );
  write(path.join(root, "alpha", "t1", "assets", "pic.png"), "png-bytes");
  write(
    path.join(root, "alpha", "t2", "_index.md"),
    "---\nid: t2\nname: Task 2\nparents:\n  - id: t1\n    order: 0\ncreated: 2026-01-03\n---\n\nChild body\n"
  );
}

describe("lazy bodies", () => {
  let root;
  const t1 = () => path.join(root, "alpha", "t1", "_index.md");
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-lazy-"));
    fixture(root);
  });
  afterEach(() => {
    graphStore.forgetWorkspace(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("reading only the frontmatter", () => {
    it("gives the same nodes as reading everything, except the body", async () => {
      const lazy = (await loadWorkspace(root, { lazy: true })).graph;
      const eager = loadWorkspaceSync(root).graph;
      expect(Object.keys(lazy.nodes).sort()).toEqual(Object.keys(eager.nodes).sort());
      for (const [id, node] of Object.entries(eager.nodes)) {
        const { body, ...rest } = node;
        const { bodyLoaded, ...lazyRest } = lazy.nodes[id];
        expect(bodyLoaded).toBe(false);
        expect(lazy.nodes[id]).not.toHaveProperty("body");
        expect(lazyRest).toEqual(rest);
        expect(body).toBeDefined();
      }
    });

    it("reads a frontmatter longer than the first chunk completely", async () => {
      const tags = Array.from({ length: 1200 }, (_, index) => `  - tag-number-${index}`).join("\n");
      write(
        path.join(root, "alpha", "t3", "_index.md"),
        `---\nid: t3\nname: Long\nparents:\n  - id: proj\n    order: 5\ntags:\n${tags}\ncreated: 2026-01-04\n---\nbody\n`
      );
      expect(fs.statSync(path.join(root, "alpha", "t3", "_index.md")).size).toBeGreaterThan(16384);
      const lazy = (await loadWorkspace(root, { lazy: true })).graph.nodes.t3;
      const eager = loadWorkspaceSync(root).graph.nodes.t3;
      expect(lazy.tags).toHaveLength(1200);
      expect(lazy.tags).toEqual(eager.tags);
      expect(lazy.createdAt).toBe("2026-01-04");
    });

    it("handles Windows line endings, a byte order mark and a closing fence at the end of the file", async () => {
      write(
        path.join(root, "alpha", "t4", "_index.md"),
        "﻿---\r\nid: t4\r\nname: CRLF\r\nparents:\r\n  - id: proj\r\n    order: 6\r\ncreated: 2026-01-05\r\n---\r\nbody\r\n"
      );
      write(
        path.join(root, "alpha", "t5", "_index.md"),
        "---\nid: t5\nname: No body\nparents:\n  - id: proj\n    order: 7\ncreated: 2026-01-06\n---"
      );
      const lazy = (await loadWorkspace(root, { lazy: true })).graph.nodes;
      expect(lazy.t4.name).toBe("CRLF");
      expect(lazy.t5.name).toBe("No body");
      expect(lazy.t5.parents).toEqual([{ id: "proj", order: 7 }]);
    });

    it("reads a legacy memo without a title completely, to name it from its first heading", async () => {
      write(
        path.join(root, "alpha", "t1", "note.md"),
        "---\nid: m1\n---\n\n# Heading name\n\nbody\n"
      );
      write(
        path.join(root, "alpha", "t1", "titled.md"),
        "---\nid: m2\ntitle: Given title\n---\n\n# Other heading\n"
      );
      const lazy = (await loadWorkspace(root, { lazy: true })).graph.nodes;
      expect(lazy.m1.name).toBe("Heading name");
      expect(lazy.m2.name).toBe("Given title");
      expect(lazy.m1.bodyLoaded).toBe(false);
      expect(lazy.m2.bodyLoaded).toBe(false);
    });
  });

  describe("writing a node whose body was not read", () => {
    it("keeps the body byte for byte when only the name changes, like an eager load does", async () => {
      // 全部読んだ場合の結果と同じファイルになる。
      const eagerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-lazy-eager-"));
      fixture(eagerRoot);
      try {
        const eager = loadWorkspaceSync(eagerRoot).graph;
        const lazy = await graphStore.readWorkspaceGraph(root);
        expect(lazy.nodes.t1.bodyLoaded).toBe(false);
        await exec(
          root,
          { type: "update-node", nodeId: "t1", changes: { name: "Renamed" } },
          lazy.revision
        );
        // 比べる相手: 全文を読んだグラフで同じ操作をしたときのファイル。
        const { renderNodeFile } = await import("../../electron/store/node-file.js");
        const { extraBlocksOf } = await import("../../electron/store/node-file.js");
        const expected = renderNodeFile(
          { ...eager.nodes.t1, name: "Renamed" },
          {
            keepAttachments: false,
            extraBlocks: extraBlocksOf(read(path.join(eagerRoot, "alpha", "t1", "_index.md"))),
          }
        );
        expect(read(t1())).toBe(expected);
        expect(read(t1())).toContain("水平線のあとにも本文。");
        expect(read(t1())).toContain("summary: kept as is");
      } finally {
        fs.rmSync(eagerRoot, { recursive: true, force: true });
      }
    });

    it("keeps the body that is on the disk now, even if it was edited outside after opening", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      // 本文だけ、外で書き換えられた（frontmatter は同じ）。
      fs.writeFileSync(t1(), read(t1()).replace("本文の 1 行目。", "外で書き換えた行。"));
      await exec(
        root,
        { type: "update-node", nodeId: "t1", changes: { name: "Renamed" } },
        graph.revision
      );
      expect(read(t1())).toContain("外で書き換えた行。");
      expect(read(t1())).toContain("name: Renamed");
    });

    it("refuses to write when the frontmatter was changed outside", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      fs.writeFileSync(t1(), read(t1()).replace("name: Task 1", "name: Edited elsewhere"));
      await expect(
        exec(root, { type: "update-node", nodeId: "t1", changes: { name: "Mine" } }, graph.revision)
      ).rejects.toThrow(/アプリの外で変更/);
      expect(read(t1())).toContain("name: Edited elsewhere");
    });

    it("never writes an empty body: a node whose file disappeared is not recreated", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      fs.rmSync(t1());
      await expect(
        exec(root, { type: "update-node", nodeId: "t1", changes: { name: "Mine" } }, graph.revision)
      ).rejects.toThrow(/本文を読めない/);
      expect(fs.existsSync(t1())).toBe(false);
      // 履歴にも段を作らない。
      expect(fs.existsSync(path.join(root, ".task-manage", "history", "undo"))).toBe(false);
    });

    it("keeps the body of an unread node through undo and redo of a rename", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      const renamed = await exec(
        root,
        { type: "update-node", nodeId: "t1", changes: { name: "Renamed" } },
        graph.revision
      );
      const undone = await graphStore.undoWorkspaceGraph(root, renamed.delta.revision);
      expect(read(t1())).toContain("name: Task 1");
      expect(read(t1())).toContain("水平線のあとにも本文。");
      await graphStore.redoWorkspaceGraph(root, undone.delta.revision);
      expect(read(t1())).toContain("name: Renamed");
      expect(read(t1())).toContain("水平線のあとにも本文。");
    });

    it("writes the history step without the body of the node", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      await exec(
        root,
        { type: "update-node", nodeId: "t1", changes: { name: "Renamed" } },
        graph.revision
      );
      const dir = path.join(root, ".task-manage", "history", "undo");
      const [step] = fs.readdirSync(dir);
      const text = read(path.join(dir, step));
      expect(text).not.toContain("水平線のあとにも本文。");
      expect(JSON.parse(text).patch.nodes.t1.bodyLoaded).toBe(false);
    });

    it("migrates an unread legacy memo into its own folder with its body", async () => {
      write(
        path.join(root, "alpha", "t1", "note.md"),
        "---\nid: m1\ntitle: A memo\n---\n\nmemo body ![i](./assets/pic.png)\n"
      );
      const graph = await graphStore.readWorkspaceGraph(root);
      expect(graph.nodes.m1.bodyLoaded).toBe(false);
      await exec(
        root,
        { type: "update-node", nodeId: "m1", changes: { name: "Memo renamed" } },
        graph.revision
      );
      const moved = path.join(root, "alpha", "m1", "_index.md");
      expect(read(moved)).toContain("name: Memo renamed");
      expect(read(moved)).toContain("memo body ![i](./assets/pic.png)");
      expect(fs.existsSync(path.join(root, "alpha", "t1", "note.md"))).toBe(false);
      expect(read(path.join(root, "alpha", "m1", "assets", "pic.png"))).toBe("png-bytes");
    });
  });

  describe("commands that use the body", () => {
    it("reads the old body first when the body changes, so undo brings it back", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      const edited = await exec(
        root,
        { type: "update-node", nodeId: "t1", changes: { body: "new body" } },
        graph.revision
      );
      expect(edited.delta.nodes.t1.body).toBe("new body");
      expect(edited.delta.nodes.t1.bodyLoaded).toBeUndefined();
      expect(read(t1())).toContain("new body");
      await graphStore.undoWorkspaceGraph(root, edited.delta.revision);
      expect(read(t1())).toContain("水平線のあとにも本文。");
      expect(read(t1())).not.toContain("new body");
    });

    it("copies the body of an unread node, and of its descendants for a subgraph copy", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      const copied = await exec(
        root,
        { type: "copy", nodeId: "t1", targetParentId: "proj", mode: "subgraph" },
        graph.revision
      );
      const ids = Object.keys(copied.delta.nodes);
      expect(ids).toHaveLength(2);
      const texts = ids.map((id) => {
        const dir = path.join(root, "alpha", id, "_index.md");
        return read(dir);
      });
      expect(texts.some((text) => text.includes("水平線のあとにも本文。"))).toBe(true);
      expect(texts.some((text) => text.includes("Child body"))).toBe(true);
      // 元のノードは変わらない。
      expect(read(t1())).toContain("name: Task 1");
    });

    it("restores a deleted unread node with its body and image", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      const deleted = await exec(root, { type: "delete-node", nodeId: "t1" }, graph.revision);
      expect(fs.existsSync(t1())).toBe(false);
      await graphStore.undoWorkspaceGraph(root, deleted.delta.revision);
      expect(read(t1())).toContain("水平線のあとにも本文。");
      expect(read(path.join(root, "alpha", "t1", "assets", "pic.png"))).toBe("png-bytes");
    });

    it("stops a write when a body that was read has been changed outside since", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      const edited = await exec(
        root,
        { type: "update-node", nodeId: "t1", changes: { body: "body A" } },
        graph.revision
      );
      fs.writeFileSync(t1(), read(t1()).replace("body A", "body edited outside"));
      await expect(
        exec(
          root,
          { type: "update-node", nodeId: "t1", changes: { name: "Mine" } },
          edited.delta.revision
        )
      ).rejects.toThrow(/アプリの外で変更/);
      expect(read(t1())).toContain("body edited outside");
    });
  });

  describe("reading bodies", () => {
    it("reads one body, and all bodies, without changing the graph", async () => {
      const graph = await graphStore.readWorkspaceGraph(root);
      const one = await graphStore.readNodeBody(root, "t1");
      expect(one.body).toContain("水平線のあとにも本文。");
      expect(one.format).toBe("markdown");
      const all = await graphStore.readAllNodeBodies(root);
      expect(Object.keys(all).sort()).toEqual(Object.keys(graph.nodes).sort());
      expect(all.t2.body).toBe("Child body");
      const again = await graphStore.readWorkspaceGraph(root);
      expect(again.revision).toBe(graph.revision);
      expect(again.nodes.t1.bodyLoaded).toBe(false);
    });

    it("rejects an unknown node", async () => {
      await graphStore.readWorkspaceGraph(root);
      await expect(graphStore.readNodeBody(root, "nope")).rejects.toThrow(/Unknown node/);
    });
  });
});
