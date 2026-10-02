const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const { parseFrontmatter } = require("./store/frontmatter");

// marked: gfm + 標準仕様(breaks:false) + 行頭4-space を code block 扱いしない。
marked.use({
  gfm: true,
  breaks: false,
  tokenizer: {
    code() {
      return undefined;
    },
  },
});

function assertSafePathSegment(value, label = "identifier") {
  const segment = String(value || "");
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.length > 200 ||
    // eslint-disable-next-line no-control-regex -- Windows では制御文字をファイル名に使えない
    /[<>:"/\\|?*\u0000-\u001f]/.test(segment) ||
    /[. ]$/.test(segment)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  const stem = segment.split(".")[0].toLowerCase();
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem)) {
    throw new Error(`Invalid ${label}`);
  }
  return segment;
}

function isQuillDelta(value) {
  return value && typeof value === "object" && Array.isArray(value.ops);
}

function wrapLinkMd(inner, href) {
  const leadingMatch = /^[ \t]+/.exec(inner);
  const trailingMatch = /[ \t]+$/.exec(inner);
  const leading = leadingMatch ? leadingMatch[0] : "";
  const trailing = trailingMatch ? trailingMatch[0] : "";
  const core = inner.slice(leading.length, inner.length - trailing.length);
  if (!core) return inner;
  return `${leading}[${core}](${href})${trailing}`;
}

function wrapInlineMd(text, attrs) {
  if (!text || !attrs) return text;
  if (attrs.code) {
    const r = "`" + text + "`";
    return attrs.link ? wrapLinkMd(r, attrs.link) : r;
  }
  let r = text;
  if (attrs.bold && attrs.italic) r = `***${r}***`;
  else if (attrs.bold) r = `**${r}**`;
  else if (attrs.italic) r = `*${r}*`;
  if (attrs.strike) r = `~~${r}~~`;
  if (attrs.underline) r = `<u>${r}</u>`;
  if (attrs.link) r = wrapLinkMd(r, attrs.link);
  return r;
}

