import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";
import { startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";

const quillInstances = [];

vi.mock("quill", () => {
  class MockQuill {
    constructor(element, options) {
      this.element = element;
      this.options = options;
      this.root = document.createElement("div");
      this.root.className = "ql-editor";
      this.toolbarContainer = document.createElement("div");
      this.theme = { tooltip: { hide: vi.fn() } };
      this.handlers = {};
      this.tableModule = {
        insertTable: vi.fn(),
        insertRowAbove: vi.fn(),
        insertRowBelow: vi.fn(),
        insertColumnLeft: vi.fn(),
        insertColumnRight: vi.fn(),
        deleteRow: vi.fn(),
        deleteColumn: vi.fn(),
        deleteTable: vi.fn(),
      };
      this.on = vi.fn((event, callback) => {
        this.handlers[event] = callback;
      });
      this.enable = vi.fn();
      this.setContents = vi.fn();
      this.setText = vi.fn();
      this.getContents = vi.fn(() => ({ ops: [{ insert: "changed\n" }] }));
      this.getLength = vi.fn(() => 0);
      this.getSelection = vi.fn(() => null);
      this.hasFocus = vi.fn(() => false);
      this.setSelection = vi.fn();
      this.deleteText = vi.fn();
      this.insertText = vi.fn();
      this.getModule = vi.fn((name) => {
        if (name === "toolbar") return { container: this.toolbarContainer };
        if (name === "table") return this.tableModule;
        return null;
      });
      this.element?.appendChild(this.toolbarContainer);
      this.element?.appendChild(this.root);
      for (const group of options.modules?.toolbar?.container ?? []) {
        for (const control of Array.isArray(group) ? group : [group]) {
          if (typeof control === "string") {
            const button = document.createElement("button");
            button.className = `ql-${control}`;
            this.toolbarContainer.appendChild(button);
            continue;
          }
          if (!control || typeof control !== "object") continue;
          const [[format, value] = []] = Object.entries(control);
          if (!format) continue;
          if (Array.isArray(value)) {
            const select = document.createElement("select");
            select.className = `ql-${format}`;
            for (const optionValue of value) {
              const option = document.createElement("option");
              option.value = optionValue === false ? "" : String(optionValue);
              select.appendChild(option);
            }
            this.toolbarContainer.appendChild(select);
            continue;
          }
          const button = document.createElement("button");
          button.className = `ql-${format}`;
          button.setAttribute("value", String(value));
          this.toolbarContainer.appendChild(button);
        }
      }
      quillInstances.push(this);
    }
  }
  return { default: MockQuill };
});

import Memo from "@features/memos/components/Memo.svelte";

async function waitForMemoComponent() {
  await waitFor(
    () => {
      expect(document.querySelector(".memo-host").firstElementChild).toBeInTheDocument();
    },
    { timeout: 20000 }
  );
}

async function renderMemo(props = {}) {
  const result = render(Memo, { props });
  await waitForMemoComponent();
  return result;
}

async function renderMarkdownMemo(props = {}) {
  const result = render(Memo, {
    props: {
      saveMemo: vi.fn(),
      content: "",
      isWorkspaceProject: true,
      ...props,
    },
  });
  await waitForMemoComponent();
  return result;
}

async function openMarkdownEditor(props = {}) {
  await renderMarkdownMemo(props);
  await fireEvent.click(document.querySelector(".edit-mode-btn"));
  await waitFor(() => {
    expect(document.querySelector(".cm-editor")).toBeInTheDocument();
  });
  return EditorView.findFromDOM(document.querySelector(".cm-editor"));
}

function markdownToolButton(label) {
  return document.querySelector(`button[aria-label="${label}"]`);
}

async function chooseMarkdownTableAction(label) {
  const select = document.querySelector('select[aria-label="Table"]');
  expect(select).toBeInTheDocument();
  const option = [...select.options].find((candidate) => candidate.textContent === label);
  expect(option).toBeTruthy();
  await fireEvent.change(select, { target: { value: option.value } });
}

describe("Memo mode routing", () => {
  beforeEach(() => {
    quillInstances.length = 0;
    window.electronAPI = { wsResolveMemoAsset: vi.fn(), openExternalLink: vi.fn() };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("uses Quill for db.json Projects even when a workspace path exists", async () => {
    const saveMemo = vi.fn();
    await renderMemo({
      saveMemo,
      content: { ops: [{ insert: "legacy\n" }] },
      workspaceProjectDir: "C:\\workspace\\project",
      taskId: "task-1",
      isWorkspaceProject: false,
    });

    expect(quillInstances).toHaveLength(1);
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(quillInstances[0].setContents).toHaveBeenCalledWith({ ops: [{ insert: "legacy\n" }] });
  });

  test("uses Markdown editor for workspace projects", async () => {
    await renderMarkdownMemo({ content: "# Workspace" });

    expect(quillInstances).toHaveLength(0);
    expect(document.querySelector(".preview-mode")).toBeInTheDocument();
    expect(document.querySelector(".preview h1")).toHaveTextContent("Workspace");
  }, 30000);

  test("uses Markdown editor for db.json memo when its format is markdown", async () => {
    await renderMemo({
      saveMemo: vi.fn(),
      content: "# Markdown in db",
      isWorkspaceProject: false,
      format: "markdown",
    });

    expect(quillInstances).toHaveLength(0);
    expect(document.querySelector(".preview h1")).toHaveTextContent("Markdown in db");
  });

  test("uses a monospace-friendly font stack in the Markdown editor", async () => {
    await openMarkdownEditor({ content: "| A | B |\n| --- | --- |\n| 1 | 2 |" });
    const scroller = document.querySelector(".cm-scroller");

    expect(getComputedStyle(scroller).fontFamily).toContain("BIZ UD");
    expect(getComputedStyle(scroller).fontFamily).toContain("Consolas");
  });

  test("uses a Quill-like heading picker in the Markdown toolbar", async () => {
    const view = await openMarkdownEditor({ content: "Title" });
    const headingPicker = document.querySelector('select[aria-label="Heading"]');

    expect(headingPicker).toBeInTheDocument();
    expect(
      [...document.querySelector(".toolbar").querySelectorAll("select, button")].map((control) =>
        control.getAttribute("aria-label")
      )
    ).toEqual([
      "Heading",
      "Bold",
      "Italic",
      "Inline code",
      "Link",
      "Bullet list",
      "Quote",
      "Code block",
      "Table",
    ]);
    expect(markdownToolButton("Heading 1")).not.toBeInTheDocument();
    expect([...headingPicker.options].map((option) => option.value)).toEqual(["normal", "1", "2"]);
    expect(markdownToolButton("Checklist")).not.toBeInTheDocument();
    expect(markdownToolButton("表を挿入")).not.toBeInTheDocument();

    await fireEvent.change(headingPicker, { target: { value: "2" } });
    expect(view.state.doc.toString()).toBe("## Title");
    expect(headingPicker.value).toBe("2");

    await fireEvent.change(headingPicker, { target: { value: "normal" } });
    expect(view.state.doc.toString()).toBe("Title");
  });

  test("uses Quill editor for workspace memo when its format is quill", async () => {
    await renderMemo({
      saveMemo: vi.fn(),
      content: { ops: [{ insert: "workspace quill\n" }] },
      isWorkspaceProject: true,
      format: "quill",
    });

    expect(quillInstances).toHaveLength(1);
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(quillInstances[0].options.modules.table).toBe(true);
    expect(quillInstances[0].options.modules.toolbar.container).toEqual([
      [{ header: [1, 2, false] }],
      ["bold", "italic", "code"],
      ["link", { list: "bullet" }, "blockquote", "code-block"],
    ]);
    expect(
      quillInstances[0].toolbarContainer.querySelector('select[aria-label="Table"]')
    ).toBeInTheDocument();
  });

  test("limits the Quill toolbar to shared Markdown-compatible controls", async () => {
    await renderMemo({ saveMemo: vi.fn(), content: "", isWorkspaceProject: false });
    const toolbar = JSON.stringify(quillInstances[0].options.modules.toolbar.container);

    for (const unsupported of [
      "font",
      "color",
      "background",
      "underline",
      "strike",
      "script",
      "indent",
      "align",
      "image",
      "ordered",
      "clean",
    ]) {
      expect(toolbar).not.toContain(unsupported);
    }

    expect(toolbar).toContain("header");
    expect(toolbar).toContain("bold");
    expect(toolbar).toContain("italic");
    expect(toolbar).toContain("code");
    expect(toolbar).toContain("blockquote");
    expect(toolbar).toContain("bullet");
    expect(toolbar).toContain("link");
    expect(quillInstances[0].toolbarContainer.querySelectorAll("button.ql-table")).toHaveLength(0);
    expect(
      quillInstances[0].toolbarContainer.querySelector('select[aria-label="Table"]')
    ).toBeInTheDocument();
  });

  test("uses a Quill table dropdown with all table actions", async () => {
    await renderMemo({ saveMemo: vi.fn(), content: "", isWorkspaceProject: false });
    const select = quillInstances[0].toolbarContainer.querySelector('select[aria-label="Table"]');

    expect(select).toBeInTheDocument();
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Table",
      "表を挿入",
      "行を上に追加",
      "行を下に追加",
      "列を左に追加",
      "列を右に追加",
      "行を削除",
      "列を削除",
      "表を削除",
    ]);
    expect(quillInstances[0].toolbarContainer.querySelectorAll("button.ql-table")).toHaveLength(0);

    await fireEvent.change(select, { target: { value: "delete-column" } });

    expect(quillInstances[0].tableModule.deleteColumn).toHaveBeenCalledTimes(1);
    expect(select.value).toBe("");
  });

  test("adds distinct Quill inline and block code toolbar buttons", async () => {
    await renderMemo({ saveMemo: vi.fn(), content: "", isWorkspaceProject: false });
    const inlineCode = quillInstances[0].toolbarContainer.querySelector("button.ql-code");
    const codeBlock = quillInstances[0].toolbarContainer.querySelector("button.ql-code-block");

    expect(inlineCode).toHaveAttribute("title", "インラインコード");
    expect(codeBlock).toHaveAttribute("title", "コードブロック");
    expect(inlineCode.innerHTML).not.toBe(codeBlock.innerHTML);
  });

  test("db.json Projects save Quill Delta content", async () => {
    const saveMemo = vi.fn();
    await renderMemo({ saveMemo, content: "", isWorkspaceProject: false });
    const quill = quillInstances.at(-1);

    quill.handlers["text-change"]({}, {}, "user");
    await tick();

    expect(saveMemo).toHaveBeenCalledWith({ ops: [{ insert: "changed\n" }] });
  });

  test("does not reapply matching Quill Delta after a user edit", async () => {
    const saveMemo = vi.fn();
    const result = await renderMemo({
      saveMemo,
      content: { ops: [{ insert: "before\n" }] },
      isWorkspaceProject: false,
    });
    const quill = quillInstances.at(-1);

    try {
      vi.useFakeTimers();
      class MockDelta {
        constructor(ops) {
          this.ops = ops;
        }
      }

      quill.setContents.mockClear();
      quill.setSelection.mockClear();
      quill.hasFocus = vi.fn(() => true);
      quill.getSelection = vi.fn(() => ({ index: 8, length: 0 }));
      quill.getLength = vi.fn(() => 9);
      quill.getContents = vi.fn(() => new MockDelta([{ insert: "changed\n" }]));

      quill.handlers["text-change"]({}, {}, "user");
      await tick();

      expect(saveMemo).toHaveBeenCalledWith({ ops: [{ insert: "changed\n" }] });

      await result.rerender({
        saveMemo,
        content: { ops: [{ insert: "changed\n" }] },
        isWorkspaceProject: false,
      });
      await tick();
      vi.advanceTimersByTime(150);
      await tick();

      expect(quill.setContents).not.toHaveBeenCalled();
      expect(quill.setSelection).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Markdown Memo - view mode", () => {
  let saveMemo;

  beforeEach(() => {
    quillInstances.length = 0;
    saveMemo = vi.fn();
    window.electronAPI = { wsResolveMemoAsset: vi.fn(), openExternalLink: vi.fn() };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("renders in view mode by default (no CM6 editor)", async () => {
    await renderMarkdownMemo({ saveMemo, content: "" });
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(document.querySelector(".preview-mode")).toBeInTheDocument();
  });

  test("shows placeholder when content is empty", async () => {
    await renderMarkdownMemo({ saveMemo, content: "" });
    expect(document.querySelector(".placeholder")).toBeInTheDocument();
    expect(document.querySelector(".preview-mode")).toHaveClass("emptyContent");
  });

  test("renders markdown content as HTML in view mode", async () => {
    await renderMarkdownMemo({ saveMemo, content: "# Hello\n\nWorld" });
    const preview = document.querySelector(".preview");
    expect(preview).toBeInTheDocument();
    expect(preview.querySelector("h1")).toHaveTextContent("Hello");
  });

  test("renders wiki links with resolved state when memo exists", async () => {
    await renderMarkdownMemo({
      saveMemo,
      content: "[[Daily Notes]] and [[Missing Note]]",
      memoTitles: ["Daily Notes"],
    });

    const links = document.querySelectorAll(".preview .wiki-link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveClass("is-resolved");
    expect(links[1]).toHaveClass("is-unresolved");
  });

  test("resolves workspace image paths to previewable file URLs", async () => {
    window.electronAPI.wsResolveMemoAsset.mockResolvedValue({
      success: true,
      url: "file:///C:/workspace/project/task-1/assets/diagram.png",
    });

    await renderMarkdownMemo({
      saveMemo,
      content: "![Diagram](./assets/diagram.png)",
      workspaceProjectDir: "C:\\workspace\\project",
      taskId: "task-1",
    });

    await waitFor(() => {
      const image = document.querySelector(".preview img");
      expect(image).toBeInTheDocument();
      expect(image.getAttribute("src")).toBe(
        "file:///C:/workspace/project/task-1/assets/diagram.png"
      );
    });
  });

  test("converts legacy Quill Delta object to readable markdown text in workspace view", async () => {
    const delta = { ops: [{ insert: "hello" }, { insert: "\nworld" }] };
    await renderMarkdownMemo({ saveMemo, content: delta });
    expect(document.querySelector(".preview")).toHaveTextContent("hello");
    expect(document.querySelector(".preview")).toHaveTextContent("world");
    expect(document.querySelector(".preview")).not.toHaveTextContent('"ops"');
  });

  test("readOnly: no placeholder shown when empty", async () => {
    await renderMarkdownMemo({ saveMemo, content: "", readOnly: true });
    expect(document.querySelector(".placeholder")).not.toBeInTheDocument();
    expect(document.querySelector(".preview-mode")).toHaveClass("emptyContent");
  });
});

describe("Markdown Memo - edit mode", () => {
  let saveMemo;

  beforeEach(() => {
    quillInstances.length = 0;
    saveMemo = vi.fn();
    window.electronAPI = { wsSaveMemoImage: vi.fn() };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("clicking edit mode switch shows CM6 editor", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });
  });

  test("inserts a Markdown table from the edit toolbar", async () => {
    const view = await openMarkdownEditor({ saveMemo, content: "" });

    await chooseMarkdownTableAction("表を挿入");
    await tick();

    expect(view.state.doc.toString()).toBe(
      "| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |"
    );
  });

  test("edits Markdown table rows and columns from the edit toolbar", async () => {
    const initialTable = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const view = await openMarkdownEditor({ saveMemo, content: initialTable });

    view.dispatch({ selection: { anchor: initialTable.indexOf("2") } });
    await chooseMarkdownTableAction("列を右に追加");
    await tick();
    expect(view.state.doc.toString()).toBe(
      "| A   | B   |     |\n| --- | --- | --- |\n| 1   | 2   |     |"
    );

    await chooseMarkdownTableAction("列を削除");
    await tick();
    expect(view.state.doc.toString()).toBe("| A   | B   |\n| --- | --- |\n| 1   | 2   |");

    await chooseMarkdownTableAction("行を下に追加");
    await tick();
    expect(view.state.doc.toString()).toBe(
      "| A   | B   |\n| --- | --- |\n| 1   | 2   |\n|     |     |"
    );

    await chooseMarkdownTableAction("行を削除");
    await tick();
    expect(view.state.doc.toString()).toBe("| A   | B   |\n| --- | --- |\n| 1   | 2   |");

    await chooseMarkdownTableAction("表を削除");
    await tick();
    expect(view.state.doc.toString()).toBe("");
  });

  test("inserts Markdown table rows above and columns left from the edit toolbar", async () => {
    const initialTable = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const view = await openMarkdownEditor({ saveMemo, content: initialTable });

    view.dispatch({ selection: { anchor: initialTable.indexOf("2") } });
    await chooseMarkdownTableAction("行を上に追加");
    await tick();
    expect(view.state.doc.toString()).toBe(
      "| A   | B   |\n| --- | --- |\n|     |     |\n| 1   | 2   |"
    );

    await chooseMarkdownTableAction("列を左に追加");
    await tick();
    expect(view.state.doc.toString()).toBe(
      "| A   |     | B   |\n| --- | --- | --- |\n|     |     |     |\n| 1   |     | 2   |"
    );
  });

  test("keeps Markdown table controls working for one-column tables", async () => {
    const initialTable = "| A |\n| --- |\n| 1 |";
    const view = await openMarkdownEditor({ saveMemo, content: initialTable });

    view.dispatch({ selection: { anchor: initialTable.indexOf("1") } });
    await chooseMarkdownTableAction("行を下に追加");
    await tick();
    expect(view.state.doc.toString()).toBe("| A   |\n| --- |\n| 1   |\n|     |");

    await chooseMarkdownTableAction("列を右に追加");
    await tick();
    expect(view.state.doc.toString()).toBe(
      "| A   |     |\n| --- | --- |\n| 1   |     |\n|     |     |"
    );

    await chooseMarkdownTableAction("列を削除");
    await tick();
    expect(view.state.doc.toString()).toBe("| A   |\n| --- |\n| 1   |\n|     |");

    await chooseMarkdownTableAction("行を削除");
    await tick();
    expect(view.state.doc.toString()).toBe("| A   |\n| --- |\n| 1   |");

    await chooseMarkdownTableAction("表を削除");
    await tick();
    expect(view.state.doc.toString()).toBe("");
  });

  test("formats Markdown tables and moves cells with Tab", async () => {
    const initialTable = "| Name | 値 |\n| --- | --- |\n| A | 12 |";
    const view = await openMarkdownEditor({ saveMemo, content: initialTable });

    view.dispatch({ selection: { anchor: initialTable.indexOf("12") } });
    await fireEvent.keyDown(view.contentDOM, { key: "Tab" });
    await tick();

    expect(view.state.doc.toString()).toBe(
      "| Name | 値  |\n| ---- | --- |\n| A    | 12  |\n|      |     |"
    );

    const newRowCellPosition = view.state.doc.toString().lastIndexOf("|      |");
    expect(view.state.selection.main.from).toBeGreaterThan(newRowCellPosition);
  });

  test("suggests memo titles after a wiki-link opener", async () => {
    await renderMarkdownMemo({
      saveMemo,
      content: "",
      memoTitles: ["Daily Notes", "Research Log"],
    });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });

    const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
    view.focus();
    view.dispatch({
      changes: { from: 0, insert: "[[" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    startCompletion(view);

    await waitFor(() => {
      expect(document.querySelector(".cm-tooltip-autocomplete")).toHaveTextContent("Daily Notes");
      expect(document.querySelector(".cm-tooltip-autocomplete")).toHaveTextContent("Research Log");
    });
  });

  test("does not suggest the current memo title after a wiki-link opener", async () => {
    await renderMarkdownMemo({
      saveMemo,
      content: "",
      memoTitles: ["Daily Notes", "Research Log"],
      currentMemoTitle: "Daily Notes",
    });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });

    const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
    view.focus();
    view.dispatch({
      changes: { from: 0, insert: "[[" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    startCompletion(view);

    await waitFor(() => {
      const tooltip = document.querySelector(".cm-tooltip-autocomplete");
      expect(tooltip).toHaveTextContent("Research Log");
      expect(tooltip).not.toHaveTextContent("Daily Notes");
    });
  });

  test("edit mode shows read mode switch", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => {
      expect(document.querySelector(".read-mode-btn")).toBeInTheDocument();
    });
  });

  test("lets the markdown editor and preview split be resized with the keyboard", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => {
      expect(document.querySelector(".markdown-split-resizer")).toBeInTheDocument();
    });

    const editBody = document.querySelector(".edit-body");
    const resizer = document.querySelector(".markdown-split-resizer");

    expect(editBody.getAttribute("style")).toContain("--editor-pane-width: 55%");

    await fireEvent.keyDown(resizer, { key: "ArrowLeft" });
    expect(editBody.getAttribute("style")).toContain("--editor-pane-width: 50%");

    await fireEvent.keyDown(resizer, { key: "End" });
    expect(editBody.getAttribute("style")).toContain("--editor-pane-width: 72%");
  });

  test("clicking read mode switch returns to view mode", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => expect(document.querySelector(".read-mode-btn")).toBeInTheDocument());

    await fireEvent.click(document.querySelector(".read-mode-btn"));
    await tick();

    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(document.querySelector(".preview-mode")).toBeInTheDocument();
  });

  test("readOnly: clicking does not enter edit mode", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello", readOnly: true });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await tick();
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
  });

  test("saveMemo is not called in readOnly mode", async () => {
    vi.useFakeTimers();
    await renderMarkdownMemo({ saveMemo, content: "text", readOnly: true });
    vi.runAllTimers();
    expect(saveMemo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("switching back to read mode without changes does not call saveMemo", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => expect(document.querySelector(".read-mode-btn")).toBeInTheDocument());

    await fireEvent.click(document.querySelector(".read-mode-btn"));
    await tick();

    expect(saveMemo).not.toHaveBeenCalled();
  });

  test("pasting an image in workspace mode saves it and inserts markdown", async () => {
    window.electronAPI.wsSaveMemoImage.mockResolvedValue({
      success: true,
      path: "./assets/pasted-image.png",
    });
    const originalGetClientRects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = () => [];

    await renderMarkdownMemo({
      saveMemo,
      content: "",
      workspaceProjectDir: "C:\\project",
      taskId: "task-1",
    });

    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });

    const file = new File(["image-bytes"], "pasted-image.png", { type: "image/png" });
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        items: [
          {
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });

    document.querySelector(".cm-content").dispatchEvent(pasteEvent);

    await waitFor(() => {
      expect(window.electronAPI.wsSaveMemoImage).toHaveBeenCalledWith(
        "C:\\project",
        "task-1",
        expect.any(Uint8Array),
        "image/png"
      );
    });

    await waitFor(() => {
      expect(document.querySelector(".cm-content").textContent).toContain(
        "![pasted-image](./assets/pasted-image.png)"
      );
    });

    Range.prototype.getClientRects = originalGetClientRects;
  });
});

