import { get } from "svelte/store";
import { describe, expect, it } from "vitest";

import {
  buildInheritedDueDateMap,
  buildNodePathMap,
  buildStickyTrail,
  getTopLevelSelection,
  isNodeEffectivelyArchived,
  restoreNode,
  flattenVisibleTree,
  type TreeData,
} from "../../src/features/tasks/utils/tree_control";

const N = (id: string, children: TreeData[] = []): TreeData => ({
  id,
  data: { name: id, status: "Open", "start date": undefined, "due date": undefined, memo: [] },
  children,
});

/**
 * 行に紐づく表示（名前パス・継承期限・パンくず）は、出現ごとに違う。
 * ノード id で引くと、別の親の下の値が混ざる。
 */
describe("行ごとの表示は経路で引く", () => {
  const withDue = (id: string, due: string | undefined, children: TreeData[] = []): TreeData => ({
    id,
    data: { name: id, status: "Open", "start date": undefined, "due date": due, memo: [] },
    children,
  });

  it("名前パスは出現ごとに違う", () => {
    const shared = withDue("C", undefined);
    const tree = withDue("root", undefined, [
      withDue("A", undefined, [shared]),
      withDue("B", undefined, [shared]),
    ]);
    const map = buildNodePathMap(flattenVisibleTree(tree, new Set(), false));

    expect(map.get("root/A/C")).toBe("root / A / C");
    expect(map.get("root/B/C")).toBe("root / B / C");
  });

  it("継承する期限は、その行の祖先から引く", () => {
    const shared = withDue("C", undefined);
    const tree = withDue("root", undefined, [
      withDue("A", "2026-01-01", [shared]),
      withDue("B", "2026-12-31", [shared]),
    ]);
    const map = buildInheritedDueDateMap(flattenVisibleTree(tree, new Set(), false));

    expect(map.get("root/A/C")).toBe("2026-01-01");
    expect(map.get("root/B/C")).toBe("2026-12-31");
  });

  it("パンくずは、その行の祖先列になる", () => {
    const shared = withDue("C", undefined, [withDue("D", undefined)]);
    const tree = withDue("root", undefined, [
      withDue("A", undefined, [shared]),
      withDue("B", undefined, [shared]),
    ]);
    const rows = flattenVisibleTree(tree, new Set(), false);
    // 行順: root, A, C, D, B, C, D。scrollTop=4 行ぶんが B の C を覆い、先頭は D。
    const trail = buildStickyTrail(rows, 5 * 40, 40);

    expect(trail.map((r) => r.path)).toEqual(["root", "root/B", "root/B/C"]);
  });
});

describe("Shift 選択の範囲も行で決まる", () => {
  it("下の出現を起点にすると、そこからの範囲になる", async () => {
    const { selectOnly, selectRange, selected_ids, selection_anchor_id } =
      await import("../../src/stores/ui");
    const shared = N("C");
    const tree = N("root", [N("A", [shared, N("A2")]), N("B", [shared, N("B2")])]);
    const rows = flattenVisibleTree(tree, new Set(), false);
    // 行順: root, A, C(A の下), A2, B, C(B の下), B2
    const ids = rows.map((r) => r.id);

    // B の下の C を起点に、B2 まで。
    selectOnly("C", "root/B/C");
    expect(get(selection_anchor_id)).toBe("C");
    selectRange("B2", ids, rows, "root/B/B2");
    expect(get(selected_ids)).toEqual(new Set(["C", "B2"]));

    // 起点が A の下の C なら、A2 以降ぜんぶが入る。
    selectOnly("C", "root/A/C");
    selectRange("B2", ids, rows, "root/B/B2");
    expect(get(selected_ids)).toEqual(new Set(["C", "A2", "B", "B2"]));
  });
});

/**
 * アーカイブと復元もノードの属性だが、「辿れるかどうか」は経路で決まる。
 */
describe("アーカイブ判定と復元", () => {
  const A = (id: string, archived: boolean, children: TreeData[] = []): TreeData => {
    const node = N(id, children);
    if (archived) {
      node.archived = true;
      node.archivedAt = "2026-09-04T00:00:00.000Z";
    }
    return node;
  };

  it("片方の親がアーカイブでも、もう片方から生きて辿れるなら生きている", () => {
    const shared = N("C");
    const tree = N("root", [A("A", true, [shared]), A("B", false, [shared])]);

    expect(isNodeEffectivelyArchived("C", tree)).toBe(false);
    expect(isNodeEffectivelyArchived("A", tree)).toBe(true);
  });

  it("すべての親がアーカイブなら、アーカイブされた扱い", () => {
    const shared = N("C");
    const tree = N("root", [A("A", true, [shared]), A("B", true, [shared])]);

    expect(isNodeEffectivelyArchived("C", tree)).toBe(true);
  });

  it("ツリーに無いノードは判定しない", () => {
    expect(isNodeEffectivelyArchived("nope", N("root", []))).toBe(false);
  });

  it("復元は、指定した行の祖先だけを解除する", () => {
    const shared = A("C", true);
    const tree = N("root", [A("A", true, [shared]), A("B", true, [shared])]);

    restoreNode("C", tree, "root/B/C");

    expect(tree.children[0].archived).toBe(true); // A はそのまま
    expect(tree.children[1].archived).toBeUndefined(); // B は解除
    expect(shared.archived).toBeUndefined();
  });
});

describe("選択の集約は重複を返さない", () => {
  it("多親ノードは、複数の経路に現れても 1 回だけ返る", () => {
    const shared = N("C");
    const tree = N("root", [N("A", [shared]), N("B", [shared])]);

    // 重複すると D&D が同じノードを 2 回挿入し、行の経路が衝突して描画が壊れる。
    expect(getTopLevelSelection(tree, new Set(["C"]))).toEqual(["C"]);
  });

  it("選択ノードの子孫は従来どおり畳まれる", () => {
    const tree = N("root", [N("A", [N("A1"), N("A2")]), N("B")]);
    expect(getTopLevelSelection(tree, new Set(["A", "A1", "B"]))).toEqual(["A", "B"]);
  });
});

describe("インデント可否は、循環になる場合も見る", () => {
  it("直前の兄弟が自分の子孫なら、行の canIndent が false", () => {
    const shared = N("C");
    const tree = N("root", [shared, N("B", [shared])]);
    const rows = flattenVisibleTree(tree, new Set(), false);

    const b = rows.find((r) => r.path === "root/B")!;
    expect(b.canIndent).toBe(false);
  });

  it("ふつうの兄弟なら true のまま", () => {
    const tree = N("root", [N("A"), N("B")]);
    const rows = flattenVisibleTree(tree, new Set(), false);
    expect(rows.find((r) => r.path === "root/B")!.canIndent).toBe(true);
  });
});
