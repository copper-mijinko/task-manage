const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { marked } = require("marked");

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
  if (attrs["code-block"]) return "code-block";
  if (attrs.list) return "list";
  if (attrs.blockquote) return "blockquote";
  if (typeof attrs.header === "number") return "heading";
  return "paragraph";
}

function shouldGroupAdjacent(type) {
  return type === "list" || type === "blockquote" || type === "code-block";
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

  for (const line of yaml.split(/\r?\n/)) {
    const listMatch = line.match(/^ {2}- (.+)/);
    if (listMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(listMatch[1].trim());
      continue;
    }
    const kvMatch = line.match(/^([^:]+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1].trim();
      const value = kvMatch[2].trim();
      data[currentKey] = value || null;
    }
  }
  return { data, body };
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
      for (const item of value) lines.push(`  - ${item}`);
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
  if (task.parents?.length > 0) data.parents = task.parents;
  if (typeof task.order === "number") data.order = task.order;
  data.created = task.createdAt || new Date().toISOString().slice(0, 10);
  return data;
}

/** Read memos from a task directory. */
function readMemos(taskDir, reservedFiles = ["_index.md"]) {
  const memos = [];
  const reserved = new Set(reservedFiles);
  const files = fs
    .readdirSync(taskDir)
    .filter((f) => f.endsWith(".md") && !reserved.has(f))
    .sort();
  files.forEach((file, fileIndex) => {
    const raw = fs.readFileSync(path.join(taskDir, file), "utf8");
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
    const content = format === "quill" ? parseQuillMemoBody(body) : body.trim();
    memos.push({ id, title, content, tags, format, order: parseOrderValue(data.order), fileIndex });
  });
  return memos
    .sort((a, b) => {
      const aHasOrder = typeof a.order === "number";
      const bHasOrder = typeof b.order === "number";
      if (aHasOrder && bHasOrder && a.order !== b.order) return a.order - b.order;
      if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
      return a.fileIndex - b.fileIndex;
    })
    .map(({ fileIndex, ...memo }) => memo);
}

/** Read the root task from _project.md inside projectDir. */
function parseOrderValue(value) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function readRootTask(projectDir) {
  const content = fs.readFileSync(path.join(projectDir, "_project.md"), "utf8");
  const { data } = parseFrontmatter(content);
  return {
    id: data.id,
    name: data.name || "",
    status: data.status || "Open",
    startDate: data.start || undefined,
    dueDate: data.due || undefined,
    parents: [],
    memos: readMemos(projectDir, ["_project.md"]),
    createdAt: data.created || "",
    order: parseOrderValue(data.order),
  };
}

/** Read a regular task from its subdirectory. */
function readTaskDir(taskDir) {
  const content = fs.readFileSync(path.join(taskDir, "_index.md"), "utf8");
  const { data } = parseFrontmatter(content);
  const parents = Array.isArray(data.parents) ? data.parents : data.parents ? [data.parents] : [];
  return {
    id: data.id,
    name: data.name || "",
    status: data.status || "Open",
    startDate: data.start || undefined,
    dueDate: data.due || undefined,
    parents,
    memos: readMemos(taskDir),
    createdAt: data.created || "",
    order: parseOrderValue(data.order),
  };
}

/**
 * Read all tasks from a project directory.
 * Returns { tasks: Map<id, task>, taskDirs: Map<id, dirName> }
 */
