<script lang="ts">
  import { tick, onDestroy } from "svelte";
  import {
    Direction,
    EditorView,
    keymap,
    layer,
    lineNumbers,
    type LayerMarker,
    type ViewUpdate,
  } from "@codemirror/view";
  import { EditorState, type Text } from "@codemirror/state";
  import {
    autocompletion,
    completionKeymap,
    type CompletionContext,
    type CompletionResult,
  } from "@codemirror/autocomplete";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { languages } from "@codemirror/language-data";
  import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
  import { marked } from "marked";
  import { markedHighlight } from "marked-highlight";
  import hljs from "highlight.js/lib/common";
  import mermaid from "mermaid";
  import quillIcons from "quill/ui/icons.js";
  import { toMarkdown } from "@features/memos/utils/memo_utils";
  import * as platform from "@lib/ipc/platform";
  import { theme } from "@stores/theme";
  import "@features/memos/styles/hljs-theme.css";

  marked.use(
    markedHighlight({
      langPrefix: "hljs language-",
      highlight(code, lang) {
        const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      },
    }),
    {
      gfm: true,
      breaks: false,
      tokenizer: {
        code() {
          return undefined;
        },
      },
      renderer: {
        checkbox({ checked }) {
          return `<input type="checkbox"${checked ? " checked" : ""}>`;
        },
      },
    }
  );

  export let saveMemo: (content: string) => void;
  export let content: unknown = "";
  export let readOnly = false;
  export let memoTitles: string[] = [];
  export let currentMemoTitle = "";
  export let openMemoLink: ((title: string) => void) | undefined = undefined;
  export let workspaceProjectDir: string | null = null;
  export let taskId: string | null = null;

  let container: HTMLElement;
  let view: EditorView | null = null;
  let saveTimer: ReturnType<typeof setTimeout>;
  let savedTimer: ReturnType<typeof setTimeout>;
  let isEditing = false;
  let markdownMode: MarkdownMemoMode = "preview";
  let hasChanges = false;
  let saveState: "clean" | "dirty" | "saved" = "clean";
  let currentContent = toMarkdown(content);
  let renderedHtml = "";
  let renderSequence = 0;
  let previewEl: HTMLElement | null = null;
  let livePreviewEl: HTMLElement | null = null;
  let editBody: HTMLElement | null = null;
  let modeDropdownEl: HTMLElement | null = null;
  let markdownSplitPercent = 55;
  let currentHeadingLevel = "normal";
  let tableActionValue = "";
  let modeMenuOpen = false;

  const SPLIT_MIN_PERCENT = 30;
  const SPLIT_MAX_PERCENT = 72;
  const SPLIT_KEY_STEP = 5;

  const EXTERNAL_LINK_PATTERN = /^(https?:\/\/|mailto:|file:\/\/)/i;
  // Quill 標準の `code` と `code-block` は同じ SVG (`<>`) で視覚的に区別できないため、
  // インラインは Quill 提供の `<>`、ブロックはフレーム付きの独自 SVG に差し替える。
  // ストローク/フィルのクラス指定は他の Quill アイコンに合わせる。
  const codeBlockIconSvg =
    '<svg viewbox="0 0 18 18">' +
    '<rect class="ql-stroke" x="2.5" y="3.5" width="13" height="11" rx="1.5" ry="1.5" fill="none"/>' +
    '<polyline class="ql-even ql-stroke" points="7 8 5.5 9.5 7 11"/>' +
    '<polyline class="ql-even ql-stroke" points="11 8 12.5 9.5 11 11"/>' +
    "</svg>";
  const toolbarIcons = {
    bold: quillIcons.bold,
    italic: quillIcons.italic,
    inlineCode: quillIcons.code,
    link: quillIcons.link,
    bulletList: quillIcons.list.bullet,
    quote: quillIcons.blockquote,
    codeBlock: codeBlockIconSvg,
  };
  const tableActionOptions = [
    { value: "insert", label: "表を挿入" },
    { value: "row-above", label: "行を上に追加" },
    { value: "row-below", label: "行を下に追加" },
    { value: "column-left", label: "列を左に追加" },
    { value: "column-right", label: "列を右に追加" },
    { value: "delete-row", label: "行を削除" },
    { value: "delete-column", label: "列を削除" },
    { value: "delete-table", label: "表を削除" },
  ] as const;
  type TableAction = (typeof tableActionOptions)[number]["value"];
  type MarkdownMemoMode = "preview" | "edit" | "split";
  type EditableMarkdownMemoMode = Exclude<MarkdownMemoMode, "preview">;
  const memoModeOptions = [
    { value: "preview", label: "Preview" },
    { value: "edit", label: "Edit" },
    { value: "split", label: "Split" },
  ] satisfies Array<{
    value: MarkdownMemoMode;
    label: string;
  }>;
  const memoModeIconSvg: Record<MarkdownMemoMode, string> = {
    preview:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20Z"/><path d="M13.5 6 18 10.5"/></svg>',
    split:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M12 5v14"/></svg>',
  };
  const chevronDownIconSvg =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';

  function memoLinkCompletion(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const match = /\[\[([^\]\n|]*)$/.exec(textBefore);
    if (!match) return null;

    const query = normalizeMemoTitle(match[1]);
    const normalizedCurrentTitle = normalizeMemoTitle(currentMemoTitle);
    const options = memoTitles
      .map((title) => {
        const label = String(title || "").trim();
        return { label, normalized: normalizeMemoTitle(label) };
      })
      .filter(({ label, normalized }) => {
        if (!label || normalized === normalizedCurrentTitle) return false;
        return !query || normalized.includes(query);
      })
      .map((title) => ({
        label: title.label,
        type: "text",
        apply: title.label,
        detail: "memo",
      }));

    if (options.length === 0 && !context.explicit) return null;

    return {
      from: context.pos - match[1].length,
      options,
      validFor: /^[^\]\n|]*$/,
    };
  }

  function normalizeMemoTitle(title: string): string {
    return title.trim().toLocaleLowerCase();
  }

  function isExternalLink(target: string): boolean {
    return EXTERNAL_LINK_PATTERN.test(target.trim());
  }

  function escapeHtml(value: string): string {
    return value
      .split("&")
      .join("&amp;")
      .split("<")
      .join("&lt;")
      .split(">")
      .join("&gt;")
      .split('"')
      .join("&quot;")
      .split("'")
      .join("&#39;");
  }

  function preprocessWikiLinks(markdownText: string): string {
    const knownTitles = new Set(memoTitles.map((title) => normalizeMemoTitle(String(title || ""))));

    return markdownText.replace(/\[\[([^\]]+)\]\]/g, (fullMatch, rawTarget) => {
      const [targetPart, aliasPart] = String(rawTarget).split("|");
      const target = String(targetPart || "").trim();
      const alias = String(aliasPart || "").trim() || target;

      if (!target) return fullMatch;

      if (isExternalLink(target)) {
        return `<a href="${escapeHtml(target)}" class="wiki-link is-external">${escapeHtml(alias)}</a>`;
      }

      const resolvedClass = knownTitles.has(normalizeMemoTitle(target))
        ? "is-resolved"
        : "is-unresolved";

      return `<a href="#" class="wiki-link ${resolvedClass}" data-memo-link="${escapeHtml(target)}">${escapeHtml(alias)}</a>`;
    });
  }

  function flushSave(nextContent: string) {
    clearTimeout(saveTimer);
    currentContent = nextContent;
    saveMemo(currentContent);
    hasChanges = false;
    saveState = "saved";
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      if (!hasChanges) {
        saveState = "clean";
      }
    }, 1600);
  }

  function canSavePastedImages(): boolean {
    return Boolean(
      (workspaceProjectDir && taskId && platform.isPlatformAvailable()) || !workspaceProjectDir
    );
  }

  function readFileAsDataUrl(file: File): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  async function persistPastedImage(file: File): Promise<string | null> {
    if (!workspaceProjectDir || !taskId) {
      return readFileAsDataUrl(file);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await platform.wsSaveMemoImage(
      workspaceProjectDir,
      taskId,
      bytes,
      file.type || "image/png"
    );

    return result.success ? (result.path ?? null) : null;
  }

  function buildImageMarkdown(relativePath: string, label = ""): string {
    const alt = label.replace(/\.[^.]+$/, "").trim();
    return alt ? `![${alt}](${relativePath})` : `![](${relativePath})`;
  }

  function imageToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read image file"));
      reader.readAsDataURL(file);
    });
  }

  function insertTextAtSelection(editorView: EditorView, text: string) {
    const range = editorView.state.selection.main;
    editorView.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: text,
      },
      selection: {
        anchor: range.from + text.length,
      },
      scrollIntoView: true,
    });
  }

  function wrapInline(marker: string, markerEnd = marker) {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.doc.sliceString(from, to);
    if (selected) {
      view.dispatch({
        changes: { from, to, insert: `${marker}${selected}${markerEnd}` },
        selection: { anchor: from + marker.length, head: to + marker.length },
      });
    } else {
      view.dispatch({
        changes: { from, insert: `${marker}${markerEnd}` },
        selection: { anchor: from + marker.length },
      });
    }
    view.focus();
  }

  function formatBold() {
    wrapInline("**");
  }
  function formatItalic() {
    wrapInline("*");
  }
  function formatInlineCode() {
    wrapInline("`");
  }

  function getHeadingLevelFromState(state: EditorState): string {
    const { from } = state.selection.main;
    const line = state.doc.lineAt(from);
    const headingMatch = line.text.match(/^(#{1,6}) /);
    const level = headingMatch?.[1]?.length ?? 0;
    return level >= 1 && level <= 2 ? String(level) : "normal";
  }

  function syncHeadingLevel(editorView: EditorView | null = view) {
    currentHeadingLevel = editorView ? getHeadingLevelFromState(editorView.state) : "normal";
  }

  function formatHeading(level: 0 | 1 | 2) {
    if (!view) return;
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const newPrefix = level > 0 ? "#".repeat(level) + " " : "";
    const headingMatch = line.text.match(/^(#{1,6}) /);
    if (headingMatch && (!newPrefix || headingMatch[0] === newPrefix)) {
      view.dispatch({
        changes: { from: line.from, to: line.from + headingMatch[0].length, insert: "" },
        selection: { anchor: Math.max(line.from, from - headingMatch[0].length) },
      });
    } else if (headingMatch) {
      const oldLen = headingMatch[0].length;
      view.dispatch({
        changes: { from: line.from, to: line.from + oldLen, insert: newPrefix },
        selection: { anchor: from - oldLen + newPrefix.length },
      });
    } else {
      view.dispatch({
        changes: { from: line.from, insert: newPrefix },
        selection: { anchor: from + newPrefix.length },
      });
    }
    syncHeadingLevel();
    view.focus();
  }

  function handleHeadingChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    const level = value === "normal" ? 0 : Number(value);
    formatHeading(level === 1 || level === 2 ? level : 0);
  }

  function toggleLinePrefix(prefix: string) {
    if (!view) return;
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    if (line.text.startsWith(prefix)) {
      view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: "" },
        selection: { anchor: Math.max(line.from, from - prefix.length) },
      });
    } else {
      view.dispatch({
        changes: { from: line.from, insert: prefix },
        selection: { anchor: from + prefix.length },
      });
    }
    view.focus();
  }

  function formatBulletList() {
    toggleLinePrefix("- ");
  }

  function formatQuote() {
    toggleLinePrefix("> ");
  }

  function formatLink() {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.doc.sliceString(from, to);
    if (selected) {
      const insert = `[${selected}](url)`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + selected.length + 3, head: from + insert.length - 1 },
      });
    } else {
      view.dispatch({
        changes: { from, insert: "[](url)" },
        selection: { anchor: from + 1 },
      });
    }
    view.focus();
  }

  function formatCodeBlock() {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc;
    const selected = doc.sliceString(from, to);
    const needsNewline = from > doc.lineAt(from).from;
    const pre = needsNewline ? "\n" : "";
    if (selected) {
      const insert = `${pre}\`\`\`\n${selected}\n\`\`\`\n`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + pre.length + 4, head: from + pre.length + 4 + selected.length },
      });
    } else {
      view.dispatch({
        changes: { from, insert: `${pre}\`\`\`\n\n\`\`\`\n` },
        selection: { anchor: from + pre.length + 4 },
      });
    }
    view.focus();
  }

  type TableAlignment = "left" | "center" | "right" | undefined;

  type MarkdownTable = {
    startLineNumber: number;
    endLineNumber: number;
    startPos: number;
    endPos: number;
    rows: string[][];
    aligns: TableAlignment[];
    columnCount: number;
    currentSourceLineIndex: number;
    currentColumnIndex: number;
  };

  function isEscaped(value: string, index: number): boolean {
    let backslashCount = 0;
    for (let i = index - 1; i >= 0 && value[i] === "\\"; i -= 1) {
      backslashCount += 1;
    }
    return backslashCount % 2 === 1;
  }

  function splitMarkdownTableCells(row: string): string[] {
    let text = row.trim();
    if (text.startsWith("|")) {
      text = text.slice(1);
    }
    if (text.endsWith("|") && !isEscaped(text, text.length - 1)) {
      text = text.slice(0, -1);
    }

    const cells: string[] = [];
    let current = "";
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === "\\" && text[i + 1] === "|") {
        current += "|";
        i += 1;
        continue;
      }
      if (char === "|" && !isEscaped(text, i)) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  }

  function isPotentialTableLine(line: string): boolean {
    return /^\s*\|/.test(line) && splitMarkdownTableCells(line).length >= 1;
  }

  function normalizeDividerCell(cell: string): TableAlignment | null {
    const value = cell.trim();
    if (!/^:?-{3,}:?$/.test(value)) return null;
    const left = value.startsWith(":");
    const right = value.endsWith(":");
    if (left && right) return "center";
    if (left) return "left";
    if (right) return "right";
    return undefined;
  }

  function isDividerRow(line: string): boolean {
    const cells = splitMarkdownTableCells(line);
    return cells.length >= 1 && cells.every((cell) => normalizeDividerCell(cell) !== null);
  }

  function columnIndexAtOffset(line: string, offset: number, columnCount: number): number {
    let pipeCount = 0;
    for (let i = 0; i < Math.min(offset, line.length); i += 1) {
      if (line[i] === "|" && !isEscaped(line, i)) {
        pipeCount += 1;
      }
    }

    const hasLeadingPipe = /^\s*\|/.test(line);
    const rawIndex = hasLeadingPipe ? pipeCount - 1 : pipeCount;
    return Math.max(0, Math.min(columnCount - 1, rawIndex));
  }

  function findMarkdownTableAt(doc: Text, pos: number): MarkdownTable | null {
    const currentLine = doc.lineAt(pos);
    if (!isPotentialTableLine(currentLine.text)) return null;

    let blockStart = currentLine.number;
    while (blockStart > 1 && isPotentialTableLine(doc.line(blockStart - 1).text)) {
      blockStart -= 1;
    }

    let blockEnd = currentLine.number;
    while (blockEnd < doc.lines && isPotentialTableLine(doc.line(blockEnd + 1).text)) {
      blockEnd += 1;
    }

    const blockLines = [];
    for (let lineNumber = blockStart; lineNumber <= blockEnd; lineNumber += 1) {
      blockLines.push(doc.line(lineNumber));
    }

    const dividerIndex = blockLines.findIndex((line) => isDividerRow(line.text));
    if (dividerIndex <= 0) return null;

    const headerIndex = dividerIndex - 1;
    const tableLines = blockLines.slice(headerIndex);
    const startLine = tableLines[0];
    const endLine = tableLines[tableLines.length - 1];
    if (currentLine.number < startLine.number || currentLine.number > endLine.number) {
      return null;
    }

    const headerCells = splitMarkdownTableCells(tableLines[0].text);
    const dividerCells = splitMarkdownTableCells(tableLines[1].text);
    const bodyRows = tableLines.slice(2).map((line) => splitMarkdownTableCells(line.text));
    const rows = [headerCells, ...bodyRows];
    const columnCount = Math.max(1, dividerCells.length, ...rows.map((row) => row.length));
    const aligns = Array.from({ length: columnCount }, (_, index) => {
      const align = normalizeDividerCell(dividerCells[index] ?? "---");
      return align === null ? undefined : align;
    });

    return {
      startLineNumber: startLine.number,
      endLineNumber: endLine.number,
      startPos: startLine.from,
      endPos: endLine.to,
      rows,
      aligns,
      columnCount,
      currentSourceLineIndex: currentLine.number - startLine.number,
      currentColumnIndex: columnIndexAtOffset(
        currentLine.text,
        pos - currentLine.from,
        columnCount
      ),
    };
  }

  function escapeMarkdownTableCell(value: string): string {
    return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
  }

  function characterDisplayWidth(value: string): number {
    const code = value.codePointAt(0) ?? 0;
    if (
      (code >= 0x0300 && code <= 0x036f) ||
      (code >= 0x1ab0 && code <= 0x1aff) ||
      (code >= 0x1dc0 && code <= 0x1dff) ||
      (code >= 0x20d0 && code <= 0x20ff) ||
      (code >= 0xfe20 && code <= 0xfe2f)
    ) {
      return 0;
    }
    if (
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1f64f) ||
        (code >= 0x1f900 && code <= 0x1f9ff) ||
        (code >= 0x20000 && code <= 0x3fffd))
    ) {
      return 2;
    }
    return 1;
  }

  function displayWidth(value: string): number {
    return Array.from(value).reduce((width, char) => width + characterDisplayWidth(char), 0);
  }

  function padDisplayEnd(value: string, width: number): string {
    return value + " ".repeat(Math.max(0, width - displayWidth(value)));
  }

  function padDisplayStart(value: string, width: number): string {
    return " ".repeat(Math.max(0, width - displayWidth(value))) + value;
  }

  function padDisplayCenter(value: string, width: number): string {
    const space = Math.max(0, width - displayWidth(value));
    const left = Math.floor(space / 2);
    return " ".repeat(left) + value + " ".repeat(space - left);
  }

  function padMarkdownTableCell(value: string, width: number, align: TableAlignment): string {
    switch (align) {
      case "right":
        return padDisplayStart(value, width);
      case "center":
        return padDisplayCenter(value, width);
      default:
        return padDisplayEnd(value, width);
    }
  }

  function minimumDividerWidth(align: TableAlignment): number {
    if (align === "center") return 5;
    if (align === "left" || align === "right") return 4;
    return 3;
  }

  function renderDividerCell(align: TableAlignment, width: number): string {
    const targetWidth = Math.max(width, minimumDividerWidth(align));
    switch (align) {
      case "left":
        return ":" + "-".repeat(targetWidth - 1);
      case "center":
        return ":" + "-".repeat(targetWidth - 2) + ":";
      case "right":
        return "-".repeat(targetWidth - 1) + ":";
      default:
        return "-".repeat(targetWidth);
    }
  }

  function normalizeTableRow(row: string[], columnCount: number): string[] {
    return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
  }

  function renderMarkdownTable(rows: string[][], aligns: TableAlignment[]): string {
    const columnCount = Math.max(1, aligns.length, ...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => normalizeTableRow(row, columnCount));
    const normalizedAligns = Array.from({ length: columnCount }, (_, index) => aligns[index]);
    const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
      Math.max(
        minimumDividerWidth(normalizedAligns[columnIndex]),
        ...normalizedRows.map((row) => displayWidth(escapeMarkdownTableCell(row[columnIndex])))
      )
    );
    const header = normalizedRows[0] ?? Array.from({ length: columnCount }, () => "");
    const body = normalizedRows.slice(1);
    const renderDataRow = (row: string[]) =>
      `| ${row
        .map((cell, index) =>
          padMarkdownTableCell(
            escapeMarkdownTableCell(cell),
            columnWidths[index],
            normalizedAligns[index]
          )
        )
        .join(" | ")} |`;

    return [
      renderDataRow(header),
      `| ${normalizedAligns
        .map((align, index) => renderDividerCell(align, columnWidths[index]))
        .join(" | ")} |`,
      ...body.map(renderDataRow),
    ].join("\n");
  }

  function sourceLineIndexToRowIndex(sourceLineIndex: number): number {
    return sourceLineIndex <= 1 ? 0 : sourceLineIndex - 1;
  }

  function rowIndexToSourceLineIndex(rowIndex: number): number {
    return rowIndex === 0 ? 0 : rowIndex + 1;
  }

  function renderedCellAnchor(markdownTable: string, sourceLineIndex: number, columnIndex: number) {
    const lines = markdownTable.split("\n");
    const targetLineIndex = Math.max(0, Math.min(sourceLineIndex, lines.length - 1));
    const targetLine = lines[targetLineIndex] ?? "";
    let offset = 0;
    for (let i = 0; i < targetLineIndex; i += 1) {
      offset += lines[i].length + 1;
    }

    let column = -1;
    for (let i = 0; i < targetLine.length; i += 1) {
      if (targetLine[i] === "|" && !isEscaped(targetLine, i)) {
        column += 1;
        if (column === columnIndex) {
          return offset + Math.min(targetLine.length, i + 2);
        }
      }
    }
    return offset + targetLine.length;
  }

  function replaceMarkdownTable(
    table: MarkdownTable,
    rows: string[][],
    aligns: TableAlignment[],
    sourceLineIndex: number,
    columnIndex: number,
    editorView: EditorView | null = view
  ): boolean {
    if (!editorView) return false;
    const nextTable = renderMarkdownTable(rows, aligns);
    const anchor = table.startPos + renderedCellAnchor(nextTable, sourceLineIndex, columnIndex);
    editorView.dispatch({
      changes: { from: table.startPos, to: table.endPos, insert: nextTable },
      selection: { anchor },
      scrollIntoView: true,
    });
    editorView.focus();
    return true;
  }

  function formatTableAndMoveCell(editorView: EditorView, direction: 1 | -1): boolean {
    const table = findMarkdownTableAt(editorView.state.doc, editorView.state.selection.main.from);
    if (!table) return false;

    const rows = table.rows.map((row) => normalizeTableRow(row, table.columnCount));
    let rowIndex = sourceLineIndexToRowIndex(table.currentSourceLineIndex);
    let columnIndex = table.currentColumnIndex + direction;

    if (direction > 0 && columnIndex >= table.columnCount) {
      columnIndex = 0;
      rowIndex += 1;
    } else if (direction < 0 && columnIndex < 0) {
      rowIndex -= 1;
      columnIndex = table.columnCount - 1;
    }

    if (rowIndex >= rows.length) {
      rows.push(Array.from({ length: table.columnCount }, () => ""));
    }

    if (rowIndex < 0) {
      rowIndex = 0;
      columnIndex = 0;
    }

    return replaceMarkdownTable(
      table,
      rows,
      table.aligns,
      rowIndexToSourceLineIndex(rowIndex),
      columnIndex,
      editorView
    );
  }

  function formatInsertTable() {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const docText = view.state.doc.toString();
    const selected = docText.slice(from, to).replace(/\s+/g, " ").trim();
    const rows = [
      [selected || "Column 1", "Column 2"],
      ["", ""],
    ];
    const tableMarkdown = renderMarkdownTable(rows, [undefined, undefined]);
    const prefix = from > 0 && !docText.slice(0, from).endsWith("\n") ? "\n\n" : "";
    const suffix = to < docText.length && !docText.slice(to).startsWith("\n") ? "\n\n" : "";
    const insert = `${prefix}${tableMarkdown}${suffix}`;

    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + prefix.length + renderedCellAnchor(tableMarkdown, 0, 0) },
      scrollIntoView: true,
    });
    view.focus();
  }

  function formatInsertTableRow(position: "above" | "below") {
    if (!view) return;
    const table = findMarkdownTableAt(view.state.doc, view.state.selection.main.from);
    if (!table) return;

    const rows = table.rows.map((row) => normalizeTableRow(row, table.columnCount));
    const emptyRow = Array.from({ length: table.columnCount }, () => "");
    const currentRowIndex = sourceLineIndexToRowIndex(table.currentSourceLineIndex);
    let insertIndex =
      position === "above" ? currentRowIndex : Math.min(rows.length, currentRowIndex + 1);
    if (currentRowIndex === 0) {
      insertIndex = 1;
    }

    rows.splice(insertIndex, 0, emptyRow);
    replaceMarkdownTable(
      table,
      rows,
      table.aligns,
      rowIndexToSourceLineIndex(insertIndex),
      table.currentColumnIndex
    );
  }

  function formatInsertTableColumn(side: "left" | "right") {
    if (!view) return;
    const table = findMarkdownTableAt(view.state.doc, view.state.selection.main.from);
    if (!table) return;

    const insertIndex = side === "left" ? table.currentColumnIndex : table.currentColumnIndex + 1;
    const rows = table.rows.map((row) => {
      const nextRow = normalizeTableRow(row, table.columnCount);
      nextRow.splice(insertIndex, 0, "");
      return nextRow;
    });
    const aligns = [...table.aligns];
    aligns.splice(insertIndex, 0, undefined);
    const sourceLineIndex = table.currentSourceLineIndex === 1 ? 0 : table.currentSourceLineIndex;

    replaceMarkdownTable(table, rows, aligns, sourceLineIndex, insertIndex);
  }

  function formatDeleteTableRow() {
    if (!view) return;
    const table = findMarkdownTableAt(view.state.doc, view.state.selection.main.from);
    if (!table) return;

    const rows = table.rows.map((row) => normalizeTableRow(row, table.columnCount));
    const rowIndex = sourceLineIndexToRowIndex(table.currentSourceLineIndex);
    if (rows.length <= 1) {
      formatDeleteTable();
      return;
    }

    rows.splice(rowIndex, 1);
    const nextRowIndex = Math.max(0, Math.min(rowIndex, rows.length - 1));
    replaceMarkdownTable(
      table,
      rows,
      table.aligns,
      rowIndexToSourceLineIndex(nextRowIndex),
      table.currentColumnIndex
    );
  }

  function formatDeleteTableColumn() {
    if (!view) return;
    const table = findMarkdownTableAt(view.state.doc, view.state.selection.main.from);
    if (!table) return;

    if (table.columnCount <= 1) {
      formatDeleteTable();
      return;
    }

    const rows = table.rows.map((row) => {
      const nextRow = normalizeTableRow(row, table.columnCount);
      nextRow.splice(table.currentColumnIndex, 1);
      return nextRow;
    });
    const aligns = [...table.aligns];
    aligns.splice(table.currentColumnIndex, 1);
    const nextColumnIndex = Math.max(0, Math.min(table.currentColumnIndex, table.columnCount - 2));
    const sourceLineIndex = table.currentSourceLineIndex === 1 ? 0 : table.currentSourceLineIndex;

    replaceMarkdownTable(table, rows, aligns, sourceLineIndex, nextColumnIndex);
  }

  function formatDeleteTable() {
    if (!view) return;
    const table = findMarkdownTableAt(view.state.doc, view.state.selection.main.from);
    if (!table) return;

    const doc = view.state.doc;
    let from = table.startPos;
    let to = table.endPos;
    if (table.endLineNumber < doc.lines) {
      to = doc.line(table.endLineNumber + 1).from;
    } else if (table.startLineNumber > 1) {
      from = doc.line(table.startLineNumber - 1).to;
    }

    view.dispatch({
      changes: { from, to, insert: "" },
      selection: { anchor: from },
      scrollIntoView: true,
    });
    view.focus();
  }

  function runTableAction(action: TableAction) {
    switch (action) {
      case "insert":
        formatInsertTable();
        return;
      case "row-above":
        formatInsertTableRow("above");
        return;
      case "row-below":
        formatInsertTableRow("below");
        return;
      case "column-left":
        formatInsertTableColumn("left");
        return;
      case "column-right":
        formatInsertTableColumn("right");
        return;
      case "delete-row":
        formatDeleteTableRow();
        return;
      case "delete-column":
        formatDeleteTableColumn();
        return;
      case "delete-table":
        formatDeleteTable();
        return;
      default:
    }
  }

  function handleTableActionChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as TableAction | "";
    if (!value) return;
    runTableAction(value);
    tableActionValue = "";
  }

  async function resolveImageSources(html: string): Promise<string> {
    if (!workspaceProjectDir || !taskId || !platform.isPlatformAvailable()) {
      return html;
    }

    const template = document.createElement("template");
    template.innerHTML = html;
    const images = Array.from(template.content.querySelectorAll("img[src]"));

    await Promise.all(
      images.map(async (image) => {
        const src = image.getAttribute("src");
        if (!src || isExternalLink(src) || src.startsWith("data:")) {
          return;
        }

        const result = await platform.wsResolveMemoAsset(workspaceProjectDir, taskId, src);

        if (result.success && result.url) {
          image.setAttribute("src", result.url);
        } else {
          image.setAttribute("data-missing-image", "true");
        }
      })
    );

    return template.innerHTML;
  }

  function injectCopyButtons(root: HTMLElement | null) {
    if (!root) return;
    root.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      if (!code) return;

      // marked-highlight が付与する "language-<lang>" クラスから言語ラベルを抽出し、
      // pre[data-lang] として保持。CSS の擬似要素で右上にバッジ表示する。
      const langClass = Array.from(code.classList).find((c) => c.startsWith("language-"));
      const lang = langClass ? langClass.slice("language-".length) : "";

      // mermaid は別途 SVG レンダリングするので、言語バッジも Copy ボタンも不要。
      // (この pre は renderMermaidBlocks で別要素に置換される)
      if (lang === "mermaid") return;

      if (lang && lang !== "plaintext") {
        pre.setAttribute("data-lang", lang);
      }

      if (pre.querySelector(".copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const text = code.innerText ?? code.textContent ?? "";
        void navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 1800);
        });
      });
      pre.appendChild(btn);
    });
  }

  // mermaid の初期化はテーマに依存する。最初の renderMermaidBlocks 呼び出し
  // および theme 変更時に setupMermaidTheme で再初期化する。
  let mermaidThemeApplied: "dark" | "default" | null = null;
  let mermaidIdCounter = 0;

  function setupMermaidTheme(themeName: "dark" | "light" | undefined) {
    const next: "dark" | "default" = themeName === "dark" ? "dark" : "default";
    if (next === mermaidThemeApplied) return false;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: next,
      fontFamily: "inherit",
    });
    mermaidThemeApplied = next;
    return true;
  }

  async function renderMermaidBlocks(root: HTMLElement | null) {
    if (!root) return;
    const codeBlocks = Array.from(
      root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")
    );
    if (codeBlocks.length === 0) return;

    setupMermaidTheme($theme);

    for (const code of codeBlocks) {
      const pre = code.parentElement;
      if (!pre) continue;
      const source = (code.textContent ?? "").trim();
      const container = document.createElement("div");
      container.className = "mermaid-block";
      const id = `mermaid-${++mermaidIdCounter}`;
      try {
        const { svg, bindFunctions } = await mermaid.render(id, source);
        container.innerHTML = svg;
        bindFunctions?.(container);
      } catch (error) {
        container.classList.add("mermaid-error");
        const msg = error instanceof Error ? error.message : String(error);
        container.textContent = `Mermaid: ${msg}`;
      }
      pre.replaceWith(container);
    }
  }

  async function updateRenderedHtml(markdownText: string) {
    const sequence = ++renderSequence;
    const baseHtml = marked.parse(preprocessWikiLinks(markdownText), {
      gfm: true,
      breaks: false,
    }) as string;
    renderedHtml = baseHtml;
    await tick();
    injectCopyButtons(previewEl);
    injectCopyButtons(livePreviewEl);
    await renderMermaidBlocks(previewEl);
    await renderMermaidBlocks(livePreviewEl);

    const nextHtml = await resolveImageSources(baseHtml);
    if (sequence === renderSequence) {
      renderedHtml = nextHtml;
      await tick();
      injectCopyButtons(previewEl);
      injectCopyButtons(livePreviewEl);
      await renderMermaidBlocks(previewEl);
      await renderMermaidBlocks(livePreviewEl);
    }
  }

  function clampSplitPercent(value: number): number {
    return Math.min(SPLIT_MAX_PERCENT, Math.max(SPLIT_MIN_PERCENT, value));
  }

  function applyMarkdownSplitPercent(value: number) {
    markdownSplitPercent = clampSplitPercent(value);
    view?.requestMeasure();
  }

  function resizeMarkdownSplitFromClientX(clientX: number) {
    if (!editBody) return;
    const rect = editBody.getBoundingClientRect();
    if (rect.width <= 0) return;
    applyMarkdownSplitPercent(((clientX - rect.left) / rect.width) * 100);
  }

  function handleSplitPointerMove(event: PointerEvent) {
    resizeMarkdownSplitFromClientX(event.clientX);
  }

  function stopSplitResize() {
    window.removeEventListener("pointermove", handleSplitPointerMove);
    window.removeEventListener("pointerup", stopSplitResize);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }

  function startSplitResize(event: PointerEvent) {
    if (!editBody) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    resizeMarkdownSplitFromClientX(event.clientX);
    window.addEventListener("pointermove", handleSplitPointerMove);
    window.addEventListener("pointerup", stopSplitResize);
  }

  function handleSplitKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        applyMarkdownSplitPercent(markdownSplitPercent - SPLIT_KEY_STEP);
        break;
      case "ArrowRight":
        event.preventDefault();
        applyMarkdownSplitPercent(markdownSplitPercent + SPLIT_KEY_STEP);
        break;
      case "Home":
        event.preventDefault();
        applyMarkdownSplitPercent(SPLIT_MIN_PERCENT);
        break;
      case "End":
        event.preventDefault();
        applyMarkdownSplitPercent(SPLIT_MAX_PERCENT);
        break;
    }
  }

  const markdownSourceFontFamily =
    '"BIZ UDゴシック", "BIZ UDGothic", "Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';

  type VisibleSpaceKind = "half" | "full";

  class VisibleSpaceMarker implements LayerMarker {
    readonly kind: VisibleSpaceKind;
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;

    constructor(kind: VisibleSpaceKind, left: number, top: number, width: number, height: number) {
      this.kind = kind;
      this.left = left;
      this.top = top;
      this.width = width;
      this.height = height;
    }

    eq(other: LayerMarker): boolean {
      return (
        other instanceof VisibleSpaceMarker &&
        other.kind === this.kind &&
        other.left === this.left &&
        other.top === this.top &&
        other.width === this.width &&
        other.height === this.height
      );
    }

    draw(): HTMLElement {
      const element = document.createElement("div");
      element.className = `cm-visible-space-marker cm-visible-${this.kind}-space-marker`;
      this.adjust(element);
      return element;
    }

    update(element: HTMLElement, previous: LayerMarker): boolean {
      if (!(previous instanceof VisibleSpaceMarker) || previous.kind !== this.kind) {
        return false;
      }
      this.adjust(element);
      return true;
    }

    private adjust(element: HTMLElement) {
      element.style.left = `${this.left}px`;
      element.style.top = `${this.top}px`;
      element.style.width = `${this.width}px`;
      element.style.height = `${this.height}px`;
    }
  }

  function getLayerBase(view: EditorView) {
    const rect = view.scrollDOM.getBoundingClientRect();
    const left =
      view.textDirection === Direction.LTR
        ? rect.left
        : rect.right - view.scrollDOM.clientWidth * view.scaleX;
    return {
      left: left - view.scrollDOM.scrollLeft * view.scaleX,
      top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
    };
  }

  function createVisibleSpaceMarker(
    view: EditorView,
    base: { left: number; top: number },
    pos: number,
    kind: VisibleSpaceKind
  ) {
    const rect = view.coordsForChar(pos);
    if (!rect) return null;

    const charLeft = rect.left - base.left;
    const charTop = rect.top - base.top;
    const charWidth = rect.right - rect.left;
    const charHeight = rect.bottom - rect.top;

    if (kind === "half") {
      const size = Math.max(2, Math.min(charWidth, charHeight) * 0.14);
      return new VisibleSpaceMarker(
        kind,
        charLeft + (charWidth - size) / 2,
        charTop + (charHeight - size) * 0.56,
        size,
        size
      );
    }

    const size = Math.max(8, Math.min(charWidth, charHeight) * 0.62);
    return new VisibleSpaceMarker(
      kind,
      charLeft + (charWidth - size) / 2,
      charTop + (charHeight - size) / 2,
      size,
      size
    );
  }

  const visibleSpaces = layer({
    above: true,
    class: "cm-visibleSpaceLayer",
    markers(view) {
      const markers: LayerMarker[] = [];
      const base = getLayerBase(view);
      for (const range of view.visibleRanges) {
        const text = view.state.doc.sliceString(range.from, range.to);
        for (let offset = 0; offset < text.length; offset += 1) {
          const character = text[offset];
          if (character !== " " && character !== "\u3000") continue;

          const marker = createVisibleSpaceMarker(
            view,
            base,
            range.from + offset,
            character === " " ? "half" : "full"
          );
          if (marker) markers.push(marker);
        }
      }
      return markers;
    },
    update(update: ViewUpdate) {
      return update.docChanged || update.viewportChanged || update.geometryChanged;
    },
  });

  const editorTheme = EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--theme-color-Main-light)",
      color: "var(--theme-color-Sub-light)",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: markdownSourceFontFamily,
      fontSize: "var(--font-body-md)",
      lineHeight: "1.5",
      fontKerning: "none",
      fontVariantLigatures: "none",
      fontFeatureSettings: '"liga" 0, "calt" 0',
    },
    ".cm-content": {
      padding: "var(--sp2) var(--sp3)",
      caretColor: "var(--theme-color-Sub-light)",
      minHeight: "100%",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--theme-color-Primary-dark) !important",
    },
    ".cm-selectionMatch": {
      backgroundColor: "var(--theme-color-Primary-main)",
      opacity: "0.35",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--theme-color-Sub-light)",
    },
    ".cm-visibleSpaceLayer": {
      pointerEvents: "none",
    },
    ".cm-visible-space-marker": {
      boxSizing: "border-box",
    },
    ".cm-visible-half-space-marker": {
      borderRadius: "50%",
      backgroundColor: "color-mix(in srgb, var(--theme-color-Sub-main) 46%, transparent)",
    },
    ".cm-visible-full-space-marker": {
      border: "1px solid color-mix(in srgb, var(--theme-color-Primary-main) 42%, transparent)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.02)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--theme-color-Main-light)",
      color: "color-mix(in srgb, var(--theme-color-Sub-main) 70%, transparent)",
      borderRight: "1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 25%, transparent)",
      userSelect: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 var(--sp1) 0 var(--sp2)",
      minWidth: "2.25rem",
      fontVariantNumeric: "tabular-nums",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent)",
      color: "var(--theme-color-Sub-light)",
    },
  });

  // テーマ非依存の Markdown 用シンタックスハイライト。defaultHighlightStyle は
  // 白背景前提の固定色 (#708, #a11, #940 など) を使うため、Dark テーマの
  // 暗い背景 (Main-light = #394249) で見えなくなる。base color は editorTheme
  // の color (Sub-light) を継承させ、トークンにはテーマ追従の色・装飾のみを
  // 乗せて両テーマで可読性を確保する。見出しは em 指定で本文サイズに追従。
  const markdownHighlightStyle = HighlightStyle.define([
    {
      tag: t.heading1,
      fontWeight: "700",
      fontSize: "1.45em",
      color: "var(--theme-color-Sub-light)",
    },
    { tag: t.heading2, fontWeight: "700", fontSize: "1.25em" },
    { tag: t.heading3, fontWeight: "700", fontSize: "1.1em" },
    { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700" },
    { tag: t.strong, fontWeight: "700", color: "var(--theme-color-Accent-light)" },
    { tag: t.emphasis, fontStyle: "italic", color: "var(--theme-color-Accent-light)" },
    { tag: [t.link, t.url], color: "var(--theme-color-Primary-main)", textDecoration: "underline" },
    { tag: t.monospace, color: "var(--theme-color-Accent-main)" },
    { tag: t.quote, color: "var(--theme-color-Sub-main)", fontStyle: "italic" },
    { tag: t.list, color: "var(--theme-color-Primary-main)" },
    { tag: t.meta, opacity: "0.55" },
  ]);

  function buildExtensions() {
    return [
      editorTheme,
      lineNumbers(),
      visibleSpaces,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      autocompletion({
        override: [memoLinkCompletion],
        activateOnTyping: true,
      }),
      syntaxHighlighting(markdownHighlightStyle),
      highlightSelectionMatches(),
      keymap.of([
        {
          key: "Mod-b",
          run: () => {
            formatBold();
            return true;
          },
        },
        {
          key: "Mod-i",
          run: () => {
            formatItalic();
            return true;
          },
        },
        {
          key: "Mod-k",
          run: () => {
            formatLink();
            return true;
          },
        },
        {
          key: "Tab",
          run: (editorView) => formatTableAndMoveCell(editorView, 1),
        },
        {
          key: "Shift-Tab",
          run: (editorView) => formatTableAndMoveCell(editorView, -1),
        },
        ...completionKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        {
          key: "Mod-s",
          run: (editorView) => {
            flushSave(editorView.state.doc.toString());
            return true;
          },
        },
        {
          key: "Mod-Enter",
          run: () => {
            stopEdit();
            return true;
          },
        },
        {
          key: "Escape",
          run: () => {
            stopEdit();
            return true;
          },
        },
      ]),
      keymap.of(historyKeymap),
      EditorView.lineWrapping,
      history(),
      EditorView.domEventHandlers({
        paste(event, editorView) {
          const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) =>
            item.type.startsWith("image/")
          );

          if (!imageItem) {
            return false;
          }

          const file = imageItem.getAsFile();
          if (!file) {
            return false;
          }

          event.preventDefault();
          void (async () => {
            let imageSrc: string | null;
            if (canSavePastedImages()) {
              imageSrc = await persistPastedImage(file);
            } else {
              imageSrc = await imageToDataUrl(file);
            }
            if (!imageSrc) {
              return;
            }

            const prefix = editorView.state.doc.length === 0 ? "" : "\n";
            insertTextAtSelection(
              editorView,
              `${prefix}${buildImageMarkdown(imageSrc, file.name || "Pasted image")}\n`
            );
          })();

          return true;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          syncHeadingLevel(update.view);
        }
        if (update.docChanged) {
          hasChanges = true;
          saveState = "dirty";
          const nextContent = update.view.state.doc.toString();
          currentContent = nextContent;
          void updateRenderedHtml(nextContent);
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            flushSave(nextContent);
          }, 500);
        }
      }),
    ];
  }

  async function startEdit(nextMode: EditableMarkdownMemoMode) {
    if (readOnly) return;
    modeMenuOpen = false;
    markdownMode = nextMode;
    await tick();
    if (!container) return;
    if (!view) {
      view = new EditorView({
        state: EditorState.create({ doc: currentContent, extensions: buildExtensions() }),
        parent: container,
      });
      syncHeadingLevel(view);
    }
    view.requestMeasure();
    view.focus();
  }

  function stopEdit() {
    modeMenuOpen = false;
    stopSplitResize();
    if (view) {
      clearTimeout(saveTimer);
      currentContent = view.state.doc.toString();
      if (hasChanges) {
        flushSave(currentContent);
      }
      view.destroy();
      view = null;
    }
    markdownMode = "preview";
  }

  function selectMarkdownMode(nextMode: MarkdownMemoMode) {
    modeMenuOpen = false;
    if (nextMode === markdownMode) {
      return;
    }
    if (nextMode === "preview") {
      stopEdit();
    } else {
      void startEdit(nextMode);
    }
  }

  function toggleModeMenu() {
    modeMenuOpen = !modeMenuOpen;
  }

  function closeModeMenu() {
    modeMenuOpen = false;
  }

  function handleModeTriggerKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      modeMenuOpen = true;
      void tick().then(() => {
        const activeOption = modeDropdownEl?.querySelector<HTMLButtonElement>(
          ".memo-mode-option.active"
        );
        activeOption?.focus();
      });
    } else if (event.key === "Escape") {
      closeModeMenu();
    }
  }

  function handleModeMenuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModeMenu();
      modeDropdownEl?.querySelector<HTMLButtonElement>(".memo-mode-trigger")?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const options = Array.from(
      modeDropdownEl?.querySelectorAll<HTMLButtonElement>(".memo-mode-option") ?? []
    );
    if (options.length === 0) return;
    const currentIndex = Math.max(0, options.indexOf(document.activeElement as HTMLButtonElement));
    const nextIndex =
      event.key === "ArrowDown"
        ? (currentIndex + 1) % options.length
        : (currentIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
  }

  function handleWindowClick(event: MouseEvent) {
    if (!modeMenuOpen || !modeDropdownEl || !(event.target instanceof Node)) return;
    if (!modeDropdownEl.contains(event.target)) {
      closeModeMenu();
    }
  }

  onDestroy(() => {
    stopSplitResize();
    clearTimeout(savedTimer);
    if (view) {
      clearTimeout(saveTimer);
      if (hasChanges) flushSave(view.state.doc.toString());
      view.destroy();
    }
  });

  // ソースの「N 番目の GFM task list item」のチェック状態を反転する。
  // インデックスはプレビュー DOM 上の `.task-list-item input` 出現順と
  // 一致させており、marked が task list を順序通りに出力することに依存している。
  const TASK_LIST_LINE_REGEX = /^(\s*[-*+]\s+\[)([ xX])(\])/;

  function toggleTaskInSource(source: string, index: number): string | null {
    const lines = source.split("\n");
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const match = TASK_LIST_LINE_REGEX.exec(lines[i]);
      if (!match) continue;
      if (count === index) {
        const next = match[2].toLowerCase() === "x" ? " " : "x";
        lines[i] = lines[i].replace(TASK_LIST_LINE_REGEX, `$1${next}$3`);
        return lines.join("\n");
      }
      count++;
    }
    return null;
  }

  function handleChecklistClick(target: Element): boolean {
    if (readOnly) return false;
    if (!(target instanceof HTMLInputElement)) return false;
    if (target.type !== "checkbox") return false;
    if (!target.closest(".task-list-item")) return false;

    const root = target.closest(".preview");
    if (!root) return false;
    const all = Array.from(
      root.querySelectorAll<HTMLInputElement>(".task-list-item > input[type='checkbox']")
    );
    const index = all.indexOf(target);
    if (index < 0) return false;

    const nextContent = toggleTaskInSource(currentContent, index);
    if (nextContent === null || nextContent === currentContent) return false;

    currentContent = nextContent;

    if (view) {
      // エディタが開いている (edit mode): カーソル位置を保ったままドキュメントを置換。
      // 同一行内 1 文字の差分しか無いので selection は安全に再利用できる。
      const oldSelection = view.state.selection;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextContent },
        selection: oldSelection,
      });
      // updateListener が 500ms 後に save を予約しているのを上書きして即時保存。
      clearTimeout(saveTimer);
    } else {
      void updateRenderedHtml(nextContent);
    }
    flushSave(nextContent);
    return true;
  }

  function handlePreviewClick(e: MouseEvent | KeyboardEvent) {
    const target = e.target as Element | null;
    if (target && handleChecklistClick(target)) {
      return;
    }
    const link = target?.closest("a") as HTMLAnchorElement | null;
    if (link?.dataset.memoLink) {
      e.preventDefault();
      openMemoLink?.(link.dataset.memoLink);
      return;
    }
    if (link?.href) {
      e.preventDefault();
      platform.openExternalLink(link.href);
      return;
    }
    // Click an image in the rendered preview → open it in a dedicated
    // BrowserWindow at its natural size. Skipped when the click came
    // from inside a link (handled above) and skipped for missing/broken
    // images so a placeholder doesn't pop a blank window.
    const img = target?.closest("img") as HTMLImageElement | null;
    if (img?.src && img.dataset.missingImage !== "true") {
      e.preventDefault();
      platform.openImageWindow(img.src);
      return;
    }
  }

  function handlePreviewKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      handlePreviewClick(e);
    }
  }

  $: normalizedContent = toMarkdown(content);
  $: isEditing = markdownMode !== "preview";
  $: currentModeLabel =
    memoModeOptions.find((mode) => mode.value === markdownMode)?.label ?? "Preview";
  $: hasRenderedContent = Boolean(currentContent.trim());
  $: if (!isEditing && normalizedContent !== currentContent) {
    currentContent = normalizedContent;
  }
  $: if (readOnly && isEditing) {
    stopEdit();
  }
  $: if (!isEditing) {
    void updateRenderedHtml(currentContent || "");
  }
  // テーマが切り替わったら mermaid を再初期化し、既存ブロックを再レンダリング。
  // setupMermaidTheme は変更が無ければ no-op なので、初回マウントと
  // 切替時のみ updateRenderedHtml が走る。
  $: if ($theme && setupMermaidTheme($theme) && currentContent.trim()) {
    void updateRenderedHtml(currentContent);
  }
