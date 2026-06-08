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
      this.off = vi.fn();
      this.enable = vi.fn();
      this.setContents = vi.fn((value) => {
        const ops = Array.isArray(value) ? value : (value?.ops ?? []);
        this.root.textContent = ops.map((op) => op.insert ?? "").join("");
      });
      this.setText = vi.fn((value) => {
        this.root.textContent = value;
      });
      this.getContents = vi.fn(() => ({ ops: [{ insert: "changed\n" }] }));
      this.getLength = vi.fn(() => 0);
      this._selection = null;
      this.getSelection = vi.fn(() => this._selection);
      this.hasFocus = vi.fn(() => false);
      this.focus = vi.fn();
      this.setSelection = vi.fn((index, length = 0) => {
        this._selection = { index, length };
      });
      this.deleteText = vi.fn((index, length) => {
        const current = this.root.textContent ?? "";
        this.root.textContent = `${current.slice(0, index)}${current.slice(index + length)}`;
      });
      this.insertText = vi.fn((index, text) => {
        const current = this.root.textContent ?? "";
        this.root.textContent = `${current.slice(0, index)}${text}${current.slice(index)}`;
      });
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
  MockQuill.events = {
    SCROLL_UPDATE: "scroll-update",
    SCROLL_OPTIMIZE: "scroll-optimize",
  };
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
  await chooseMarkdownMode("edit");
  await waitFor(() => {
    expect(document.querySelector(".cm-editor")).toBeInTheDocument();
  });
  return EditorView.findFromDOM(document.querySelector(".cm-editor"));
}

