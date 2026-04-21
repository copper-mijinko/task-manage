import { writable, type Writable } from "svelte/store";
import { THEME_DARK, THEME_LIGHT } from "../common/theme";
import type { ThemeName } from "../types/app";

type ThemePalette = {
  [key: string]: string | ThemePalette;
};

export interface ThemeStore extends Writable<ThemeName | undefined> {
  init: () => void;
}

export function isThemeName(value: unknown): value is ThemeName {
  return value === "dark" || value === "light";
}

function createTheme(initialValue: ThemeName | undefined): ThemeStore {
  const { subscribe, set, update } = writable<ThemeName | undefined>(initialValue);

  const traverse = (palette: ThemePalette, varString: string) => {
    Object.keys(palette).forEach((key) => {
      const varString2 = `${varString}-${key}`;
      const value = palette[key];
      if (typeof value === "string") {
        document.documentElement.style.setProperty(varString2, value);
      } else {
        traverse(value, varString2);
      }
    });
  };

  return {
    subscribe,
    set,
    update,
    init: () => {
      subscribe((current) => {
        if (current === undefined) {
          window.electronAPI.getMetaData("theme").then((result) => {
            if (isThemeName(result)) {
              set(result);
            }
          });
        }

        if (current === "dark") {
          traverse(THEME_DARK as ThemePalette, "--theme");
          window.electronAPI.setMetaData("theme", current);
        } else if (current === "light") {
          traverse(THEME_LIGHT as ThemePalette, "--theme");
          window.electronAPI.setMetaData("theme", current);
        }
      });
    },
  };
}

// eslint-disable-next-line prefer-const
export let theme: ThemeStore;
theme = createTheme(undefined);
