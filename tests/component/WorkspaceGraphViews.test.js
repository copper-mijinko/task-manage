import { fireEvent, render, screen } from "@testing-library/svelte";
import { vi } from "vitest";
vi.mock("@features/memos/components/Memo.svelte", async () => ({
  default: (await import("../mocks/PassThroughStub.svelte")).default,
}));
import WorkspaceTreeView from "../../src/features/workspace/components/WorkspaceTreeView.svelte";
import WorkspaceFinderView from "../../src/features/workspace/components/WorkspaceFinderView.svelte";
import WorkspaceNodeInspector from "../../src/features/workspace/components/WorkspaceNodeInspector.svelte";
import WorkspaceGraphView from "../../src/features/workspace/components/WorkspaceGraphView.svelte";
import InspectorEventHost from "../mocks/InspectorEventHost.svelte";

const node = (id, name, parents = [], extra = {}) => ({
  id,
  name,
  parents,
  createdAt: "2026-01-01",
  ...extra,
});
const graph = {
  schemaVersion: 1,
  workspaceId: "fixture",
  rootId: "root",
  revision: 1,
  nodes: {
    root: node("root", "Workspace"),
    a: node("a", "Alpha", [{ id: "root", order: 0 }]),
    b: node("b", "Shared", [
      { id: "a", order: 0 },
      { id: "root", order: 1 },
    ]),
    c: node("c", "Cycle", [{ id: "b", order: 0 }]),
    back: node("back", "Back", [{ id: "c", order: 0 }]),
  },
};
graph.nodes.a.parents.push({ id: "back", order: 0 });

describe("workspace graph views", () => {
  beforeEach(() => localStorage.clear());
  test("tree expands by occurrence and terminates a cycle", async () => {
    render(WorkspaceTreeView, { graph, showArchived: true, persistenceKey: "fixture" });
    await fireEvent.click(screen.getAllByLabelText("展開する")[0]);
    const alpha = screen.getByRole("button", { name: "Alpha" });
    expect(alpha).toBeInTheDocument();
    await fireEvent.click(alpha.previousElementSibling);
    await fireEvent.click(
      screen.getAllByRole("button", { name: "Shared" })[0].previousElementSibling
    );
    await fireEvent.click(screen.getByRole("button", { name: "Cycle" }).previousElementSibling);
    await fireEvent.click(screen.getByRole("button", { name: "Back" }).previousElementSibling);
    expect(screen.getByText(/循環参照/)).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("task-manage:tree-expanded:fixture")).length
    ).toBeGreaterThan(2);
  });
  test("Finder creates one Mac-style column per selected path", async () => {
    const { container } = render(WorkspaceFinderView, {
      graph,
      showArchived: true,
      persistenceKey: "fixture",
    });
    await fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    await fireEvent.click(screen.getByLabelText("Alpha の子").querySelector("button"));
    expect(container.querySelectorAll(".column")).toHaveLength(3);
    expect(screen.getByLabelText("Shared の子")).toBeInTheDocument();
  });
  test("inspector distinguishes absent status and protects root operations", async () => {
    const { unmount } = render(WorkspaceNodeInspector, {
      graph,
      nodeId: "root",
      workspacePath: "C:/fixture",
    });
    expect(screen.getByRole("button", { name: "ノードを削除" })).toBeDisabled();
    unmount();
    render(InspectorEventHost, { graph });
    await fireEvent.change(screen.getByLabelText("ステータス"), { target: { value: "Undefined" } });
    expect(
      JSON.parse(screen.getByTestId("execute-detail").textContent).command.changes.status
    ).toBe("Undefined");
    await fireEvent.change(screen.getByLabelText("ステータス"), { target: { value: "" } });
    expect(
      JSON.parse(screen.getByTestId("execute-detail").textContent).command.changes
    ).not.toHaveProperty("status");
  });
});
test("lays out a newly created node when persisted positions are partial", async () => {
  const initial = { ...graph, positions: { root: { x: 100, y: 100 }, a: { x: 250, y: 180 } } };
  const { rerender } = render(WorkspaceGraphView, { graph: initial });
  const created = node("new-node", "Created", [{ id: "root", order: 3 }]);
  await rerender({
    graph: { ...initial, revision: 2, nodes: { ...initial.nodes, [created.id]: created } },
  });
  expect(screen.getByRole("button", { name: "Created" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Created" }).getAttribute("transform")).toMatch(
    /^translate\([\d.]+,[\d.]+\)$/
  );
});
