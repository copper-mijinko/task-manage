import { writable, type Writable } from "svelte/store";
import { THEME_DARK, THEME_LIGHT } from "@lib/utils/theme";
import type { ThemeName } from "@app-types/app";
import * as platform from "@lib/ipc/platform";

type ThemePalette = {
  [key: string]: string | ThemePalette;
};

export interface ThemeStore extends Writable<ThemeName | undefined> {
  init: () => void;
  /**
   * 保存済みのテーマや、他のウィンドウで変わったテーマを反映する。保存はしない
   * （保存し直すと通知が他のウィンドウへ跳ね返り、続けて切り替えたときに
   * 古い値へ戻る）。
   */
  applyExternal: (value: ThemeName) => void;
}

function isThemeName(value: unknown): value is ThemeName {
  return value === "dark" || value === "light";
}

function createTheme(initialValue: ThemeName | undefined): ThemeStore {
  const { subscribe, set, update } = writable<ThemeName | undefined>(initialValue);
  // 保存するのは利用者が切り替えたときだけ。保存済みの値を読んだときや
  // 他のウィンドウから届いた変更は反映だけにする。
  let persist = true;
  const applyExternal = (value: ThemeName) => {
    persist = false;
    try {
      set(value);
    } finally {
      persist = true;
    }
  };

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
    applyExternal,
    init: () => {
      subscribe((current) => {
        if (current === undefined) {
          // 保存済みの値を読むだけなので、保存し直さない。
          platform.getMetaData("theme").then((result) => {
            if (isThemeName(result)) applyExternal(result);
          });
        }

        if (current === "dark") {
          traverse(THEME_DARK as ThemePalette, "--theme");
          traverse(THEME_DARK.semantic, "-");
          document.documentElement.style.setProperty("--color-scheme", "dark");
          if (persist) platform.setMetaData("theme", current);
        } else if (current === "light") {
          traverse(THEME_LIGHT as ThemePalette, "--theme");
          traverse(THEME_LIGHT.semantic, "-");
          document.documentElement.style.setProperty("--color-scheme", "light");
          if (persist) platform.setMetaData("theme", current);
        }
      });
    },
  };
}

export const theme: ThemeStore = createTheme(undefined);
