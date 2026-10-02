import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { vi } from "vitest";

vi.mock("@lib/ipc/platform", () => ({
  wsReadGraph: vi.fn(),
  wsReadAllNodeBodies: vi.fn(async () => ({})),
  onWorkspaceGraphUpdated: vi.fn(),
}));

import ActiveFilterBar from "@features/search/components/ActiveFilterBar.svelte";
import { filter } from "@features/search/stores/search";
import * as platform from "@lib/ipc/platform";
import { bodies_status, workspace_graph_store } from "@features/workspace/stores/graph";

/**
 * 本文の検索は、全ノードの本文を読み終えるまで結果（件数）が確定しない。
 * 読み込み中・失敗を、絞り込みの表示に出す。
 */
describe("ActiveFilterBar body search status", () => {
  beforeEach(() => {
    filter.set({ full_text: ["needle"], search_memo: ["1"] });
    bodies_status.set("idle");
  });

  test("says the result is not final while the bodies are being read", async () => {
    bodies_status.set("loading");
    render(ActiveFilterBar);
    expect(await screen.findByTestId("body-search-loading")).toHaveTextContent(
      "検索結果は読み込み後に確定します"
    );
    bodies_status.set("idle");
    await Promise.resolve();
    expect(screen.queryByTestId("body-search-loading")).toBeNull();
  });

  test("does not say anything when the body search is off", () => {
    filter.set({ full_text: ["needle"] });
    bodies_status.set("loading");
    render(ActiveFilterBar);
    expect(screen.queryByTestId("body-search-loading")).toBeNull();
  });

  test("tells that the bodies could not be read, and offers to read them again", async () => {
    vi.mocked(platform.wsReadGraph).mockResolvedValue({
      schemaVersion: 1,
      workspaceId: "w",
      rootId: "root",
      revision: 1,
      nodes: { root: { id: "root", name: "Root", parents: [], createdAt: "2026-01-01" } },
    });
    await workspace_graph_store.load("w");
    bodies_status.set("error");
    render(ActiveFilterBar);
    expect(await screen.findByTestId("body-search-error")).toHaveTextContent(
      "本文を読み込めませんでした"
    );
    await fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(platform.wsReadAllNodeBodies).toHaveBeenCalledWith("w");
    await vi.waitFor(() => expect(get(bodies_status)).toBe("idle"));
  });
});
