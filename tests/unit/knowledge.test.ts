import { describe, expect, it } from "vitest";
import {
  buildKnowledgeItemsForProject,
  filterKnowledgeItems,
  sortKnowledgeItems,
} from "../../src/features/knowledge/stores/knowledge";
import type { WorkspaceTask } from "../../src/types/workspace";

const PROJECT = { name: "Web", projectDir: "/ws/web", rootId: "root" };

function memo(id: string, title: string, kind?: string, tags: string[] = []) {
  return {
    id,
    title,
    content: "",
    tags,
    format: "markdown" as const,
    ...(kind === undefined ? {} : { kind: kind as "working" | "knowledge" }),
  };
}

function task(over: Partial<WorkspaceTask> & { id: string }): WorkspaceTask {
  return {
    name: over.id,
    status: "Open",
    parents: ["root"],
    memos: [],
    createdAt: "2026-09-03",
    ...over,
  } as WorkspaceTask;
}

describe("buildKnowledgeItemsForProject", () => {
  it("ナレッジだけを集め、作業メモは無視する", () => {
    const items = buildKnowledgeItemsForProject(
      {
        root: task({ id: "root", name: "Web", parents: [] }),
        t1: task({
          id: "t1",
          name: "実装",
          memos: [memo("m1", "詰まった点"), memo("m2", "デプロイ手順", "knowledge")],
        }),
      },
      PROJECT
    );

    expect(items.map((i) => i.title)).toEqual(["デプロイ手順"]);
    expect(items[0].taskName).toBe("実装");
    expect(items[0].projectName).toBe("Web");
  });

  // ナレッジはタスクより長生きする前提なので、由来のタスクがアーカイブ
  // されても一覧から外さない。外すと「終わったら消える」に逆戻りする。
  it("アーカイブ済みタスクのナレッジも残し、印を付ける", () => {
    const items = buildKnowledgeItemsForProject(
      {
        root: task({ id: "root", name: "Web", parents: [] }),
        t1: task({
          id: "t1",
          name: "終わった作業",
          archived: true,
          memos: [memo("m1", "基準", "knowledge")],
        }),
      },
      PROJECT
    );

    expect(items).toHaveLength(1);
    expect(items[0].fromArchivedTask).toBe(true);
  });

  it("アーカイブは子孫にも波及する", () => {
    const items = buildKnowledgeItemsForProject(
      {
        root: task({ id: "root", name: "Web", parents: [] }),
        parent: task({ id: "parent", name: "親", archived: true }),
        child: task({
          id: "child",
          name: "子",
          parents: ["parent"],
          memos: [memo("m1", "知見", "knowledge")],
        }),
      },
      PROJECT
    );

    expect(items[0].fromArchivedTask).toBe(true);
  });

  it("親タスク名を文脈として持つ", () => {
    const items = buildKnowledgeItemsForProject(
      {
        root: task({ id: "root", name: "Web", parents: [] }),
        parent: task({ id: "parent", name: "設計" }),
        child: task({
          id: "child",
          name: "画面設計",
          parents: ["parent"],
          memos: [memo("m1", "方針", "knowledge")],
        }),
      },
      PROJECT
    );

    expect(items[0].parentPath).toBe("設計");
  });

  it("タイトルのないメモは無題として出す", () => {
    const items = buildKnowledgeItemsForProject(
      {
        t1: task({ id: "t1", memos: [memo("m1", "", "knowledge")] }),
      },
      PROJECT
    );

    expect(items[0].title).toBe("無題");
  });
});

describe("sortKnowledgeItems", () => {
  it("生きているものを先に、アーカイブ由来を後ろに置く", () => {
    const base = {
      memoId: "m",
      tags: [],
      taskId: "t",
      taskName: "t",
      projectDir: "/ws/a",
      projectRootId: "r",
      parentPath: "",
    };
    const sorted = sortKnowledgeItems([
      { ...base, title: "古い知見", projectName: "A", fromArchivedTask: true },
      { ...base, title: "今の知見", projectName: "A", fromArchivedTask: false },
    ]);

    expect(sorted.map((i) => i.title)).toEqual(["今の知見", "古い知見"]);
  });
});

describe("filterKnowledgeItems", () => {
  const items = buildKnowledgeItemsForProject(
    {
      root: task({ id: "root", name: "Web", parents: [] }),
      t1: task({
        id: "t1",
        name: "リリース準備",
        memos: [memo("m1", "配布手順", "knowledge", ["infra"])],
      }),
      t2: task({ id: "t2", name: "採用", memos: [memo("m2", "求人票の書き方", "knowledge")] }),
    },
    PROJECT
  );

  it("タイトルで絞り込む", () => {
    expect(filterKnowledgeItems(items, "手順").map((i) => i.title)).toEqual(["配布手順"]);
  });

  it("タグで絞り込む", () => {
    expect(filterKnowledgeItems(items, "infra").map((i) => i.title)).toEqual(["配布手順"]);
  });

  it("タスク名でも絞り込む", () => {
    expect(filterKnowledgeItems(items, "採用").map((i) => i.title)).toEqual(["求人票の書き方"]);
  });

  it("空の条件では全件返す", () => {
    expect(filterKnowledgeItems(items, "   ")).toHaveLength(2);
  });
});
