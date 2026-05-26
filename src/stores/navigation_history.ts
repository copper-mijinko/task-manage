import { derived, get, writable, type Readable } from "svelte/store";
import type { SelectedType } from "@app-types/app";
import { selected_id, selected_type } from "./ui";

/**
 * 1 件の「ページ」エントリ。本アプリでは画面遷移の単位を
 * `(selected_type, selected_id)` のタプルで定義する。
 *
 * - `Projects` / `WorkspaceProject` の id は project root の id
 * - `Inbox` の id は `INBOX_SELECTED_ID` センチネル
 * - `Info` の id は info ページ id
 */
export interface NavigationEntry {
  selectedType: SelectedType;
  selectedId: string | undefined;
}

export interface NavigationHistoryState {
  entries: NavigationEntry[];
  /** entries 内における「現在地」のインデックス。-1 は履歴なし。 */
  index: number;
}

export interface NavigationHistoryStore extends Readable<NavigationHistoryState> {
  /** メインウィンドウでのみ呼ぶ。タスク詳細サブウィンドウでは呼ばない。 */
  init: () => void;
  /** 1 つ前の履歴へ戻る。先頭にいるときは何もしない。 */
  back: () => void;
  /** 1 つ先の履歴へ進む。末尾にいるときは何もしない。 */
  forward: () => void;
  /** テスト用のリセットフック。本体コードからは呼ばない。 */
  reset: () => void;
}

/** 履歴の最大長。これを超える分は古い側から捨てる。 */
const MAX_HISTORY = 100;

function entriesEqual(a: NavigationEntry, b: NavigationEntry): boolean {
  return a.selectedType === b.selectedType && a.selectedId === b.selectedId;
}

function isEmptyEntry(entry: NavigationEntry): boolean {
  return entry.selectedType === undefined && entry.selectedId === undefined;
}

function createNavigationHistory(): NavigationHistoryStore {
  const internal = writable<NavigationHistoryState>({ entries: [], index: -1 });

  let initialized = false;
  let recordQueued = false;
  // back() / forward() による store 更新は履歴に記録しないためのフラグ。
  // 同期的に立て、microtask で消費する。
  let programmaticNavigation = false;

  function currentEntry(): NavigationEntry {
    return {
      selectedType: get(selected_type),
      selectedId: get(selected_id),
    };
  }

  function commitRecord() {
    const wasProgrammatic = programmaticNavigation;
    programmaticNavigation = false;
    if (wasProgrammatic) return;

    const entry = currentEntry();
    if (isEmptyEntry(entry)) {
      // 起動直後 / プロジェクト削除直後など、選択なし状態は履歴に積まない。
      return;
    }
    internal.update((state) => {
      const current = state.entries[state.index];
      if (current && entriesEqual(current, entry)) {
        // 同一ページへの遷移は履歴に積まない（無限の重複防止）。
        return state;
      }
      // index より先（forward 履歴）は新規遷移によって失われる。
      const truncated = state.entries.slice(0, state.index + 1);
      truncated.push(entry);
      const overflow = truncated.length - MAX_HISTORY;
      if (overflow > 0) {
        truncated.splice(0, overflow);
      }
      return { entries: truncated, index: truncated.length - 1 };
    });
  }

  function queueRecord() {
    if (recordQueued) return;
    recordQueued = true;
    Promise.resolve().then(() => {
      recordQueued = false;
      commitRecord();
    });
  }

  function flushPendingRecord() {
    if (!recordQueued) return;
    recordQueued = false;
    commitRecord();
  }

  function navigateTo(targetIndex: number) {
    const state = get(internal);
    if (targetIndex < 0 || targetIndex >= state.entries.length) return;
    if (targetIndex === state.index) return;

    const target = state.entries[targetIndex];
    internal.update((s) => ({ ...s, index: targetIndex }));

    programmaticNavigation = true;
    // 順序は selected_type を先にしておく。読み込み側 (ui.ts) は両方の変更を
    // microtask で 1 回にまとめてさばくため、どちらが先でも結果は同じだが
    // type が先のほうが「同 type 内での id 切替」と一貫した順序になる。
    selected_type.set(target.selectedType);
    selected_id.set(target.selectedId);
  }

  return {
    subscribe: internal.subscribe,
    init: () => {
      if (initialized) return;
      initialized = true;
      // 起動時の type/id 初期化を最初の履歴エントリとして拾う。
      selected_type.subscribe(queueRecord);
      selected_id.subscribe(queueRecord);
    },
    back: () => {
      // 直前のユーザ遷移が microtask 待ちで未記録のまま戻る/進むが押されることがある。
      // 先に flush して履歴ヘッドを最新にしてから index を動かす。
      flushPendingRecord();
      navigateTo(get(internal).index - 1);
    },
    forward: () => {
      flushPendingRecord();
      navigateTo(get(internal).index + 1);
    },
    reset: () => {
      internal.set({ entries: [], index: -1 });
      recordQueued = false;
      programmaticNavigation = false;
    },
  };
}

// eslint-disable-next-line prefer-const
export let navigation_history: NavigationHistoryStore = createNavigationHistory();

/** 戻る操作が可能か。Header の戻るボタン disabled 判定に使う。 */
export const canGoBack: Readable<boolean> = derived(navigation_history, (state) => state.index > 0);

/** 進む操作が可能か。Header の進むボタン disabled 判定に使う。 */
export const canGoForward: Readable<boolean> = derived(
  navigation_history,
  (state) => state.index >= 0 && state.index < state.entries.length - 1
);
