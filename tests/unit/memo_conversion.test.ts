import { describe, it, expect } from "vitest";
import {
  markdownToQuillDelta,
  quillDeltaToMarkdown,
  type QuillDelta,
} from "@features/memos/utils/memo_utils";

const ops = (delta: QuillDelta) => delta.ops;

const roundTripMd = (md: string) => quillDeltaToMarkdown(markdownToQuillDelta(md));

const roundTripDelta = (delta: QuillDelta): QuillDelta =>
  markdownToQuillDelta(quillDeltaToMarkdown(delta));

// 2つの Delta が semantic に等価か(同じ Markdown に変換されるか)で比較する。
// op 配列の構造的差(normalize による merge 等)を許容するため、ラウンドトリップ判定に使う。
const expectDeltaSemEqual = (actual: QuillDelta, expected: QuillDelta) =>
  expect(quillDeltaToMarkdown(actual)).toBe(quillDeltaToMarkdown(expected));

describe("Markdown ↔ Quill Delta — heading", () => {
  for (let n = 1; n <= 6; n++) {
    it(`H${n}`, () => {
      const md = `${"#".repeat(n)} Hello`;
      const d = markdownToQuillDelta(md);
      expect(ops(d)).toEqual([{ insert: "Hello" }, { insert: "\n", attributes: { header: n } }]);
      expect(quillDeltaToMarkdown(d)).toBe(md);
    });
  }

  it("heading + paragraph(blank-line separated)", () => {
    const md = "# Title\n\nBody";
    expect(roundTripMd(md)).toBe(md);
  });

  it("h1 + h2 + blockquote (issue case)", () => {
    const md = "# h1\n\n## h2\n\n> 引用";
    expect(roundTripMd(md)).toBe(md);
  });
});

