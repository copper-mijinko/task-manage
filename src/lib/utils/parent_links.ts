import type { WorkspaceParentLink } from "@app-types/workspace";

/**
 * 親リンクの正規化。
 *
 * ファイル上の `parents:` は 3 つの形を受ける。
 *   - `parents: [{ id, order }]`  … 現行。順序は辺の属性
 *   - `parents: [id, id]`         … 旧形式・手書きの短縮形。順序は未指定
 *   - `parents: id`               … 単一のスカラー
 * 旧形式にはタスク直下の `order` が 1 つあるだけなので、その値を全ての辺に
 * 配る（＝旧来の「どの親の下でも同じ位置」という意味をそのまま保つ）。
 */
export function normalizeParentLinks(raw: unknown, fallbackOrder?: number): WorkspaceParentLink[] {
  const list = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
  const result: WorkspaceParentLink[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    let id: string | undefined;
    let order: number | undefined;
    if (typeof entry === "string") {
      id = entry;
      order = fallbackOrder;
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      id = typeof record.id === "string" ? record.id : undefined;
      // frontmatter 由来では数値が文字列で来る（自前パーサのため）。
      order =
        record.order != null && Number.isFinite(Number(record.order))
          ? Number(record.order)
          : undefined;
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(order === undefined ? { id } : { id, order });
  }
  return result;
}

/** 親 id だけが要る呼び出し向け。 */
export function parentIdsOf(parents: readonly WorkspaceParentLink[] | undefined): string[] {
  return (parents ?? []).map((parent) => parent.id);
}

/** その親の下での並び順。未指定は末尾に置くため Infinity を返す。 */
export function orderUnderParent(
  parents: readonly WorkspaceParentLink[] | undefined,
  parentId: string
): number {
  const link = (parents ?? []).find((parent) => parent.id === parentId);
  return typeof link?.order === "number" ? link.order : Number.POSITIVE_INFINITY;
}
