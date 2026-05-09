/**
 * Global panel coordinator — ensures only one floating panel (dropdown, filter
 * panel, context menu, etc.) is open at a time.
 *
 * Usage for mount/unmount panels (DateRangePanel, NameFilterPanel, …):
 *   const myId = newPanelId();
 *   onMount(() => {
 *     activePanelId.set(myId);
 *     unsubscribe = activePanelId.subscribe((id) => {
 *       if (id !== null && id !== myId) dispatch("close");
 *     });
 *   });
 *   onDestroy(() => unsubscribe?.());
 *
 * Usage for persistent components (MultiSelect, column-settings, …):
 *   const myId = newPanelId();
 *   // When opening:  activePanelId.set(myId)
 *   // To auto-close: $: if ($activePanelId !== null && $activePanelId !== myId && isOpen) isOpen = false;
 */
import { writable, type Writable } from "svelte/store";

let _counter = 0;

/** Returns a new unique panel identifier. */
export function newPanelId(): string {
  return `panel-${++_counter}`;
}

/** The ID of the currently active (open) panel, or null when none is open. */
export const activePanelId: Writable<string | null> = writable(null);
