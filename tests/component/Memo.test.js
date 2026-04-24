import { render } from "@testing-library/svelte";
import { vi } from "vitest";

import Memo from "../../src/components/Memo.svelte";

describe("Memo (CodeMirror 6)", () => {
  let saveMemo;

  beforeEach(() => {
    saveMemo = vi.fn();
  });

  test("renders the CM6 editor container", () => {
    render(Memo, { props: { saveMemo, content: "" } });
    expect(document.querySelector(".cm-editor")).toBeInTheDocument();
  });

  test("displays initial string content in the editor", () => {
    render(Memo, { props: { saveMemo, content: "hello world" } });
    expect(document.querySelector(".cm-content")).toHaveTextContent("hello world");
  });

  test("handles empty content without error", () => {
    render(Memo, { props: { saveMemo, content: "" } });
    expect(document.querySelector(".cm-editor")).toBeInTheDocument();
  });

  test("converts legacy Quill Delta object to JSON string", () => {
    const delta = { ops: [{ insert: "hello" }] };
    render(Memo, { props: { saveMemo, content: delta } });
    expect(document.querySelector(".cm-content")).toHaveTextContent('"ops"');
  });

  test("converts null/undefined content to empty string", () => {
    render(Memo, { props: { saveMemo, content: null } });
    expect(document.querySelector(".cm-editor")).toBeInTheDocument();
    expect(document.querySelector(".cm-content").textContent.trim()).toBe("");
  });

  test("editable by default: contenteditable is true", () => {
    render(Memo, { props: { saveMemo, content: "" } });
    const content = document.querySelector(".cm-content");
    expect(content).toHaveAttribute("contenteditable", "true");
  });

  test("readOnly: contenteditable is false", () => {
    render(Memo, { props: { saveMemo, content: "read only text", readOnly: true } });
    const content = document.querySelector(".cm-content");
    expect(content).not.toHaveAttribute("contenteditable", "true");
  });

  test("readOnly: saveMemo is never called", async () => {
    vi.useFakeTimers();
    render(Memo, { props: { saveMemo, content: "text", readOnly: true } });
    vi.runAllTimers();
    expect(saveMemo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
