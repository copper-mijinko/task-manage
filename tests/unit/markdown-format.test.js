import {
  formatScalar,
  parseFrontmatter,
  parseFrontmatterDetailed,
  stringifyFrontmatter,
} from "../../electron/store/frontmatter.js";
import {
  extraBlocksOf,
  normalizeDate,
  parseNodeFile,
  renderNodeFile,
} from "../../electron/store/node-file.js";

/**
 * ノードのファイル形式（旧 Markdown 形式 + グラフの機能）のテスト。
 *
 * ファイルは人や生成 AI が読み書きするので、標準的な YAML としても読める形で書き、
 * 手書きの形（引用符なし・`tags: [a, b]`・旧形式の `parents: [id]`）も読めること。
 */
describe("parseFrontmatter", () => {
  it("parses scalars, lists and the body", () => {
    const { data, body } = parseFrontmatter("---\nid: a\ntags:\n  - x\n  - y\n---\nbody text\n");
    expect(data.id).toBe("a");
    expect(data.tags).toEqual(["x", "y"]);
    expect(body).toContain("body text");
  });

  it("returns empty data when there is no frontmatter", () => {
    expect(parseFrontmatter("# Title").data).toEqual({});
  });

  it("keeps colons inside tags while still parsing parent link maps", () => {
    const { data } = parseFrontmatter(
      "---\ntags:\n  - scope:work\n  - owner: team\n  - https://example.test\nparents:\n  - id: p\n    order: 2\n---\n"
    );
    expect(data.tags).toEqual(["scope:work", "owner: team", "https://example.test"]);
    expect(data.parents).toEqual([{ id: "p", order: "2" }]);
  });

  it("reads a value that legacy versions wrote without quotes", () => {
    const { data } = parseFrontmatter("---\nname: Bug: login fails\nid: a\n---\n");
    expect(data.name).toBe("Bug: login fails");
  });

  it("reads quoted scalars and flow lists written by hand", () => {
    const { data } = parseFrontmatter(
      "---\nname: \"Quoted: name\"\ntitle: 'it''s'\ntags: [design, \"a, b\", c]\nparents: [p1, p2]\n---\n"
    );
    expect(data.name).toBe("Quoted: name");
    expect(data.title).toBe("it's");
    expect(data.tags).toEqual(["design", "a, b", "c"]);
    expect(data.parents).toEqual(["p1", "p2"]);
  });

  it("keeps a name that looks like a list as text", () => {
    const { data } = parseFrontmatter("---\nname: [WIP]\ntags: [a, b]\n---\n");
    expect(data.name).toBe("[WIP]");
    expect(data.tags).toEqual(["a", "b"]);
  });

  it("accepts a list that is not indented and a byte order mark", () => {
    const { data } = parseFrontmatter("﻿---\nid: a\ntags:\n- x\n- y\n---\n");
    expect(data.id).toBe("a");
    expect(data.tags).toEqual(["x", "y"]);
  });

  it("keeps the raw lines of every key, so unknown keys survive a rewrite", () => {
    const { blocks } = parseFrontmatterDetailed(
      "---\nid: a\nsummary: hand written\nmeta:\n  nested: 1\n  other: [1, 2]\nname: A\n---\n"
    );
    expect(blocks.map((block) => block.key)).toEqual(["id", "summary", "meta", "name"]);
    expect(blocks[2].text).toBe("meta:\n  nested: 1\n  other: [1, 2]");
  });
});

describe("stringifyFrontmatter", () => {
  it("quotes only the values that would be read as something else", () => {
    expect(formatScalar("plain text")).toBe("plain text");
    expect(formatScalar("日本語の名前")).toBe("日本語の名前");
    expect(formatScalar("Bug: login fails")).toBe('"Bug: login fails"');
    expect(formatScalar("#hash")).toBe('"#hash"');
    expect(formatScalar("- dash")).toBe('"- dash"');
    expect(formatScalar("true")).toBe('"true"');
    expect(formatScalar("123")).toBe('"123"');
    expect(formatScalar(" padded ")).toBe('" padded "');
    expect(formatScalar("")).toBe('""');
    expect(formatScalar("2026-09-01", true)).toBe("2026-09-01");
  });

  it("round-trips scalars, lists and maps", () => {
    const data = {
      id: "n1",
      name: 'He said "hi": ok',
      tags: ["a: b", "c"],
      parents: [{ id: "p", order: 1.5 }, "q"],
    };
    const text = stringifyFrontmatter(data, "body", { rawKeys: new Set(["id"]) });
    const parsed = parseFrontmatter(text);
    expect(parsed.data.name).toBe('He said "hi": ok');
    expect(parsed.data.tags).toEqual(["a: b", "c"]);
    expect(parsed.data.parents).toEqual([{ id: "p", order: "1.5" }, "q"]);
    expect(parsed.body).toBe("body");
  });

  it("puts the unknown keys back after the known ones", () => {
    const text = stringifyFrontmatter({ id: "a" }, "", { extraBlocks: ["summary: kept"] });
    expect(text).toBe("---\nid: a\nsummary: kept\n---\n");
  });
});

