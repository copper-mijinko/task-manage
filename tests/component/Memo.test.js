import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

const quillInstances = [];

vi.mock("quill", () => {
  class MockQuill {
    constructor(element, options) {
      this.element = element;
      this.options = options;
      this.root = document.createElement("div");
      this.root.className = "ql-editor";
      this.theme = { tooltip: { hide: vi.fn() } };
      this.handlers = {};
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
      this.element?.appendChild(this.root);
      quillInstances.push(this);
    }
  }
  return { default: MockQuill };
});

import Memo from "../../src/components/Memo.svelte";

function renderMarkdownMemo(props = {}) {
  return render(Memo, {
    props: {
      saveMemo: vi.fn(),
      content: "",
      isWorkspaceProject: true,
      ...props,
    },
  });
}

describe("Memo mode routing", () => {
  beforeEach(() => {
    quillInstances.length = 0;
    window.electronAPI = { wsResolveMemoAsset: vi.fn(), openExternalLink: vi.fn() };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("uses Quill for db.json Projects even when a workspace path exists", () => {
    const saveMemo = vi.fn();
    render(Memo, {
      props: {
        saveMemo,
        content: { ops: [{ insert: "legacy\n" }] },
        workspaceProjectDir: "C:\\workspace\\project",
        taskId: "task-1",
        isWorkspaceProject: false,
      },
    });

    expect(quillInstances).toHaveLength(1);
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(quillInstances[0].setContents).toHaveBeenCalledWith({ ops: [{ insert: "legacy\n" }] });
  });

  test("uses Markdown editor for workspace projects", () => {
    renderMarkdownMemo({ content: "# Workspace" });

    expect(quillInstances).toHaveLength(0);
    expect(document.querySelector(".preview-mode")).toBeInTheDocument();
    expect(document.querySelector(".preview h1")).toHaveTextContent("Workspace");
  });

  test("db.json Projects save Quill Delta content", async () => {
    const saveMemo = vi.fn();
    render(Memo, { props: { saveMemo, content: "", isWorkspaceProject: false } });
    const quill = quillInstances.at(-1);

    quill.handlers["text-change"]({}, {}, "user");
    await tick();

    expect(saveMemo).toHaveBeenCalledWith({ ops: [{ insert: "changed\n" }] });
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

  test("renders in view mode by default (no CM6 editor)", () => {
    renderMarkdownMemo({ saveMemo, content: "" });
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(document.querySelector(".preview-mode")).toBeInTheDocument();
  });

  test("shows placeholder when content is empty", () => {
    renderMarkdownMemo({ saveMemo, content: "" });
    expect(document.querySelector(".placeholder")).toBeInTheDocument();
  });

  test("renders markdown content as HTML in view mode", () => {
    renderMarkdownMemo({ saveMemo, content: "# Hello\n\nWorld" });
    const preview = document.querySelector(".preview");
    expect(preview).toBeInTheDocument();
    expect(preview.querySelector("h1")).toHaveTextContent("Hello");
  });

  test("renders wiki links with resolved state when memo exists", () => {
    renderMarkdownMemo({
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

    renderMarkdownMemo({
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

  test("converts legacy Quill Delta object to readable markdown text in workspace view", () => {
    const delta = { ops: [{ insert: "hello" }, { insert: "\nworld" }] };
    renderMarkdownMemo({ saveMemo, content: delta });
    expect(document.querySelector(".preview")).toHaveTextContent("hello");
    expect(document.querySelector(".preview")).toHaveTextContent("world");
    expect(document.querySelector(".preview")).not.toHaveTextContent('"ops"');
  });

  test("readOnly: no placeholder shown when empty", () => {
    renderMarkdownMemo({ saveMemo, content: "", readOnly: true });
    expect(document.querySelector(".placeholder")).not.toBeInTheDocument();
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
    renderMarkdownMemo({ saveMemo, content: "hello" });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });
  });

  test("edit mode shows read mode switch", async () => {
    renderMarkdownMemo({ saveMemo, content: "hello" });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => {
      expect(document.querySelector(".read-mode-btn")).toBeInTheDocument();
    });
  });

  test("lets the markdown editor and preview split be resized with the keyboard", async () => {
    renderMarkdownMemo({ saveMemo, content: "hello" });
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
    renderMarkdownMemo({ saveMemo, content: "hello" });
    await fireEvent.click(document.querySelector(".edit-mode-btn"));
    await waitFor(() => expect(document.querySelector(".read-mode-btn")).toBeInTheDocument());

    await fireEvent.click(document.querySelector(".read-mode-btn"));
    await tick();

    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(document.querySelector(".preview-mode")).toBeInTheDocument();
  });

  test("readOnly: clicking does not enter edit mode", async () => {
    renderMarkdownMemo({ saveMemo, content: "hello", readOnly: true });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await tick();
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
  });

  test("saveMemo is not called in readOnly mode", async () => {
    vi.useFakeTimers();
    renderMarkdownMemo({ saveMemo, content: "text", readOnly: true });
    vi.runAllTimers();
    expect(saveMemo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("switching back to read mode without changes does not call saveMemo", async () => {
    renderMarkdownMemo({ saveMemo, content: "hello" });
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

    renderMarkdownMemo({
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
    renderMarkdownMemo({ saveMemo, content: "[Visit](https://example.com)" });
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
    renderMarkdownMemo({
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
    renderMarkdownMemo({ saveMemo, content: "[[https://example.com|Example]]" });
    const link = document.querySelector(".preview a");
    expect(link).toBeInTheDocument();

    await fireEvent.click(link);
    await tick();

    expect(window.electronAPI.openExternalLink).toHaveBeenCalledWith("https://example.com/");
  });

  test("clicking non-link preview area stays in read mode", async () => {
    renderMarkdownMemo({ saveMemo, content: "plain text" });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await tick();
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
  });
});
