import {
  buildRenderItems,
  nearestIndices,
  scrollTopToReveal,
  visibleRowRange,
} from "@features/tasks/utils/virtual_rows";

const base = {
  rowCount: 1000,
  scrollTop: 0,
  viewportHeight: 240,
  rowHeight: 24,
  rowsOffset: 27,
  overscan: 5,
  fallbackAllRows: 200,
  fallbackWindowRows: 60,
};

describe("visibleRowRange", () => {
  test("covers the viewport plus overscan at the top", () => {
    // 240px の表示に 24px の行は 10 行。先頭なので前側の余分は無い。
    expect(visibleRowRange(base)).toEqual({ start: 0, end: 15 });
  });

  test("follows the scroll position, excluding the header height", () => {
    // 見出し 27px ぶんを引いた位置から数える: (1227 - 27) / 24 = 50 行目。
    expect(visibleRowRange({ ...base, scrollTop: 1227 })).toEqual({ start: 45, end: 65 });
  });

  test("clamps at the end of the rows", () => {
    expect(visibleRowRange({ ...base, scrollTop: 1_000_000 })).toEqual({
      start: 1000,
      end: 1000,
    });
    expect(visibleRowRange({ ...base, rowCount: 12, scrollTop: 100 })).toEqual({
      start: 0,
      end: 12,
    });
  });

  test("renders everything or a fixed head when the viewport cannot be measured", () => {
    expect(visibleRowRange({ ...base, rowCount: 150, viewportHeight: 0 })).toEqual({
      start: 0,
      end: 150,
    });
    expect(visibleRowRange({ ...base, viewportHeight: 0 })).toEqual({ start: 0, end: 60 });
  });

  test("returns an empty range when there are no rows", () => {
    expect(visibleRowRange({ ...base, rowCount: 0 })).toEqual({ start: 0, end: 0 });
  });
});

describe("buildRenderItems", () => {
  test("fills the rows outside the range with one gap on each side", () => {
    expect(buildRenderItems(10, { start: 3, end: 5 })).toEqual([
      { kind: "gap", start: 0, count: 3 },
      { kind: "row", index: 3 },
      { kind: "row", index: 4 },
      { kind: "gap", start: 5, count: 5 },
    ]);
  });

  test("keeps pinned rows in row order, split by gaps", () => {
    expect(buildRenderItems(10, { start: 4, end: 6 }, [8, 1, 5, 42, -1])).toEqual([
      { kind: "gap", start: 0, count: 1 },
      { kind: "row", index: 1 },
      { kind: "gap", start: 2, count: 2 },
      { kind: "row", index: 4 },
      { kind: "row", index: 5 },
      { kind: "gap", start: 6, count: 2 },
      { kind: "row", index: 8 },
      { kind: "gap", start: 9, count: 1 },
    ]);
  });

  test("has no gaps when every row is rendered", () => {
    expect(buildRenderItems(3, { start: 0, end: 3 })).toEqual([
      { kind: "row", index: 0 },
      { kind: "row", index: 1 },
      { kind: "row", index: 2 },
    ]);
  });

  test("always adds up to the full row count", () => {
    const items = buildRenderItems(500, { start: 120, end: 150 }, [3, 499, 200]);
    const total = items.reduce((sum, item) => sum + (item.kind === "gap" ? item.count : 1), 0);
    expect(total).toBe(500);
  });
});

describe("scrollTopToReveal", () => {
  const view = { scrollTop: 0, viewportHeight: 240, rowHeight: 24, rowsOffset: 27, topInset: 0 };

  test("does not scroll for a row that is already fully visible", () => {
    expect(scrollTopToReveal({ ...view, index: 3 })).toBeNull();
  });

  test("scrolls down just enough to show a row below the viewport", () => {
    // 行 20 の下端 = 27 + 21 * 24 = 531。表示の下端がそこに来る位置。
    expect(scrollTopToReveal({ ...view, index: 20 })).toBe(531 - 240);
  });

  test("scrolls up so a row above the viewport sits under the header and trail", () => {
    expect(scrollTopToReveal({ ...view, scrollTop: 2000, index: 10, topInset: 24 })).toBe(
      10 * 24 - 24
    );
  });
});

describe("nearestIndices", () => {
  test("returns every index when there are no more than the limit", () => {
    expect(nearestIndices([1, 5, 9], 100, 3)).toEqual([1, 5, 9]);
  });

  test("picks the indices closest to the center, in order", () => {
    const sorted = Array.from({ length: 100 }, (_, index) => index * 10);
    expect(nearestIndices(sorted, 500, 4)).toEqual([480, 490, 500, 510]);
  });

  test("fills from the other side at either end", () => {
    const sorted = [0, 10, 20, 30, 40, 50];
    expect(nearestIndices(sorted, -5, 3)).toEqual([0, 10, 20]);
    expect(nearestIndices(sorted, 999, 3)).toEqual([30, 40, 50]);
  });
});