function readProject(projectDir) {
  const tasks = new Map();
  const taskDirs = new Map();

  const rootFile = path.join(projectDir, "_project.md");
  if (fs.existsSync(rootFile)) {
    const root = readRootTask(projectDir);
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
      const task = readTaskDir(taskDir);
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

function writeMemoFiles(taskDir, indexFileName, memos) {
  const existing = fs.readdirSync(taskDir).filter((f) => f.endsWith(".md") && f !== indexFileName);
  for (const f of existing) fs.unlinkSync(path.join(taskDir, f));
  for (const [index, memo] of (memos || []).entries()) {
    const id = memo.id || crypto.randomUUID();
    fs.writeFileSync(
      path.join(taskDir, `${id}.md`),
      stringifyFrontmatter(
        {
          id,
          title: memo.title,
          tags: memo.tags ?? [],
          format: normalizeMemoFormat(memo.format),
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
    const id = memo.id || crypto.randomUUID();
    nextFiles.add(`${id}.md`);
    await writeFileIfChanged(
      path.join(taskDir, `${id}.md`),
      stringifyFrontmatter(
        {
          id,
          title: memo.title,
          tags: memo.tags ?? [],
          format: normalizeMemoFormat(memo.format),
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

function saveMemoImage(projectDir, taskDirs, taskId, bytes, mimeType) {
  const dirName = taskDirs.get(taskId);
  if (!dirName) {
    throw new Error("Task directory was not found");
  }

  const targetDir = dirName === "_project" ? projectDir : path.join(projectDir, dirName);
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
  const dirName = taskDirs.get(taskId);
  if (!dirName) {
    throw new Error("Task directory was not found");
  }

  const targetDir = dirName === "_project" ? projectDir : path.join(projectDir, dirName);
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

function resolveMemoAssetPath(projectDir, taskDirs, taskId, assetPath) {
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

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

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
  if (fs.existsSync(taskDir)) {
    await retryFileOperation(() => fs.promises.rm(taskDir, { recursive: true, force: true }));
  }
  taskDirs.delete(taskId);
}

async function writeProjectAsync(projectDir, tasks, options = {}) {
  const { onWritten } = options;
  const { taskDirs } = readProject(projectDir);
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
  const dirName = uniqueName(workspacePath, slugify(name) || "project");
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

function listProjects(workspacePath) {
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

async function setProjectOrderAsync(workspacePath, orderedProjects, options = {}) {
  const { onWritten } = options;
  if (!workspacePath || typeof workspacePath !== "string") {
    throw new Error("Invalid workspacePath");
  }
  if (!fs.existsSync(workspacePath)) {
    throw new Error("workspacePath does not exist");
  }

  const currentProjects = listProjects(workspacePath);
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

/**
 * DAG cycle check: would setting taskId's parents to newParents create a cycle?
 * tasks: Map<id, { parents: string[] }>
 */
function wouldCreateCycle(tasks, taskId, newParents) {
  if (!newParents || newParents.length === 0) return false;

  // Self-cycle: taskId is listed as its own parent
  if (newParents.includes(taskId)) return true;

  // Build children map from current parent links
  const children = new Map();
  for (const [id, task] of tasks) {
    for (const parent of task.parents) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(id);
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
      if (newParents.includes(child)) return true;
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
    for (const parent of task.parents) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(id);
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
      };
    });
    const exportedTaskId = node === projectData.data ? exportedProjectId : node.id;

    tasks.push({
      id: exportedTaskId,
      name: node.data.name || "",
      status: node.data.status || "Open",
      startDate: node.data["start date"] || undefined,
      dueDate: node.data["due date"] || undefined,
      parents: [...parentIds],
      memos,
      createdAt: today,
      order: siblingIndex,
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
  if (!fs.existsSync(projectDir)) {
    return { success: true, alreadyMissing: true };
  }
  const stat = await fs.promises.stat(projectDir);
  if (!stat.isDirectory()) {
    throw new Error("projectDir is not a directory");
  }
  await retryFileOperation(() => fs.promises.rm(projectDir, { recursive: true, force: true }));
  return { success: true };
}

module.exports = {
  slugify,
  parseFrontmatter,
  stringifyFrontmatter,
  atomicWriteFile,
  writeFileIfChanged,
  retryFileOperation,
  readProject,
  writeTask,
  writeTaskAsync,
  writeProjectAsync,
  saveMemoImage,
  saveMemoImageAsync,
  resolveMemoAssetPath,
  deleteTaskDir,
  deleteTaskDirAsync,
  createProject,
  createProjectAsync,
  deleteProject,
  deleteProjectAsync,
  listProjects,
  setProjectOrderAsync,
  wouldCreateCycle,
  bfsFromRoot,
  exportProjectData,
  migrateProjectData,
  legacyMemoContentToMarkdown,
};
