function elementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  if (node instanceof Element) return node;
  return node.parentElement;
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(".cm-editor")) return true;
  if (target.closest(".ql-editor")) return true;
  if (target.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

export function hasSelectedDocumentText(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  return selection.toString().length > 0;
}

export function hasSelectedMemoText(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  if (selection.toString().length === 0) return false;

  const commonAncestor = selection.getRangeAt(0).commonAncestorContainer;
  return [selection.anchorNode, selection.focusNode, commonAncestor].some((node) =>
    elementFromNode(node)?.closest(
      ".memo-host .cm-editor, .memo-host .ql-editor, .memo-host .preview"
    )
  );
}
