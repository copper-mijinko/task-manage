import { marked, type Tokens } from "marked";

// Syntax highlighting is configured lazily in MarkdownMemo so highlight.js
// stays out of the startup bundle.
// marked 設定:
//  - gfm: GitHub Flavored Markdown (タスクリスト、打消し線、テーブル等)
//  - breaks: false (Markdown 標準仕様)。行末スペース2個+\n のみ hard break、単純 \n は同段落内空白扱い
//  - tokenizer.code: 行頭4-space インデントを code block 扱いしない (インデント保持目的)
marked.use({
  gfm: true,
  breaks: false,
  tokenizer: {
    code() {
      return undefined;
    },
  },
  renderer: {
    // GFM のデフォルトは disabled 属性付き checkbox を出力するため、プレビュー上で
    // ユーザーがクリックしてもチェック状態を切り替えられない。disabled を外して
    // MarkdownMemo 側の click ハンドラがソース行 (`- [ ]` / `- [x]`) を直接編集
    // できるようにする。
    checkbox({ checked }) {
      return `<input type="checkbox"${checked ? " checked" : ""}>`;
    },
  },
});

export type MemoFormat = "markdown" | "quill";

export interface QuillDelta {
  ops: Array<{ insert?: unknown; attributes?: Record<string, unknown> }>;
}

type QuillAttrs = Record<string, unknown>;
type QuillOp = { insert: string | { image: string }; attributes?: QuillAttrs };

export function normalizeMemoFormat(value: unknown, fallback: MemoFormat = "markdown"): MemoFormat {
  return value === "quill" || value === "markdown" ? value : fallback;
}

export function isQuillDelta(value: unknown): value is QuillDelta {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as { ops?: unknown }).ops)
  );
}

// link の leading/trailing space を link 外に出す Markdown 慣例の補助。
function wrapLink(inner: string, href: string): string {
  const leadingMatch = /^[ \t]+/.exec(inner);
  const trailingMatch = /[ \t]+$/.exec(inner);
  const leading = leadingMatch ? leadingMatch[0] : "";
  const trailing = trailingMatch ? trailingMatch[0] : "";
  const core = inner.slice(leading.length, inner.length - trailing.length);
  if (!core) return inner; // space のみ — link 構文化しない
  return `${leading}[${core}](${href})${trailing}`;
}

// インライン装飾を Markdown 構文で巻く。
// 巻き順は: code → bold/italic/strike/underline → link。codeの中にはbold等が入らないので最内側。
function wrapInline(text: string, attrs: QuillAttrs | undefined): string {
  if (!text || !attrs) return text;
  if (attrs.code) {
    const r = "`" + text + "`";
    return attrs.link ? wrapLink(r, attrs.link as string) : r;
  }
  let r = text;
  if (attrs.bold && attrs.italic) r = `***${r}***`;
  else if (attrs.bold) r = `**${r}**`;
  else if (attrs.italic) r = `*${r}*`;
  if (attrs.strike) r = `~~${r}~~`;
  if (attrs.underline) r = `<u>${r}</u>`;
  if (attrs.link) r = wrapLink(r, attrs.link as string);
  return r;
}

type DeltaLine = { inline: string; blockAttrs: QuillAttrs };

function deltaToLines(ops: QuillDelta["ops"]): DeltaLine[] {
  const lines: DeltaLine[] = [];
  let currentInline = "";
  for (const op of ops) {
    if (op.insert == null) continue;
    if (typeof op.insert === "object") {
      const img = (op.insert as { image?: string }).image;
      if (typeof img === "string") currentInline += `![](${img})`;
      continue;
    }
    if (typeof op.insert !== "string") continue;
    const text = op.insert;
    const inlineAttrs = op.attributes;
    let i = 0;
    while (i < text.length) {
      const nl = text.indexOf("\n", i);
      if (nl === -1) {
        currentInline += wrapInline(text.slice(i), inlineAttrs);
        break;
      }
      if (nl > i) currentInline += wrapInline(text.slice(i, nl), inlineAttrs);
      // この "\n" の attributes は op が「改行のみ」のとき行属性として扱われるが、
      // テキスト+改行が混在する op では「inlineAttrsが行属性も兼ねる」ケースがある。
      // Quill の仕様上、行属性 (header/list/...) は専ら「\n のみの op」に付くため、
      // ここでは inlineAttrs を行属性候補として渡し、後段で行属性キーのみを抽出する。
      lines.push({ inline: currentInline, blockAttrs: inlineAttrs ?? {} });
      currentInline = "";
      i = nl + 1;
    }
  }
  if (currentInline) lines.push({ inline: currentInline, blockAttrs: {} });
  return lines;
}