async function chooseMarkdownMode(mode) {
  const trigger = document.querySelector(".memo-mode-trigger");
  expect(trigger).toBeInTheDocument();
  await fireEvent.click(trigger);
  const option = document.querySelector(`.memo-mode-option[data-mode="${mode}"]`);
  expect(option).toBeInTheDocument();
  await fireEvent.click(option);
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

    // Regression: interacting with the dropdown blurs the editor, so
    // getSelection() is null. The action must refocus + restore a selection so
    // the table module (which no-ops on a null range) still runs.
    expect(quillInstances[0].getSelection()).toBeNull();
    await fireEvent.change(select, { target: { value: "delete-column" } });

    expect(quillInstances[0].focus).toHaveBeenCalled();
    expect(quillInstances[0].setSelection).toHaveBeenCalled();
    expect(quillInstances[0].tableModule.deleteColumn).toHaveBeenCalledTimes(1);
    expect(select.value).toBe("");
  });

  test("installs a visible-space layer without replacing Quill editor text", async () => {
    await renderMemo({
      saveMemo: vi.fn(),
      content: " leading　full",
      isWorkspaceProject: false,
    });

    expect(document.querySelector(".quill-visible-space-layer")).toBeInTheDocument();
    expect(quillInstances[0].root.textContent).toBe(" leading　full");
  });

  test("clears stale Quill visible-space markers while composing full-width text", async () => {
    await renderMemo({
      saveMemo: vi.fn(),
      content: "a 　b",
      isWorkspaceProject: false,
    });
    const quill = quillInstances[0];
    const layer = document.querySelector(".quill-visible-space-layer");

    expect(layer).toBeInTheDocument();
    layer.appendChild(document.createElement("span"));
    expect(layer.childElementCount).toBe(1);

    await fireEvent.compositionStart(quill.root);
    expect(layer.childElementCount).toBe(0);
  });

  test("observes Quill editor resizes for visible-space placement", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const observe = vi.fn();
    const disconnect = vi.fn();
    globalThis.ResizeObserver = vi.fn(function MockResizeObserver() {
      this.observe = observe;
      this.disconnect = disconnect;
    });

    try {
      const result = await renderMemo({
        saveMemo: vi.fn(),
        content: " leading　full",
        isWorkspaceProject: false,
      });
      const quill = quillInstances[0];

      expect(observe).toHaveBeenCalledWith(quill.root.parentElement);
      expect(observe).toHaveBeenCalledWith(quill.root);

      result.unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      if (originalResizeObserver) {
        globalThis.ResizeObserver = originalResizeObserver;
      } else {
        delete globalThis.ResizeObserver;
      }
    }
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
    const modeTrigger = document.querySelector(".memo-mode-trigger");
    expect(modeTrigger).toHaveAttribute("aria-label", "Memo mode: Preview");
    expect(modeTrigger.querySelector(".memo-mode-icon svg")).toBeInTheDocument();

    await fireEvent.click(modeTrigger);
    expect(
      [...document.querySelectorAll(".memo-mode-option-label")].map((node) => node.textContent)
    ).toEqual(["Preview", "Edit", "Split"]);
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

  test("markdown preview image relies on the static CSS cap, not a JS-set per-image variable", async () => {
    // Image sizing was previously driven by a JS path that measured each
    // image's naturalWidth and pushed it into a `--memo-preview-image-max-width`
    // inline custom property. That created a visible size mismatch between
    // Preview-only and Split modes (different containers, different
    // computed widths) and was replaced with a static `max-width: min(100%, 32rem)`
    // rule in CSS. This regression test fails fast if the per-image JS hook
    // is reintroduced.
    await renderMarkdownMemo({ saveMemo, content: "![Diagram](data:image/png;base64,AAAA)" });

    const image = document.querySelector(".preview img");
    expect(image).toBeInTheDocument();

    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 640 });
    await fireEvent.load(image);

    expect(image.style.getPropertyValue("--memo-preview-image-max-width")).toBe("");
  }, 30000);

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

  test("choosing edit mode shows only the CM6 editor", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await chooseMarkdownMode("edit");
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });
    expect(document.querySelector(".markdown-split-resizer")).not.toBeInTheDocument();
    expect(document.querySelector(".live-preview")).not.toBeInTheDocument();
  });

  test("installs a visible-space layer without replacing Markdown editor text", async () => {
    await openMarkdownEditor({ saveMemo, content: " leading　full" });

    expect(document.querySelector(".cm-visibleSpaceLayer")).toBeInTheDocument();
    expect(document.querySelector(".cm-content").textContent).toBe(" leading　full");
  });

  test("keeps the caret after a full-width space in the Markdown editor", async () => {
    const view = await openMarkdownEditor({ saveMemo, content: "" });

    view.dispatch({
      changes: { from: 0, insert: "　" },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });
    await tick();

    expect(view.state.doc.toString()).toBe("　");
    expect(view.state.selection.main.from).toBe(1);
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
    await chooseMarkdownMode("edit");
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
    await chooseMarkdownMode("edit");
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

  test("edit mode shows the same mode dropdown", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await chooseMarkdownMode("edit");
    await waitFor(() => {
      expect(document.querySelector(".memo-mode-trigger")).toHaveAttribute(
        "aria-label",
        "Memo mode: Edit"
      );
    });
  });

  test("choosing split mode shows editor and live preview", async () => {
    await renderMarkdownMemo({ saveMemo, content: "# hello" });
    await chooseMarkdownMode("split");
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
      expect(document.querySelector(".markdown-split-resizer")).toBeInTheDocument();
      expect(document.querySelector(".live-preview .preview h1")).toHaveTextContent("hello");
    });
  });

  test("lets the markdown editor and preview split be resized with the keyboard", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await chooseMarkdownMode("split");
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

  test("choosing preview mode returns to view mode", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await chooseMarkdownMode("edit");
    await waitFor(() =>
      expect(document.querySelector(".memo-mode-trigger")).toHaveAttribute(
        "aria-label",
        "Memo mode: Edit"
      )
    );

    await chooseMarkdownMode("preview");
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

  test("switching back to preview mode without changes does not call saveMemo", async () => {
    await renderMarkdownMemo({ saveMemo, content: "hello" });
    await chooseMarkdownMode("edit");
    await waitFor(() =>
      expect(document.querySelector(".memo-mode-trigger")).toHaveAttribute(
        "aria-label",
        "Memo mode: Edit"
      )
    );

    await chooseMarkdownMode("preview");
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

    await chooseMarkdownMode("edit");
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

  test("clicking non-link preview area stays in preview mode", async () => {
    await renderMarkdownMemo({ saveMemo, content: "plain text" });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await tick();
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
  });
});
