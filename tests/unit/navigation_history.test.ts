import { get } from "svelte/store";
import { beforeEach, describe, expect, test } from "vitest";

import { selected_id, selected_type, table_selected_id } from "@stores/ui";
import { workspace_store } from "@features/workspace/stores/workspace";
import { canGoBack, canGoForward, navigation_history } from "@stores/navigation_history";

/**
 * 履歴記録は selected_type / selected_id への subscribe を microtask で
 * 1 回にまとめてさばく。テストでは `await tick()` の代わりに素の microtask
 * を待つために `Promise.resolve()` を await する。
 */
async function flushMicrotask() {
  await Promise.resolve();
}

async function navigateTo(type: "Projects" | "WorkspaceProject" | "Info" | "Inbox", id: string) {
  selected_type.set(type);
  selected_id.set(id);
  await flushMicrotask();
}

async function navigateToWorkspaceProject(rootId: string, projectDir: string) {
  // MenuList.selectWorkspaceProject() と同じ順序：先に activeProjectDir、
  // 続けて selected_type / selected_id を更新する。
  workspace_store.setActiveProject(projectDir);
  selected_type.set("WorkspaceProject");
  selected_id.set(rootId);
  await flushMicrotask();
}

describe("navigation_history store", () => {
  beforeEach(() => {
    navigation_history.reset();
    selected_type.set(undefined);
    selected_id.set(undefined);
    table_selected_id.set(undefined);
    workspace_store.set({
      workspaces: [],
      activeWorkspacePath: null,
      activeProjectDir: null,
      projects: [],
    });
    navigation_history.init();
  });

  test("初期状態は entries 空・index -1。back / forward は無効", () => {
    const state = get(navigation_history);
    expect(state.entries).toEqual([]);
    expect(state.index).toBe(-1);
    expect(get(canGoBack)).toBe(false);
    expect(get(canGoForward)).toBe(false);
  });

  test("undefined / undefined への遷移は履歴に積まない", async () => {
    await flushMicrotask();
    expect(get(navigation_history).entries).toEqual([]);
  });

  test("ページ遷移ごとに 1 エントリ積まれ、back / forward で行き来できる", async () => {
    await navigateTo("Projects", "project-A");
    await navigateTo("Projects", "project-B");
    await navigateTo("WorkspaceProject", "ws-root-1");

    const state = get(navigation_history);
    expect(state.entries.map((e) => e.selectedId)).toEqual(["project-A", "project-B", "ws-root-1"]);
    expect(state.index).toBe(2);
    expect(get(canGoBack)).toBe(true);
    expect(get(canGoForward)).toBe(false);

    navigation_history.back();
    await flushMicrotask();
    expect(get(selected_type)).toBe("Projects");
    expect(get(selected_id)).toBe("project-B");
    expect(get(canGoForward)).toBe(true);

    navigation_history.back();
    await flushMicrotask();
    expect(get(selected_id)).toBe("project-A");
    expect(get(canGoBack)).toBe(false);

    navigation_history.forward();
    await flushMicrotask();
    expect(get(selected_id)).toBe("project-B");

    navigation_history.forward();
    await flushMicrotask();
    expect(get(selected_id)).toBe("ws-root-1");
    expect(get(canGoForward)).toBe(false);
  });

  test("back / forward 自体は履歴を再増殖させない（重複しない）", async () => {
    await navigateTo("Projects", "A");
    await navigateTo("Projects", "B");
    await navigateTo("Projects", "C");

    navigation_history.back();
    await flushMicrotask();
    navigation_history.back();
    await flushMicrotask();
    navigation_history.forward();
    await flushMicrotask();

    const state = get(navigation_history);
    expect(state.entries.map((e) => e.selectedId)).toEqual(["A", "B", "C"]);
    expect(state.index).toBe(1);
  });

  test("途中から別ページへ遷移すると forward 履歴は捨てられる", async () => {
    await navigateTo("Projects", "A");
    await navigateTo("Projects", "B");
    await navigateTo("Projects", "C");

    navigation_history.back();
    await flushMicrotask();
    navigation_history.back();
    await flushMicrotask();
    // 今 A にいる。forward 履歴は [B, C]。
    await navigateTo("Projects", "X");

    const state = get(navigation_history);
    expect(state.entries.map((e) => e.selectedId)).toEqual(["A", "X"]);
    expect(state.index).toBe(1);
    expect(get(canGoForward)).toBe(false);
  });

  test("同一ページへの再選択は履歴に積まない", async () => {
    await navigateTo("Projects", "A");
    await navigateTo("Projects", "A");
    await navigateTo("Projects", "A");

    expect(get(navigation_history).entries).toHaveLength(1);
  });

  test("selected_type だけ変わって id 据え置きの遷移も 1 エントリで済む", async () => {
    selected_type.set("Projects");
    selected_id.set("shared-id");
    await flushMicrotask();
    selected_type.set("WorkspaceProject");
    // id は維持
    await flushMicrotask();

    const state = get(navigation_history);
    expect(state.entries).toEqual([
      {
        selectedType: "Projects",
        selectedId: "shared-id",
        projectDir: null,
        workspacePath: null,
        tableSelectedId: undefined,
      },
      {
        selectedType: "WorkspaceProject",
        selectedId: "shared-id",
        projectDir: null,
        workspacePath: null,
        tableSelectedId: undefined,
      },
    ]);
  });

  test("WorkspaceProject の back は activeProjectDir も復元する", async () => {
    // ワークスペースプロジェクト A → B と移って戻ったとき、
    // workspace_store.activeProjectDir も A に巻き戻らないと
    // loadWorkspaceData が B のタスクを A の rootId で読んでしまい
    // unknown ノードが出る。
    await navigateToWorkspaceProject("root-A", "/ws/projectA");
    await navigateToWorkspaceProject("root-B", "/ws/projectB");

    expect(get(workspace_store).activeProjectDir).toBe("/ws/projectB");

    navigation_history.back();
    await flushMicrotask();

    expect(get(selected_id)).toBe("root-A");
    expect(get(workspace_store).activeProjectDir).toBe("/ws/projectA");

    navigation_history.forward();
    await flushMicrotask();

    expect(get(selected_id)).toBe("root-B");
    expect(get(workspace_store).activeProjectDir).toBe("/ws/projectB");
  });

  test("非 WorkspaceProject の back は activeProjectDir に触らない", async () => {
    workspace_store.setActiveProject("/ws/sticky");
    await navigateTo("Projects", "A");
    await navigateTo("Projects", "B");

    navigation_history.back();
    await flushMicrotask();

    // Projects 間の遷移なので activeProjectDir は変えない。
    expect(get(workspace_store).activeProjectDir).toBe("/ws/sticky");
  });

  test("type と id の同時セットは中間状態を履歴に残さない", async () => {
    await navigateTo("Projects", "A");

    // 同期的に両方更新
    selected_type.set("WorkspaceProject");
    selected_id.set("ws-1");
    await flushMicrotask();

    const state = get(navigation_history);
    expect(state.entries.map((e) => [e.selectedType, e.selectedId])).toEqual([
      ["Projects", "A"],
      ["WorkspaceProject", "ws-1"],
    ]);
  });

  test("先頭で back を押しても何も起きない", async () => {
    await navigateTo("Projects", "A");
    navigation_history.back();
    await flushMicrotask();

    expect(get(selected_id)).toBe("A");
    expect(get(navigation_history).index).toBe(0);
  });

  test("末尾で forward を押しても何も起きない", async () => {
    await navigateTo("Projects", "A");
    navigation_history.forward();
    await flushMicrotask();

    expect(get(selected_id)).toBe("A");
    expect(get(navigation_history).index).toBe(0);
  });

  test("microtask 未消化の状態で back されても押す前のページが履歴に残る", async () => {
    await navigateTo("Projects", "A");
    await navigateTo("Projects", "B");

    // B から C へ遷移したが flush 前に back を押す状況を再現。
    selected_type.set("Projects");
    selected_id.set("C");
    navigation_history.back();
    await flushMicrotask();

    const state = get(navigation_history);
    // C はちゃんと履歴に残った上で、現在地は B。
    expect(state.entries.map((e) => e.selectedId)).toEqual(["A", "B", "C"]);
    expect(state.index).toBe(1);
    expect(get(selected_id)).toBe("B");
  });

  test("Inbox / Info / WorkspaceProject も同じ履歴に乗る", async () => {
    await navigateTo("Projects", "A");
    await navigateTo("Inbox", "__inbox__");
    await navigateTo("Info", "1");
    await navigateTo("WorkspaceProject", "ws-1");

    const state = get(navigation_history);
    expect(state.entries.map((e) => e.selectedType)).toEqual([
      "Projects",
      "Inbox",
      "Info",
      "WorkspaceProject",
    ]);
  });

  test("ロード完了直後の table_selected_id fill-in は履歴を伸ばさず最後のエントリへ in-place で入る", async () => {
    await navigateTo("Projects", "A");
    expect(get(navigation_history).entries).toHaveLength(1);
    expect(get(navigation_history).entries[0].tableSelectedId).toBeUndefined();

    // 「ロード完了でルートを auto-select」のような system-driven な
    // table_selected_id 変更は in-place で fill-in される。
    table_selected_id.set("task-root");
    await flushMicrotask();
    expect(get(navigation_history).entries).toHaveLength(1);
    expect(get(navigation_history).entries[0].tableSelectedId).toBe("task-root");

    // 一度 fill-in した後は、subscriber 経路の table_selected_id 変更は
    // 履歴を一切触らない（pushSelection 経由でのみ反映される）。
    table_selected_id.set("task-2");
    await flushMicrotask();
    expect(get(navigation_history).entries).toHaveLength(1);
    expect(get(navigation_history).entries[0].tableSelectedId).toBe("task-root");
  });

  test("ページ遷移時、新ページの初期エントリの tableSelectedId は undefined にしておきロード完了で埋まる", async () => {
    await navigateTo("Projects", "A");
    table_selected_id.set("task-A1");
    await flushMicrotask();

    await navigateTo("Projects", "B");
    // ページ切替直後はまだ table_selected_id が古い A の値を持ったままだが、
    // 新エントリは undefined で記録される（旧値の混入を防ぐため）。
    // 続けてロード完了で B のルートが selectOnly される想定でセット：
    table_selected_id.set("task-B-root");
    await flushMicrotask();

    const state = get(navigation_history);
    expect(state.entries.map((e) => [e.selectedId, e.tableSelectedId])).toEqual([
      ["A", "task-A1"],
      ["B", "task-B-root"],
    ]);
  });

  test("activeWorkspacePath はエントリに記録される", async () => {
    workspace_store.update((s) => ({ ...s, activeWorkspacePath: "/ws/alpha" }));
    await navigateTo("Projects", "A");

    workspace_store.update((s) => ({ ...s, activeWorkspacePath: "/ws/beta" }));
    await navigateTo("Projects", "B");

    const state = get(navigation_history);
    expect(state.entries.map((e) => [e.selectedId, e.workspacePath])).toEqual([
      ["A", "/ws/alpha"],
      ["B", "/ws/beta"],
    ]);
  });

  test("workspace_store の non-navigation 変更（projects 一覧更新など）は履歴を伸ばさない", async () => {
    workspace_store.update((s) => ({ ...s, activeWorkspacePath: "/ws/x" }));
    await navigateTo("Projects", "A");
    expect(get(navigation_history).entries).toHaveLength(1);

    // projects 一覧だけ更新する（async setActive の load 完了等の挙動を模す）。
    workspace_store.update((s) => ({
      ...s,
      projects: [{ name: "p", rootId: "r", dirName: "d", projectDir: "/ws/x/p" }],
    }));
    await flushMicrotask();

    expect(get(navigation_history).entries).toHaveLength(1);
  });

  // TreeTable.handleSelectRow は selectOnly() を同期で呼んだ直後に
  // pushSelection() を呼ぶ。microtask が走る前に呼ぶことで「ユーザの
  // 能動的なクリック」というシグナルになる（subscriber 経路の in-place
  // 更新より先に push する）。テストヘルパでこの呼び順を模す。
  function userSelectTask(taskId: string) {
    table_selected_id.set(taskId);
    navigation_history.pushSelection();
  }

  test("pushSelection は同ページ内のタスク行切替を 1 エントリとして積む", async () => {
    await navigateTo("Projects", "A");
    expect(get(navigation_history).entries).toHaveLength(1);

    userSelectTask("task-1");
    await flushMicrotask();
    userSelectTask("task-2");
    await flushMicrotask();

    const state = get(navigation_history);
    expect(state.entries.map((e) => [e.selectedId, e.tableSelectedId])).toEqual([
      ["A", undefined],
      ["A", "task-1"],
      ["A", "task-2"],
    ]);
  });

  test("pushSelection で積んだタスク選択は back で逆める", async () => {
    await navigateTo("Projects", "A");
    userSelectTask("task-1");
    await flushMicrotask();
    userSelectTask("task-2");
    await flushMicrotask();
    userSelectTask("task-3");
    await flushMicrotask();

    expect(get(table_selected_id)).toBe("task-3");

    navigation_history.back();
    await flushMicrotask();
    expect(get(table_selected_id)).toBe("task-2");
    expect(get(selected_id)).toBe("A");

    navigation_history.back();
    await flushMicrotask();
    expect(get(table_selected_id)).toBe("task-1");

    navigation_history.forward();
    await flushMicrotask();
    expect(get(table_selected_id)).toBe("task-2");
  });

  test("pushSelection は直前エントリと完全一致する状態では no-op", async () => {
    await navigateTo("Projects", "A");
    userSelectTask("task-1");
    await flushMicrotask();

    // 同じタスクを連打しても重複しない
    navigation_history.pushSelection();
    navigation_history.pushSelection();
    navigation_history.pushSelection();

    expect(get(navigation_history).entries).toHaveLength(2);
  });

  test("ページ跨ぎ + タスクの 2 アクションは 2 回の back で巻き戻る", async () => {
    // クリック 1: A 表示 → entries[(A, undefined)]
    await navigateTo("Projects", "A");
    // クリック 2: A の task-A1 を選択 → 追加 entry
    userSelectTask("task-A1");
    await flushMicrotask();
    // クリック 3: B 表示 → 追加 entry。tableSelectedId は undefined（ロード未完了）
    await navigateTo("Projects", "B");
    // クリック 4: B の task-B1 を選択 → 追加 entry
    userSelectTask("task-B1");
    await flushMicrotask();

    // 1 回戻る = task-B1 選択操作のみ取り消し → (B, undefined) へ
    navigation_history.back();
    await flushMicrotask();
    expect(get(selected_id)).toBe("B");
    expect(get(table_selected_id)).toBeUndefined();

    // もう 1 回戻る = B へのページ遷移を取り消し → (A, task-A1) へ
    // table_selected_id の復元は loader (loadProjectsData) が
    // pendingTaskDetailSelection を読んで selectOnly(taskA1) する経路で
    // 行われるため、ここではユニットテスト範囲外。selected_id だけ確認する。
    navigation_history.back();
    await flushMicrotask();
    expect(get(selected_id)).toBe("A");
  });
});