const BLOCK_ATTR_KEYS = new Set([
  "table",
  "header",
  "list",
  "blockquote",
  "code-block",
  "indent",
  "align",
  "direction",
]);

function pickBlockAttrs(attrs: QuillAttrs): QuillAttrs {
  const out: QuillAttrs = {};
  for (const k of Object.keys(attrs)) if (BLOCK_ATTR_KEYS.has(k)) out[k] = attrs[k];
  return out;
}

type BlockType = "heading" | "paragraph" | "list" | "blockquote" | "code-block" | "table";

type Block = {
  type: BlockType;
  lines: { inline: string; attrs: QuillAttrs }[];
};

function getBlockType(attrs: QuillAttrs): BlockType {
  if (attrs.table) return "table";
  if (attrs["code-block"]) return "code-block";
  if (attrs.list) return "list";
  if (attrs.blockquote) return "blockquote";
  if (typeof attrs.header === "number") return "heading";
  return "paragraph";
}

// listとblockquoteとcode-blockは隣接する同種行を1つのMdブロックにまとめる。
// heading/paragraphはMd上で空行区切りが必要なので、行ごとに別ブロックに分ける。
function shouldGroupAdjacent(type: BlockType): boolean {
  return type === "list" || type === "blockquote" || type === "code-block" || type === "table";
}

function groupBlocks(lines: DeltaLine[]): Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const attrs = pickBlockAttrs(line.blockAttrs);
    const type = getBlockType(attrs);
    const last = blocks[blocks.length - 1];
    if (last && last.type === type && shouldGroupAdjacent(type)) {
      last.lines.push({ inline: line.inline, attrs });
    } else {
      blocks.push({ type, lines: [{ inline: line.inline, attrs }] });
    }
  }
  return blocks;
}

function renderListBlock(block: Block): string {
  return block.lines
    .map(({ inline, attrs }) => {
      const indent = typeof attrs.indent === "number" ? (attrs.indent as number) : 0;
      const listIndent = "  ".repeat(indent);
      let marker = "- ";
      if (attrs.list === "ordered") marker = "1. ";
      else if (attrs.list === "checked") marker = "- [x] ";
      else if (attrs.list === "unchecked") marker = "- [ ] ";
      return `${listIndent}${marker}${inline}`;
    })
    .join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function tableRowId(attrs: QuillAttrs): string | null {
  if (attrs.table == null) return null;
  return String(attrs.table);
}

function normalizeTableAlign(value: unknown): "left" | "center" | "right" | undefined {
  if (value === "left" || value === "center" || value === "right") return value;
  return undefined;
}

function tableDividerCell(align: unknown): string {
  switch (normalizeTableAlign(align)) {
    case "left":
      return ":---";
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

function renderTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function renderTableBlock(block: Block): string {
  const rows: Array<Array<{ inline: string; attrs: QuillAttrs }>> = [];
  let currentRowId: string | null = null;

  for (const line of block.lines) {
    const rowId = tableRowId(line.attrs);
    if (!rowId) continue;
    if (rowId !== currentRowId) {
      rows.push([]);
      currentRowId = rowId;
    }
    rows[rows.length - 1].push(line);
  }

  if (rows.length === 0) return "";

  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? { inline: "", attrs: {} })
  );
  const columnAligns = Array.from({ length: columnCount }, (_, index) => {
    for (const row of normalizedRows) {
      const align = normalizeTableAlign(row[index].attrs.align);
      if (align) return align;
    }
    return undefined;
  });

  const header = renderTableRow(normalizedRows[0].map((cell) => escapeTableCell(cell.inline)));
  const divider = renderTableRow(columnAligns.map(tableDividerCell));
  const body = normalizedRows
    .slice(1)
    .map((row) => renderTableRow(row.map((cell) => escapeTableCell(cell.inline))));

  return [header, divider, ...body].join("\n");
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case "heading": {
      const { inline, attrs } = block.lines[0];
      const level = Math.max(1, Math.min(6, (attrs.header as number) ?? 1));
      return `${"#".repeat(level)} ${inline}`;
    }
    case "list":
      return renderListBlock(block);
    case "blockquote":
      return block.lines.map(({ inline }) => `> ${inline}`).join("\n");
    case "code-block":
      return "```\n" + block.lines.map((l) => l.inline).join("\n") + "\n```";
    case "table":
      return renderTableBlock(block);
    case "paragraph":
    default: {
      // 仕様: リスト外の Quill indent は Md に出力しない(諦める)。
      return block.lines[0].inline;
    }
  }
}

