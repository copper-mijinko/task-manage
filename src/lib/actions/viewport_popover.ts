/** Keep a portalled menu inside the renderer, including short detail windows. */
export function viewportPopover(node: HTMLElement, anchor?: DOMRect | (() => DOMRect) | null) {
  const original = node.getBoundingClientRect();
  const ownsPortal = node.parentElement !== document.body;
  if (ownsPortal) document.body.appendChild(node);
  let frame = 0;
  const position = () => {
    const rect = typeof anchor === "function" ? anchor() : anchor;
    const margin = 8;
    const width = Math.max(0, window.innerWidth - margin * 2);
    const height = Math.max(0, window.innerHeight - margin * 2);
    Object.assign(node.style, {
      position: "fixed",
      boxSizing: "border-box",
      minWidth: `${Math.min(Math.max(rect?.width ?? 0, original.width), width)}px`,
      maxWidth: `${width}px`,
      maxHeight: `${height}px`,
      overflowY: "auto",
      right: "auto",
      bottom: "auto",
    });
    const size = node.getBoundingClientRect();
    let top = rect ? rect.bottom + 2 : original.top;
    if (
      rect &&
      top + size.height > window.innerHeight - margin &&
      rect.top > window.innerHeight - rect.bottom
    )
      top = rect.top - size.height - 2;
    node.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - size.height - margin))}px`;
    node.style.left = `${Math.max(margin, Math.min(rect?.left ?? original.left, window.innerWidth - size.width - margin))}px`;
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(node);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  position();
  return {
    update(next: typeof anchor) {
      anchor = next;
      schedule();
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (ownsPortal) node.remove();
    },
  };
}
