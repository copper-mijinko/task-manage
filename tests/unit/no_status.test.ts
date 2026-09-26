import { describe, it, expect } from "vitest";

// @ts-expect-error -- main プロセス側は JS のまま

import { filterTree, sortTree, NO_STATUS } from "../../src/features/tasks/utils/tree_control";
import type { TreeData } from "../../src/features/tasks/utils/tree_control";

/**
 * ステータス「無し」は既定値ではなく**状態のひとつ**である。
 *
 * メモがノードになると、「期限とステータスで追跡するノード」と「ただ書いて
 * あるノード」が同じ空間に並ぶ。後者に既定のステータスを与えると、ノート 1 つ
 * 1 つが「未着手のタスク」として積み上がり、ステータス列も絞り込みも意味を
 * 失う。だから「無し」を潰さないことが要件になる。
 *
 * 潰れる箇所は決まっていて、どれも `|| "Open"` のようなフォールバックである。
 * ここではその往復（ファイル ⇄ ワークスペース ⇄ ツリー）を固定する。
 */

function node(id: string, status: string, children: TreeData[] = []): TreeData {
  return {
    id,
    data: {
      name: id,
      status: status as TreeData["data"]["status"],
      "start date": undefined,
      "due date": undefined,
      memo: [],
    },
    children,
  };
}

describe("ステータス無し: 絞り込みと並べ替え", () => {
  const tree = (): TreeData =>
    node("root", "Open", [node("a", NO_STATUS), node("b", "Pending"), node("c", "Open")]);

  it("「なし」で絞り込むと、ステータスを持たない行だけが残る", () => {
    const filtered = filterTree(tree(), { status: [NO_STATUS] });

    expect(filtered!.children.map((child) => child.id)).toEqual(["a"]);
  });

  it("「なし」の絞り込みが全行に当たってしまわない", () => {
    // 部分一致で見ていると、あらゆる文字列が "" を含むので全行が残る。
    const filtered = filterTree(tree(), { status: [NO_STATUS] });

    expect(filtered!.children).toHaveLength(1);
  });

  it("状態を選んだときに、ステータス無しの行が紛れ込まない", () => {
    const filtered = filterTree(tree(), { status: ["Open"] });

    expect(filtered!.children.map((child) => child.id)).toEqual(["c"]);
  });

  it("ステータス順の並べ替えでは、無しを最後に置く", () => {
    const sorted = sortTree(tree(), { column: "status", direction: "asc" }) as TreeData;

    expect(sorted.children.map((child) => child.id)).toEqual(["c", "b", "a"]);
  });
});
