import { get } from "svelte/store";
import { EditorView } from "@codemirror/view";
import Quill from "quill";
import { date_time_format, type DateFormat } from "@stores/preferences";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDate(now: Date, format: DateFormat): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  switch (format) {
    case "iso":
      return `${y}-${pad2(m)}-${pad2(d)}`;
    case "japanese":
      return `${y}年${m}月${d}日`;
    case "slash":
    default:
      return `${y}/${pad2(m)}/${pad2(d)}`;
  }
}

export function formatTime(now: Date, format: DateFormat): string {
  const h = now.getHours();
  const mi = now.getMinutes();
  if (format === "japanese") {
    return `${h}時${pad2(mi)}分`;
  }
  return `${pad2(h)}:${pad2(mi)}`;
}

function isoDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function isoTime(now: Date): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function isoDateTimeLocal(now: Date): string {
  return `${isoDate(now)}T${isoTime(now)}`;
}

// `<input type="date|time|...">` requires a fixed ISO-ish value format —
// the user-facing display is rendered by the browser/locale. So we ignore
// the configured text format here and use the spec-mandated value.
function setNativePickerValue(input: HTMLInputElement, now: Date, kind: "date" | "time"): boolean {
  const type = input.type;
  if (kind === "date") {
    if (type === "date") {
      input.value = isoDate(now);
    } else if (type === "datetime-local") {
      input.value = isoDateTimeLocal(now);
    } else if (type === "month") {
      input.value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    } else if (type === "week") {
      input.value = isoWeek(now);
    } else {
      return false;
    }
  } else {
    if (type === "time") {
      input.value = isoTime(now);
    } else if (type === "datetime-local") {
      input.value = isoDateTimeLocal(now);
    } else {
      return false;
    }
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

// ISO 8601 week number (YYYY-Www) for `<input type="week">`.
function isoWeek(d: Date): string {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${target.getUTCFullYear()}-W${pad2(week)}`;
}

function insertIntoTextInput(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  input.value = `${before}${text}${after}`;
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function insertIntoCodeMirror(target: Element, text: string): boolean {
  const editor = target.closest(".cm-editor");
  if (!(editor instanceof HTMLElement)) return false;
  const view = EditorView.findFromDOM(editor);
  if (!view) return false;
  const range = view.state.selection.main;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function insertIntoQuill(target: Element, text: string): boolean {
  const editor = target.closest(".ql-editor");
  if (!editor) return false;
  // Quill instances are bound to the container (the `.ql-container` parent),
  // not the `.ql-editor` itself. Walk up to find the registered node.
  let node: Element | null = editor;
  let quill: Quill | null = null;
  while (node) {
    const found = Quill.find(node);
    if (found instanceof Quill) {
      quill = found;
      break;
    }
    node = node.parentElement;
  }
  if (!quill) return false;
  const selection = quill.getSelection(true);
  const index = selection ? selection.index : quill.getLength();
  const length = selection ? selection.length : 0;
  if (length > 0) {
    quill.deleteText(index, length, "user");
  }
  quill.insertText(index, text, "user");
  quill.setSelection(index + text.length, 0, "user");
  return true;
}

function insertIntoContentEditable(target: Element, text: string): boolean {
  const host = (target as HTMLElement).closest('[contenteditable=""], [contenteditable="true"]');
  if (!(host instanceof HTMLElement)) return false;
  host.focus();
  // execCommand is deprecated but is the only portable way to insert into
  // an unknown contenteditable while preserving its own undo stack. We are
  // in Electron/Chromium so it remains supported.
  const ok = document.execCommand("insertText", false, text);
  if (ok) return true;
  // Fallback: raw Selection API (no undo integration, last resort).
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function handleDateTimeShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  // `event.key` already accounts for Shift on US layouts (Shift+; -> ":")
  // and is the raw character on JIS layouts (where ; and : are separate keys),
  // so checking the resolved character covers both.
  const isDate = event.key === ";";
  const isTime = event.key === ":";
  if (!isDate && !isTime) return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  const now = new Date();

  // Native date/time pickers: set the spec value directly, ignoring the
  // configured text format (which the browser does not accept).
  if (target instanceof HTMLInputElement) {
    if (setNativePickerValue(target, now, isDate ? "date" : "time")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }

  const format = get(date_time_format);
  const text = isDate ? formatDate(now, format) : formatTime(now, format);

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    insertIntoTextInput(target, text);
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (insertIntoCodeMirror(target, text)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (insertIntoQuill(target, text)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (insertIntoContentEditable(target, text)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
}

export function registerDateTimeShortcuts(): () => void {
  // Capture phase so we intercept before editor-specific bindings (CodeMirror,
  // Quill) consume the keystroke. Otherwise CodeMirror's default keymap would
  // type a literal ";" or ":" into the document.
  window.addEventListener("keydown", handleDateTimeShortcut, true);
  return () => {
    window.removeEventListener("keydown", handleDateTimeShortcut, true);
  };
}
