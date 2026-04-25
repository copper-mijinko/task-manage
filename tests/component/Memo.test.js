import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

import Memo from "../../src/components/Memo.svelte";

describe("Memo - view mode (default)", () => {
  let saveMemo;

  beforeEach(() => {
    saveMemo = vi.fn();
    window.electronAPI = { wsResolveMemoAsset: vi.fn(), openExternalLink: vi.fn() };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("renders in view mode by default (no CM6 editor)", () => {
    render(Memo, { props: { saveMemo, content: "" } });
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(document.querySelector(".preview-mode")).toBeInTheDocument();
  });

  test("shows placeholder when content is empty", () => {
    render(Memo, { props: { saveMemo, content: "" } });
    expect(document.querySelector(".placeholder")).toBeInTheDocument();
  });

  test("renders markdown content as HTML in view mode", () => {
    render(Memo, { props: { saveMemo, content: "# Hello\n\nWorld" } });
    const preview = document.querySelector(".preview");
    expect(preview).toBeInTheDocument();
    expect(preview.querySelector("h1")).toHaveTextContent("Hello");
  });

  test("renders wiki links with resolved state when memo exists", () => {
    render(Memo, {
      props: {
        saveMemo,
        content: "[[Daily Notes]] and [[Missing Note]]",
        memoTitles: ["Daily Notes"],
      },
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

    render(Memo, {
      props: {
        saveMemo,
        content: "![Diagram](./assets/diagram.png)",
        workspaceProjectDir: "C:\\workspace\\project",
        taskId: "task-1",
      },
    });

    await waitFor(() => {
      const image = document.querySelector(".preview img");
      expect(image).toBeInTheDocument();
      expect(image.getAttribute("src")).toBe(
        "file:///C:/workspace/project/task-1/assets/diagram.png"
      );
    });
  });

  test("converts legacy Quill Delta object to plain text for display", () => {
    const delta = { ops: [{ insert: "hello" }] };
    render(Memo, { props: { saveMemo, content: delta } });
    expect(document.querySelector(".preview")).toBeInTheDocument();
    expect(document.querySelector(".preview").textContent).toContain("hello");
  });

  test("readOnly: no placeholder shown when empty", () => {
    render(Memo, { props: { saveMemo, content: "", readOnly: true } });
    expect(document.querySelector(".placeholder")).not.toBeInTheDocument();
  });
});

describe("Memo - edit mode", () => {
  let saveMemo;

  beforeEach(() => {
    saveMemo = vi.fn();
    window.electronAPI = { wsSaveMemoImage: vi.fn() };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("clicking preview enters edit mode and shows CM6 editor", async () => {
    render(Memo, { props: { saveMemo, content: "hello" } });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });
  });

  test("edit mode shows complete button", async () => {
    render(Memo, { props: { saveMemo, content: "hello" } });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await waitFor(() => {
      expect(document.querySelector(".done-btn")).toBeInTheDocument();
    });
  });

  test("clicking complete returns to view mode", async () => {
    render(Memo, { props: { saveMemo, content: "hello" } });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await waitFor(() => expect(document.querySelector(".done-btn")).toBeInTheDocument());

    await fireEvent.click(document.querySelector(".done-btn"));
    await tick();

    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
    expect(document.querySelector(".preview-mode")).toBeInTheDocument();
  });

  test("readOnly: clicking does not enter edit mode", async () => {
    render(Memo, { props: { saveMemo, content: "hello", readOnly: true } });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await tick();
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
  });

  test("saveMemo is not called in readOnly mode", async () => {
    vi.useFakeTimers();
    render(Memo, { props: { saveMemo, content: "text", readOnly: true } });
    vi.runAllTimers();
    expect(saveMemo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("clicking complete without changes does not call saveMemo", async () => {
    render(Memo, { props: { saveMemo, content: "hello" } });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await waitFor(() => expect(document.querySelector(".done-btn")).toBeInTheDocument());

    await fireEvent.click(document.querySelector(".done-btn"));
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

    render(Memo, {
      props: {
        saveMemo,
        content: "",
        workspaceProjectDir: "C:\\project",
        taskId: "task-1",
      },
    });

    await fireEvent.click(document.querySelector(".preview-mode"));
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

describe("Memo - link handling in preview", () => {
  let saveMemo;

  beforeEach(() => {
    saveMemo = vi.fn();
    window.electronAPI = { openExternalLink: vi.fn(), wsResolveMemoAsset: vi.fn() };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test("clicking a markdown link opens it externally and does not enter edit mode", async () => {
    render(Memo, { props: { saveMemo, content: "[Visit](https://example.com)" } });
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
    render(Memo, {
      props: {
        saveMemo,
        content: "[[Research Notes]]",
        memoTitles: ["Research Notes"],
        openMemoLink,
      },
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
    render(Memo, { props: { saveMemo, content: "[[https://example.com|Example]]" } });
    const link = document.querySelector(".preview a");
    expect(link).toBeInTheDocument();

    await fireEvent.click(link);
    await tick();

    expect(window.electronAPI.openExternalLink).toHaveBeenCalledWith("https://example.com/");
  });

  test("clicking non-link area enters edit mode", async () => {
    render(Memo, { props: { saveMemo, content: "plain text" } });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });
  });
});
