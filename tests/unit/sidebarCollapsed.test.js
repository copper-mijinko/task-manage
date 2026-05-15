import { get } from "svelte/store";
import { sidebarCollapsed } from "@stores/ui";

describe("sidebarCollapsed store", () => {
  test("defaults to true (sidebar starts collapsed)", () => {
    // Per UX feedback the sidebar should ALWAYS start collapsed on launch —
    // no localStorage persistence is allowed to override that.
    expect(get(sidebarCollapsed)).toBe(true);
  });

  test("set(false) opens the sidebar", () => {
    sidebarCollapsed.set(false);
    expect(get(sidebarCollapsed)).toBe(false);
    sidebarCollapsed.set(true); // restore for other tests
  });

  test("update toggles the value", () => {
    sidebarCollapsed.set(true);
    sidebarCollapsed.update((v) => !v);
    expect(get(sidebarCollapsed)).toBe(false);
    sidebarCollapsed.update((v) => !v);
    expect(get(sidebarCollapsed)).toBe(true);
  });
});