</script>

<svelte:window on:click={handleWindowClick} />

<div class="wrapper">
  {#if isEditing}
    <div class="edit-mode">
      <div class="edit-bar">
        <div class="toolbar">
          <!-- eslint-disable svelte/no-at-html-tags -->
          <span class="heading-picker toolbar-picker">
            <select
              aria-label="Heading"
              title="Heading"
              bind:value={currentHeadingLevel}
              on:change={handleHeadingChange}
            >
              <option value="normal">Normal</option>
              <option value="1">Heading 1</option>
              <option value="2">Heading 2</option>
            </select>
          </span>
          <span class="tool-sep"></span>
          <button
            type="button"
            class="tool-btn tool-bold"
            aria-label="Bold"
            title="Bold (Ctrl+B)"
            on:mousedown|preventDefault
            on:click={formatBold}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.bold}</span>
          </button>
          <button
            type="button"
            class="tool-btn tool-italic"
            aria-label="Italic"
            title="Italic (Ctrl+I)"
            on:mousedown|preventDefault
            on:click={formatItalic}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.italic}</span>
          </button>
          <button
            type="button"
            class="tool-btn tool-code-inline"
            aria-label="Inline code"
            title="Inline code"
            on:mousedown|preventDefault
            on:click={formatInlineCode}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.inlineCode}</span>
          </button>
          <span class="tool-sep"></span>
          <button
            type="button"
            class="tool-btn"
            aria-label="Link"
            title="Link (Ctrl+K)"
            on:mousedown|preventDefault
            on:click={formatLink}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.link}</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            aria-label="Bullet list"
            title="Bullet list"
            on:mousedown|preventDefault
            on:click={formatBulletList}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.bulletList}</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            aria-label="Quote"
            title="Quote"
            on:mousedown|preventDefault
            on:click={formatQuote}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.quote}</span>
          </button>
          <button
            type="button"
            class="tool-btn tool-code-block"
            aria-label="Code block"
            title="Code block"
            on:mousedown|preventDefault
            on:click={formatCodeBlock}
          >
            <span class="tool-icon" aria-hidden="true">{@html toolbarIcons.codeBlock}</span>
          </button>
          <span class="tool-sep"></span>
          <span class="table-picker toolbar-picker">
            <select
              aria-label="Table"
              title="Table"
              bind:value={tableActionValue}
              on:change={handleTableActionChange}
            >
              <option value="" disabled>Table</option>
              {#each tableActionOptions as action}
                <option value={action.value}>{action.label}</option>
              {/each}
            </select>
          </span>
          <!-- eslint-enable svelte/no-at-html-tags -->
        </div>
        <div class="edit-bar-end">
          <span class="save-status" aria-live="polite">
            {saveState === "dirty" ? "Unsaved" : saveState === "saved" ? "Saved" : ""}
          </span>
          <!-- eslint-disable svelte/no-at-html-tags -->
          <div class="memo-mode-dropdown" bind:this={modeDropdownEl}>
            <button
              type="button"
              class="memo-mode-trigger"
              aria-label={`Memo mode: ${currentModeLabel}`}
              aria-haspopup="listbox"
              aria-expanded={modeMenuOpen}
              title={currentModeLabel}
              on:click|stopPropagation={toggleModeMenu}
              on:keydown={handleModeTriggerKeydown}
            >
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="memo-mode-icon" aria-hidden="true"
                >{@html memoModeIconSvg[markdownMode]}</span
              >
              <span class="memo-mode-hover-label" aria-hidden="true">{currentModeLabel}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="memo-mode-chevron" aria-hidden="true">{@html chevronDownIconSvg}</span>
            </button>
            {#if modeMenuOpen}
              <div
                class="memo-mode-menu"
                role="listbox"
                aria-label="Memo mode"
                tabindex="-1"
                on:keydown={handleModeMenuKeydown}
              >
                {#each memoModeOptions as mode}
                  <button
                    type="button"
                    class="memo-mode-option"
                    class:active={mode.value === markdownMode}
                    data-mode={mode.value}
                    role="option"
                    aria-selected={mode.value === markdownMode}
                    on:click|stopPropagation={() => selectMarkdownMode(mode.value)}
                  >
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <span class="memo-mode-icon" aria-hidden="true"
                      >{@html memoModeIconSvg[mode.value]}</span
                    >
                    <span class="memo-mode-option-label">{mode.label}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <!-- eslint-enable svelte/no-at-html-tags -->
        </div>
      </div>
      <div
        class="edit-body"
        class:split-mode={markdownMode === "split"}
        bind:this={editBody}
        style={`--editor-pane-width: ${markdownSplitPercent}%`}
      >
        <div class="editor-pane">
          <div class="editor" bind:this={container}></div>
        </div>
        {#if markdownMode === "split"}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="markdown-split-resizer"
            role="separator"
            aria-label="Resize editor and preview"
            aria-orientation="vertical"
            aria-valuemin={SPLIT_MIN_PERCENT}
            aria-valuemax={SPLIT_MAX_PERCENT}
            aria-valuenow={Math.round(markdownSplitPercent)}
            tabindex="0"
            on:pointerdown={startSplitResize}
            on:keydown={handleSplitKeydown}
          ></div>
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="live-preview"
            aria-label="Markdown preview"
            on:click={handlePreviewClick}
            on:keydown={handlePreviewKeydown}
          >
            {#if hasRenderedContent}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <div class="preview" bind:this={livePreviewEl}>{@html renderedHtml}</div>
            {:else}
              <div class="placeholder">Preview</div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="preview-mode"
      class:emptyContent={!hasRenderedContent}
      on:click={handlePreviewClick}
      on:keydown={handlePreviewKeydown}
    >
      {#if !readOnly}
        <div class="preview-bar">
          <!-- eslint-disable svelte/no-at-html-tags -->
          <div class="memo-mode-dropdown" bind:this={modeDropdownEl}>
            <button
              type="button"
              class="memo-mode-trigger"
              aria-label={`Memo mode: ${currentModeLabel}`}
              aria-haspopup="listbox"
              aria-expanded={modeMenuOpen}
              title={currentModeLabel}
              on:click|stopPropagation={toggleModeMenu}
              on:keydown={handleModeTriggerKeydown}
            >
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="memo-mode-icon" aria-hidden="true"
                >{@html memoModeIconSvg[markdownMode]}</span
              >
              <span class="memo-mode-hover-label" aria-hidden="true">{currentModeLabel}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="memo-mode-chevron" aria-hidden="true">{@html chevronDownIconSvg}</span>
            </button>
            {#if modeMenuOpen}
              <div
                class="memo-mode-menu"
                role="listbox"
                aria-label="Memo mode"
                tabindex="-1"
                on:keydown={handleModeMenuKeydown}
              >
                {#each memoModeOptions as mode}
                  <button
                    type="button"
                    class="memo-mode-option"
                    class:active={mode.value === markdownMode}
                    data-mode={mode.value}
                    role="option"
                    aria-selected={mode.value === markdownMode}
                    on:click|stopPropagation={() => selectMarkdownMode(mode.value)}
                  >
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <span class="memo-mode-icon" aria-hidden="true"
                      >{@html memoModeIconSvg[mode.value]}</span
                    >
                    <span class="memo-mode-option-label">{mode.label}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <!-- eslint-enable svelte/no-at-html-tags -->
        </div>
      {/if}
      {#if hasRenderedContent}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="preview" bind:this={previewEl}>{@html renderedHtml}</div>
      {:else if !readOnly}
        <div class="placeholder">No content</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrapper {
    --memo-editor-font:
      "BIZ UDゴシック", "BIZ UDGothic", "Cascadia Mono", "Cascadia Code", Consolas, "Courier New",
      monospace;
    --memo-quill-button-color: var(--theme-color-Sub-light);
    --memo-quill-button-active-color: #06c;
    --memo-quill-button-height: 24px;
    --memo-quill-button-width: 28px;

    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background-color: var(--theme-color-Main-light);
    border: var(--memo-wrapper-border);
    box-sizing: border-box;
  }

  .wrapper :global(.cm-tooltip-autocomplete) {
    background-color: var(--theme-color-Main-main);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 28%, transparent);
    color: var(--theme-color-Sub-main);
  }

  .wrapper :global(.cm-tooltip-autocomplete ul li[aria-selected]) {
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 18%, transparent);
    color: var(--theme-color-Sub-light);
  }

  .edit-mode {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .edit-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: var(--sp1) var(--sp2);
    background-color: var(--theme-color-Main-dark);
    flex-shrink: 0;
    gap: var(--sp2);
    min-width: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0;
    flex-wrap: wrap;
    flex: 1 1 auto;
    min-width: 0;
    row-gap: var(--sp1);
    overflow: visible;
    scrollbar-width: none;
  }

  .toolbar::-webkit-scrollbar {
    display: none;
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    height: var(--memo-quill-button-height);
    width: var(--memo-quill-button-width);
    padding: 3px 5px;
    margin: 0;
    font-size: 14px;
    background: none;
    border: none;
    border-radius: 0;
    color: var(--memo-quill-button-color);
    cursor: pointer;
    line-height: 1;
    text-align: center;
    transition:
      color 0.1s ease,
      background-color 0.1s ease;
  }

  .tool-btn:hover,
  .tool-btn:focus-visible {
    background-color: color-mix(in srgb, var(--theme-color-Sub-light) 10%, transparent);
    color: var(--memo-quill-button-active-color);
  }

  .tool-btn:active {
    background-color: color-mix(in srgb, var(--theme-color-Sub-light) 16%, transparent);
  }

  .tool-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    pointer-events: none;
  }

  .tool-icon :global(svg) {
    display: block;
    width: 18px;
    height: 18px;
  }

  .tool-icon :global(.ql-stroke) {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
  }

  .tool-icon :global(.ql-stroke-miter) {
    fill: none;
    stroke: currentColor;
    stroke-miterlimit: 10;
    stroke-width: 2;
  }

  .tool-icon :global(.ql-fill),
  .tool-icon :global(.ql-stroke.ql-fill) {
    fill: currentColor;
  }

  .tool-icon :global(.ql-even) {
    fill-rule: evenodd;
  }

  .tool-icon :global(.ql-thin),
  .tool-icon :global(.ql-stroke.ql-thin) {
    stroke-width: 1;
  }

  .tool-icon :global(.ql-transparent) {
    opacity: 0.4;
  }

  .tool-bold {
    font-weight: bold;
  }

  .tool-italic {
    font-style: italic;
  }

  .tool-code-inline,
  .tool-code-block {
    min-width: var(--memo-quill-button-width);
  }

  .toolbar-picker {
    position: relative;
    display: inline-block;
    flex: 0 0 auto;
    height: var(--memo-quill-button-height);
    color: var(--memo-quill-button-color);
    font-size: 14px;
    font-weight: 500;
    vertical-align: middle;
  }

  .heading-picker {
    width: 98px;
  }

  .table-picker {
    width: 112px;
  }

  .toolbar-picker select {
    appearance: none;
    width: 100%;
    height: 100%;
    padding: 0 20px 0 8px;
    margin: 0;
    border: none;
    border-radius: 0;
    outline: none;
    color: inherit;
    background: transparent;
    cursor: pointer;
    font: inherit;
    line-height: 22px;
  }

  .toolbar-picker::after {
    content: "";
    position: absolute;
    top: 50%;
    right: 6px;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: translateY(-65%) rotate(45deg);
    pointer-events: none;
  }

  .toolbar-picker:hover,
  .toolbar-picker:focus-within {
    color: var(--memo-quill-button-active-color);
  }

  .toolbar-picker select option {
    color: var(--theme-color-Sub-light);
    background-color: var(--theme-color-Main-light);
  }

  .tool-sep {
    width: 0;
    height: var(--memo-quill-button-height);
    background-color: transparent;
    margin: 0 var(--sp2) 0 var(--sp1);
    flex-shrink: 0;
  }

  .edit-bar-end {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    flex-shrink: 0;
    margin-left: auto;
  }

  .memo-mode-dropdown {
    position: relative;
    flex: 0 0 auto;
  }

  .memo-mode-trigger {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 3.05rem;
    height: var(--memo-quill-button-height);
    padding: 0 7px;
    margin: 0;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 34%, transparent);
    border-radius: var(--shape-xs);
    color: var(--theme-color-Sub-main);
    background-color: var(--theme-color-Main-light);
    cursor: pointer;
  }

  .memo-mode-trigger:hover,
  .memo-mode-trigger:focus,
  .memo-mode-trigger[aria-expanded="true"] {
    border-color: var(--theme-color-Primary-main);
    color: var(--theme-color-Primary-main);
    outline: none;
  }

  .memo-mode-trigger:focus-visible {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color-Primary-main) 30%, transparent);
  }

  .memo-mode-icon,
  .memo-mode-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    pointer-events: none;
  }

  .memo-mode-icon :global(svg) {
    width: 15px;
    height: 15px;
  }

  .memo-mode-chevron :global(svg) {
    width: 12px;
    height: 12px;
    transition: transform 120ms ease;
  }

  .memo-mode-icon :global(svg),
  .memo-mode-chevron :global(svg) {
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .memo-mode-trigger[aria-expanded="true"] .memo-mode-chevron :global(svg) {
    transform: rotate(180deg);
  }

  .memo-mode-hover-label {
    position: absolute;
    top: 50%;
    right: calc(100% + var(--sp1));
    z-index: 24;
    padding: 4px 9px;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 30%, transparent);
    border-radius: var(--shape-xs);
    color: var(--theme-color-Sub-light);
    background-color: var(--theme-color-Main-light);
    box-shadow: var(--shadow-sm);
    font-size: var(--font-label-sm);
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(-50%) translateX(3px);
    transition:
      opacity 120ms ease,
      transform 120ms ease;
    pointer-events: none;
  }

  .memo-mode-trigger:hover .memo-mode-hover-label,
  .memo-mode-trigger:focus-visible .memo-mode-hover-label {
    opacity: 1;
    transform: translateY(-50%);
  }

  .memo-mode-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 25;
    display: flex;
    flex-direction: column;
    min-width: 8rem;
    padding: 4px;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 28%, transparent);
    border-radius: var(--shape-xs);
    background-color: var(--theme-color-Main-light);
    box-shadow: var(--shadow-md);
  }

  .memo-mode-option {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    width: 100%;
    min-height: 1.65rem;
    padding: 0 var(--sp3);
    border: 0;
    border-radius: var(--shape-xs);
    color: var(--theme-color-Sub-main);
    background-color: transparent;
    font-size: var(--font-label-md);
    font-weight: 700;
    line-height: 1;
    text-align: left;
    cursor: pointer;
  }

  .memo-mode-option:hover,
  .memo-mode-option:focus,
  .memo-mode-option.active {
    color: var(--theme-color-Primary-main);
    background-color: color-mix(in srgb, var(--theme-color-Primary-main) 14%, transparent);
    outline: none;
  }

  .memo-mode-option-label {
    white-space: nowrap;
  }

  .save-status {
    min-width: 3rem;
    text-align: right;
    color: var(--theme-color-Sub-main);
    font-size: var(--font-label-md);
    white-space: nowrap;
  }

  .save-status:empty {
    display: none;
  }

  .edit-body {
    --editor-pane-width: 55%;
    display: flex;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }

  .editor-pane {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .edit-body.split-mode .editor-pane {
    flex: 0 0 var(--editor-pane-width);
  }

  .editor {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }

  .editor :global(.cm-editor) {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .editor :global(.cm-scroller) {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  /* Match SplitPanes' resizer look: thin neutral bar that turns Primary on
     hover/focus, with subtle grip dots. Keeps the visual language consistent. */
  .markdown-split-resizer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 5px;
    min-width: 5px;
    padding: 0;
    cursor: col-resize;
    background-color: transparent;
    border: none;
    touch-action: none;
  }

  .markdown-split-resizer::before {
    content: "";
    position: absolute;
    top: 0;
    left: 1px;
    width: 3px;
    height: 100%;
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 48%, transparent);
    border-radius: 1.5px;
    opacity: 0.85;
    transition:
      background-color 0.15s ease,
      width 0.15s ease,
      opacity 0.15s ease;
  }

  .markdown-split-resizer::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 1px;
    width: 3px;
    height: 1.5rem;
    transform: translateY(-50%);
    background-image: radial-gradient(circle, var(--theme-color-Main-main) 1px, transparent 1.2px);
    background-size: 3px 4px;
    background-repeat: repeat-y;
    opacity: 0.9;
    pointer-events: none;
  }

  .markdown-split-resizer:hover::before,
  .markdown-split-resizer:focus-visible::before {
    width: 5px;
    left: 0;
    background-color: var(--theme-color-Primary-main);
    opacity: 1;
  }

  .markdown-split-resizer:focus-visible {
    outline: 2px solid var(--theme-color-Primary-main);
    outline-offset: -2px;
  }

  .live-preview {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background-color: var(--theme-color-Main-light);
  }

  .preview-mode {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    overflow: auto;
  }

  .preview-mode.emptyContent {
    overflow: hidden;
  }

  .preview-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    justify-content: flex-end;
    padding: 2px var(--sp2);
    border-bottom: 1px solid var(--theme-color-Shadow-main);
    background-color: color-mix(in srgb, var(--theme-color-Main-light) 94%, black);
  }

  .preview {
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--sp2) var(--sp4);
    color: var(--theme-color-Sub-light);
    font-family: var(--memo-editor-font);
    font-size: var(--font-body-md);
    font-kerning: none;
    font-variant-ligatures: none;
    font-feature-settings:
      "liga" 0,
      "calt" 0;
    line-height: 1.55;
  }

  @media (max-width: 900px) {
    .edit-body.split-mode .editor-pane {
      flex-basis: 100%;
    }

    .markdown-split-resizer,
    .live-preview {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .edit-bar {
      flex-wrap: wrap;
      row-gap: var(--sp1);
    }

    .edit-bar-end {
      order: 1;
    }

    .toolbar {
      order: 2;
      flex-basis: 100%;
    }
  }

  .placeholder {
    flex: 1 1 auto;
    min-height: 0;
    box-sizing: border-box;
    padding: var(--sp2);
    color: var(--theme-color-Sub-main);
    font-size: var(--font-body-md);
    font-style: italic;
  }

  .live-preview .placeholder {
    min-height: 100%;
  }

  .preview :global(h1),
  .preview :global(h2),
  .preview :global(h3),
  .preview :global(h4) {
    margin: 0.85em 0 0.4em;
    font-weight: 700;
    line-height: 1.3;
    color: var(--theme-color-Sub-light);
  }

  .preview :global(:first-child) {
    margin-top: 0;
  }

  .preview :global(h1) {
    font-size: 1.75rem;
    padding-bottom: var(--sp1);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 50%, transparent);
  }

  .preview :global(h2) {
    font-size: 1.4rem;
    padding-bottom: var(--sp1);
    border-bottom: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 30%, transparent);
  }

  .preview :global(h3) {
    font-size: 1.15rem;
  }

  .preview :global(h4) {
    font-size: 1.05rem;
  }

  .preview :global(p) {
    margin: 0.5em 0;
  }

  .preview :global(img) {
    display: block;
    box-sizing: border-box;
    /* Fixed cap (32rem) keeps the rendered size identical between
       Preview-only and Split modes for any image wider than the cap,
       so the layout doesn't visually jump when the user toggles the
       view. Smaller images still display at their natural size in
       both modes. Click opens the image in a dedicated window for
       a full-resolution look. */
    width: auto;
    max-width: min(100%, 32rem);
    height: auto;
    margin: var(--sp3) 0;
    border-radius: var(--shape-md);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-main) 25%, transparent);
    background: color-mix(in srgb, var(--theme-color-Main-dark) 80%, transparent);
    box-shadow: var(--elevation-2);
    cursor: zoom-in;
  }

  .preview :global(img[data-missing-image="true"]) {
    min-height: 6rem;
    object-fit: contain;
    opacity: 0.65;
  }

  .preview :global(a) {
    color: var(--theme-color-Primary-main);
    text-decoration: underline;
    cursor: pointer;
  }

  .preview :global(a.wiki-link) {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    padding: 1px var(--sp2);
    border-radius: var(--shape-pill);
    text-decoration: none;
    font-weight: 600;
    background: color-mix(in srgb, var(--theme-color-Primary-main) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--theme-color-Primary-main) 45%, transparent);
  }

  .preview :global(a.wiki-link.is-unresolved) {
    opacity: 0.8;
    border-style: dashed;
  }

  .preview :global(a.wiki-link.is-external)::after {
    content: "ext";
    font-size: 0.8em;
  }

  .preview :global(code) {
    font-family: var(--memo-editor-font);
    font-size: 0.85em;
    background-color: var(--theme-color-Main-dark);
    padding: 0.1em 0.35em;
    border-radius: var(--shape-xs);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 20%, transparent);
  }

  .preview :global(pre) {
    background-color: var(--theme-color-Main-dark);
    padding: var(--sp3) var(--sp4);
    border-radius: var(--shape-sm);
    overflow-x: auto;
    margin: 0.75em 0;
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 25%, transparent);
    position: relative;
  }

  .preview :global(pre[data-lang]) {
    padding-top: calc(var(--sp3) + var(--sp4));
  }

  .preview :global(pre[data-lang])::before {
    content: attr(data-lang);
    position: absolute;
    top: var(--sp1);
    left: var(--sp2);
    padding: 0 var(--sp2);
    font-size: var(--font-label-sm);
    font-family: inherit;
    color: var(--theme-color-Sub-main);
    background-color: color-mix(in srgb, var(--theme-color-Main-light) 60%, transparent);
    border-radius: var(--shape-xs);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 30%, transparent);
    text-transform: lowercase;
    line-height: 1.5;
    pointer-events: none;
  }

  .preview :global(pre code) {
    background: none;
    padding: 0;
    border: none;
    font-size: var(--font-body-sm);
  }

  .preview :global(pre .copy-btn) {
    position: absolute;
    top: var(--sp1);
    right: var(--sp1);
    padding: 2px var(--sp2);
    font-size: var(--font-label-sm);
    font-family: inherit;
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 40%, transparent);
    border-radius: var(--shape-xs);
    color: var(--theme-color-Sub-main);
    cursor: pointer;
    opacity: 0.45;
    transition:
      opacity 0.15s ease,
      background-color 0.1s ease;
    line-height: 1.4;
    user-select: none;
  }

  .preview :global(pre:hover .copy-btn),
  .preview :global(pre .copy-btn:focus-visible) {
    opacity: 1;
  }

  .preview :global(pre .copy-btn:hover) {
    background-color: color-mix(in srgb, var(--theme-color-Sub-dark) 30%, transparent);
    color: var(--theme-color-Sub-light);
    border-color: var(--theme-color-Sub-main);
  }

  .preview :global(pre .copy-btn.copied) {
    color: var(--theme-color-Success-main);
    border-color: var(--theme-color-Success-dark);
    opacity: 1;
  }

  .preview :global(.mermaid-block) {
    display: flex;
    justify-content: center;
    margin: 0.75em 0;
    padding: var(--sp3);
    background-color: var(--theme-color-Main-dark);
    border: 1px solid color-mix(in srgb, var(--theme-color-Sub-dark) 25%, transparent);
    border-radius: var(--shape-sm);
    overflow-x: auto;
  }

  .preview :global(.mermaid-block svg) {
    max-width: 100%;
    height: auto;
  }

  .preview :global(.mermaid-block.mermaid-error) {
    justify-content: flex-start;
    padding: var(--sp3) var(--sp4);
    color: var(--theme-color-Error-main);
    background-color: color-mix(in srgb, var(--theme-color-Error-main) 8%, transparent);
    border-color: color-mix(in srgb, var(--theme-color-Error-main) 35%, transparent);
    font-family: var(--memo-editor-font);
    font-size: var(--font-body-sm);
    white-space: pre-wrap;
  }

  .preview :global(blockquote) {
    border-left: 3px solid var(--theme-color-Sub-dark);
    margin: 0.5em 0;
    padding: 0.25em 0.75em;
    color: var(--theme-color-Sub-main);
  }

  .preview :global(ul),
  .preview :global(ol) {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  .preview :global(ul.contains-task-list) {
    list-style: none;
    padding-left: 0;
  }

  .preview :global(li) {
    margin: 0.2em 0;
  }

  .preview :global(.task-list-item) {
    list-style: none;
    display: flex;
    gap: var(--sp2);
    align-items: flex-start;
  }

  .preview :global(.task-list-item input[type="checkbox"]) {
    margin-top: var(--sp1);
    accent-color: var(--theme-color-Primary-main);
    cursor: pointer;
  }

  .preview :global(hr) {
    border: none;
    border-top: 1px solid var(--theme-color-Sub-dark);
    margin: 1em 0;
  }

  .preview :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
    font-size: var(--font-body-md);
  }

  .preview :global(th),
  .preview :global(td) {
    border: 1px solid var(--theme-color-Sub-dark);
    padding: 0.3em 0.6em;
  }

  .preview :global(th) {
    background-color: var(--theme-color-Main-dark);
  }
</style>
