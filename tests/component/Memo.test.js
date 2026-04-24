import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { vi } from "vitest";

import Memo from "../../src/components/Memo.svelte";

describe("Memo - view mode (default)", () => {
  let saveMemo;

  beforeEach(() => {
    saveMemo = vi.fn();
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

  test("converts legacy Quill Delta object to JSON string for display", () => {
    const delta = { ops: [{ insert: "hello" }] };
    render(Memo, { props: { saveMemo, content: delta } });
    expect(document.querySelector(".preview")).toBeInTheDocument();
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
  });

  test("clicking preview enters edit mode and shows CM6 editor", async () => {
    render(Memo, { props: { saveMemo, content: "hello" } });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    });
  });

  test("edit mode shows 完了 button", async () => {
    render(Memo, { props: { saveMemo, content: "hello" } });
    await fireEvent.click(document.querySelector(".preview-mode"));
    await waitFor(() => {
      expect(document.querySelector(".done-btn")).toBeInTheDocument();
    });
  });

  test("clicking 完了 returns to view mode", async () => {
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
});
