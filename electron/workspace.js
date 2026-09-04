const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { marked } = require("marked");
const { performanceMetrics } = require("./performance-metrics");

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

/** Convert a human name to a filesystem-safe slug. */
function slugify(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[/\\:*?"<>|]/g, "")
      .split("\0")
      .join("")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "task"
  );
}

/** Return a name that does not already exist inside parentDir. */
function uniqueName(parentDir, baseName) {
  if (!fs.existsSync(path.join(parentDir, baseName))) return baseName;
  let i = 2;
  while (fs.existsSync(path.join(parentDir, `${baseName}-${i}`))) i++;
  return `${baseName}-${i}`;
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function uniqueNameAsync(parentDir, baseName) {
  if (!(await pathExists(path.join(parentDir, baseName)))) return baseName;
  let i = 2;
  while (await pathExists(path.join(parentDir, `${baseName}-${i}`))) i++;
  return `${baseName}-${i}`;
}

function safeFileName(fileName, fallback = "attachment") {
  const baseName = path
    .basename(String(fileName || fallback))
    .split("\0")
    .join("")
    .replace(/[/\\:*?"<>|]/g, "")
    .trim();
  return baseName || fallback;
}

function assertSafePathSegment(value, label = "identifier") {
  const segment = String(value || "");
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.length > 200 ||
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

function uniqueFileName(parentDir, fileName) {
  const safeName = safeFileName(fileName);
  if (!fs.existsSync(path.join(parentDir, safeName))) return safeName;

  const extension = path.extname(safeName);
  const stem = path.basename(safeName, extension) || "attachment";
  let i = 2;
  while (fs.existsSync(path.join(parentDir, `${stem}-${i}${extension}`))) i++;
  return `${stem}-${i}${extension}`;
}

async function uniqueFileNameAsync(parentDir, fileName) {
  const safeName = safeFileName(fileName);
  if (!(await pathExists(path.join(parentDir, safeName)))) return safeName;

  const extension = path.extname(safeName);
  const stem = path.basename(safeName, extension) || "attachment";
  let i = 2;
  while (await pathExists(path.join(parentDir, `${stem}-${i}${extension}`))) i++;
  return `${stem}-${i}${extension}`;
}

function extensionFromMimeType(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
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

/**
 * メモの種別。記録の寿命と再利用性で分ける。
 *
 * - `working`  作業メモ。そのタスクの作業中だけ意味を持つ短命な記録
 * - `knowledge` ナレッジ。タスクより長生きし、他の文脈でも再利用される記録
 *
 * 既存ファイルには `kind:` が無いので、未指定は `working` として読む。
 * 「昇華」（working → knowledge）はユーザーの明示操作でだけ起きる。
 */
function normalizeMemoKind(value, fallback = "working") {
  return value === "knowledge" || value === "working" ? value : fallback;
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

function serializeMemoBody(memo) {
  const format = normalizeMemoFormat(memo.format, "markdown");
  if (format === "quill") {
    return `\`\`\`json\n${JSON.stringify(memoContentToQuillDelta(memo.content), null, 2)}\n\`\`\``;
  }
  return legacyMemoContentToMarkdown(memo.content, memo.title);
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns { data: Record<string, string | string[]>, body: string }.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: {}, body: content };

  const yaml = match[1];
  const body = content.slice(match[0].length).trim();
  const data = {};
  let currentKey = null;

  // 直前に読んだリスト要素。マップ要素（`- id: x` に続く `    order: 1`）を
  // そこへ足していくために覚えておく。
  let currentListItem = null;

  for (const line of yaml.split(/\r?\n/)) {
    const listMatch = line.match(/^ {2}- (.+)/);
    if (listMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      const entry = listMatch[1].trim();
      // `- key: value` はマップ要素の 1 行目。スカラー要素と区別する。
      const entryKv = entry.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (entryKv) {
        currentListItem = { [entryKv[1]]: entryKv[2].trim() };
        data[currentKey].push(currentListItem);
      } else {
        currentListItem = null;
        data[currentKey].push(entry);
      }
      continue;
    }
    // マップ要素の 2 行目以降（`- ` より深いインデント）。
    const nestedMatch = line.match(/^ {4}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nestedMatch && currentListItem) {
      currentListItem[nestedMatch[1]] = nestedMatch[2].trim();
      continue;
    }
    const kvMatch = line.match(/^([^:]+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1].trim();
      currentListItem = null;
      const value = kvMatch[2].trim();
      data[currentKey] = value || null;
    }
  }
  return { data, body };
}

function readFilePrefix(filePath, maxBytes = 16 * 1024) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Serialize data object + optional body to markdown with YAML frontmatter.
 */
function stringifyFrontmatter(data, body = "") {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        if (item && typeof item === "object") {
          // マップ要素。1 つ目のキーを `- key: value` に、残りを字下げして続ける。
          const entries = Object.entries(item).filter(([, v]) => v !== undefined && v !== null);
          if (entries.length === 0) continue;
          lines.push(`  - ${entries[0][0]}: ${entries[0][1]}`);
          for (const [k, v] of entries.slice(1)) lines.push(`    ${k}: ${v}`);
        } else {
          lines.push(`  - ${item}`);
        }
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  if (body) lines.push("", body);
  return lines.join("\n") + "\n";
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

async function writeFileIfChanged(filePath, data, options, onWritten) {
  const nextBuffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  try {
    const currentBuffer = await fs.promises.readFile(filePath);
    if (Buffer.compare(currentBuffer, nextBuffer) === 0) {
      // No write needed; the on-disk content already matches. Still call
      // onWritten so the reconciler can register the hash even if this is
      // the first time we've touched this file in the session.
      if (typeof onWritten === "function") {
        try {
          onWritten(filePath, nextBuffer);
        } catch {
          // ignore
        }
      }
      return false;
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await atomicWriteFile(filePath, nextBuffer, options, onWritten);
  return true;
}

function taskFrontmatterData(task) {
  const data = { id: task.id, name: task.name, status: task.status };
  if (task.startDate) data.start = task.startDate;
  if (task.dueDate) data.due = task.dueDate;
  if (task.parents?.length > 0) {
    // 並び順は辺の属性なので、親 id と組で書く。順序が無い辺は短縮形（文字列）
    // にして、手書きのファイルと見た目を揃える。
    data.parents = task.parents.map((parent) =>
      typeof parent.order === "number" ? { id: parent.id, order: parent.order } : parent.id
    );
  }
  // タスク直下の `order` はルートタスク（＝プロジェクトの並び順）だけが持つ。
  // 通常タスクの並び順は `parents[].order` にある。
  if (typeof task.order === "number" && !(task.parents?.length > 0)) {
    data.order = task.order;
  }
  const tags = normalizeTaskTags(task.tags);
  if (tags.length > 0) data.tags = tags;
  data.created = task.createdAt || new Date().toISOString().slice(0, 10);
  // Archived (論理削除) フラグはオプションで載せる。未アーカイブのときは
  // フィールド自体を出さないことで、既存ファイルとの差分も最小限になる。
  if (task.archived) {
    data.archived = true;
    if (task.archivedAt) data.archived_at = task.archivedAt;
  }
  return data;
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

/** Read memos from a task directory. */
function readMemos(taskDir, reservedFiles = ["_index.md"], options = {}) {
  const includeMemoContent = options.includeMemoContent !== false;
  const memos = [];
  const reserved = new Set(reservedFiles);
  const files = fs
    .readdirSync(taskDir)
    .filter((f) => f.endsWith(".md") && !reserved.has(f))
    .sort();
  files.forEach((file, fileIndex) => {
    const filePath = path.join(taskDir, file);
    const raw = includeMemoContent ? fs.readFileSync(filePath, "utf8") : readFilePrefix(filePath);
    const { data, body } = parseFrontmatter(raw);
    const id = data.id || crypto.randomUUID();
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
    const kind = normalizeMemoKind(data.kind);
    const content = includeMemoContent
      ? format === "quill"
        ? parseQuillMemoBody(body)
        : body.trim()
      : "";
    memos.push({
      id,
      title,
      content,
      tags,
      format,
      kind,
      order: parseOrderValue(data.order),
      bodyLoaded: includeMemoContent,
      fileIndex,
    });
  });
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

function attachmentEntryFromStats(fileName, stats) {
  return {
    id: `./attachments/${fileName}`,
    name: fileName,
    relativePath: `./attachments/${fileName}`,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

function attachmentEntryFromFile(attachmentsDir, fileName) {
  const filePath = path.join(attachmentsDir, fileName);
  return attachmentEntryFromStats(fileName, fs.statSync(filePath));
}

function readAttachments(taskDir) {
  const attachmentsDir = path.join(taskDir, "attachments");
  if (!fs.existsSync(attachmentsDir)) return [];

  return fs
    .readdirSync(attachmentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((fileName) => attachmentEntryFromFile(attachmentsDir, fileName));
}

/** Read the root task from _project.md inside projectDir. */
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
    if (typeof entry === "string") {
      id = entry;
      order = fallbackOrder;
    } else if (entry && typeof entry === "object") {
      id = typeof entry.id === "string" ? entry.id : undefined;
      order = parseOrderValue(entry.order);
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(order === undefined ? { id } : { id, order });
  }
  return result;
}

/** 親 id だけが要る呼び出し向け。 */
function parentIdsOf(parents) {
  return (parents ?? []).map((parent) => parent.id);
}

function readRootTask(projectDir, options = {}) {
  const content = fs.readFileSync(path.join(projectDir, "_project.md"), "utf8");
  const { data } = parseFrontmatter(content);
  const task = {
    id: data.id,
    name: data.name || "",
    status: data.status || "Open",
    startDate: data.start || undefined,
    dueDate: data.due || undefined,
    parents: [],
    memos: readMemos(projectDir, ["_project.md"], options),
    attachments: readAttachments(projectDir),
    createdAt: data.created || "",
    order: parseOrderValue(data.order),
    tags: normalizeTaskTags(data.tags),
  };
  if (parseArchivedValue(data.archived)) {
    task.archived = true;
    if (data.archived_at) task.archivedAt = String(data.archived_at);
  }
  return task;
}

/** Read a regular task from its subdirectory. */
function readTaskDir(taskDir, options = {}) {
  const content = fs.readFileSync(path.join(taskDir, "_index.md"), "utf8");
  const { data } = parseFrontmatter(content);
  const parents = normalizeParentLinks(data.parents, parseOrderValue(data.order));
  const task = {
    id: data.id,
    name: data.name || "",
    status: data.status || "Open",
    startDate: data.start || undefined,
    dueDate: data.due || undefined,
    parents,
    memos: readMemos(taskDir, ["_index.md"], options),
    attachments: readAttachments(taskDir),
    createdAt: data.created || "",
    order: parseOrderValue(data.order),
    tags: normalizeTaskTags(data.tags),
  };
  if (parseArchivedValue(data.archived)) {
    task.archived = true;
    if (data.archived_at) task.archivedAt = String(data.archived_at);
  }
  return task;
}

/**
 * Read all tasks from a project directory.
 * Returns { tasks: Map<id, task>, taskDirs: Map<id, dirName> }
 */
function readProjectUnmeasured(projectDir, options = {}) {
  const tasks = new Map();
  const taskDirs = new Map();

  const rootFile = path.join(projectDir, "_project.md");
  if (fs.existsSync(rootFile)) {
    const root = readRootTask(projectDir, options);
    if (root.id) {
      tasks.set(root.id, root);
      taskDirs.set(root.id, "_project");
    }
  }

  const entries = fs.readdirSync(projectDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const taskDir = path.join(projectDir, entry.name);
    if (!fs.existsSync(path.join(taskDir, "_index.md"))) continue;
    try {
      const task = readTaskDir(taskDir, options);
      if (task.id) {
        tasks.set(task.id, task);
        taskDirs.set(task.id, entry.name);
      }
    } catch {
      // Skip malformed task directories
    }
  }

  return { tasks, taskDirs };
}

function readProject(projectDir, options = {}) {
  return performanceMetrics.measureSync("workspace.readProject", () =>
    readProjectUnmeasured(projectDir, options)
  );
}

function readTaskMemosUnmeasured(projectDir, taskId, taskDirs) {
  const dirName = taskDirs.get(taskId);
  if (!dirName) {
    throw new Error("Task directory was not found");
  }
  const taskDir = dirName === "_project" ? projectDir : path.join(projectDir, dirName);
  return readMemos(taskDir, dirName === "_project" ? ["_project.md"] : ["_index.md"], {
    includeMemoContent: true,
  });
}

function readTaskMemos(projectDir, taskId, taskDirs) {
  return performanceMetrics.measureSync("workspace.readTaskMemos", () =>
    readTaskMemosUnmeasured(projectDir, taskId, taskDirs)
  );
}

// ── Async read mirrors ───────────────────────────────────────────────────
// The sync readers above stay for batch/export, the reconciler, inbox helpers
// and tests. The async mirrors below are used by the interactive IPC handlers
// so that slow disks (e.g. OneDrive) cannot block the main process event loop —
// which would otherwise stall *all* IPC, including window controls, and freeze
// the whole UI. They use fs.promises and read sibling files concurrently.

async function readFilePrefixAsync(filePath, maxBytes = 16 * 1024) {
  const fh = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

function buildMemoEntry(file, fileIndex, raw, includeMemoContent) {
  const { data, body } = parseFrontmatter(raw);
  const id = data.id || crypto.randomUUID();
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
  const kind = normalizeMemoKind(data.kind);
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
    kind,
    order: parseOrderValue(data.order),
    bodyLoaded: includeMemoContent,
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

async function readMemosAsync(taskDir, reservedFiles = ["_index.md"], options = {}) {
  const includeMemoContent = options.includeMemoContent !== false;
  const reserved = new Set(reservedFiles);
  const files = (await fs.promises.readdir(taskDir))
    .filter((f) => f.endsWith(".md") && !reserved.has(f))
    .sort();
  const memos = await Promise.all(
    files.map(async (file, fileIndex) => {
      const filePath = path.join(taskDir, file);
      const raw = includeMemoContent
        ? await fs.promises.readFile(filePath, "utf8")
        : await readFilePrefixAsync(filePath);
      return buildMemoEntry(file, fileIndex, raw, includeMemoContent);
    })
  );
  return sortMemoEntries(memos);
}

async function readAttachmentsAsync(taskDir) {
  const attachmentsDir = path.join(taskDir, "attachments");
  let entries;
  try {
    entries = await fs.promises.readdir(attachmentsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  return Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = path.join(attachmentsDir, fileName);
      const stats = await fs.promises.stat(filePath);
      return attachmentEntryFromStats(fileName, stats);
    })
  );
}

function buildTaskFromFrontmatter(data, extra) {
  const task = {
    id: data.id,
    name: data.name || "",
    status: data.status || "Open",
    startDate: data.start || undefined,
    dueDate: data.due || undefined,
    createdAt: data.created || "",
    order: parseOrderValue(data.order),
    tags: normalizeTaskTags(data.tags),
    ...extra,
  };
  if (parseArchivedValue(data.archived)) {
    task.archived = true;
    if (data.archived_at) task.archivedAt = String(data.archived_at);
  }
  return task;
}

async function readRootTaskAsync(projectDir, options = {}) {
  const content = await fs.promises.readFile(path.join(projectDir, "_project.md"), "utf8");
  const { data } = parseFrontmatter(content);
  const [memos, attachments] = await Promise.all([
    readMemosAsync(projectDir, ["_project.md"], options),
    readAttachmentsAsync(projectDir),
  ]);
  return buildTaskFromFrontmatter(data, { parents: [], memos, attachments });
}

async function readTaskDirAsync(taskDir, options = {}) {
  const content = await fs.promises.readFile(path.join(taskDir, "_index.md"), "utf8");
  const { data } = parseFrontmatter(content);
  const parents = normalizeParentLinks(data.parents, parseOrderValue(data.order));
  const [memos, attachments] = await Promise.all([
    readMemosAsync(taskDir, ["_index.md"], options),
    readAttachmentsAsync(taskDir),
  ]);
  return buildTaskFromFrontmatter(data, { parents, memos, attachments });
}

/**
 * Async mirror of readProject. Returns { tasks: Map, taskDirs: Map }.
 * Task directories are read concurrently so per-file disk latency overlaps
 * instead of summing.
 */
async function readProjectAsyncUnmeasured(projectDir, options = {}) {
  const tasks = new Map();
  const taskDirs = new Map();

  let entries;
  try {
    entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return { tasks, taskDirs };
    throw err;
  }

  const hasRootFile = entries.some((entry) => entry.isFile() && entry.name === "_project.md");

  const taskDirNames = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);

  const [root, regularTasks] = await Promise.all([
    hasRootFile ? readRootTaskAsync(projectDir, options).catch(() => null) : Promise.resolve(null),
    Promise.all(
      taskDirNames.map(async (name) => {
        const taskDir = path.join(projectDir, name);
        try {
          await fs.promises.access(path.join(taskDir, "_index.md"));
        } catch {
          return null;
        }
        try {
          const task = await readTaskDirAsync(taskDir, options);
          return task.id ? { name, task } : null;
        } catch {
          // Skip malformed task directories (parity with sync readProject).
          return null;
        }
      })
    ),
  ]);

  if (root?.id) {
    tasks.set(root.id, root);
    taskDirs.set(root.id, "_project");
  }

  for (const entry of regularTasks) {
    if (!entry) continue;
    tasks.set(entry.task.id, entry.task);
    taskDirs.set(entry.task.id, entry.name);
  }

  return { tasks, taskDirs };
}

async function readProjectAsync(projectDir, options = {}) {
  return performanceMetrics.measureAsync("workspace.readProjectAsync", () =>
    readProjectAsyncUnmeasured(projectDir, options)
  );
}

async function readTaskMemosAsyncUnmeasured(projectDir, taskId, taskDirs) {
  const dirName = taskDirs.get(taskId);
  if (!dirName) {
    throw new Error("Task directory was not found");
  }
  const taskDir = dirName === "_project" ? projectDir : path.join(projectDir, dirName);
  return readMemosAsync(taskDir, dirName === "_project" ? ["_project.md"] : ["_index.md"], {
    includeMemoContent: true,
  });
}

async function readTaskMemosAsync(projectDir, taskId, taskDirs) {
  return performanceMetrics.measureAsync("workspace.readTaskMemosAsync", () =>
    readTaskMemosAsyncUnmeasured(projectDir, taskId, taskDirs)
  );
}

function writeMemoFiles(taskDir, indexFileName, memos) {
  const existing = fs.readdirSync(taskDir).filter((f) => f.endsWith(".md") && f !== indexFileName);
  for (const f of existing) fs.unlinkSync(path.join(taskDir, f));
  for (const [index, memo] of (memos || []).entries()) {
    const id = assertSafePathSegment(memo.id || crypto.randomUUID(), "memo id");
    fs.writeFileSync(
      path.join(taskDir, `${id}.md`),
      stringifyFrontmatter(
        {
          id,
          title: memo.title,
          tags: memo.tags ?? [],
          format: normalizeMemoFormat(memo.format),
          kind: normalizeMemoKind(memo.kind),
          order: index,
        },
        serializeMemoBody(memo)
      )
    );
  }
}

async function writeMemoFilesAsync(taskDir, indexFileName, memos, onWritten) {
  const existing = (await fs.promises.readdir(taskDir)).filter(
    (f) => f.endsWith(".md") && f !== indexFileName
  );
  const nextFiles = new Set();

  for (const [index, memo] of (memos || []).entries()) {
    const id = assertSafePathSegment(memo.id || crypto.randomUUID(), "memo id");
    nextFiles.add(`${id}.md`);
    await writeFileIfChanged(
      path.join(taskDir, `${id}.md`),
      stringifyFrontmatter(
        {
          id,
          title: memo.title,
          tags: memo.tags ?? [],
          format: normalizeMemoFormat(memo.format),
          kind: normalizeMemoKind(memo.kind),
          order: index,
        },
        serializeMemoBody(memo)
      ),
      undefined,
      onWritten
    );
  }

  for (const f of existing) {
    if (!nextFiles.has(f)) {
      await retryFileOperation(() => fs.promises.unlink(path.join(taskDir, f)));
    }
  }
}

/** Write root task to _project.md. */
function writeRootTask(projectDir, task) {
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "_project.md"),
    stringifyFrontmatter(taskFrontmatterData(task))
  );
  writeMemoFiles(projectDir, "_project.md", task.memos);
}

/** Write root task to _project.md using atomic async file writes. */
async function writeRootTaskAsync(projectDir, task, onWritten) {
  await fs.promises.mkdir(projectDir, { recursive: true });
  await writeFileIfChanged(
    path.join(projectDir, "_project.md"),
    stringifyFrontmatter(taskFrontmatterData(task)),
    undefined,
    onWritten
  );
  await writeMemoFilesAsync(projectDir, "_project.md", task.memos, onWritten);
}

/**
 * Write a task to its directory. Creates directory on first write.
 * taskDirs (Map<id, dirName>) is mutated when a new dir is allocated.
 */
function writeTask(projectDir, task, taskDirs) {
  assertSafePathSegment(task.id, "task id");
  if (!task.parents || task.parents.length === 0) {
    writeRootTask(projectDir, task);
    if (!taskDirs.has(task.id)) taskDirs.set(task.id, "_project");
    return;
  }

  let dirName = taskDirs.get(task.id);
  if (!dirName) {
    dirName = task.id;
    taskDirs.set(task.id, dirName);
  }
  const taskDir = path.join(projectDir, dirName);
  fs.mkdirSync(taskDir, { recursive: true });

  fs.writeFileSync(
    path.join(taskDir, "_index.md"),
    stringifyFrontmatter(taskFrontmatterData(task))
  );

  writeMemoFiles(taskDir, "_index.md", task.memos);
}

/**
 * Async atomic variant for the interactive save path. The synchronous
 * writeTask stays available for export/migrate batch operations.
 */
async function writeTaskAsync(projectDir, task, taskDirs, onWritten) {
  assertSafePathSegment(task.id, "task id");
  if (!task.parents || task.parents.length === 0) {
    await writeRootTaskAsync(projectDir, task, onWritten);
    if (!taskDirs.has(task.id)) taskDirs.set(task.id, "_project");
    return;
  }

  let dirName = taskDirs.get(task.id);
  if (!dirName) {
    dirName = task.id;
    taskDirs.set(task.id, dirName);
  }
  const taskDir = path.join(projectDir, dirName);
  await fs.promises.mkdir(taskDir, { recursive: true });

  await writeFileIfChanged(
    path.join(taskDir, "_index.md"),
    stringifyFrontmatter(taskFrontmatterData(task)),
    undefined,
    onWritten
  );

  await writeMemoFilesAsync(taskDir, "_index.md", task.memos, onWritten);
}

function getTaskTargetDir(projectDir, taskDirs, taskId) {
  const dirName = taskDirs.get(taskId);
  if (!dirName) {
    throw new Error("Task directory was not found");
  }
  return dirName === "_project" ? projectDir : path.join(projectDir, dirName);
}

function saveMemoImage(projectDir, taskDirs, taskId, bytes, mimeType) {
  const targetDir = getTaskTargetDir(projectDir, taskDirs, taskId);
  const assetsDir = path.join(targetDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const extension = extensionFromMimeType(mimeType);
  const fileName = `pasted-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  const assetPath = path.join(assetsDir, fileName);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  fs.writeFileSync(assetPath, buffer);

  return {
    fileName,
    relativePath: `./assets/${fileName}`,
    assetPath,
  };
}

async function saveMemoImageAsync(projectDir, taskDirs, taskId, bytes, mimeType, onWritten) {
  const targetDir = getTaskTargetDir(projectDir, taskDirs, taskId);
  const assetsDir = path.join(targetDir, "assets");
  await fs.promises.mkdir(assetsDir, { recursive: true });

  const extension = extensionFromMimeType(mimeType);
  const fileName = `pasted-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  const assetPath = path.join(assetsDir, fileName);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  await atomicWriteFile(assetPath, buffer, undefined, onWritten);

  return {
    fileName,
    relativePath: `./assets/${fileName}`,
    assetPath,
  };
}

function resolveTaskAttachmentPathCandidate(projectDir, taskDirs, taskId, attachmentPath) {
  if (!attachmentPath) return null;

  const taskDir = getTaskTargetDir(projectDir, taskDirs, taskId);
  const normalizedAttachmentPath = String(attachmentPath).replace(/\\/g, "/").trim();
  const relativeAttachmentPath = normalizedAttachmentPath.replace(/^\.\//, "");

  if (
    !relativeAttachmentPath.startsWith("attachments/") ||
    path.isAbsolute(relativeAttachmentPath) ||
    relativeAttachmentPath.includes("\0")
  ) {
    return null;
  }

  const resolvedPath = path.resolve(taskDir, relativeAttachmentPath);
  const relativePath = path.relative(taskDir, resolvedPath);
  const attachmentsDir = path.join(taskDir, "attachments");
  const relativeToAttachments = path.relative(attachmentsDir, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  if (relativeToAttachments.startsWith("..") || path.isAbsolute(relativeToAttachments)) {
    return null;
  }

  return resolvedPath;
}

function resolveTaskAttachmentFilePath(projectDir, taskDirs, taskId, attachmentPath) {
  const resolvedPath = resolveTaskAttachmentPathCandidate(
    projectDir,
    taskDirs,
    taskId,
    attachmentPath
  );
  if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    return null;
  }
  return resolvedPath;
}

async function resolveTaskAttachmentFilePathAsync(projectDir, taskDirs, taskId, attachmentPath) {
  const resolvedPath = resolveTaskAttachmentPathCandidate(
    projectDir,
    taskDirs,
    taskId,
    attachmentPath
  );
  if (!resolvedPath) return null;
  try {
    const stats = await fs.promises.stat(resolvedPath);
    return stats.isFile() ? resolvedPath : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function saveTaskAttachmentAsync(projectDir, taskDirs, taskId, fileName, bytes, onWritten) {
  const targetDir = getTaskTargetDir(projectDir, taskDirs, taskId);
  const attachmentsDir = path.join(targetDir, "attachments");
  await fs.promises.mkdir(attachmentsDir, { recursive: true });

  const attachmentFileName = await uniqueFileNameAsync(attachmentsDir, fileName);
  const attachmentPath = path.join(attachmentsDir, attachmentFileName);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  await atomicWriteFile(attachmentPath, buffer, undefined, onWritten);

  const stats = await fs.promises.stat(attachmentPath);
  return attachmentEntryFromStats(attachmentFileName, stats);
}

async function deleteTaskAttachmentAsync(projectDir, taskDirs, taskId, attachmentPath) {
  const resolvedPath = await resolveTaskAttachmentFilePathAsync(
    projectDir,
    taskDirs,
    taskId,
    attachmentPath
  );
  if (!resolvedPath) {
    throw new Error("Attachment was not found");
  }

  await retryFileOperation(() => fs.promises.unlink(resolvedPath));
  return readAttachmentsAsync(getTaskTargetDir(projectDir, taskDirs, taskId));
}

function resolveMemoAssetPathCandidate(projectDir, taskDirs, taskId, assetPath) {
  const dirName = taskDirs.get(taskId);
  if (!dirName || !assetPath) {
    return null;
  }

  const taskDir = dirName === "_project" ? projectDir : path.join(projectDir, dirName);
  const normalizedAssetPath = String(assetPath).replace(/\\/g, "/").trim();
  const resolvedPath = path.resolve(taskDir, normalizedAssetPath);
  const relativePath = path.relative(taskDir, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return resolvedPath;
}

function resolveMemoAssetPath(projectDir, taskDirs, taskId, assetPath) {
  const resolvedPath = resolveMemoAssetPathCandidate(projectDir, taskDirs, taskId, assetPath);
  return resolvedPath && fs.existsSync(resolvedPath)
    ? pathToFileURL(resolvedPath).toString()
    : null;
}

async function resolveMemoAssetPathAsync(projectDir, taskDirs, taskId, assetPath) {
  const resolvedPath = resolveMemoAssetPathCandidate(projectDir, taskDirs, taskId, assetPath);
  if (!resolvedPath || !(await pathExists(resolvedPath))) return null;
  return pathToFileURL(resolvedPath).toString();
}

/**
 * Delete a task's directory (and its files).
 * The root task (_project) cannot be deleted here.
 */
function deleteTaskDir(projectDir, taskDirs, taskId) {
  const dirName = taskDirs.get(taskId);
  if (!dirName || dirName === "_project") return;
  const taskDir = path.join(projectDir, dirName);
  if (fs.existsSync(taskDir)) fs.rmSync(taskDir, { recursive: true });
  taskDirs.delete(taskId);
}

async function deleteTaskDirAsync(projectDir, taskDirs, taskId) {
  const dirName = taskDirs.get(taskId);
  if (!dirName || dirName === "_project") return;
  const taskDir = path.join(projectDir, dirName);
  await retryFileOperation(() => fs.promises.rm(taskDir, { recursive: true, force: true }));
  taskDirs.delete(taskId);
}

async function writeProjectAsyncUnmeasured(projectDir, tasks, options = {}) {
  const { onWritten } = options;
  const { taskDirs } = await readProjectAsync(projectDir, { includeMemoContent: false });
  const nextTaskIds = new Set(tasks.map((task) => task.id));

  for (const id of [...taskDirs.keys()]) {
    if (!nextTaskIds.has(id)) {
      await deleteTaskDirAsync(projectDir, taskDirs, id);
    }
  }

  for (const task of tasks) {
    await writeTaskAsync(projectDir, task, taskDirs, onWritten);
  }

  return {
    tasks: new Map(tasks.map((task) => [task.id, task])),
    taskDirs,
  };
}

async function writeProjectAsync(projectDir, tasks, options = {}) {
  return performanceMetrics.measureAsync("workspace.writeProjectAsync", () =>
    writeProjectAsyncUnmeasured(projectDir, tasks, options)
  );
}

async function writeProjectPatchAsyncUnmeasured(projectDir, patch, options = {}) {
  const { onWritten } = options;
  const { tasks, taskDirs } = await readProjectAsync(projectDir, { includeMemoContent: false });
  const nextTasks = Array.isArray(patch?.tasks) ? patch.tasks.filter((task) => task?.id) : [];
  const deletedTaskIds = Array.isArray(patch?.deletedTaskIds)
    ? [...new Set(patch.deletedTaskIds.filter((id) => typeof id === "string" && id.length > 0))]
    : [];

  for (const id of deletedTaskIds) {
    await deleteTaskDirAsync(projectDir, taskDirs, id);
    tasks.delete(id);
  }

  for (const task of nextTasks) {
    await writeTaskAsync(projectDir, task, taskDirs, onWritten);
    tasks.set(task.id, task);
  }

  return {
    tasks,
    taskDirs,
  };
}

async function writeProjectPatchAsync(projectDir, patch, options = {}) {
  return performanceMetrics.measureAsync("workspace.writeProjectPatchAsync", () =>
    writeProjectPatchAsyncUnmeasured(projectDir, patch, options)
  );
}

/**
 * Create a new project directory with a root _project.md.
 * Returns { dirName, projectDir }.
 */
function createProject(workspacePath, name, id, order) {
  const dirName = uniqueName(workspacePath, slugify(name) || "project");
  const projectDir = path.join(workspacePath, dirName);
  fs.mkdirSync(projectDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  writeRootTask(projectDir, {
    id,
    name,
    status: "Open",
    parents: [],
    memos: [],
    createdAt: today,
    order,
  });
  return { dirName, projectDir };
}

async function createProjectAsync(workspacePath, name, id, order, options = {}) {
  const { onWritten } = options;
  const dirName = await uniqueNameAsync(workspacePath, slugify(name) || "project");
  const projectDir = path.join(workspacePath, dirName);
  await fs.promises.mkdir(projectDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  await writeRootTaskAsync(
    projectDir,
    {
      id,
      name,
      status: "Open",
      parents: [],
      memos: [],
      createdAt: today,
      order,
    },
    onWritten
  );
  return { dirName, projectDir };
}

/**
 * List all projects (directories containing _project.md) inside a workspace.
 * Returns WorkspaceProjectListItem[].
 */
function compareProjectListItems(a, b) {
  const aHasOrder = typeof a.order === "number";
  const bHasOrder = typeof b.order === "number";
  if (aHasOrder && bHasOrder && a.order !== b.order) return a.order - b.order;
  if (aHasOrder && !bHasOrder) return -1;
  if (!aHasOrder && bHasOrder) return 1;
  return String(a.name || a.dirName).localeCompare(String(b.name || b.dirName), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function listProjectsUnmeasured(workspacePath) {
  if (!fs.existsSync(workspacePath)) return [];
  const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Reserved/internal workspace directories use a leading underscore and
    // must not appear in the user-facing project list. (See electron/inbox.js
    // for the `_inbox` Inbox bucket.)
    if (entry.name.startsWith("_")) continue;
    const projectFile = path.join(workspacePath, entry.name, "_project.md");
    if (!fs.existsSync(projectFile)) continue;
    try {
      const content = fs.readFileSync(projectFile, "utf8");
      const { data } = parseFrontmatter(content);
      // Defensive: even if a non-underscore directory happens to be tagged
      // with kind=inbox (e.g. user copied an inbox into a project slot),
      // keep it out of the project list.
      if (data.kind === "inbox") continue;
      projects.push({
        name: data.name || entry.name,
        rootId: data.id,
        dirName: entry.name,
        projectDir: path.join(workspacePath, entry.name),
        order: parseOrderValue(data.order),
      });
    } catch {
      // Ignore malformed project entries
    }
  }
  return projects.sort(compareProjectListItems);
}

function listProjects(workspacePath) {
  return performanceMetrics.measureSync("workspace.listProjects", () =>
    listProjectsUnmeasured(workspacePath)
  );
}

/**
 * Async mirror of listProjects. Reads every `_project.md` concurrently so a
 * slow disk does not serialize one stat+read per project on the main event
 * loop.
 */
async function listProjectsAsyncUnmeasured(workspacePath) {
  let entries;
  try {
    entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const dirNames = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);

  const projects = await Promise.all(
    dirNames.map(async (dirName) => {
      const projectFile = path.join(workspacePath, dirName, "_project.md");
      let content;
      try {
        content = await fs.promises.readFile(projectFile, "utf8");
      } catch {
        // Missing _project.md (not a project dir) or unreadable — skip.
        return null;
      }
      try {
        const { data } = parseFrontmatter(content);
        if (data.kind === "inbox") return null;
        return {
          name: data.name || dirName,
          rootId: data.id,
          dirName,
          projectDir: path.join(workspacePath, dirName),
          order: parseOrderValue(data.order),
        };
      } catch {
        return null;
      }
    })
  );

  return projects.filter(Boolean).sort(compareProjectListItems);
}

async function listProjectsAsync(workspacePath) {
  return performanceMetrics.measureAsync("workspace.listProjectsAsync", () =>
    listProjectsAsyncUnmeasured(workspacePath)
  );
}

function projectListIdentity(project) {
  return project?.rootId || project?.id || project?.dirName || project?.projectDir || null;
}

function projectListIdentities(project) {
  return [project?.rootId, project?.id, project?.dirName, project?.projectDir].filter(Boolean);
}

async function writeProjectRootOrder(projectDir, order, onWritten) {
  const projectFile = path.join(projectDir, "_project.md");
  const content = await fs.promises.readFile(projectFile, "utf8");
  const { data, body } = parseFrontmatter(content);
  if (parseOrderValue(data.order) === order) {
    return false;
  }
  return writeFileIfChanged(
    projectFile,
    stringifyFrontmatter({ ...data, order }, body),
    "utf8",
    onWritten
  );
}

async function setProjectOrderAsyncUnmeasured(workspacePath, orderedProjects, options = {}) {
  const { onWritten } = options;
  if (!workspacePath || typeof workspacePath !== "string") {
    throw new Error("Invalid workspacePath");
  }
  if (!(await pathExists(workspacePath))) {
    throw new Error("workspacePath does not exist");
  }

  const currentProjects = await listProjectsAsync(workspacePath);
  const currentByIdentity = new Map();
  for (const project of currentProjects) {
    for (const identity of projectListIdentities(project)) {
      currentByIdentity.set(identity, project);
    }
  }

  const nextProjects = [];
  const seen = new Set();
  for (const project of Array.isArray(orderedProjects) ? orderedProjects : []) {
    const identity = projectListIdentity(project);
    const current = identity ? currentByIdentity.get(identity) : null;
    const currentIdentity = projectListIdentity(current);
    if (!current || !currentIdentity || seen.has(currentIdentity)) continue;
    nextProjects.push(current);
    seen.add(currentIdentity);
  }

  for (const project of currentProjects) {
    const identity = projectListIdentity(project);
    if (!identity || seen.has(identity)) continue;
    nextProjects.push(project);
    seen.add(identity);
  }

  const changedProjectDirs = [];
  for (const [index, project] of nextProjects.entries()) {
    const changed = await writeProjectRootOrder(project.projectDir, index, onWritten);
    project.order = index;
    if (changed) {
      changedProjectDirs.push(project.projectDir);
    }
  }

  return { projects: nextProjects, changedProjectDirs };
}

async function setProjectOrderAsync(workspacePath, orderedProjects, options = {}) {
  return performanceMetrics.measureAsync("workspace.setProjectOrderAsync", () =>
    setProjectOrderAsyncUnmeasured(workspacePath, orderedProjects, options)
  );
}

/**
 * DAG cycle check: would setting taskId's parents to newParents create a cycle?
 * tasks: Map<id, { parents: string[] }>
 */
function wouldCreateCycle(tasks, taskId, newParents) {
  // 呼び出し側は親リンク（{id, order}）でも id の配列でも渡してくる。
  const newParentIds = parentIdsOf(normalizeParentLinks(newParents));
  if (newParentIds.length === 0) return false;

  // Self-cycle: taskId is listed as its own parent
  if (newParentIds.includes(taskId)) return true;

  // Build children map from current parent links
  const children = new Map();
  for (const [id, task] of tasks) {
    for (const parentId of parentIdsOf(task.parents)) {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(id);
    }
  }

  // BFS from taskId following children. If any newParent is reachable, a cycle exists.
  const visited = new Set();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of children.get(current) || []) {
      if (newParentIds.includes(child)) return true;
      queue.push(child);
    }
  }
  return false;
}

/**
 * BFS traversal from rootId over a task map.
 * Returns ordered array of task IDs (visited nodes only once).
 */
function bfsFromRoot(tasks, rootId) {
  const children = new Map();
  for (const [id, task] of tasks) {
    for (const parentId of parentIdsOf(task.parents)) {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(id);
    }
  }

  const visited = new Set();
  const order = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    order.push(current);
    for (const child of children.get(current) || []) {
      queue.push(child);
    }
  }
  return order;
}

/**
 * Export a ProjectData (legacy db.json tree format) to workspace flat-file format.
 * @param {string} workspacePath  Destination workspace directory.
 * @param {object} projectData    ProjectData: { headers, data: TreeData }
 * @param {{ memoFormat?: "preserve" | "markdown" }} options
 * @returns {{ dirName: string, projectDir: string, count: number }}
 */
function exportProjectData(workspacePath, projectData, options = {}) {
  const tasks = [];
  const today = new Date().toISOString().slice(0, 10);
  const exportMemoFormat = options.memoFormat === "markdown" ? "markdown" : "preserve";
  const exportedProjectId = crypto.randomUUID();

  function traverse(node, parentIds, siblingIndex) {
    const memos = (node.data.memo || []).map((m) => {
      const title = String(m.title || "Memo");
      const sourceFormat = normalizeMemoFormat(m.format, "quill");
      const targetFormat = exportMemoFormat === "markdown" ? "markdown" : sourceFormat;
      return {
        id: crypto.randomUUID(),
        title,
        content:
          targetFormat === "markdown"
            ? legacyMemoContentToMarkdown(m.content, title)
            : memoContentToQuillDelta(m.content),
        tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
        format: targetFormat,
        kind: normalizeMemoKind(m.kind),
      };
    });
    const exportedTaskId = node === projectData.data ? exportedProjectId : node.id;

    tasks.push({
      id: exportedTaskId,
      name: node.data.name || "",
      status: node.data.status || "Open",
      startDate: node.data["start date"] || undefined,
      dueDate: node.data["due date"] || undefined,
      // 並び順は辺の属性。エクスポート先でも親と組で持たせる。
      parents: parentIds.map((id) => ({ id, order: siblingIndex })),
      memos,
      tags: normalizeTaskTags(node.data.tags),
      createdAt: today,
      // ルート（親なし）だけがタスク直下の order を持つ。
      order: parentIds.length === 0 ? siblingIndex : undefined,
    });

    for (const [index, child] of (node.children || []).entries()) {
      traverse(child, [exportedTaskId], index);
    }
  }

  if (!projectData || !projectData.data) throw new Error("Invalid project data");
  traverse(projectData.data, [], 0);

  const rootName = tasks[0].name || "project";
  const dirName = uniqueName(workspacePath, slugify(rootName) || "project");
  const projectDir = path.join(workspacePath, dirName);
  fs.mkdirSync(projectDir, { recursive: true });

  const taskDirs = new Map();
  for (const task of tasks) {
    writeTask(projectDir, task, taskDirs);
  }

  return { dirName, projectDir, count: tasks.length };
}

function migrateProjectData(workspacePath, projectData, options = {}) {
  return exportProjectData(workspacePath, projectData, options);
}

/**
 * Recursively delete a workspace project directory.
 * Returns { success: true } or throws on failure.
 */
function deleteProject(projectDir) {
  if (!projectDir || typeof projectDir !== "string") {
    throw new Error("Invalid projectDir");
  }
  if (!fs.existsSync(projectDir)) {
    return { success: true, alreadyMissing: true };
  }
  const stat = fs.statSync(projectDir);
  if (!stat.isDirectory()) {
    throw new Error("projectDir is not a directory");
  }
  fs.rmSync(projectDir, { recursive: true, force: true });
  return { success: true };
}

async function deleteProjectAsync(projectDir) {
  if (!projectDir || typeof projectDir !== "string") {
    throw new Error("Invalid projectDir");
  }
  let stat;
  try {
    stat = await fs.promises.stat(projectDir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { success: true, alreadyMissing: true };
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new Error("projectDir is not a directory");
  }
  await retryFileOperation(() => fs.promises.rm(projectDir, { recursive: true, force: true }));
  return { success: true };
}

module.exports = {
  slugify,
  normalizeMemoKind,
  normalizeParentLinks,
  normalizeTaskTags,
  parseFrontmatter,
  stringifyFrontmatter,
  atomicWriteFile,
  writeFileIfChanged,
  retryFileOperation,
  readProject,
  readProjectAsync,
  readTaskMemos,
  readTaskMemosAsync,
  writeTask,
  writeTaskAsync,
  writeProjectAsync,
  writeProjectPatchAsync,
  saveMemoImage,
  saveMemoImageAsync,
  saveTaskAttachmentAsync,
  deleteTaskAttachmentAsync,
  resolveTaskAttachmentFilePath,
  resolveTaskAttachmentFilePathAsync,
  resolveMemoAssetPath,
  resolveMemoAssetPathAsync,
  deleteTaskDir,
  deleteTaskDirAsync,
  createProject,
  createProjectAsync,
  deleteProject,
  deleteProjectAsync,
  listProjects,
  listProjectsAsync,
  setProjectOrderAsync,
  wouldCreateCycle,
  bfsFromRoot,
  exportProjectData,
  migrateProjectData,
  legacyMemoContentToMarkdown,
};