function deltaToLines(ops) {
  const lines = [];
  let currentInline = "";
  for (const op of ops) {
    if (op.insert == null) continue;
    if (typeof op.insert === "object") {
      if (typeof op.insert.image === "string") currentInline += `![](${op.insert.image})`;
      continue;
    }
    if (typeof op.insert !== "string") continue;
    const text = op.insert;
    const inlineAttrs = op.attributes;
    let i = 0;
    while (i < text.length) {
      const nl = text.indexOf("\n", i);
      if (nl === -1) {
        currentInline += wrapInlineMd(text.slice(i), inlineAttrs);
        break;
      }
      if (nl > i) currentInline += wrapInlineMd(text.slice(i, nl), inlineAttrs);
      lines.push({ inline: currentInline, blockAttrs: inlineAttrs || {} });
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

function pickBlockAttrs(attrs) {
  const out = {};
  for (const k of Object.keys(attrs || {})) if (BLOCK_ATTR_KEYS.has(k)) out[k] = attrs[k];
  return out;
}

function getBlockType(attrs) {
  if (attrs.table) return "table";
  if (attrs["code-block"]) return "code-block";
  if (attrs.list) return "list";
  if (attrs.blockquote) return "blockquote";
  if (typeof attrs.header === "number") return "heading";
  return "paragraph";
}

function shouldGroupAdjacent(type) {
  return type === "list" || type === "blockquote" || type === "code-block" || type === "table";
}

function groupBlocks(lines) {
  const blocks = [];
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

function renderListBlock(block) {
  return block.lines
    .map(({ inline, attrs }) => {
      const indent = typeof attrs.indent === "number" ? attrs.indent : 0;
      const listIndent = "  ".repeat(indent);
      let marker = "- ";
      if (attrs.list === "ordered") marker = "1. ";
      else if (attrs.list === "checked") marker = "- [x] ";
      else if (attrs.list === "unchecked") marker = "- [ ] ";
      return `${listIndent}${marker}${inline}`;
    })
    .join("\n");
}

function escapeTableCell(value) {
  return String(value || "")
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

function tableRowId(attrs) {
  if (!attrs || attrs.table == null) return null;
  return String(attrs.table);
}

function normalizeTableAlign(value) {
  return value === "left" || value === "center" || value === "right" ? value : undefined;
}

function tableDividerCell(align) {
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

function renderTableRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

function renderTableBlock(block) {
  const rows = [];
  let currentRowId = null;

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
    Array.from({ length: columnCount }, (_, index) => row[index] || { inline: "", attrs: {} })
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

function renderBlock(block) {
  switch (block.type) {
    case "heading": {
      const { inline, attrs } = block.lines[0];
      const level = Math.max(1, Math.min(6, attrs.header || 1));
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
    default:
      // 仕様: リスト外の Quill indent は Md に出力しない(諦める)。
      return block.lines[0].inline;
  }
}

function quillDeltaToMarkdown(delta) {
  if (!delta || !Array.isArray(delta.ops) || delta.ops.length === 0) return "";
  const lines = deltaToLines(delta.ops);
  const blocks = groupBlocks(lines);
  while (
    blocks.length > 0 &&
    blocks[blocks.length - 1].type === "paragraph" &&
    blocks[blocks.length - 1].lines.every((l) => l.inline === "")
  ) {
    blocks.pop();
  }
  return blocks.map(renderBlock).join("\n\n");
}

function legacyMemoContentToMarkdown(content, title = "Memo") {
  if (typeof content === "string") {
    return content;
  }

  if (isQuillDelta(content)) {
    try {
      return quillDeltaToMarkdown(content);
    } catch {
      // Fall through to JSON block so export keeps the original content.
    }
  }

  if (content !== null && content !== undefined) {
    return `# ${title || "Memo"}\n\n\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``;
  }

  return "";
}

function normalizeMemoFormat(value, fallback = "markdown") {
  return value === "quill" || value === "markdown" ? value : fallback;
}

function decodeMdEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function pushDeltaText(ops, text, attrs) {
  if (!text) return;
  const hasAttrs = attrs && Object.keys(attrs).length > 0;
  ops.push(hasAttrs ? { insert: text, attributes: { ...attrs } } : { insert: text });
}

// marked は <u>text</u> を「<u>」「text」「</u>」の3つの inline html token に分解する。
// 走査時に open/close を見て underline 属性 stack を管理する。
function appendInlineMdTokens(ops, tokens, attrs) {
  if (!tokens) return;
  let active = { ...attrs };
  const stack = [];
  for (const token of tokens) {
    if (token.type === "html") {
      const raw = String(token.raw || "").trim();
      if (/^<u>$/i.test(raw)) {
        stack.push(active);
        active = { ...active, underline: true };
        continue;
      }
      if (/^<\/u>$/i.test(raw)) {
        active = stack.pop() || { ...attrs };
        continue;
      }
    }
    appendInlineMdToken(ops, token, active);
  }
}

function appendInlineMdToken(ops, token, attrs) {
  switch (token.type) {
    case "text":
      if (token.tokens && token.tokens.length > 0) {
        appendInlineMdTokens(ops, token.tokens, attrs);
      } else {
        // CommonMark soft break: paragraph内に残る \n は空白扱い(breaks:false)。
        pushDeltaText(ops, decodeMdEntities(token.text || "").replace(/\n/g, " "), attrs);
      }
      return;
    case "escape":
      pushDeltaText(ops, token.text, attrs);
      return;
    case "strong":
      appendInlineMdTokens(ops, token.tokens, { ...attrs, bold: true });
      return;
    case "em":
      appendInlineMdTokens(ops, token.tokens, { ...attrs, italic: true });
      return;
    case "del":
      appendInlineMdTokens(ops, token.tokens, { ...attrs, strike: true });
      return;
    case "codespan":
      pushDeltaText(ops, decodeMdEntities(token.text), { ...attrs, code: true });
      return;
    case "link":
      appendInlineMdTokens(ops, token.tokens, { ...attrs, link: token.href });
      return;
    case "image":
      ops.push({ insert: { image: token.href } });
      return;
    case "br":
      ops.push({ insert: "\n" });
      return;
    case "html": {
      const raw = token.raw || "";
      const uMatch = /^<u>([\s\S]*?)<\/u>$/i.exec(raw.trim());
      if (uMatch) {
        pushDeltaText(ops, decodeMdEntities(uMatch[1]), { ...attrs, underline: true });
        return;
      }
      pushDeltaText(ops, decodeMdEntities(raw), attrs);
      return;
    }
    default:
      if (typeof token.text === "string") pushDeltaText(ops, decodeMdEntities(token.text), attrs);
  }
}

function endsWithNl(ops) {
  if (ops.length === 0) return false;
  const last = ops[ops.length - 1];
  return typeof last.insert === "string" && last.insert.endsWith("\n");
}

function appendListToken(ops, list, level) {
  for (const item of list.items) {
    const itemTokens = item.tokens || [];
    const itemOps = [];
    const nested = [];
    for (const sub of itemTokens) {
      if (sub.type === "list") {
        nested.push(sub);
      } else if (sub.type === "text") {
        appendInlineMdTokens(itemOps, sub.tokens, {});
      } else if (sub.type === "paragraph") {
        appendInlineMdTokens(itemOps, sub.tokens, {});
      } else {
        appendBlockToken(itemOps, sub);
      }
    }
    const listKind = list.ordered
      ? "ordered"
      : item.task
        ? item.checked
          ? "checked"
          : "unchecked"
        : "bullet";
    const lineAttrs = level > 0 ? { list: listKind, indent: level } : { list: listKind };
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

function appendTableCell(ops, cell) {
  if (cell && cell.tokens && cell.tokens.length > 0) {
    appendInlineMdTokens(ops, cell.tokens, {});
    return;
  }
  if (typeof cell?.text === "string") {
    pushDeltaText(ops, decodeMdEntities(cell.text), {});
  }
}

function appendTableToken(ops, token) {
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
      const attributes = cellAlign ? { table: rowId, align: cellAlign } : { table: rowId };
      appendTableCell(ops, cell);
      ops.push({ insert: "\n", attributes });
    }
  });
}

function appendBlockToken(ops, token) {
  switch (token.type) {
    case "heading":
      appendInlineMdTokens(ops, token.tokens, {});
      ops.push({ insert: "\n", attributes: { header: token.depth } });
      return;
    case "paragraph":
      appendInlineMdTokens(ops, token.tokens, {});
      ops.push({ insert: "\n" });
      return;
    case "code": {
      const lines = String(token.text || "").split("\n");
      for (const line of lines) {
        if (line) pushDeltaText(ops, line, {});
        ops.push({ insert: "\n", attributes: { "code-block": true } });
      }
      return;
    }
    case "blockquote": {
      const inner = [];
      for (const sub of token.tokens || []) appendBlockToken(inner, sub);
      for (const op of inner) {
        if (typeof op.insert === "string" && op.insert === "\n") {
          op.attributes = { ...(op.attributes || {}), blockquote: true };
        }
      }
      ops.push(...inner);
      return;
    }
    case "list":
      appendListToken(ops, token, 0);
      return;
    case "table":
      appendTableToken(ops, token);
      return;
    case "html": {
      const raw = token.raw || "";
      pushDeltaText(ops, decodeMdEntities(raw), {});
      if (!endsWithNl(ops)) ops.push({ insert: "\n" });
      return;
    }
    case "space":
      // Markdown の空行はブロック区切りの意味だけなので、Quill 側に空 paragraph を生成しない。
      return;
    case "hr":
      ops.push({ insert: "\n" });
      return;
    default:
      if (typeof token.text === "string" && token.text) {
        pushDeltaText(ops, decodeMdEntities(token.text), {});
        if (!endsWithNl(ops)) ops.push({ insert: "\n" });
      }
  }
}

function normalizeOps(ops) {
  const out = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    const lastAttrs = JSON.stringify(last && last.attributes ? last.attributes : null);
    const curAttrs = JSON.stringify(op.attributes || null);
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

function markdownToQuillDelta(value) {
  const text = typeof value === "string" ? value : legacyMemoContentToMarkdown(value);
  if (!text) return { ops: [{ insert: "\n" }] };

  let tokens;
  try {
    tokens = marked.lexer(text);
  } catch {
    return { ops: [{ insert: text.endsWith("\n") ? text : `${text}\n` }] };
  }

  const ops = [];
  for (const token of tokens) appendBlockToken(ops, token);

  if (ops.length === 0) return { ops: [{ insert: "\n" }] };
  if (!endsWithNl(ops)) ops.push({ insert: "\n" });
  return { ops: normalizeOps(ops) };
}

function memoContentToQuillDelta(content) {
  if (isQuillDelta(content)) return content;
  return markdownToQuillDelta(content);
}

function parseQuillMemoBody(body) {
  const trimmed = String(body || "").trim();
  const fenceMatch = trimmed.match(/^```(?:json|quill-delta)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  const jsonText = fenceMatch ? fenceMatch[1] : trimmed;

  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (isQuillDelta(parsed)) return parsed;
    } catch {
      // Fall through to a text Delta so malformed files are still readable.
    }
  }

  return markdownToQuillDelta(body);
}

/**
 * ノード本文の読み。
 *
 * ノードは 1 つだけ本文を持つ（「1 つのメモ ＝ 1 つのノード」）。Quill の
 * ノードは本文を fenced code block の Delta として持つので、メモと同じ流儀で
 * 取り出す。
 */
function parseNodeBody(body, format) {
  return normalizeMemoFormat(format, "markdown") === "quill"
    ? parseQuillMemoBody(body)
    : String(body ?? "").trim();
}

const RETRYABLE_FS_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFsError(err) {
  return err && RETRYABLE_FS_CODES.has(err.code);
}

async function retryFileOperation(operation, { attempts = 5, baseDelay = 40 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isRetryableFsError(err) || attempt === attempts - 1) {
        throw err;
      }
      await sleep(baseDelay * 2 ** attempt);
    }
  }
  throw lastError;
}

function tempPathFor(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, `.${base}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`);
}

async function atomicWriteFile(filePath, data, options, onWritten) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = tempPathFor(filePath);
  try {
    await retryFileOperation(() => fs.promises.writeFile(tmpPath, data, options));
    await retryFileOperation(() => fs.promises.rename(tmpPath, filePath));
  } catch (err) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // Best effort cleanup; the original write error is more useful.
    }
    throw err;
  }
  if (typeof onWritten === "function") {
    try {
      onWritten(filePath, data);
    } catch {
      // onWritten is a best-effort sync hook for the reconciler; never let
      // its errors fail an otherwise-successful write.
    }
  }
}

/** ノード本文の書き。`parseNodeBody` の逆。 */
function serializeNodeBody(task) {
  const format = normalizeMemoFormat(task.format, "markdown");
  if (format === "quill") {
    return `\`\`\`json\n${JSON.stringify(memoContentToQuillDelta(task.body), null, 2)}\n\`\`\``;
  }
  return legacyMemoContentToMarkdown(task.body, task.name);
}

/**
 * Task tags round-trip through the `tags:` frontmatter list. Files are
 * hand-editable, so accept both the YAML list form and a comma separated
 * scalar, and drop blanks / duplicates rather than trusting the input.
 */
function normalizeTaskTags(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : value == null
        ? []
        : [value];
  const seen = new Set();
  const tags = [];
  for (const entry of raw) {
    const tag = String(entry ?? "")
      .trim()
      .replace(/^#/, "");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function parseArchivedValue(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "1") return true;
  }
  return false;
}

/** frontmatter の並び順の値（数値に直せなければ undefined）。 */
function parseOrderValue(value) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

/**
 * 親リンクの正規化。並び順は「辺」の属性なので、親 id と組で持つ。
 *
 * frontmatter の `parents:` は 3 つの形を受ける。
 *   - `parents: [{ id, order }]` … 現行
 *   - `parents: [id, id]`        … 旧形式・手書きの短縮形
 *   - `parents: id`              … 単一のスカラー
 * 旧形式にはタスク直下の `order` が 1 つあるだけなので、その値を全ての辺に
 * 配る（旧来の「どの親の下でも同じ位置」という意味をそのまま保つ）。
 *
 * renderer 側の `src/lib/utils/parent_links.ts` と同じ仕様。片方だけ直さないこと。
 */
function normalizeParentLinks(raw, fallbackOrder) {
  const list = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
  const result = [];
  const seen = new Set();
  for (const entry of list) {
    let id;
    let order;
    let archived = false;
    let archivedAt;
    if (typeof entry === "string") {
      id = entry;
      order = fallbackOrder;
    } else if (entry && typeof entry === "object") {
      id = typeof entry.id === "string" ? entry.id : undefined;
      order = parseOrderValue(entry.order);
      // 辺だけのアーカイブ（ノード自体の `archived` とは別）。
      archived = parseArchivedValue(entry.archived);
      if (archived && entry.archived_at) archivedAt = String(entry.archived_at);
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const link = order === undefined ? { id } : { id, order };
    if (archived) {
      link.archived = true;
      if (archivedAt) link.archivedAt = archivedAt;
    }
    result.push(link);
  }
  return result;
}

/** 旧メモをタスクの子として並べるときの順序の基点。実タスクの後ろに置く。 */
const LEGACY_MEMO_ORDER_BASE = 1_000_000;

function legacyMemoId(id, taskDir, fileName) {
  try {
    return assertSafePathSegment(id, "memo id");
  } catch {
    // Summary reads, hydration and saves must identify the same file each time.
    return `legacy-${crypto
      .createHash("sha256")
      .update(JSON.stringify([taskDir, fileName]))
      .digest("hex")}`;
  }
}

function buildMemoEntry(file, fileIndex, raw, includeMemoContent, taskDir) {
  const { data, body } = parseFrontmatter(raw);
  const id = legacyMemoId(data.id, taskDir, file);
  const headingMatch = body.match(/^#\s+(.+)/m);
  const fileTitle = file.replace(/\.md$/, "");
  let title = data.title;
  if (!title) {
    if (headingMatch) {
      title = headingMatch[1].trim();
    } else {
      title = data.id === fileTitle ? "memo" : fileTitle;
    }
  }
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const format = normalizeMemoFormat(data.format, "markdown");
  const content = includeMemoContent
    ? format === "quill"
      ? parseQuillMemoBody(body)
      : body.trim()
    : "";
  return {
    id,
    title,
    content,
    tags,
    format,
    order: parseOrderValue(data.order),
    bodyLoaded: includeMemoContent,
    fileName: file,
    fileIndex,
  };
}

function sortMemoEntries(memos) {
  return memos
    .sort((a, b) => {
      const aHasOrder = typeof a.order === "number";
      const bHasOrder = typeof b.order === "number";
      if (aHasOrder && bHasOrder && a.order !== b.order) return a.order - b.order;
      if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
      return a.fileIndex - b.fileIndex;
    })
    .map(({ fileIndex: _fileIndex, ...memo }) => memo);
}

module.exports = {
  parseFrontmatter,
  atomicWriteFile,
  retryFileOperation,
  assertSafePathSegment,
  legacyMemoId,
  LEGACY_MEMO_ORDER_BASE,
  buildMemoEntry,
  sortMemoEntries,
  parseNodeBody,
  serializeNodeBody,
  normalizeMemoFormat,
  normalizeParentLinks,
  normalizeTaskTags,
  parseArchivedValue,
  parseOrderValue,
};