describe("Markdown Memo - link handling in preview", () => {
  let saveMemo;

  beforeEach(() => {
    quillInstances.length = 0;
    saveMemo = vi.fn();
    window.electronAPI = { openExternalLink: vi.fn(), wsResolveMemoAsset: vi.fn() };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("clicking a markdown link opens it externally and does not enter edit mode", async () => {
    await renderMarkdownMemo({ saveMemo, content: "[Visit](https://example.com)" });
    const link = document.querySelector(".preview a");
    expect(link).toBeInTheDocument();

    await fireEvent.click(link);
    await tick();

    expect(window.electronAPI.openExternalLink).toHaveBeenCalledWith(
      expect.stringContaining("example.com")
    );
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
  });

  test("clicking a wiki link opens the target memo and does not enter edit mode", async () => {
    const openMemoLink = vi.fn();
    await renderMarkdownMemo({
      saveMemo,
      content: "[[Research Notes]]",
      memoTitles: ["Research Notes"],
      openMemoLink,
    });

    const link = document.querySelector(".preview a[data-memo-link]");
    expect(link).toBeInTheDocument();

    await fireEvent.click(link);
    await tick();

    expect(openMemoLink).toHaveBeenCalledWith("Research Notes");
    expect(window.electronAPI.openExternalLink).not.toHaveBeenCalled();
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
  });

  test("clicking an external wiki link opens it externally", async () => {
    await renderMarkdownMemo({ saveMemo, content: "[[https://example.com|Example]]" });
    const link = document.querySelector(".preview a");
    expect(link).toBeInTheDocument();

    await fireEvent.click(link);
    await tick();

    expect(window.electronAPI.openExternalLink).toHaveBeenCalledWith("https://example.com/");
  });

  test("clicking non-link preview area stays in read mode", async () => {
    await renderMarkdownMemo({ saveMemo, content: "plain text" });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await tick();
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
  });
});