export function quillDeltaToMarkdown(delta: QuillDelta): string {
  if (!delta || !Array.isArray(delta.ops) || delta.ops.length === 0) return "";
  const lines = deltaToLines(delta.ops);
  const blocks = groupBlocks(lines);
  // 末尾の空 paragraph(quill が常に持つ末尾改行)は捨てる
  while (
    blocks.length > 0 &&
    blocks[blocks.length - 1].type === "paragraph" &&
    blocks[blocks.length - 1].lines.every((l) => l.inline === "")
  ) {
    blocks.pop();
  }
  return blocks.map(renderBlock).join("\n\n");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// marked は <u>text</u> のような inline HTML を「<u>」「text」「</u>」の3トークンに分解する。
// 走査時に open/close を見て underline 属性 stack を管理する。
function appendInlineTokens(
  ops: QuillOp[],
  tokens: Tokens.Generic[] | undefined,
  attrs: QuillAttrs
): void {
  if (!tokens) return;
  let active = { ...attrs };
  const stack: QuillAttrs[] = [];
  for (const token of tokens) {
    if (token.type === "html") {
      const raw = ((token as Tokens.HTML).raw ?? "").trim();
      if (/^<u>$/i.test(raw)) {
        stack.push(active);
        active = { ...active, underline: true };
        continue;
      }
      if (/^<\/u>$/i.test(raw)) {
        active = stack.pop() ?? attrs;
        continue;
      }
    }
    appendInlineToken(ops, token, active);
  }
}

function pushText(ops: QuillOp[], text: string, attrs: QuillAttrs): void {
  if (!text) return;
  const hasAttrs = Object.keys(attrs).length > 0;
  ops.push(hasAttrs ? { insert: text, attributes: { ...attrs } } : { insert: text });
}

function appendInlineToken(ops: QuillOp[], token: Tokens.Generic, attrs: QuillAttrs): void {
  switch (token.type) {
    case "text": {
      // text token may contain inline tokens (e.g. with smartypants); fall back to plain text.
      // CommonMark soft break: paragraph内に残る \n は空白扱い(breaks:false)。
      const sub = (token as Tokens.Text).tokens;
      if (sub && sub.length > 0) {
        appendInlineTokens(ops, sub, attrs);
      } else {
        const raw = (token as Tokens.Text).text ?? "";
        pushText(ops, decodeEntities(raw).replace(/\n/g, " "), attrs);
      }
      return;
    }
    case "escape":
      pushText(ops, (token as Tokens.Escape).text, attrs);
      return;
    case "strong":
      appendInlineTokens(ops, (token as Tokens.Strong).tokens, { ...attrs, bold: true });
      return;
    case "em":
      appendInlineTokens(ops, (token as Tokens.Em).tokens, { ...attrs, italic: true });
      return;
    case "del":
      appendInlineTokens(ops, (token as Tokens.Del).tokens, { ...attrs, strike: true });
      return;
    case "codespan":
      pushText(ops, decodeEntities((token as Tokens.Codespan).text), { ...attrs, code: true });
      return;
    case "link":
      appendInlineTokens(ops, (token as Tokens.Link).tokens, {
        ...attrs,
        link: (token as Tokens.Link).href,
      });
      return;
    case "image":
      ops.push({ insert: { image: (token as Tokens.Image).href } });
      return;
    case "br":
      ops.push({ insert: "\n" });
      return;
    case "html": {
      const raw = (token as Tokens.HTML).raw ?? "";
      const uMatch = /^<u>([\s\S]*?)<\/u>$/i.exec(raw.trim());
      if (uMatch) {
        pushText(ops, decodeEntities(uMatch[1]), { ...attrs, underline: true });
        return;
      }
      pushText(ops, decodeEntities(raw), attrs);
      return;
    }
    default: {
      const text = (token as Tokens.Generic & { text?: string }).text;
      if (typeof text === "string") pushText(ops, decodeEntities(text), attrs);
    }
  }
}

function endsWithNewline(ops: QuillOp[]): boolean {
  if (ops.length === 0) return false;
  const last = ops[ops.length - 1];
  return typeof last.insert === "string" && last.insert.endsWith("\n");
}

function ensureLineBreak(ops: QuillOp[]): void {
  if (!endsWithNewline(ops)) ops.push({ insert: "\n" });
}

function appendListToken(ops: QuillOp[], list: Tokens.List, level: number): void {
  for (const item of list.items) {
    const itemTokens = (item as Tokens.ListItem).tokens || [];
    const itemOps: QuillOp[] = [];
    const nested: Tokens.List[] = [];
    for (const sub of itemTokens) {
      if (sub.type === "list") {
        nested.push(sub as Tokens.List);
      } else if (sub.type === "text") {
        appendInlineTokens(itemOps, (sub as Tokens.Text).tokens, {});
      } else if (sub.type === "paragraph") {
        appendInlineTokens(itemOps, (sub as Tokens.Paragraph).tokens, {});
      } else {
        appendBlockToken(itemOps, sub);
        // 末尾の "\n" は line attrs を上書きされるのでここでは触らない
      }
    }
    const listKind = list.ordered
      ? "ordered"
      : (item as Tokens.ListItem).task
        ? (item as Tokens.ListItem).checked
          ? "checked"
          : "unchecked"
        : "bullet";
    const lineAttrs: QuillAttrs =
      level > 0 ? { list: listKind, indent: level } : { list: listKind };
    if (itemOps.length > 0 && itemOps[itemOps.length - 1].insert === "\n") {
      itemOps[itemOps.length - 1] = {
        insert: "\n",
        attributes: { ...(itemOps[itemOps.length - 1].attributes || {}), ...lineAttrs },
      };
    } else {
      itemOps.push({ insert: "\n", attributes: lineAttrs });
    }
    ops.push(...itemOps);
    for (const child of nested) appendListToken(ops, child, level + 1);
  }
}

type MarkedTableCell = {
  text?: string;
  tokens?: Tokens.Generic[];
  align?: string | null;
};

type MarkedTableToken = Tokens.Generic & {
  header?: MarkedTableCell[];
  rows?: MarkedTableCell[][];
  align?: Array<string | null>;
};

function appendTableCell(ops: QuillOp[], cell: MarkedTableCell | undefined): void {
  if (cell?.tokens && cell.tokens.length > 0) {
    appendInlineTokens(ops, cell.tokens, {});
    return;
  }
  if (typeof cell?.text === "string") {
    pushText(ops, decodeEntities(cell.text), {});
  }
}

function appendTableToken(ops: QuillOp[], token: MarkedTableToken): void {
  const header = Array.isArray(token.header) ? token.header : [];
  const bodyRows = Array.isArray(token.rows) ? token.rows : [];
  const rows = [header, ...bodyRows];
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const align = Array.isArray(token.align) ? token.align : [];
  const rowIdPrefix = `row-md-${ops.length + 1}`;

  rows.forEach((row, rowIndex) => {
    const rowId = `${rowIdPrefix}-${rowIndex + 1}`;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const cell = row[columnIndex];
      const cellAlign = normalizeTableAlign(cell?.align ?? align[columnIndex]);
      const attributes: QuillAttrs = cellAlign
        ? { table: rowId, align: cellAlign }
        : { table: rowId };
      appendTableCell(ops, cell);
      ops.push({ insert: "\n", attributes });
    }
  });
}

