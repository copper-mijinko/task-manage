/**
 * 2 つのグラフの違いを 1 行で言う（元に戻す / やり直しの通知に使う）。
 *
 * 履歴の段は差分だけで、どんな操作だったかの名前を持っていない。操作の前後の
 * グラフを比べて、変わったノードの名前を出す。
 */
interface NodeLike {
  name?: string;
}
interface GraphLike {
  nodes?: Record<string, NodeLike>;
}

export function changedNodeNames(before: GraphLike | null, after: GraphLike | null): string[] {
  const a = before?.nodes ?? {};
  const b = after?.nodes ?? {};
  const names: string[] = [];
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[id] === b[id]) continue;
    if (a[id] && b[id] && JSON.stringify(a[id]) === JSON.stringify(b[id])) continue;
    names.push((b[id]?.name ?? a[id]?.name ?? "").trim() || "（名前なし）");
  }
  return names;
}

export function describeHistoryStep(
  direction: "undo" | "redo",
  before: GraphLike | null,
  after: GraphLike | null
): string {
  const verb = direction === "undo" ? "元に戻しました" : "やり直しました";
  const names = changedNodeNames(before, after);
  if (names.length === 0) return verb;
  const rest = names.length > 1 ? ` ほか ${names.length - 1} 件` : "";
  return `${verb}：「${names[0]}」${rest}`;
}
