/**
 * ノード 1 つと Markdown ファイル 1 つの相互変換。
 *
 * ファイルは旧 Markdown 形式の `_project.md` / `_index.md` と同じ形で、
 * グラフの機能（複数の親・親ごとの並び順・辺だけのアーカイブ）は `parents:`
 * に入る。
 *
 * ```
 * ---
 * id: 1b2c...
 * name: 設計メモ
 * status: In Progress
 * start: 2026-09-01
 * due: 2026-09-30
 * parents:
 *   - id: proj-web
 *     order: 1
 *   - id: t-w2
 *     order: 0
 *     archived: true
 *     archived_at: 2026-09-20T01:00:00.000Z
 * tags:
 *   - 設計
 * created: 2026-08-24
 * attachments:
 *   - name: 仕様書.pdf
 *     path: ./attachments/仕様書.pdf
 *     size: 12345
 * ---
 *
 * 本文（Markdown）
 * ```
 *
 * 純粋な関数だけで、ファイルには触れない。
 */
const {
  parseNodeBody,
  serializeNodeBody,
  normalizeMemoFormat,
  normalizeParentLinks,
  normalizeTaskTags,
  parseArchivedValue,
  parseOrderValue,
} = require("../workspace");
const { parseFrontmatterDetailed, stringifyFrontmatter } = require("./frontmatter");

const STATUSES = ["Undefined", "Open", "Pending", "In Progress", "Completed", "Canceled"];

/** アプリが読み書きするキー。これ以外は未知のキーとして、そのまま残す。 */
const KNOWN_KEYS = new Set([
  "id",
  "name",
  "status",
  "start",
  "due",
  "kind",
  "parents",
  "order",
  "format",
  "tags",
  "created",
  "createdAt",
  "archived",
  "archived_at",
  "attachments",
]);

