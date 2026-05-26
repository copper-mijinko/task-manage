import { get } from "svelte/store";
import { beforeEach, describe, expect, test } from "vitest";

import { selected_id, selected_type } from "@stores/ui";
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
      { selectedType: "Projects", selectedId: "shared-id", projectDir: null },
      { selectedType: "WorkspaceProject", selectedId: "shared-id", projectDir: null },
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
});