describe("node files", () => {
  const node = {
    id: "n1",
    name: "設計メモ",
    status: "In Progress",
    startDate: "2026-09-01",
    dueDate: "2026-09-30",
    parents: [
      { id: "proj", order: 1 },
      { id: "t2", order: 0, archived: true, archivedAt: "2026-09-20T01:00:00.000Z" },
      { id: "t3" },
    ],
    tags: ["設計", "a: b"],
    createdAt: "2026-08-24",
    body: "本文\n\n---\n\n水平線を含む",
    format: "markdown",
    attachments: [
      { id: "x", name: "仕様書.pdf", relativePath: "./attachments/仕様書.pdf", size: 12 },
    ],
  };

  it("keeps parents with their order and the archive mark of each edge", () => {
    const text = renderNodeFile(node);
    expect(text).toContain("parents:\n  - id: proj\n    order: 1\n  - id: t2\n    order: 0\n");
    expect(text).toContain("    archived: true\n    archived_at: 2026-09-20T01:00:00.000Z\n");
    expect(text).toContain("  - t3\n");
    const parsed = parseNodeFile(text);
    expect(parsed.node.parents).toEqual([
      { id: "proj", order: 1 },
      { id: "t2", order: 0, archived: true, archivedAt: "2026-09-20T01:00:00.000Z" },
      { id: "t3" },
    ]);
  });

  it("round-trips the fields, including a body that contains a horizontal rule", () => {
    const parsed = parseNodeFile(renderNodeFile(node));
    expect(parsed.node).toMatchObject({
      id: "n1",
      name: "設計メモ",
      status: "In Progress",
      startDate: "2026-09-01",
      dueDate: "2026-09-30",
      tags: ["設計", "a: b"],
      createdAt: "2026-08-24",
      body: node.body,
      format: "markdown",
    });
    expect(parsed.node.attachments).toEqual([
      {
        id: "./attachments/仕様書.pdf",
        name: "仕様書.pdf",
        relativePath: "./attachments/仕様書.pdf",
        size: 12,
      },
    ]);
    expect(parsed.hasAttachments).toBe(true);
  });

  it("omits a missing status instead of writing an empty one", () => {
    const text = renderNodeFile({ ...node, status: undefined });
    expect(text).not.toContain("status:");
    expect(parseNodeFile(text).node.status).toBeUndefined();
    expect(parseNodeFile(renderNodeFile({ ...node, status: "Undefined" })).node.status).toBe(
      "Undefined"
    );
  });

  it("writes `attachments:` for an empty list only when asked", () => {
    const empty = { ...node, attachments: [] };
    expect(renderNodeFile(empty)).not.toContain("attachments:");
    const kept = renderNodeFile(empty, { keepAttachments: true });
    expect(parseNodeFile(kept).hasAttachments).toBe(true);
    expect(parseNodeFile(kept).node.attachments).toEqual([]);
  });

  it("marks the Inbox and keeps a Quill body as fenced JSON", () => {
    const delta = { ops: [{ insert: "Rich\n", attributes: { bold: true } }] };
    const text = renderNodeFile({ ...node, format: "quill", body: delta }, { inbox: true });
    expect(text).toContain("kind: inbox\n");
    expect(text).toContain("format: quill\n");
    const parsed = parseNodeFile(text);
    expect(parsed.inbox).toBe(true);
    expect(parsed.node.body).toEqual(delta);
  });

  it("keeps unknown keys of the existing file", () => {
    const existing = "---\nid: n1\nname: A\nsummary: by an assistant\nlinks:\n  - a\n  - b\n---\n";
    expect(extraBlocksOf(existing)).toEqual(["summary: by an assistant", "links:\n  - a\n  - b"]);
    const text = renderNodeFile(node, { extraBlocks: extraBlocksOf(existing) });
    expect(text).toContain("summary: by an assistant\nlinks:\n  - a\n  - b\n---");
    expect(parseNodeFile(text).extraBlocks).toHaveLength(2);
  });

  it("puts the name on one line", () => {
    const text = renderNodeFile({ ...node, name: "two\nlines" });
    expect(parseNodeFile(text).node.name).toBe("two lines");
  });

  it("returns null when the file has no id", () => {
    expect(parseNodeFile("---\nname: No id\n---\nbody")).toBeNull();
    expect(parseNodeFile("just text")).toBeNull();
  });

  it("drops wrong values with a warning instead of refusing the file", () => {
    const parsed = parseNodeFile(
      "---\nid: a\nname: A\nstatus: Done\nstart: 2026-09-30\ndue: 2026-09-01\ncreated: 2026-02-31\n---\n"
    );
    expect(parsed.node.status).toBeUndefined();
    // 開始日が期限日より後のときは、開始日を捨てる。
    expect(parsed.node.startDate).toBeUndefined();
    expect(parsed.node.dueDate).toBe("2026-09-01");
    // 暦にない日付は捨てる（読み込み側が今日の日付で補う）。
    expect(parsed.node.createdAt).toBe("");
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("reads the legacy forms: createdAt, short parents and a node-level order", () => {
    const parsed = parseNodeFile(
      "---\nid: a\nname: A\nparents:\n  - root\norder: 3\ncreatedAt: 2026-04-24\nstatus: in progress\n---\n"
    );
    expect(parsed.node.parents).toEqual([{ id: "root", order: 3 }]);
    expect(parsed.node.createdAt).toBe("2026-04-24");
    expect(parsed.node.status).toBe("In Progress");
    expect(parsed.legacyOrder).toBe(3);
  });

  it("normalizes dates", () => {
    expect(normalizeDate("2026-09-01")).toBe("2026-09-01");
    expect(normalizeDate("2026-09-01T10:00:00Z")).toBe("2026-09-01");
    expect(normalizeDate("2026-13-01")).toBeUndefined();
    expect(normalizeDate("tomorrow")).toBeUndefined();
  });
});
