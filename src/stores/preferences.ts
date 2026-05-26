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
