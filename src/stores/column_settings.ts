import { writable, type Writable } from "svelte/store";

export interface ColumnSetting {
  id: string;
  label: string;
  visible: boolean;
}

export interface ColumnSettingsStore extends Writable<ColumnSetting[]> {
  init: () => void;
  toggle: (id: string) => void;
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
}

const META_KEY = "column_settings";

export const DEFAULT_COLUMN_SETTINGS: ColumnSetting[] = [
  { id: "name", label: "タスク名", visible: true },
  { id: "status", label: "ステータス", visible: true },
  { id: "start date", label: "開始日", visible: true },
  { id: "due date", label: "期限日", visible: true },
  { id: "memo", label: "メモ数", visible: false },
];

function isColumnSettingsArray(value: unknown): value is ColumnSetting[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).label === "string" &&
        typeof (item as Record<string, unknown>).visible === "boolean"
    )
  );
}

function createColumnSettings(): ColumnSettingsStore {
  const { subscribe, set, update } = writable<ColumnSetting[]>(DEFAULT_COLUMN_SETTINGS);

  const save = (settings: ColumnSetting[]) => {
    try {
      window.electronAPI.setMetaData(META_KEY, settings);
    } catch {
      // ignore
    }
  };

  return {
    subscribe,
    set,
    update,
    init: () => {
      window.electronAPI
        .getMetaData(META_KEY)
        .then((saved) => {
          if (!isColumnSettingsArray(saved)) return;

          // Merge saved settings with defaults (handles new columns added later)
          const merged = DEFAULT_COLUMN_SETTINGS.map((def) => {
            const found = saved.find((s) => s.id === def.id);
            return found ? { ...def, visible: found.visible } : def;
          });

          // Restore saved column ordering
          const savedOrder = saved.map((s) => s.id);
          merged.sort((a, b) => {
            const ai = savedOrder.indexOf(a.id);
            const bi = savedOrder.indexOf(b.id);
            if (ai === -1 && bi === -1) return 0;
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          });

          set(merged);
        })
        .catch(() => {
          // keep defaults
        });
    },
    toggle: (id: string) => {
      if (id === "name") return;
      update((settings) => {
        const next = settings.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s));
        save(next);
        return next;
      });
    },
    moveUp: (id: string) => {
      update((settings) => {
        const index = settings.findIndex((s) => s.id === id);
        if (index <= 1) return settings; // Cannot move before 'name'
        const next = [...settings];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        save(next);
        return next;
      });
    },
    moveDown: (id: string) => {
      update((settings) => {
        const index = settings.findIndex((s) => s.id === id);
        if (index < 0 || index >= settings.length - 1) return settings;
        const next = [...settings];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        save(next);
        return next;
      });
    },
  };
}

export const column_settings = createColumnSettings();