/** 日付（YYYY-MM-DD）。時刻付きは日付だけにし、暦にない日付は捨てる。 */
function normalizeDate(value) {
  if (value == null) return undefined;
  const match = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** ステータス。大文字小文字の違いは直し、知らない値は「無し」にする。 */
function canonicalStatus(value) {
  if (value == null || value === "") return undefined;
  const text = String(value).trim().toLowerCase();
  return STATUSES.find((status) => status.toLowerCase() === text);
}

function oneLine(value) {
  return String(value ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/**
 * @typedef {object} ParsedNodeFile
 * @property {any} node 取り出したノード（`parents` はファイルの値そのまま）
 * @property {boolean} hasParents `parents:` が書いてあるか
 * @property {number | undefined} legacyOrder 旧形式の、ノード直下の `order`
 * @property {boolean} inbox `kind: inbox`
 * @property {boolean} hasAttachments `attachments:` が書いてあるか
 * @property {string[]} extraBlocks 未知のキーの元の行
 * @property {string[]} warnings
 */

/**
 * ノードのファイルを読む。`id` が無ければ null。
 *
 * 値の検証（日付・ステータス）はここで済ませる。手で編集したファイルに
 * 誤りがあっても、ワークスペース全体が開けなくならないよう、誤った値は
 * 捨てて警告に積む（ファイルは、そのノードを次に保存するまで変わらない）。
 *
 * `lazy` のときは本文を読まない。ノードは `bodyLoaded: false` で、`body` を持たない
 * （frontmatter だけが分かればよい読み込みで、本文は選んだときに別に読む）。
 *
 * @param {string} text
 * @param {{ lazy?: boolean }} [options]
 * @returns {ParsedNodeFile | null}
 */
function parseNodeFile(text, { lazy = false } = {}) {
  const { data, body, blocks } = parseFrontmatterDetailed(text);
  if (typeof data.id !== "string" || data.id === "") return null;

  /** @type {string[]} */
  const warnings = [];
  const format = normalizeMemoFormat(data.format, "markdown");
  const legacyOrder = parseOrderValue(data.order);
  const status = canonicalStatus(data.status);
  if (data.status && !status) warnings.push(`未知のステータスを無視しました: ${data.status}`);
  let startDate = normalizeDate(data.start);
  let dueDate = normalizeDate(data.due);
  if (data.start && !startDate) warnings.push(`開始日を読めませんでした: ${data.start}`);
  if (data.due && !dueDate) warnings.push(`期限日を読めませんでした: ${data.due}`);
  if (startDate && dueDate && startDate > dueDate) {
    warnings.push("開始日が期限日より後です。開始日を無視しました");
    startDate = undefined;
  }
  const created = normalizeDate(data.created ?? data.createdAt);

  /** @type {any} */
  const node = {
    id: data.id,
    name: data.name == null ? "" : String(data.name),
    parents: normalizeParentLinks(data.parents, legacyOrder),
    format,
    tags: normalizeTaskTags(data.tags),
    createdAt: created || "",
  };
  if (lazy) node.bodyLoaded = false;
  else node.body = parseNodeBody(body, format);
  if (status) node.status = status;
  if (startDate) node.startDate = startDate;
  if (dueDate) node.dueDate = dueDate;
  if (parseArchivedValue(data.archived)) {
    node.archived = true;
    if (data.archived_at) node.archivedAt = String(data.archived_at);
  }
  const hasAttachments = Array.isArray(data.attachments);
  if (hasAttachments) {
    node.attachments = data.attachments
      .filter((entry) => entry && typeof entry === "object" && entry.path)
      .map((entry) => {
        const relativePath = String(entry.path);
        const size = Number(entry.size);
        return {
          id: relativePath,
          name: entry.name ? String(entry.name) : relativePath.split("/").pop(),
          relativePath,
          size: Number.isFinite(size) ? size : 0,
        };
      });
  }

  return {
    node,
    hasParents: data.parents != null,
    legacyOrder,
    inbox: data.kind === "inbox",
    hasAttachments,
    extraBlocks: blocks.filter((block) => !KNOWN_KEYS.has(block.key)).map((block) => block.text),
    warnings,
  };
}

/** 既存のファイルにある、未知のキーの元の行。書き戻すときに残す。 */
function extraBlocksOf(text) {
  return parseFrontmatterDetailed(text)
    .blocks.filter((block) => !KNOWN_KEYS.has(block.key))
    .map((block) => block.text);
}

/** 辺を frontmatter の形にする。順序も印も無い辺は id だけの短縮形。 */
function linkToFrontmatter(link) {
  if (link.archived) {
    return {
      id: link.id,
      order: typeof link.order === "number" ? link.order : undefined,
      archived: true,
      archived_at: link.archivedAt,
    };
  }
  return typeof link.order === "number" ? { id: link.id, order: link.order } : link.id;
}

/**
 * ノードをファイルの中身にする。
 *
 * @param {any} node
 * @param {object} [options]
 * @param {boolean} [options.inbox] Inbox のノードか（`kind: inbox` を書く）
 * @param {boolean} [options.keepAttachments] 添付が 0 件でも `attachments:` を書く
 *   （書かないと、次に読むとき添付フォルダーの中身が添付として現れる）
 * @param {string[]} [options.extraBlocks] 未知のキーの元の行
 * @param {string} [options.today]
 */
function renderNodeFile(
  node,
  { inbox = false, keepAttachments = false, extraBlocks = [], today = "" } = {}
) {
  // 本文を読んでいないノードをそのまま書くと、本文が空のファイルになる。呼ぶ側が、
  // ディスクの本文を読んでから渡す（`writer.js`）。
  if (node.bodyLoaded === false)
    throw new Error(`本文を読んでいないノードは書けません: ${node.id}`);
  /** @type {Record<string, any>} */
  const data = { id: node.id, name: oneLine(node.name) };
  // ステータス無しは `status:` キーごと書かない。空文字を書くと、次に読んだとき
  // 「値がある」と「無い」を区別できなくなる。
  if (node.status) data.status = node.status;
  if (node.startDate) data.start = node.startDate;
  if (node.dueDate) data.due = node.dueDate;
  if (inbox) data.kind = "inbox";
  if (node.parents?.length > 0) data.parents = node.parents.map(linkToFrontmatter);
  // 本文の形式。既定（markdown）のときはキーを書かない。
  if (normalizeMemoFormat(node.format, "markdown") === "quill") data.format = "quill";
  const tags = normalizeTaskTags(node.tags);
  if (tags.length > 0) data.tags = tags;
  data.created = node.createdAt || today || new Date().toISOString().slice(0, 10);
  if (node.archived) {
    data.archived = true;
    if (node.archivedAt) data.archived_at = node.archivedAt;
  }
  const attachments = Array.isArray(node.attachments) ? node.attachments : [];
  if (attachments.length > 0 || keepAttachments) {
    data.attachments = attachments.map((attachment) => ({
      name: attachment.name,
      path: attachment.relativePath,
      size: Number.isFinite(attachment.size) ? attachment.size : undefined,
    }));
  }
  return stringifyFrontmatter(data, serializeNodeBody(node), {
    rawKeys: new Set(["id", "status", "start", "due", "kind", "created", "archived_at"]),
    extraBlocks,
  });
}

module.exports = {
  STATUSES,
  KNOWN_KEYS,
  normalizeDate,
  canonicalStatus,
  parseNodeFile,
  extraBlocksOf,
  renderNodeFile,
};