describe("Markdown ↔ Quill Delta — paragraph", () => {
  it("simple paragraph", () => {
    const d = markdownToQuillDelta("Hello world");
    // normalize により text + "\n" は1opに merge される
    expect(ops(d)).toEqual([{ insert: "Hello world\n" }]);
    expect(quillDeltaToMarkdown(d)).toBe("Hello world");
  });

  it("two paragraphs (blank line)", () => {
    const md = "First\n\nSecond";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([{ insert: "First\nSecond\n" }]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("soft break inside one paragraph (no blank line) joins as space", () => {
    const d = markdownToQuillDelta("a\nb");
    expect(ops(d)).toEqual([{ insert: "a b\n" }]);
  });

  it("hard break via 2-trailing-spaces becomes br", () => {
    const d = markdownToQuillDelta("a  \nb");
    // normalize で "a" + "\n" + "b" + "\n" は1opに merge される
    expect(ops(d)).toEqual([{ insert: "a\nb\n" }]);
  });
});

describe("Markdown ↔ Quill Delta — inline formatting", () => {
  it("bold", () => {
    const md = "**bold**";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([{ insert: "bold", attributes: { bold: true } }, { insert: "\n" }]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("italic with *", () => {
    const md = "*italic*";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([{ insert: "italic", attributes: { italic: true } }, { insert: "\n" }]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("bold + italic combined", () => {
    const md = "***both***";
    const d = markdownToQuillDelta(md);
    // markedのトークン化は順序が異なる場合があるので個別検証
    expect(
      ops(d).some((op) => {
        const a = op.attributes as Record<string, unknown> | undefined;
        return a?.bold === true && a?.italic === true && op.insert === "both";
      })
    ).toBe(true);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("strikethrough (GFM)", () => {
    const md = "~~gone~~";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([{ insert: "gone", attributes: { strike: true } }, { insert: "\n" }]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("inline code", () => {
    const md = "`code`";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([{ insert: "code", attributes: { code: true } }, { insert: "\n" }]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("link", () => {
    const md = "[example](https://example.com)";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([
      { insert: "example", attributes: { link: "https://example.com" } },
      { insert: "\n" },
    ]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("image", () => {
    const md = "![](https://example.com/img.png)";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([
      { insert: { image: "https://example.com/img.png" } },
      { insert: "\n" },
    ]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("underline (<u> html)", () => {
    const md = "<u>under</u>";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([
      { insert: "under", attributes: { underline: true } },
      { insert: "\n" },
    ]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });
});

describe("Markdown ↔ Quill Delta — list", () => {
  it("flat bullet list", () => {
    const md = "- A\n- B\n- C";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([
      { insert: "A" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "B" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "C" },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("nested bullet list (2 levels)", () => {
    const md = "- A\n  - A1\n  - A2\n- B";
    expect(roundTripMd(md)).toBe(md);
  });

  it("nested bullet list (3 levels)", () => {
    const md = "- A\n  - A1\n    - A1a\n    - A1b\n  - A2\n- B";
    expect(roundTripMd(md)).toBe(md);
  });

  it("ordered list (normalized to 1.)", () => {
    const md = "1. A\n1. B\n1. C";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([
      { insert: "A" },
      { insert: "\n", attributes: { list: "ordered" } },
      { insert: "B" },
      { insert: "\n", attributes: { list: "ordered" } },
      { insert: "C" },
      { insert: "\n", attributes: { list: "ordered" } },
    ]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("task list checked/unchecked", () => {
    const md = "- [x] done\n- [ ] todo";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([
      { insert: "done" },
      { insert: "\n", attributes: { list: "checked" } },
      { insert: "todo" },
      { insert: "\n", attributes: { list: "unchecked" } },
    ]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });
});

describe("Markdown ↔ Quill Delta — blockquote", () => {
  it("single line", () => {
    const md = "> Hello";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([
      { insert: "Hello" },
      { insert: "\n", attributes: { blockquote: true } },
    ]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("multi-line joined per CommonMark soft break", () => {
    // CommonMark: blockquote内の soft break は同段落の空白扱い → `> a b` に正規化される
    const md = "> a\n> b";
    expect(roundTripMd(md)).toBe("> a b");
  });

  it("eventually stabilizes for multi-paragraph blockquote", () => {
    // CommonMark の「1 blockquote 内 2 paragraph」は Quill が表現できないため (line-by-line形式)、
    // 数回ラウンドトリップすると単行表現に正規化されることのみ確認する。
    const md = "> a\n>\n> b";
    let result = md;
    for (let i = 0; i < 4; i++) result = roundTripMd(result);
    expect(roundTripMd(result)).toBe(result);
  });
});

describe("Markdown ↔ Quill Delta — code block", () => {
  it("fenced code", () => {
    const md = "```\nline1\nline2\n```";
    const d = markdownToQuillDelta(md);
    expect(ops(d)).toEqual([
      { insert: "line1" },
      { insert: "\n", attributes: { "code-block": true } },
      { insert: "line2" },
      { insert: "\n", attributes: { "code-block": true } },
    ]);
    expect(quillDeltaToMarkdown(d)).toBe(md);
  });

  it("code with blank line inside", () => {
    const md = "```\nA\n\nB\n```";
    expect(roundTripMd(md)).toBe(md);
  });
});

describe("Markdown ↔ Quill Delta — combined", () => {
  it("heading + paragraph + bullet list", () => {
    const md = "# Title\n\nIntro paragraph.\n\n- A\n- B\n- C";
    expect(roundTripMd(md)).toBe(md);
  });

  it("heading + ordered + nested bullet", () => {
    // markedの ordered list ネスト判定: marker `1. ` の content列(3 chars)以上のインデントが必要。
    // 出力側の renderListBlock は indent*2 spaces を採用、入力もそれに合わせる。
    const md = "## Steps\n\n1. first\n1. second\n  - nested\n  - again\n1. third";
    const out = roundTripMd(md);
    // 安定性のみ確認(入力が正規化形でない場合があるため再 round trip で同じになるか)
    expect(roundTripMd(out)).toBe(out);
  });

  it("blockquote then list", () => {
    const md = "> quote\n\n- A\n- B";
    expect(roundTripMd(md)).toBe(md);
  });
});

describe("Quill→Md→Quill round trip", () => {
  it("heading H1", () => {
    const original: QuillDelta = {
      ops: [{ insert: "Hello" }, { insert: "\n", attributes: { header: 1 } }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("heading H2-H6", () => {
    for (let n = 2; n <= 6; n++) {
      const original: QuillDelta = {
        ops: [{ insert: `H${n}` }, { insert: "\n", attributes: { header: n } }],
      };
      expect(roundTripDelta(original)).toEqual(original);
    }
  });

  it("plain paragraph (normalized)", () => {
    const original: QuillDelta = { ops: [{ insert: "Hello world\n" }] };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("two paragraphs", () => {
    const original: QuillDelta = { ops: [{ insert: "First\nSecond\n" }] };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("bold text", () => {
    const original: QuillDelta = {
      ops: [{ insert: "bold", attributes: { bold: true } }, { insert: "\n" }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("italic text", () => {
    const original: QuillDelta = {
      ops: [{ insert: "italic", attributes: { italic: true } }, { insert: "\n" }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("bold + italic combined", () => {
    const original: QuillDelta = {
      ops: [{ insert: "x", attributes: { bold: true, italic: true } }, { insert: "\n" }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("strike", () => {
    const original: QuillDelta = {
      ops: [{ insert: "gone", attributes: { strike: true } }, { insert: "\n" }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("inline code", () => {
    const original: QuillDelta = {
      ops: [{ insert: "code", attributes: { code: true } }, { insert: "\n" }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("link", () => {
    const original: QuillDelta = {
      ops: [{ insert: "site", attributes: { link: "https://example.com" } }, { insert: "\n" }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("image", () => {
    const original: QuillDelta = {
      ops: [{ insert: { image: "https://example.com/x.png" } }, { insert: "\n" }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("underline", () => {
    const original: QuillDelta = {
      ops: [{ insert: "u", attributes: { underline: true } }, { insert: "\n" }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("bullet list flat", () => {
    const original: QuillDelta = {
      ops: [
        { insert: "A" },
        { insert: "\n", attributes: { list: "bullet" } },
        { insert: "B" },
        { insert: "\n", attributes: { list: "bullet" } },
        { insert: "C" },
        { insert: "\n", attributes: { list: "bullet" } },
      ],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("bullet list nested 2 levels", () => {
    const original: QuillDelta = {
      ops: [
        { insert: "A" },
        { insert: "\n", attributes: { list: "bullet" } },
        { insert: "A1" },
        { insert: "\n", attributes: { list: "bullet", indent: 1 } },
        { insert: "B" },
        { insert: "\n", attributes: { list: "bullet" } },
      ],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("bullet list nested 3 levels", () => {
    const original: QuillDelta = {
      ops: [
        { insert: "A" },
        { insert: "\n", attributes: { list: "bullet" } },
        { insert: "A1" },
        { insert: "\n", attributes: { list: "bullet", indent: 1 } },
        { insert: "A1a" },
        { insert: "\n", attributes: { list: "bullet", indent: 2 } },
        { insert: "B" },
        { insert: "\n", attributes: { list: "bullet" } },
      ],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("ordered list", () => {
    const original: QuillDelta = {
      ops: [
        { insert: "A" },
        { insert: "\n", attributes: { list: "ordered" } },
        { insert: "B" },
        { insert: "\n", attributes: { list: "ordered" } },
      ],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("task list checked/unchecked", () => {
    const original: QuillDelta = {
      ops: [
        { insert: "done" },
        { insert: "\n", attributes: { list: "checked" } },
        { insert: "todo" },
        { insert: "\n", attributes: { list: "unchecked" } },
      ],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("blockquote single line", () => {
    const original: QuillDelta = {
      ops: [{ insert: "quote" }, { insert: "\n", attributes: { blockquote: true } }],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("code block", () => {
    const original: QuillDelta = {
      ops: [
        { insert: "line1" },
        { insert: "\n", attributes: { "code-block": true } },
        { insert: "line2" },
        { insert: "\n", attributes: { "code-block": true } },
      ],
    };
    expect(roundTripDelta(original)).toEqual(original);
  });

  it("heading + paragraph + list combined", () => {
    const original: QuillDelta = {
      ops: [
        { insert: "Title" },
        { insert: "\n", attributes: { header: 1 } },
        { insert: "Intro\n" },
        { insert: "A" },
        { insert: "\n", attributes: { list: "bullet" } },
        { insert: "B" },
        { insert: "\n", attributes: { list: "bullet" } },
      ],
    };
    // normalize により paragraph 終端 "\n" と次の list item text が同 attrs として merge される。
    // syntactic 一致は崩れるが、Md 出力上は同等であることを確認する。
    expectDeltaSemEqual(roundTripDelta(original), original);
  });
});

describe("Markdown ↔ Quill Delta — edge cases", () => {
  it("empty input", () => {
    expect(markdownToQuillDelta("")).toEqual({ ops: [{ insert: "\n" }] });
    expect(quillDeltaToMarkdown({ ops: [{ insert: "\n" }] })).toBe("");
  });

  it("only blank lines collapse", () => {
    const md = "\n\n\n";
    const d = markdownToQuillDelta(md);
    expect(d.ops).toEqual([{ insert: "\n" }]);
  });

  it("Quill independent attributes (color/font) are dropped on Md output", () => {
    const d: QuillDelta = {
      ops: [{ insert: "x", attributes: { color: "#f00", bold: true } }, { insert: "\n" }],
    };
    expect(quillDeltaToMarkdown(d)).toBe("**x**");
  });

  it("paragraph-level indent is dropped on Md output", () => {
    const d: QuillDelta = {
      ops: [{ insert: "text" }, { insert: "\n", attributes: { indent: 2 } }],
    };
    expect(quillDeltaToMarkdown(d)).toBe("text");
  });
});
