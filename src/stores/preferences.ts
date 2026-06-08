import { writable, type Writable } from "svelte/store";
import * as platform from "@lib/ipc/platform";

export type DateFormat = "iso" | "slash" | "japanese";

const DATE_FORMAT_KEY = "preferences.date_time_format";
const DATE_FORMAT_DEFAULT: DateFormat = "slash";

function isDateFormat(value: unknown): value is DateFormat {
  return value === "iso" || value === "slash" || value === "japanese";
}

export interface DateFormatStore extends Writable<DateFormat> {
  init: () => void;
}

function createDateFormatStore(): DateFormatStore {
  const { subscribe, set, update } = writable<DateFormat>(DATE_FORMAT_DEFAULT);

  return {
    subscribe,
    set: (value: DateFormat) => {
      set(value);
      platform.setMetaData(DATE_FORMAT_KEY, value);
    },
    update,
    init: () => {
      platform.getMetaData(DATE_FORMAT_KEY).then((result) => {
        if (isDateFormat(result)) {
          set(result);
        }
      });
    },
  };
}

// eslint-disable-next-line prefer-const
export let date_time_format: DateFormatStore = createDateFormatStore();

// UI density — "comfortable" (default, card-based with elevation) or
// "compact" (VSCode-like flat layout: tighter spacing, no shadows, sharper
// corners, hairline borders for zoning).
export type UiDensity = "comfortable" | "compact";

const UI_DENSITY_KEY = "preferences.ui_density";
const UI_DENSITY_DEFAULT: UiDensity = "comfortable";

function isUiDensity(value: unknown): value is UiDensity {
  return value === "comfortable" || value === "compact";
}

export interface UiDensityStore extends Writable<UiDensity> {
  init: () => void;
}

function applyUiDensityClass(value: UiDensity) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.toggle("density-compact", value === "compact");
}

function createUiDensityStore(): UiDensityStore {
  const { subscribe, set, update } = writable<UiDensity>(UI_DENSITY_DEFAULT);

  // Cross-window live sync. BroadcastChannel works between BrowserWindow
  // renderers within the same Electron app (same origin), so a density
  // change in the main window propagates to any open Task Detail windows
  // (and vice versa) without needing the main process to broker an event.
  const channel: BroadcastChannel | null =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("preferences") : null;
  const BROADCAST_TYPE = "ui_density";

  // Apply a value locally without re-broadcasting. Used for incoming
  // BroadcastChannel messages and the initial getMetaData hydration —
  // both already know the canonical value, so re-emitting would just
  // bounce the message back and (for setMetaData) cause a redundant disk
  // write in every window.
  function setLocal(value: UiDensity) {
    set(value);
    applyUiDensityClass(value);
  }

  return {
    subscribe,
    set: (value: UiDensity) => {
      setLocal(value);
      platform.setMetaData(UI_DENSITY_KEY, value);
      channel?.postMessage({ type: BROADCAST_TYPE, value });
    },
    update,
    init: () => {
      channel?.addEventListener("message", (event: MessageEvent) => {
        const data = event.data;
        if (
          data &&
          typeof data === "object" &&
          (data as { type?: unknown }).type === BROADCAST_TYPE &&
          isUiDensity((data as { value?: unknown }).value)
        ) {
          setLocal((data as { value: UiDensity }).value);
        }
      });
      platform.getMetaData(UI_DENSITY_KEY).then((result) => {
        if (isUiDensity(result)) {
          setLocal(result);
        }
      });
    },
  };
}

// eslint-disable-next-line prefer-const
export let ui_density: UiDensityStore = createUiDensityStore();
