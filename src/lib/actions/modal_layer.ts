/**
 * Move a modal layer to document.body and isolate it from the rest of the app.
 * This keeps background controls out of both keyboard navigation and the
 * accessibility tree while a dialog is open, which is especially important
 * for screen readers and GUI agents.
 */
export function modalLayer(node: HTMLElement) {
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  document.body.appendChild(node);

  const siblings = Array.from(document.body.children).filter(
    (element): element is HTMLElement =>
      element !== node &&
      element instanceof HTMLElement &&
      element.tagName !== "SCRIPT" &&
      element.tagName !== "STYLE"
  );
  const previousState = siblings.map((element) => ({
    element,
    inert: element.hasAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden"),
  }));

  for (const sibling of siblings) {
    sibling.setAttribute("inert", "");
    sibling.setAttribute("aria-hidden", "true");
  }

  window.dispatchEvent(new CustomEvent("task-manage:modal-open"));
  requestAnimationFrame(() => {
    const focusTarget =
      node.querySelector<HTMLElement>("[data-modal-autofocus]") ??
      node.querySelector<HTMLElement>(
        "input:not([disabled]), button:not([disabled]), [tabindex='0'], [tabindex='-1']"
      );
    focusTarget?.focus();
  });

  return {
    destroy() {
      for (const state of previousState) {
        if (state.inert) state.element.setAttribute("inert", "");
        else state.element.removeAttribute("inert");

        if (state.ariaHidden === null) state.element.removeAttribute("aria-hidden");
        else state.element.setAttribute("aria-hidden", state.ariaHidden);
      }
      node.remove();
      previousFocus?.focus();
    },
  };
}
