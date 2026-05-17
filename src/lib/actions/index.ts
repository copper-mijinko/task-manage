type ActionNode = HTMLElement & { value?: string };

interface TooltipParams {
  backgroundColor?: string;
  color?: string;
  content?: string;
  disable?: boolean;
  wrapped?: boolean;
  force?: boolean;
}

interface RippleParams {
  duration?: number;
  color?: string;
  disable?: boolean;
}

// ------------------------------------------------------------------
// Global tooltip housekeeping
// ------------------------------------------------------------------
// Each `tooltip` action records its anchor node and the created tooltip
// element here. A single set of global listeners (scroll, mousedown,
// visibilitychange, window blur) sweeps the registry to delete tooltips
// whose anchor is no longer in the DOM or no longer hovered. This fixes
// the "ghost tooltip stays on screen" bug that used to happen whenever a
// row was virtualised away or the page scrolled while a tooltip was open.
// ------------------------------------------------------------------
interface TooltipEntry {
  node: HTMLElement;
  element: HTMLDivElement;
}
const activeTooltips = new Set<TooltipEntry>();
let globalListenersAttached = false;

function isStillVisible(node: HTMLElement): boolean {
  if (!node.isConnected) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  // offsetParent === null on display:none ancestors.
  if (node.offsetParent === null && getComputedStyle(node).position !== "fixed") return false;
  return true;
}

function removeTooltipEntry(entry: TooltipEntry) {
  if (entry.element.parentNode) {
    entry.element.parentNode.removeChild(entry.element);
  }
  activeTooltips.delete(entry);
}

function sweepTooltips() {
  if (activeTooltips.size === 0) return;
  for (const entry of [...activeTooltips]) {
    if (!isStillVisible(entry.node)) {
      removeTooltipEntry(entry);
      continue;
    }
    // If the anchor is no longer hovered, kill the tooltip. We use
    // :hover via matches() — browsers reset that pseudo-class when the
    // pointer leaves, even when the mouseleave event was missed.
    if (!entry.node.matches(":hover")) {
      removeTooltipEntry(entry);
    }
  }
}

function ensureGlobalListeners() {
  if (globalListenersAttached || typeof document === "undefined") return;
  globalListenersAttached = true;
  // Anything that typically invalidates hover state.
  document.addEventListener("mousedown", sweepTooltips, true);
  document.addEventListener("scroll", sweepTooltips, true);
  document.addEventListener("wheel", sweepTooltips, true);
  document.addEventListener("keydown", sweepTooltips, true);
  document.addEventListener("visibilitychange", () => {
    // Tab change always invalidates hovers.
    for (const entry of [...activeTooltips]) removeTooltipEntry(entry);
  });
  window.addEventListener("blur", () => {
    for (const entry of [...activeTooltips]) removeTooltipEntry(entry);
  });
}

// Re-armable safety sweep: only schedules itself while at least one tooltip
// is alive. This avoids creating a setInterval that would otherwise run
// forever (and infinite-loop fake-timer test harnesses).
let pendingSafetyTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSafetySweep() {
  if (pendingSafetyTimer !== null || activeTooltips.size === 0) return;
  pendingSafetyTimer = setTimeout(() => {
    pendingSafetyTimer = null;
    sweepTooltips();
    if (activeTooltips.size > 0) scheduleSafetySweep();
  }, 1000);
}

// tooltip
export function tooltip(
  node: ActionNode,
  params: TooltipParams = {
    backgroundColor: "white",
    color: "black",
    content: undefined,
    disable: false,
    wrapped: false,
    force: false,
  }
) {
  // Hold params in a mutable closure so reactive prop changes (e.g. the
  // sidebar toggle button flipping its `tooltipContent` between "open" and
  // "close") actually take effect — the Svelte action protocol calls
  // `update(newParams)` whenever the params expression re-evaluates.
  let current = params;
  const getBg = () => current.backgroundColor ?? "white";
  const getFg = () => current.color ?? "black";
  const isDisabled = () => current.disable ?? false;
  const isForce = () => current.force ?? false;

  const judge = () => {
    return !isDisabled() && (isForce() || node.scrollWidth > node.offsetWidth);
  };

  let entry: TooltipEntry | undefined;
  ensureGlobalListeners();

  const removeOwn = () => {
    if (entry) {
      removeTooltipEntry(entry);
      entry = undefined;
    }
  };

  // mouseenter/leave/move を受ける実 anchor。wrapped:true なら親要素にイベントを
  // 付けるので、sweepTooltips の :hover 判定も同じ要素で行わないと、カーソルが
  // 親内の他の子要素 (ボタン等) に乗ったときに原 node の :hover が外れて
  // safety sweep (1秒) でツールチップが消されてしまう。
  const target = params.wrapped ? (node.parentElement ?? node) : node;

  const handleMouseEnter = (e: MouseEvent) => {
    // Defensive: kill any tooltip we might have left over from a previous
    // anchor (this can happen if mouseleave never fired).
    removeOwn();
    if (!judge()) {
      return;
    }
    const element = document.createElement("div");
    element.classList.add("__tooltip-element");
    if (current.content) {
      element.textContent = current.content;
    } else {
      element.textContent = node.textContent || node.value || "";
    }
    element.style.cssText = `
      display: flex;
      justify-content: center;
      align-items: center;
      border: none;
      color: ${getFg()};
      background-color: ${getBg()};
      box-shadow: 0 .2rem .5rem rgba(0,0,0,0.25), 0 .1em .25rem rgba(0,0,0,0);
      border-radius: 0.5rem;
      padding: 0.5rem;
      position: fixed;
      top: calc(${e.pageY}px + 1rem);
      left: calc(${e.pageX}px + 1rem);
      pointer-events: none;
      z-index: 9999999999;
    `;
    document.body.appendChild(element);
    entry = { node: target, element };
    activeTooltips.add(entry);
    scheduleSafetySweep();
  };
  const handleMouseLeave = (_event: MouseEvent) => {
    removeOwn();
  };
  const handleMouseMove = (e: MouseEvent) => {
    if (entry) {
      entry.element.style.left = `calc(${e.pageX}px + 1rem)`;
      entry.element.style.top = `calc(${e.pageY}px + 1rem)`;
    }
  };
  target.addEventListener("mouseenter", handleMouseEnter);
  target.addEventListener("mouseleave", handleMouseLeave);
  target.addEventListener("mousemove", handleMouseMove);

  return {
    update(next: TooltipParams) {
      current = next;
      // If a tooltip is currently shown, refresh its visible text so the
      // user doesn't see stale content (e.g. the close button still saying
      // "open" after the sidebar opened).
      if (entry) {
        entry.element.textContent = current.content ?? node.textContent ?? node.value ?? "";
        entry.element.style.color = getFg();
        entry.element.style.backgroundColor = getBg();
        if (isDisabled()) removeOwn();
      }
    },
    destroy() {
      target.removeEventListener("mouseenter", handleMouseEnter);
      target.removeEventListener("mouseleave", handleMouseLeave);
      target.removeEventListener("mousemove", handleMouseMove);
      removeOwn();
    },
  };
}

