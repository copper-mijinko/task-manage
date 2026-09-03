import { describe, expect, it } from "vitest";
import { MEMO_KIND_LABELS, normalizeMemoKind } from "../../src/features/memos/utils/memo_utils";
import { comparableWorkspaceTask } from "../../src/features/tasks/stores/tree";
import { projectDataToWorkspaceTasks } from "../../src/features/workspace/utils/workspace_tree";
import type { WorkspaceTask } from "../../src/types/workspace";

describe("normalizeMemoKind", () => {
  it("既知の種別はそのまま通す", () => {
    expect(normalizeMemoKind("working")).toBe("working");
    expect(normalizeMemoKind("knowledge")).toBe("knowledge");
  });

  it("kind を持たない既存メモは作業メモとして読む", () => {
    expect(normalizeMemoKind(undefined)).toBe("working");
    expect(normalizeMemoKind(null)).toBe("working");
    expect(normalizeMemoKind("")).toBe("working");
    expect(normalizeMemoKind("なにか他の値")).toBe("working");
  });

  it("日本語ラベルを持つ", () => {
    expect(MEMO_KIND_LABELS.working).toBe("作業メモ");
    expect(MEMO_KIND_LABELS.knowledge).toBe("ナレッジ");
  });
});

function taskWithMemoKind(kind: string | undefined): WorkspaceTask {
  return {
    id: "t1",
    name: "タスク",
    status: "Open",
    parents: ["root"],
    createdAt: "2026-09-03",
    memos: [
      {
        id: "m1",
        title: "メモ",
        content: "本文",
        tags: [],
        format: "markdown",
        ...(kind === undefined ? {} : { kind: kind as "working" | "knowledge" }),
      },
    ],
  };
}

describe("comparableWorkspaceTask", () => {
  // 実際にあったバグ。kind が差分判定から漏れていたため、種別だけを変えた編集が
  // 「変更なし」と判定され、画面とキャッシュだけ変わってファイルに書かれなかった。
  it("種別だけの変更を差分として検出する", () => {
    const before = comparableWorkspaceTask(taskWithMemoKind("working"));
    const after = comparableWorkspaceTask(taskWithMemoKind("knowledge"));

    expect(before).not.toEqual(after);
  });

  it("kind 未設定と working は同じものとして扱う（無用な書き込みを起こさない）", () => {
    expect(comparableWorkspaceTask(taskWithMemoKind(undefined))).toEqual(
      comparableWorkspaceTask(taskWithMemoKind("working"))
    );
  });

  /**
   * 永続化されるメモのフィールドは、すべて差分判定にも載っている必要がある。
   * 載せ忘れると「保存済み」と表示されたままディスクに書かれない。
   * 期待値は `electron/workspace.js` の writeMemoFiles が書き出すキーに対応する。
   */
  it("永続化されるメモのフィールドをすべて含む", () => {
    const comparable = comparableWorkspaceTask(taskWithMemoKind("knowledge"));
    expect(Object.keys(comparable.memos[0]).sort()).toEqual(
      ["content", "format", "id", "kind", "order", "tags", "title"].sort()
    );
  });
});

describe("projectDataToWorkspaceTasks", () => {
  it("メモの種別を保存用のタスクへ引き継ぐ", () => {
    const tasks = projectDataToWorkspaceTasks(
      {
        headers: [],
        data: {
          id: "root",
          data: { name: "P", status: "Open", memo: [], attachments: [] },
          children: [
            {
              id: "t1",
              data: {
                name: "タスク",
                status: "Open",
                attachments: [],
                memo: [
                  { id: "m1", title: "作業", content: "a", tags: [], format: "markdown" },
                  {
                    id: "m2",
                    title: "手順",
                    content: "b",
                    tags: [],
                    format: "markdown",
                    kind: "knowledge",
                  },
                ],
              },
              children: [],
            },
          ],
        },
      } as never,
      {}
    );

    const task = tasks.find((t) => t.id === "t1");
    expect(task?.memos.map((m) => m.kind)).toEqual(["working", "knowledge"]);
  });
});
