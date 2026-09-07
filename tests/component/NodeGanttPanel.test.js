import { fireEvent, render } from "@testing-library/svelte";
import NodeGanttPanel from "@features/gantt/components/NodeGanttPanel.svelte";

const task = (id, extra = {}) => ({ id, name: id, parents: [], createdAt: "2026-01-01", ...extra });

describe("NodeGanttPanel", () => {
  it("renders one row per node and exposes the status-only section", () => {
    const { container, getByText } = render(NodeGanttPanel, {
      props: {
        rootId: "root",
        nodes: { root: task("root"), child: task("child", { status: "Undefined" }) },
      },
    });
    expect(container.querySelectorAll("[data-row-id]")).toHaveLength(1);
    expect(getByText("日付未設定", { selector: "h3" })).toBeInTheDocument();
  });

  it("selects a node and validates an invalid date visibly", async () => {
    const onSelect = vi.fn();
    const { getByRole, findByRole } = render(NodeGanttPanel, {
      props: {
        rootId: "root",
        nodes: { root: task("root"), child: task("child", { startDate: "2026-02-31" }) },
        onSelect,
      },
    });
    await fireEvent.click(getByRole("button", { name: "child" }));
    expect(onSelect).toHaveBeenCalledWith("child");
    expect(await findByRole("alert")).toHaveTextContent("YYYY-MM-DD");
  });

  it("edits a status-only node date through onUpdate", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { getByLabelText } = render(NodeGanttPanel, {
      props: {
        rootId: "root",
        nodes: { root: task("root"), child: task("child", { status: "Undefined" }) },
        onUpdate,
      },
    });
    await fireEvent.change(getByLabelText("child の開始日"), { target: { value: "2026-02-05" } });
    expect(onUpdate).toHaveBeenCalledWith("child", { startDate: "2026-02-05" });
  });

  it("rejects reversed dates without updating and shows an error", async () => {
    const onUpdate = vi.fn();
    const { getByLabelText, findByRole } = render(NodeGanttPanel, {
      props: {
        rootId: "root",
        nodes: {
          root: task("root"),
          child: task("child", { startDate: "2026-02-05", dueDate: "2026-02-10" }),
        },
        onUpdate,
      },
    });
    await fireEvent.change(getByLabelText("child の期限日"), { target: { value: "2026-02-01" } });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(await findByRole("alert")).toHaveTextContent("開始日以降");
  });

  it("shows rejected update errors", async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error("保存に失敗しました"));
    const { getByLabelText, findByRole } = render(NodeGanttPanel, {
      props: {
        rootId: "root",
        nodes: { root: task("root"), child: task("child", { dueDate: "2026-02-10" }) },
        onUpdate,
      },
    });
    await fireEvent.change(getByLabelText("child の開始日"), { target: { value: "2026-02-05" } });
    expect(await findByRole("alert")).toHaveTextContent("保存に失敗しました");
  });
});