// ripple
export function ripple(
  node: HTMLElement,
  params: RippleParams = {
    duration: 500,
    color: "rgba(0, 0, 0, 0.16)",
    disable: false,
  }
) {
  const duration = params.duration ?? 500;
  const color = params.color ?? "rgba(0, 0, 0, 0.16)";
  const disable = params.disable ?? false;
  if (disable) {
    return;
  }
  const handleClick = (e: MouseEvent) => {
    if (!(e.target instanceof Node) || !node.contains(e.target)) {
      return;
    }
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);

    if (style.zIndex == "auto") {
      node.style.zIndex = "0";
    }

    const clone = document.createElement("span");
    clone.style.position = "fixed";
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.borderRadius = style.borderRadius;
    clone.style.overflow = "hidden";
    clone.style.backgroundColor = "transparent";
    clone.style.pointerEvents = "none";
    clone.style.zIndex = "2147483647";

    node.appendChild(clone);

    const x = e.clientX;
    const y = e.clientY;
    const bt = rect.top;
    const bl = rect.left;

    const circle = document.createElement("span");
    circle.classList.add("circle");
    const size = Math.max(rect.width, rect.height);
    circle.style.top = `${y - bt - size / 2}px`;
    circle.style.left = `${x - bl - size / 2}px`;
    circle.style.width = `${size}px`;
    circle.style.height = `${size}px`;
    circle.style.backgroundColor = color;
    circle.style.position = "absolute";
    circle.style.borderRadius = "50%";
    circle.animate(
      {
        opacity: [1, 0],
        scale: [0, 2],
      },
      {
        duration: duration,
        easing: "ease-out",
      }
    );

    setTimeout(() => {
      clone.remove();
    }, duration * 0.8);

    clone.appendChild(circle);
  };

  node.addEventListener("click", handleClick);

  return {
    destroy() {
      node.removeEventListener("click", handleClick);
    },
  };
}

// clickOutside
export function clickOutside(node: HTMLElement) {
  const handleClick = (event: MouseEvent) => {
    const rect = node.getBoundingClientRect();
    if (!(event.target instanceof Node)) {
      return;
    }

    if (!node.contains(event.target) && rect.width && rect.height) {
      node.dispatchEvent(new CustomEvent("outclick"));
    }
  };

  document.addEventListener("click", handleClick, true);

  return {
    destroy() {
      document.removeEventListener("click", handleClick, true);
    },
  };
}

/**
 * Pop-up dismiss helper.
 *
 * Many of our pop-ups (filter panels, column-settings, three-dot menu, status
 * picker, …) need to close on ANY mousedown outside the panel — including on
 * disabled buttons or other toolbar buttons that may call stopPropagation in
 * their click handlers. A plain `window.click` listener misses those, so we
 * register on `document` with capture-phase mousedown instead, plus a few
 * other "the user clearly isn't using this panel anymore" signals.
 *
 * Usage:
 *   <div use:globalDismiss={handleClose}>...</div>
 */
export function globalDismiss(node: HTMLElement, callback: () => void) {
  let cb = callback;
  const handle = (event: Event) => {
    if (!(event.target instanceof Node)) return;
    if (node.contains(event.target)) return;
    cb?.();
  };
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") cb?.();
  };

  // Listen for BOTH mousedown and pointerdown at the capture phase. Some
  // events (notably mousedown on `<button disabled>` in Chromium) are not
  // fired at all, while pointerdown still is — pointerdown gives us the
  // most coverage. We also keep mousedown for compatibility / non-pointer
  // pointing devices.
  document.addEventListener("pointerdown", handle, true);
  document.addEventListener("mousedown", handle, true);
  document.addEventListener("contextmenu", handle, true);
  // Wheel / scroll / focus changes are also dismissal signals — they almost
  // always mean "I'm done with this pop-up".
  const onBlur = () => cb?.();
  window.addEventListener("blur", onBlur);
  document.addEventListener("keydown", handleKey);

  return {
    update(next: () => void) {
      cb = next;
    },
    destroy() {
      document.removeEventListener("pointerdown", handle, true);
      document.removeEventListener("mousedown", handle, true);
      document.removeEventListener("contextmenu", handle, true);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", onBlur);
    },
  };
}
