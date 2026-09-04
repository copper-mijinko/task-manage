import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import ParentField from "@features/tasks/components/ParentField.svelte";

function createProps(over = {}) {
  return {
    parentIds: ["p1"],
    candidates: [
      { id: "p2", name: "リリース準備", path: "Web リニューアル" },
      { id: "p3", name: "デザインカンプ作成", path: "Web リニューアル" },
      { id: "p4", name: "требования", path: "" },
    ],
    nameById: { p1: "Web リニューアル", p2: "リリース準備", p3: "デザインカンプ作成" },
    ...over,
  };
}

describe("ParentField", () => {
  test("現在の親をチップで出す", () => {
    render(ParentField, { props: createProps() });

    expect(screen.getByText("Web リニューアル")).toBeInTheDocument();
  });

  // 孤児を作らないための不変条件。最後の 1 つは外せない。
  test("唯一の親は外せない", () => {
    render(ParentField, { props: createProps() });

    expect(screen.getByRole("button", { name: /唯一の親なので外せません/ })).toBeDisabled();
  });

  test("親が 2 つ以上あれば外せる", () => {
    render(ParentField, {
      props: createProps({ parentIds: ["p1", "p2"] }),
    });

    expect(screen.getByRole("button", { name: "親 Web リニューアル を外す" })).toBeEnabled();
  });

  test("入力するまで候補は出さない", () => {
    render(ParentField, { props: createProps() });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("入力に応じて候補を絞る", async () => {
    render(ParentField, { props: createProps() });

    await fireEvent.input(screen.getByLabelText("親ノードを追加"), {
      target: { value: "リリース" },
    });
    await tick();

    expect(screen.getByRole("option", { name: /リリース準備/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /デザインカンプ作成/ })).not.toBeInTheDocument();
  });

  // VS Code のように、文字が順に含まれていれば拾う。
  test("連続していなくても文字が順に含まれれば拾う", async () => {
    render(ParentField, { props: createProps() });

    await fireEvent.input(screen.getByLabelText("親ノードを追加"), {
      target: { value: "デ作成" },
    });
    await tick();

    expect(screen.getByRole("option", { name: /デザインカンプ作成/ })).toBeInTheDocument();
  });

  test("既に親になっているものは候補に出ない", async () => {
    render(ParentField, {
      props: createProps({ parentIds: ["p1", "p2"] }),
    });

    await fireEvent.input(screen.getByLabelText("親ノードを追加"), {
      target: { value: "リリース" },
    });
    await tick();

    expect(screen.queryByRole("option", { name: /リリース準備/ })).not.toBeInTheDocument();
  });

  test("候補を選ぶと親の追加を通知する", async () => {
    const changes = [];
    render(ParentField, {
      props: createProps(),
      events: { change: (event) => changes.push(event.detail.parentIds) },
    });

    await fireEvent.input(screen.getByLabelText("親ノードを追加"), {
      target: { value: "リリース" },
    });
    await tick();
    await fireEvent.click(screen.getByRole("option", { name: /リリース準備/ }));

    expect(changes).toEqual([["p1", "p2"]]);
  });

  test("一致が無いときは理由を出す", async () => {
    render(ParentField, { props: createProps() });

    await fireEvent.input(screen.getByLabelText("親ノードを追加"), {
      target: { value: "存在しない語" },
    });
    await tick();

    expect(screen.getByText(/自分自身と子孫は候補に出ません/)).toBeInTheDocument();
  });
});
