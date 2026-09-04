import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
// @ts-expect-error -- main プロセス側は JS のまま
import {
  createProject,
  readProject,
  readProjectAsync,
  writeTask,
  writeProjectAsync,
  writeProjectPatchAsync,
  parseFrontmatter,
} from "../../electron/workspace.js";

/**
 * 「1 つのメモ ＝ 1 つのノード」。
 *
 * 旧メモ（`<task-dir>/<memo-id>.md`）は読みでノードになり、次の保存で自分の
 * ディレクトリへ移る。移行は **コピー → 削除** の 2 パスで、全ノードを書き
 * 終えてから元を消す。逆順にすると、途中で落ちたときに本文が失われる。
 *
 * 危ないのは画像で、本文の `./assets/x.png` は**そのノードのディレクトリ相対**
 * で解決される（`..` で外に出る参照は拒否される）。だから移行のときに参照ぶんを
 * 運ぶ必要がある。運ぶのは**コピー**で、親の本文や他のメモが同じ画像を指して
 * いても壊さない。
 */

function projectWithLegacyMemo(tmpDir: string, memoFile: string) {
  const { projectDir } = createProject(tmpDir, "P", "root-id");
  writeTask(
    projectDir,
    {
      id: "t1",
      name: "タスク",
      status: "Open",
      parents: [{ id: "root-id", order: 0 }],
      createdAt: "2026-09-04",
    },
    new Map()
  );
  fs.writeFileSync(path.join(projectDir, "t1", "m1.md"), memoFile);
  return projectDir;
}

describe("旧メモの取り込み（読み）", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memo-node-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("旧メモはノードとして読まれ、書いてあったタスクの子になる", () => {
    const projectDir = projectWithLegacyMemo(
      tmpDir,
      "---\nid: m1\ntitle: メモA\ntags:\n  - a\n---\n\n本文A\n"
    );

    const { tasks, legacyMemoFiles } = readProject(projectDir);
    const node = tasks.get("m1");

    expect(node.name).toBe("メモA");
    expect(node.body).toBe("本文A");
    expect(node.tags).toEqual(["a"]);
    expect(node.parents.map((parent: { id: string }) => parent.id)).toEqual(["t1"]);
    // メモは進み具合を持たない。既定のステータスを与えると、ノート 1 つ 1 つが
    // 「未着手のタスク」として積み上がる。
    expect(node.status).toBeUndefined();
    expect(legacyMemoFiles.get("m1").fileName).toBe("m1.md");
  });

  it("旧メモは実タスクの子の後ろに並ぶ", () => {
    const projectDir = projectWithLegacyMemo(tmpDir, "---\nid: m1\ntitle: メモ\n---\n\n本文\n");
    writeTask(
      projectDir,
      {
        id: "child",
        name: "実タスク",
        status: "Open",
        parents: [{ id: "t1", order: 0 }],
        createdAt: "2026-09-04",
      },
      new Map()
    );

    const { tasks } = readProject(projectDir);
    const orderUnderT1 = (id: string) =>
      tasks.get(id).parents.find((parent: { id: string }) => parent.id === "t1").order;

    expect(orderUnderT1("child")).toBeLessThan(orderUnderT1("m1"));
  });

  it("同期と非同期の読みが一致する", async () => {
    const projectDir = projectWithLegacyMemo(tmpDir, "---\nid: m1\ntitle: メモ\n---\n\n本文\n");

    const sync = readProject(projectDir);
    const asyncResult = await readProjectAsync(projectDir);

    expect([...asyncResult.tasks.keys()].sort()).toEqual([...sync.tasks.keys()].sort());
    expect(asyncResult.tasks.get("m1")).toEqual(sync.tasks.get("m1"));
  });

  it("同じ id のディレクトリが既にあるときは、旧ファイルを取り込まない", () => {
    // 移行の途中で落ちると「新しいディレクトリ」と「消し残した旧ファイル」が
    // 並ぶ。そのときはディレクトリを正とする。
    const projectDir = projectWithLegacyMemo(tmpDir, "---\nid: m1\ntitle: 旧\n---\n\n旧本文\n");
    writeTask(
      projectDir,
      {
        id: "m1",
        name: "新",
        parents: [{ id: "t1", order: 0 }],
        body: "新本文",
        format: "markdown",
        createdAt: "2026-09-04",
      },
      new Map()
    );

    const { tasks, legacyMemoFiles } = readProject(projectDir);

    expect(tasks.get("m1").name).toBe("新");
    expect(tasks.get("m1").body).toBe("新本文");
    expect(legacyMemoFiles.has("m1")).toBe(false);
  });
});