function appendBlockToken(ops: QuillOp[], token: Tokens.Generic): void {
  switch (token.type) {
    case "heading": {
      const h = token as Tokens.Heading;
      appendInlineTokens(ops, h.tokens, {});
      ops.push({ insert: "\n", attributes: { header: h.depth } });
      return;
    }
    case "paragraph": {
      const p = token as Tokens.Paragraph;
      appendInlineTokens(ops, p.tokens, {});
      ops.push({ insert: "\n" });
      return;
    }
    case "code": {
      // Quill の code-block は各行末の \n に `code-block: true` が付いた連続行で表現する。
      const c = token as Tokens.Code;
      const lines = c.text.split("\n");
      for (const line of lines) {
        if (line) pushText(ops, line, {});
        ops.push({ insert: "\n", attributes: { "code-block": true } });
      }
      return;
    }
    case "blockquote": {
      const bq = token as Tokens.Blockquote;
      const inner: QuillOp[] = [];
      for (const sub of bq.tokens || []) appendBlockToken(inner, sub);
      // 内部の改行属性を blockquote に置き換える
      for (const op of inner) {
        if (typeof op.insert === "string" && op.insert === "\n") {
          op.attributes = { ...(op.attributes || {}), blockquote: true };
          delete (op.attributes as QuillAttrs)["header"];
        }
      }
      ops.push(...inner);
      return;
    }
    case "list":
      appendListToken(ops, token as Tokens.List, 0);
      return;
    case "table":
      appendTableToken(ops, token as MarkedTableToken);
      return;
    case "html": {
      // 仕様外の HTML ブロックは生テキストとして取り込む。<u> はインラインで underline 化されるためここでは扱わない。
      const raw = (token as Tokens.HTML).raw ?? "";
      pushText(ops, decodeEntities(raw), {});
      ensureLineBreak(ops);
      return;
    }
    case "space":
      // Markdown の空行はブロック区切りの意味だけなので、Quill 側に空 paragraph を生成しない。
      return;
    case "hr":
      // 水平線は Quill のデフォルトフォーマットに無いため改行のみで表現する。
      ops.push({ insert: "\n" });
      return;
    default: {
      const text = (token as Tokens.Generic & { text?: string }).text;
      if (typeof text === "string" && text) {
        pushText(ops, decodeEntities(text), {});
        ensureLineBreak(ops);
      }
    }
  }
}

