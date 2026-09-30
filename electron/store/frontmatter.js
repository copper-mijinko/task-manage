/**
 * Markdown ファイル先頭の frontmatter（YAML のごく一部）の読み書き。
 *
 * ファイルは人や生成 AI が読み書きするので、標準的な YAML ライブラリでも
 * 読めるように書く（`name: "Bug: login fails"` のように、必要なときだけ値を
 * 引用符で囲む）。読むときは、旧形式で引用符なしに書かれた値も、手書きの
 * `tags: [a, b]` のような書き方も受ける。
 *
 * 扱う形は次の 3 つだけ。
 * - スカラー: `key: value`
 * - 文字列の配列: `key:` に続く `  - item`、または `key: [a, b]`
 * - マップの配列: `parents` と `attachments` だけ（`  - id: x` に続く `    order: 1`）
 *
 * アプリが知らないキーは、書き戻すときに失わないよう、元の行のまま
 * `blocks` に残す（`parseFrontmatterDetailed`）。
 */

/** マップの配列として読むキー。タグなど他のキーの `- a: b` は文字列のまま。 */
const MAP_LIST_KEYS = new Set(["parents", "attachments"]);

/** 値が引用符で囲まれていれば中身を返す。そうでなければそのまま。 */
function parseScalar(raw) {
  const value = String(raw).trim();
  if (value === "") return null;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // 引用符で始まって終わるだけの普通の文字列として扱う。
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** `a, "b, c", d` を引用符の外のカンマで分ける。 */
function splitFlowList(inner) {
  const parts = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"') {
        current += inner[index + 1] ?? "";
        index += 1;
      } else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim() !== "" || parts.length > 0) parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** `[a, b]` なら配列、そうでなければスカラー。 */
function parseValue(raw) {
  const value = String(raw).trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitFlowList(value.slice(1, -1)).map(parseScalar);
  }
  return parseScalar(value);
}

/**
 * frontmatter を読む。`blocks` は最上位のキーごとの元の行（未知のキーを
 * 書き戻すときに使う）。
 *
 * @param {string} content
 * @returns {{ data: Record<string, any>, body: string, blocks: { key: string, text: string }[] }}
 */
function parseFrontmatterDetailed(content) {
  const source = String(content ?? "").replace(/^\uFEFF/, "");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: {}, body: source, blocks: [] };

  const body = source.slice(match[0].length).trim();
  /** @type {Record<string, any>} */
  const data = {};
  /** @type {{ key: string, lines: string[] }[]} */
  const blocks = [];
  let currentKey = null;
  let currentItem = null;
  let itemIndent = 0;

  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "" || /^\s*#/.test(line)) {
      if (blocks.length > 0) blocks[blocks.length - 1].lines.push(line);
      continue;
    }

    const listMatch = line.match(/^(\s*)-(?:\s+(.*))?$/);
    if (listMatch && currentKey) {
      blocks[blocks.length - 1]?.lines.push(line);
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      const entry = (listMatch[2] ?? "").trim();
      // `- key: value` はマップ要素の 1 行目。タグ（`owner: team` も文字列）と
      // 区別するため、マップにするのは対象のキーだけ。
      const entryKv = MAP_LIST_KEYS.has(currentKey) && entry.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (entryKv) {
        currentItem = { [entryKv[1]]: parseScalar(entryKv[2]) };
        itemIndent = listMatch[1].length;
        data[currentKey].push(currentItem);
      } else {
        currentItem = null;
        data[currentKey].push(parseScalar(entry));
      }
      continue;
    }

    const nested = line.match(/^(\s+)([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && currentItem && nested[1].length > itemIndent) {
      blocks[blocks.length - 1]?.lines.push(line);
      currentItem[nested[2]] = parseScalar(nested[3]);
      continue;
    }

    const top = line.match(/^([^\s:][^:]*):\s*(.*)$/);
    if (top) {
      currentKey = top[1].trim();
      currentItem = null;
      blocks.push({ key: currentKey, lines: [line] });
      const raw = top[2].trim();
      data[currentKey] = raw === "" ? null : parseValue(raw);
      continue;
    }

    // 読み取れない行（複数行の文字列など）は、所属するキーの行として残す。
    blocks[blocks.length - 1]?.lines.push(line);
  }

  return {
    data,
    body,
    blocks: blocks.map(({ key, lines }) => ({
      key,
      text: lines.join("\n").replace(/\s+$/, ""),
    })),
  };
}

/**
 * frontmatter を読む。
 *
 * @param {string} content
 * @returns {{ data: Record<string, any>, body: string }}
 */
function parseFrontmatter(content) {
  const { data, body } = parseFrontmatterDetailed(content);
  return { data, body };
}

/** 引用符なしで書くと別の意味に読まれうる文字列か。 */
function needsQuoting(text) {
  if (text === "") return true;
  if (/^\s|\s$/.test(text)) return true;
  // eslint-disable-next-line no-control-regex -- 改行などの制御文字は 1 行に書けない
  if (/[\u0000-\u001f]/.test(text)) return true;
  if (/:(\s|$)/.test(text) || /\s#/.test(text)) return true;
  if (/^[[\]{}#&*!|>'"%@`]/.test(text)) return true;
  if (/^[-?:,](\s|$)/.test(text)) return true;
  if (/^(true|false|yes|no|on|off|null|~)$/i.test(text)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return true;
  return false;
}

/**
 * スカラーを書く形にする。`raw` は日付や id のように、そのまま書いてよい値。
 *
 * @param {unknown} value
 * @param {boolean} [raw]
 */
function formatScalar(value, raw = false) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (raw && text !== "" && !/[\n\r]/.test(text) && !/:(\s|$)/.test(text)) return text;
  return needsQuoting(text) ? JSON.stringify(text) : text;
}

/**
 * frontmatter と本文を 1 つの文字列にする。
 *
 * `data` の値は、スカラー・スカラーの配列・マップの配列。`undefined` と
 * `null` は書かない。`rawKeys` のキーのスカラーは、引用符が要らなければ
 * そのまま書く。`extraBlocks` は未知のキーの元の行で、最後に付け足す。
 *
 * @param {Record<string, any>} data
 * @param {string} [body]
 * @param {{ rawKeys?: Set<string>, extraBlocks?: string[] }} [options]
 */
function stringifyFrontmatter(data, body = "", { rawKeys = new Set(), extraBlocks = [] } = {}) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      // 空の配列は `key: []`（`key:` だけだと、読むときに「キーが無い」のと区別できない）。
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }
      lines.push(`${key}:`);
      for (const item of value) {
        if (item && typeof item === "object") {
          const entries = Object.entries(item).filter(([, v]) => v !== undefined && v !== null);
          if (entries.length === 0) continue;
          lines.push(`  - ${entries[0][0]}: ${formatScalar(entries[0][1], true)}`);
          for (const [k, v] of entries.slice(1)) lines.push(`    ${k}: ${formatScalar(v, true)}`);
        } else {
          lines.push(`  - ${formatScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${formatScalar(value, rawKeys.has(key))}`);
    }
  }
  for (const block of extraBlocks) if (block) lines.push(block);
  lines.push("---");
  if (body) lines.push("", body);
  return lines.join("\n") + "\n";
}

module.exports = {
  parseFrontmatter,
  parseFrontmatterDetailed,
  stringifyFrontmatter,
  formatScalar,
};
