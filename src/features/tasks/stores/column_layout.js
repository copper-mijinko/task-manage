const KEY = "task-manage:treegrid-column-widths";
export function readColumnWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return Object.fromEntries(
      Object.entries(saved).filter(
        ([, width]) => Number.isFinite(width) && width >= 32 && width <= 4000
      )
    );
  } catch {
    return {};
  }
}
export function saveColumnWidths(widths) {
  localStorage.setItem(KEY, JSON.stringify({ ...readColumnWidths(), ...widths }));
}
