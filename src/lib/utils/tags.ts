/**
 * タグ文字列の正規化。タグはタスク自身にもメモにも付けられるため、
 * 表記ゆれ（大文字小文字、前後の空白、先頭の `#`）をここで一箇所に寄せる。
 */
export function normalizeTag(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^#+/, "")
    .trim()
    .toLowerCase();
}

/** 空文字と重複を落としたタグ配列を返す。入力が配列でなければ空配列。 */
export function normalizeTagList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const result: string[] = [];
  for (const entry of source) {
    const tag = normalizeTag(entry);
    if (!tag || result.includes(tag)) continue;
    result.push(tag);
  }
  return result;
}

/** 既存タグ配列へ 1 件追加した新しい配列を返す。重複・空文字は無視する。 */
export function withTagAdded(tags: unknown, value: unknown): string[] {
  const current = normalizeTagList(tags);
  const tag = normalizeTag(value);
  if (!tag || current.includes(tag)) return current;
  return [...current, tag];
}

/** 既存タグ配列から 1 件除いた新しい配列を返す。 */
export function withTagRemoved(tags: unknown, value: unknown): string[] {
  const tag = normalizeTag(value);
  return normalizeTagList(tags).filter((entry) => entry !== tag);
}
