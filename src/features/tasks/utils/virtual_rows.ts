/**
 * ツリーの行を「見えている範囲だけ」描くための計算。
 *
 * 行の高さは `--tree-row-height` で固定なので、スクロール位置から描くべき
 * 行の範囲を割り算で出せる。描かない行は、同じ高さの空白（gap）で置き換え、
 * スクロールバーの長さと各行の位置を変えない。
 *
 * 画面外でも描いておきたい行（いま操作している行、ドラッグ中の行、
 * ページ内検索に一致する行）は `pinned` で渡す。範囲外の行は間を gap で
 * 埋めて、行番号の順に並べる（DOM の順＝見た目の順を保つ）。
 */

export interface RowRange {
  /** 描く最初の行（含む）。 */
  start: number;
  /** 描く最後の行の次（含まない）。 */
  end: number;
}

export interface RowWindowInput {
  rowCount: number;
  /** スクロール容器の scrollTop（px）。 */
  scrollTop: number;
  /** スクロール容器の見えている高さ（px）。0 は「まだ測れていない」。 */
  viewportHeight: number;
  /** 1 行の高さ（px）。 */
  rowHeight: number;
  /** スクロール内容の先頭から最初の行までの距離（見出しの高さ, px）。 */
  rowsOffset: number;
  /** 見えている範囲の前後に余分に描く行数。 */
  overscan: number;
  /** 高さが測れないとき、この行数以下なら全部描く。 */
  fallbackAllRows: number;
  /** 高さが測れず全部は描かないときに、先頭から描く行数。 */
  fallbackWindowRows: number;
}

export function visibleRowRange(input: RowWindowInput): RowRange {
  const { rowCount, scrollTop, viewportHeight, rowHeight, rowsOffset, overscan } = input;
  if (rowCount <= 0) return { start: 0, end: 0 };
  if (!(viewportHeight > 0) || !(rowHeight > 0)) {
    // レイアウトが無い（テストの jsdom や、畳まれたペイン）。少なければ全部、
    // 多ければ先頭だけ描き、測れるようになったら描き直す。
    if (rowCount <= input.fallbackAllRows) return { start: 0, end: rowCount };
    return { start: 0, end: Math.min(rowCount, input.fallbackWindowRows) };
  }
  const top = Math.max(0, scrollTop - rowsOffset);
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + viewportHeight) / rowHeight);
  const start = Math.min(rowCount, Math.max(0, first - overscan));
  const end = Math.min(rowCount, Math.max(start, last + overscan));
  return { start, end };
}

export type RenderItem =
  | { kind: "row"; index: number }
  /** `count` 行ぶんの空白。`start` は空白が置き換える最初の行。 */
  | { kind: "gap"; start: number; count: number };

/**
 * 描く行（範囲＋pinned）と、その間を埋める空白を、行の順に並べる。
 */
export function buildRenderItems(
  rowCount: number,
  range: RowRange,
  pinned: Iterable<number> = []
): RenderItem[] {
  const indices = new Set<number>();
  for (let index = range.start; index < range.end; index += 1) indices.add(index);
  for (const index of pinned) {
    if (Number.isInteger(index) && index >= 0 && index < rowCount) indices.add(index);
  }
  const sorted = [...indices].sort((a, b) => a - b);
  const items: RenderItem[] = [];
  let next = 0;
  for (const index of sorted) {
    if (index > next) items.push({ kind: "gap", start: next, count: index - next });
    items.push({ kind: "row", index });
    next = index + 1;
  }
  if (next < rowCount) items.push({ kind: "gap", start: next, count: rowCount - next });
  return items;
}

/**
 * 行が見える位置に来るように、必要なら scrollTop を返す（動かさなくてよければ null）。
 *
 * 先頭側は、見出し（`rowsOffset`）と、その下に重なる経路表示ぶん
 * （`topInset`）を避ける。
 */
export function scrollTopToReveal(input: {
  index: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  rowsOffset: number;
  topInset: number;
}): number | null {
  const { index, scrollTop, viewportHeight, rowHeight, rowsOffset, topInset } = input;
  if (!(viewportHeight > 0) || !(rowHeight > 0) || index < 0) return null;
  const rowTop = rowsOffset + index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const visibleTop = scrollTop + rowsOffset + topInset;
  const visibleBottom = scrollTop + viewportHeight;
  if (rowTop < visibleTop) return Math.max(0, rowTop - rowsOffset - topInset);
  if (rowBottom > visibleBottom) return Math.max(0, rowBottom - viewportHeight);
  return null;
}

/**
 * 昇順の行番号から、`center` に近い順に最大 `limit` 個を選ぶ。
 *
 * ページ内検索で一致する行をすべて描くと、よくある語では全行を描くことに
 * なり、仮想化した意味が無くなる。表示位置の近くにある一致だけを描き、
 * 次の一致へ進んで表示位置が動けば、その周りの一致が描かれる。
 */
export function nearestIndices(sorted: number[], center: number, limit: number): number[] {
  if (sorted.length <= limit) return sorted;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < center) lo = mid + 1;
    else hi = mid;
  }
  let left = lo - 1;
  let right = lo;
  const picked: number[] = [];
  while (picked.length < limit && (left >= 0 || right < sorted.length)) {
    const takeLeft =
      right >= sorted.length || (left >= 0 && center - sorted[left] <= sorted[right] - center);
    if (takeLeft) picked.push(sorted[left--]);
    else picked.push(sorted[right++]);
  }
  return picked.sort((a, b) => a - b);
}
