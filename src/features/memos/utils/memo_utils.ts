export type MemoFormat = "markdown" | "quill";

export interface QuillDelta {
  ops: Array<{ insert?: unknown; attributes?: Record<string, unknown> }>;
}

export function normalizeMemoFormat(value: unknown, fallback: MemoFormat = "markdown"): MemoFormat {
  return value === "quill" || value === "markdown" ? value : fallback;
}

export function isQuillDelta(value: unknown): value is QuillDelta {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as { ops?: unknown }).ops)
  );
}

export function quillDeltaToMarkdown(delta: QuillDelta): string {
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

export function markdownToQuillDelta(markdown: unknown): QuillDelta {
  const text = typeof markdown === "string" ? markdown : toMarkdown(markdown);
  return {
    ops: [
      {
        insert: text.endsWith("\n") ? text : `${text}\n`,
      },
    ],
  };
}

export function convertMemoContent(
  content: unknown,
  fromFormat: MemoFormat,
  toFormat: MemoFormat
): unknown {
  if (fromFormat === toFormat) return content;
  if (toFormat === "markdown") return toMarkdown(content);
  return markdownToQuillDelta(content);
}

// 空メモ判定: 装飾損失の警告を出すかどうかの判定に使う
// Markdown: 空文字 / 空白のみ
// Quill: ops 空 / 単一の空 insert / 単一の改行のみ insert
export function isEmptyMemoContent(content: unknown): boolean {
  if (content == null) return true;
  if (typeof content === "string") return content.trim() === "";
  if (isQuillDelta(content)) {
    const { ops } = content;
    if (ops.length === 0) return true;
    if (ops.length === 1) {
      const insert = ops[0].insert;
      return insert === "" || insert === "\n";
    }
    return false;
  }
  return false;
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
export function searchMemoEntries(memos: Array<{ content: unknown }>, keywords: string[]): boolean {
  return memos.some((entry) =>
    keywords.some((keyword) =>
      memoContentForSearch(entry.content).toLowerCase().includes(keyword.toLowerCase())
    )
  );
}