describe("旧メモの移行（書き）", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memo-node-w-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("保存すると自分のディレクトリへ移り、元のファイルは消える", async () => {
    const projectDir = projectWithLegacyMemo(tmpDir, "---\nid: m1\ntitle: メモ\n---\n\n本文\n");

    const { tasks } = await readProjectAsync(projectDir);
    await writeProjectAsync(projectDir, [...tasks.values()]);

    expect(fs.existsSync(path.join(projectDir, "m1", "_index.md"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "t1", "m1.md"))).toBe(false);
    // 親のディレクトリは巻き添えにしない。
    expect(fs.existsSync(path.join(projectDir, "t1", "_index.md"))).toBe(true);

    const { data } = parseFrontmatter(
      fs.readFileSync(path.join(projectDir, "m1", "_index.md"), "utf8")
    );
    expect(data.id).toBe("m1");
    expect(data.name).toBe("メモ");
  });

  it("本文が参照している画像を、新しいディレクトリへコピーする", async () => {
    const projectDir = projectWithLegacyMemo(
      tmpDir,
      "---\nid: m1\ntitle: メモ\n---\n\n見て ![](./assets/pic.png)\n"
    );
    fs.mkdirSync(path.join(projectDir, "t1", "assets"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "t1", "assets", "pic.png"), "PNGDATA");

    const { tasks } = await readProjectAsync(projectDir);
    await writeProjectAsync(projectDir, [...tasks.values()]);

    // 本文の `./assets/pic.png` は、移行後のディレクトリから解決できること。
    expect(fs.readFileSync(path.join(projectDir, "m1", "assets", "pic.png"), "utf8")).toBe(
      "PNGDATA"
    );
    // 移動ではなくコピー。親の本文や他のメモが同じ画像を指していても壊さない。
    expect(fs.existsSync(path.join(projectDir, "t1", "assets", "pic.png"))).toBe(true);
  });

  it("参照していない画像は運ばない", async () => {
    const projectDir = projectWithLegacyMemo(tmpDir, "---\nid: m1\ntitle: メモ\n---\n\n本文だけ\n");
    fs.mkdirSync(path.join(projectDir, "t1", "assets"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "t1", "assets", "other.png"), "PNGDATA");

    const { tasks } = await readProjectAsync(projectDir);
    await writeProjectAsync(projectDir, [...tasks.values()]);

    expect(fs.existsSync(path.join(projectDir, "m1", "assets"))).toBe(false);
  });

  it("移行後にもう一度読むと、旧メモは残っていない", async () => {
    const projectDir = projectWithLegacyMemo(tmpDir, "---\nid: m1\ntitle: メモ\n---\n\n本文\n");

    const first = await readProjectAsync(projectDir);
    await writeProjectAsync(projectDir, [...first.tasks.values()]);
    const second = await readProjectAsync(projectDir);

    expect(second.legacyMemoFiles.size).toBe(0);
    expect(second.tasks.get("m1").body).toBe("本文");
    expect(second.tasks.get("m1").parents.map((p: { id: string }) => p.id)).toEqual(["t1"]);
  });

  it("差分保存でも移行できる（親が変わっていなくてよい）", async () => {
    const projectDir = projectWithLegacyMemo(tmpDir, "---\nid: m1\ntitle: メモ\n---\n\n本文\n");

    const { tasks } = await readProjectAsync(projectDir);
    await writeProjectPatchAsync(projectDir, { tasks: [tasks.get("m1")], deletedTaskIds: [] });

    expect(fs.existsSync(path.join(projectDir, "m1", "_index.md"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "t1", "m1.md"))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, "t1", "_index.md"))).toBe(true);
  });

  // 一番危ない取り違え。旧メモノードの `taskDirs` は**親**を指しているので、
  // 素直にディレクトリを消すと親とその子が丸ごと消える。
  it("まだ移行していない旧メモを削除しても、親のディレクトリを消さない", async () => {
    const projectDir = projectWithLegacyMemo(tmpDir, "---\nid: m1\ntitle: メモ\n---\n\n本文\n");

    const { tasks } = await readProjectAsync(projectDir);
    await writeProjectPatchAsync(projectDir, {
      tasks: [],
      deletedTaskIds: ["m1"],
    });

    expect(fs.existsSync(path.join(projectDir, "t1", "_index.md"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "t1", "m1.md"))).toBe(false);
    expect(tasks.has("m1")).toBe(true);
  });
});
