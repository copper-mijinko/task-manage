export function isQuillDelta(value: unknown): value is { ops: Array<{ insert?: unknown }> } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { ops?: unknown }).ops)
  );
}

export function quillDeltaToMarkdown(delta: { ops: Array<{ insert?: unknown }> }): string {
  return delta.ops
    .map((op) => {
      if (typeof op.insert === "string") {
        return op.insert;
      }
      if (
        typeof op.insert === "object" &&
        op.insert !== null &&
        typeof (op.insert as { image?: unknown }).image === "string"
      ) {
        return `![](${(op.insert as { image: string }).image})`;
      }
      return "";
    })
    .join("")
    .replace(/\s+$/, "");
}

export function toMarkdown(val: unknown): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (isQuillDelta(val)) return quillDeltaToMarkdown(val);
  return JSON.stringify(val, null, 2);
}

// data URL (base64) を除去して照合コストを下げる
export function memoContentForSearch(val: unknown): string {
  return toMarkdown(val).replace(/data:[^)]+/g, "");
}

// 将来 elasticlunr 等のインデックス型エンジンに差し替え可能な検索ポイント
export function searchMemoEntries(
  memos: Array<{ content: unknown }>,
  keywords: string[]
): boolean {
  return memos.some((entry) =>
    keywords.some((keyword) =>
      memoContentForSearch(entry.content).toLowerCase().includes(keyword.toLowerCase())
    )
  );
}