// 同 attributes の連続テキスト op を merge する Quill 慣習の normalization。
function normalizeOps(ops: QuillOp[]): QuillOp[] {
  const out: QuillOp[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    const lastAttrs = JSON.stringify(last?.attributes ?? null);
    const curAttrs = JSON.stringify(op.attributes ?? null);
    if (
      last &&
      typeof last.insert === "string" &&
      typeof op.insert === "string" &&
      lastAttrs === curAttrs
    ) {
      last.insert += op.insert;
    } else {
      out.push({ ...op });
    }
  }
  return out;
}

export function markdownToQuillDelta(markdown: unknown): QuillDelta {
  const text = typeof markdown === "string" ? markdown : toMarkdown(markdown);
  if (!text) return { ops: [{ insert: "\n" }] };

  let tokens: Tokens.Generic[];
  try {
    tokens = marked.lexer(text) as Tokens.Generic[];
  } catch {
    return { ops: [{ insert: text.endsWith("\n") ? text : `${text}\n` }] };
  }

  const ops: QuillOp[] = [];
  for (const token of tokens) appendBlockToken(ops, token);

  if (ops.length === 0) return { ops: [{ insert: "\n" }] };
  ensureLineBreak(ops);
  return { ops: normalizeOps(ops) as QuillDelta["ops"] };
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

// lodash の isEqual は constructor を比較するため、Quill の Delta インスタンスと
// IPC 越しに受け取ったプレーンな `{ops}` を「異なる」と判定する。
// Quill エディタの編集中に workspace の保存→反映ラウンドトリップが走るたびに
// 比較が false 化して `setContents` が呼び直され、カーソルが先頭に飛んでいた。
// 中身 (ops) が一致しているかだけ知りたい比較は、必ずこのヘルパで正規化してから渡す。
export function memoContentForCompare(value: unknown): unknown {
  if (isQuillDelta(value)) {
    return { ops: value.ops };
  }
  return value;
}

// 将来 elasticlunr 等のインデックス型エンジンに差し替え可能な検索ポイント
export function searchMemoEntries(memos: Array<{ content: unknown }>, keywords: string[]): boolean {
  return memos.some((entry) =>
    keywords.some((keyword) =>
      memoContentForSearch(entry.content).toLowerCase().includes(keyword.toLowerCase())
    )
  );
}
