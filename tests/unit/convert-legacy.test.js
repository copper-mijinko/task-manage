import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import graphStore from "../../electron/workspace-graph.js";
import { convertLegacyWorkspace, planConversion } from "../../electron/store/convert-legacy.js";

/**
 * 旧形式のフォルダーを別の場所へ変換して書き出す（移行のための機能）。
 * メモが 1 つだけで名前が「memo」、かつノードの本文が空のときだけ、親の本文にする。
 */
const store = {
  read: (workspace) => graphStore.readWorkspaceGraph(workspace),
  execute: (workspace, command, origin, revision) =>
    graphStore.executeWorkspaceGraphCommand(workspace, command, origin, revision),
  forget: (workspace) => graphStore.forgetWorkspace(workspace),
};
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const read = (file) => fs.readFileSync(file, "utf8");
const node = (id, name, body = "") =>
  `---\nid: ${id}\nname: ${name}\nparents:\n  - id: proj\n    order: 0\ncreated: 2026-01-02\n---\n\n${body}\n`;

describe("converting a legacy workspace", () => {
  let source;
  let dest;
  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-convert-"));
    source = path.join(base, "legacy");
    dest = path.join(base, "converted");
    write(path.join(source, "alpha", "_project.md"), "---\nid: proj\nname: Alpha\n---\n");
    // 1. メモが 1 つだけ、名前なし（ファイル名が id と同じ。画面では「memo」）、本文が空 → 親の本文にする
    write(path.join(source, "alpha", "single", "_index.md"), node("single", "Single"));
    write(
      path.join(source, "alpha", "single", "m-single.md"),
      "---\nid: m-single\ntags:\n  - from-memo\n---\n\nbody of the only memo ![i](./assets/pic.png)\n"
    );
    write(path.join(source, "alpha", "single", "assets", "pic.png"), "png");
    // 2. メモが複数 → 特別な扱いなし
    write(path.join(source, "alpha", "many", "_index.md"), node("many", "Many"));
    write(path.join(source, "alpha", "many", "m-a.md"), "---\nid: m-a\n---\n\nfirst\n");
    write(path.join(source, "alpha", "many", "m-b.md"), "---\nid: m-b\n---\n\nsecond\n");
    // 3. メモが 1 つだが名前がある → 特別な扱いなし
    write(path.join(source, "alpha", "named", "_index.md"), node("named", "Named"));
    write(
      path.join(source, "alpha", "named", "n.md"),
      "---\nid: m-n\ntitle: Design notes\n---\n\nnamed body\n"
    );
    // 4. メモが 1 つ「memo」だが、親に本文がある → 本文を上書きしない
    write(path.join(source, "alpha", "full", "_index.md"), node("full", "Full", "parent body"));
    write(path.join(source, "alpha", "full", "m-x.md"), "---\nid: m-x\n---\n\nmemo body\n");
    // メモの無いノード
    write(path.join(source, "alpha", "plain", "_index.md"), node("plain", "Plain", "plain body"));
  });
  afterEach(() => {
    graphStore.forgetWorkspace(source);
    graphStore.forgetWorkspace(dest);
    fs.rmSync(path.dirname(source), { recursive: true, force: true });
  });

  it("plans to move only a lone untitled memo into an empty parent body", () => {
    const plan = planConversion(source);
    expect(plan.merge.map((item) => item.ownerId)).toEqual(["single"]);
    expect(plan.keep.map((item) => item.ownerId)).toEqual(["full"]);
    expect(plan.memoNodes).toBe(5);
  });

  it("writes the converted workspace elsewhere and leaves the source untouched", async () => {
    const before = fs.readdirSync(source, { recursive: true }).sort();
    const plan = await convertLegacyWorkspace(source, dest, store);
    expect(plan.merge).toHaveLength(1);
    expect(fs.readdirSync(source, { recursive: true }).sort()).toEqual(before);
    expect(fs.existsSync(path.join(source, ".task-manage"))).toBe(false);

    // 親の本文になり、メモのファイルは無くなる。画像の参照もそのまま使える。
    const single = read(path.join(dest, "alpha", "single", "_index.md"));
    expect(single).toContain("body of the only memo ![i](./assets/pic.png)");
    expect(single).toContain("from-memo");
    expect(fs.existsSync(path.join(dest, "alpha", "single", "m-single.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "alpha", "single", "assets", "pic.png"))).toBe(true);
  });

  it("changes nothing for several memos, a titled memo, or a parent that has a body", async () => {
    await convertLegacyWorkspace(source, dest, store);
    for (const file of ["many/m-a.md", "many/m-b.md", "named/n.md", "full/m-x.md"])
      expect(read(path.join(dest, "alpha", file))).toBe(read(path.join(source, "alpha", file)));
    expect(read(path.join(dest, "alpha", "full", "_index.md"))).toContain("parent body");
    expect(read(path.join(dest, "alpha", "plain", "_index.md"))).toContain("plain body");
  });

  it("opens as a workspace with one node fewer, and leaves no history or trash behind", async () => {
    await convertLegacyWorkspace(source, dest, store);
    expect(fs.existsSync(path.join(dest, ".task-manage", "history"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".task-manage", "trash"))).toBe(false);
    const graph = await graphStore.readWorkspaceGraph(dest);
    expect(graph.nodes["m-single"]).toBeUndefined();
    expect(graph.nodes["m-a"]).toBeTruthy();
    expect((await graphStore.readNodeBody(dest, "single")).body).toContain("only memo");
    expect(graph.history).toEqual({ undo: 0, redo: 0 });
  });

  it("refuses a destination that is not empty or overlaps the source", async () => {
    write(path.join(dest, "something.txt"), "x");
    await expect(convertLegacyWorkspace(source, dest, store)).rejects.toThrow(/空ではありません/);
    await expect(
      convertLegacyWorkspace(source, path.join(source, "inside"), store)
    ).rejects.toThrow(/別の場所/);
    await expect(convertLegacyWorkspace(source, path.dirname(source), store)).rejects.toThrow(
      /別の場所/
    );
  });
});
