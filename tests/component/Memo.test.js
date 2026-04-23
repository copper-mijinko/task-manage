import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

const quillInstances = [];

vi.mock("quill", () => {
  class MockQuill {
    constructor() {
      this.root = document.createElement("div");
      this.theme = { tooltip: { hide: vi.fn() } };
      this.on = vi.fn();
      this.enable = vi.fn();
      this.setContents = vi.fn();
      this.setText = vi.fn();
      this.getContents = vi.fn(() => ({ ops: [] }));
      this.getLength = vi.fn(() => 0);
      this.getSelection = vi.fn(() => null);
      this.hasFocus = vi.fn(() => false);
      this.setSelection = vi.fn();
      this.deleteText = vi.fn();
      this.insertText = vi.fn();
      quillInstances.push(this);
    }
  }
  return { default: MockQuill };
});

import Memo from "../../src/components/Memo.svelte";

describe("Memo - link click handling", () => {
  let saveMemo;

  beforeEach(() => {
    quillInstances.length = 0;
    saveMemo = vi.fn();
    window.electronAPI = {
      openExternalLink: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    delete window.electronAPI;
    document.querySelectorAll(".ql-preview").forEach((el) => el.remove());
  });

  function addPreviewLink(href) {
    const link = document.createElement("a");
    link.className = "ql-preview";
    link.setAttribute("href", href);
    document.body.appendChild(link);
    return link;
  }

  test("shows no error banner initially", () => {
    render(Memo, { props: { saveMemo, content: "" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("shows error banner when openExternalLink rejects", async () => {
    window.electronAPI.openExternalLink.mockRejectedValue(new Error("network error"));
    render(Memo, { props: { saveMemo, content: "" } });

    const link = addPreviewLink("https://example.com");
    await fireEvent.click(link);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("リンクを開けませんでした");
  });

  test("dismisses error banner when × button is clicked", async () => {
    window.electronAPI.openExternalLink.mockRejectedValue(new Error("failed"));
    render(Memo, { props: { saveMemo, content: "" } });

    addPreviewLink("https://example.com");
    await fireEvent.click(document.querySelector(".ql-preview"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    await fireEvent.click(screen.getByRole("button", { name: "×" }));
    await tick();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("shows no error banner when openExternalLink resolves", async () => {
    render(Memo, { props: { saveMemo, content: "" } });

    const link = addPreviewLink("https://example.com");
    await fireEvent.click(link);
    await waitFor(() => expect(window.electronAPI.openExternalLink).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("resets isHandlingLink after error, allowing subsequent clicks", async () => {
    window.electronAPI.openExternalLink.mockRejectedValue(new Error("failed"));
    render(Memo, { props: { saveMemo, content: "" } });

    const link = addPreviewLink("https://example.com");

    await fireEvent.click(link);
    await waitFor(() => expect(window.electronAPI.openExternalLink).toHaveBeenCalledTimes(1));

    // 2回目のクリックが処理される
    window.electronAPI.openExternalLink.mockResolvedValue(undefined);
    await fireEvent.click(link);
    await waitFor(() => expect(window.electronAPI.openExternalLink).toHaveBeenCalledTimes(2));
  });

  test("ignores duplicate clicks while a link is being handled", async () => {
    let resolveFn;
    window.electronAPI.openExternalLink.mockImplementation(
      () => new Promise((resolve) => (resolveFn = resolve))
    );
    render(Memo, { props: { saveMemo, content: "" } });

    const link = addPreviewLink("https://example.com");

    await fireEvent.click(link);
    await tick();

    // 1回目の処理中に2回目をクリック → 無視される
    await fireEvent.click(link);
    await tick();

    resolveFn();
    await tick();

    expect(window.electronAPI.openExternalLink).toHaveBeenCalledTimes(1);
  });

  test("does not open link when href is empty", async () => {
    render(Memo, { props: { saveMemo, content: "" } });

    const link = addPreviewLink("");
    await fireEvent.click(link);
    await tick();

    expect(window.electronAPI.openExternalLink).not.toHaveBeenCalled();
  });

  test("preserves leading newlines for plain-text paste", async () => {
    render(Memo, { props: { saveMemo, content: "" } });
    const quill = quillInstances.at(-1);
    expect(quill).toBeDefined();

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type) => (type === "text/plain" ? "\nhello" : ""),
        items: [],
      },
      configurable: true,
    });

    quill.root.dispatchEvent(pasteEvent);

    expect(quill.insertText).toHaveBeenCalledWith(0, "\nhello", "user");
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  test("does not intercept paste when clipboard has rich HTML content", async () => {
    render(Memo, { props: { saveMemo, content: "" } });
    const quill = quillInstances.at(-1);

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type) => (type === "text/plain" ? "\n" : "<p><img src='x'></p>"),
        items: [],
      },
      configurable: true,
    });

    quill.root.dispatchEvent(pasteEvent);

    expect(quill.insertText).not.toHaveBeenCalled();
    expect(pasteEvent.defaultPrevented).toBe(false);
  });

  test("does not intercept paste when clipboard has image file items", async () => {
    render(Memo, { props: { saveMemo, content: "" } });
    const quill = quillInstances.at(-1);

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type) => (type === "text/plain" ? "\n" : ""),
        items: [{ kind: "file", type: "image/png" }],
      },
      configurable: true,
    });

    quill.root.dispatchEvent(pasteEvent);

    expect(quill.insertText).not.toHaveBeenCalled();
    expect(pasteEvent.defaultPrevented).toBe(false);
  });

  test("does not intercept paste while readOnly", async () => {
    render(Memo, { props: { saveMemo, content: "", readOnly: true } });
    const quill = quillInstances.at(-1);

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type) => (type === "text/plain" ? "\nhello" : ""),
        items: [],
      },
      configurable: true,
    });

    quill.root.dispatchEvent(pasteEvent);

    expect(quill.insertText).not.toHaveBeenCalled();
    expect(pasteEvent.defaultPrevented).toBe(false);
  });
});
