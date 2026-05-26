import { derived, get, writable, type Readable } from "svelte/store";
import type { SelectedType } from "@app-types/app";
import { workspace_store } from "@features/workspace/stores/workspace";
import { selected_id, selected_type, setPendingTaskDetailSelection, table_selected_id } from "./ui";

/**
 * 1 件の「ページ」エントリ。
 *
 * 「ページ」は本アプリでは `(selected_type, selected_id)` を主軸に、
 * Workspace 側の `activeWorkspacePath` / `activeProjectDir` を含めて
 * 一意に同定する。さらに「ページ内で選択していたタスク行」も
 * `tableSelectedId` として併せて保持し、戻ったときの TaskDetail / Memo の
 * コンテキストを復元する。
 *
 * - `Projects` / `WorkspaceProject` の `selectedId` は project root の id
 * - `Inbox` の `selectedId` は `INBOX_SELECTED_ID` センチネル
 * - `Info` の `selectedId` は info ページ id
 * - `projectDir` は `WorkspaceProject` のときのみ意味があり、それ以外では null
 * - `workspacePath` は `WorkspaceProject` / `Projects` 系で意味があり、Inbox/Info でも参考値として持つ（復元時は WorkspaceProject のときだけ反映）
 * - `tableSelectedId` は `Projects` / `WorkspaceProject` のときのみ意味があり、ページ内のタスク行選択を表す
 */
export interface NavigationEntry {
  selectedType: SelectedType;
  selectedId: string | undefined;
  projectDir: string | null;
  workspacePath: string | null;
  tableSelectedId: string | undefined;
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
  /**
   * 「ユーザがタスク行を能動的に選択した」と分かっている呼び出し元から
   * 同ページ内のタスク行切替を 1 エントリとして履歴に積むためのフック。
   *
   * 通常の subscriber 経路では同ページ内の `table_selected_id` 変更は
   * in-place 更新（履歴を伸ばさない）として扱う。これは load 完了直後の
   * 自動 selectOnly や clearSelection といった transient な変更が
   * 履歴を肥らせるのを防ぐためで、結果としてユーザのクリックも履歴に
   * 残らなくなる。クリックハンドラ側から本メソッドを呼ぶことで、
   * 「これは能動的な選択である」というシグナルを与え、明示的に push する。
   *
   * 直前エントリと完全一致する状態であれば no-op。
   */
  pushSelection: () => void;
  /** テスト用のリセットフック。本体コードからは呼ばない。 */
  reset: () => void;
}

/** 履歴の最大長。これを超える分は古い側から捨てる。 */
const MAX_HISTORY = 100;

/**
 * ページとしての同一性を判定する。`tableSelectedId` はページ内選択なので
 * 含めない（同じページ内のタスク選択切替で履歴を増やさない）。
 */
function pageEqual(a: NavigationEntry, b: NavigationEntry): boolean {
  return (
    a.selectedType === b.selectedType &&
    a.selectedId === b.selectedId &&
    a.projectDir === b.projectDir &&
    a.workspacePath === b.workspacePath
  );
}

function isEmptyEntry(entry: NavigationEntry): boolean {
  return entry.selectedType === undefined && entry.selectedId === undefined;
}

function createNavigationHistory(): NavigationHistoryStore {
  const internal = writable<NavigationHistoryState>({ entries: [], index: -1 });

  let initialized = false;
  let recordQueued = false;
  /**
   * back/forward 実行中に「target ページに着地するまで」を表す。
   * - 設定されている間：commitRecord は entries を更新しない（target の
   *   tableSelectedId を transient な undefined で上書きしてしまうのを防ぐ）。
   * - pageEqual で着地が確認できた時点でクリアする。
   * - 着地前にユーザが別ページへ移動したら（pageEqual が崩れたら）クリアして
   *   通常記録に戻す。
   */
  let pendingNavigation: NavigationEntry | null = null;

  function currentEntry(): NavigationEntry {
    const type = get(selected_type);
    const ws = get(workspace_store);
    return {
      selectedType: type,
      selectedId: get(selected_id),
      projectDir: type === "WorkspaceProject" ? (ws.activeProjectDir ?? null) : null,
      workspacePath: ws.activeWorkspacePath ?? null,
      tableSelectedId: get(table_selected_id),
    };
  }

  function commitRecord() {
    const entry = currentEntry();

    if (pendingNavigation !== null) {
      if (pageEqual(entry, pendingNavigation)) {
        // ターゲットページに着地した。entries[index] には navigateTo 時点で
        // セット済みの正しい tableSelectedId が入っているので触らない。
        // pendingTaskDetailSelection 経由で loader が tableSelectedId を反映
        // するのはこの後の async load 完了時。それは通常の commitRecord 経路
        // で entries[index].tableSelectedId と比較され、合致するため no-op。
        pendingNavigation = null;
        return;
      }
      // pageEqual が崩れた = ユーザが target を待たずに別ページへ移動した。
      // 待つのをやめて通常記録に進む。
      pendingNavigation = null;
    }

    if (isEmptyEntry(entry)) {
      // 起動直後 / プロジェクト削除直後など、選択なし状態は履歴に積まない。
      return;
    }

    internal.update((state) => {
      const current = state.entries[state.index];
      if (current && pageEqual(current, entry)) {
        // 同じページ内の subscriber 経由の commitRecord は基本的に
        // 「ロード完了で tableSelectedId が決まった」という fill-in イベント
        // を取り込むためにだけ使う。current.tableSelectedId が未定 (undefined)
        // のときに entry 側で定まった値が来たら 1 回だけ in-place 更新する。
        //
        // それ以外（current 側に既に値があるとき）は in-place 更新しない。
        // pushSelection で積まれたユーザ選択を後続の transient な変更で
        // 上書きしないため。
        if (current.tableSelectedId === undefined && entry.tableSelectedId !== undefined) {
          const updated = state.entries.slice();
          updated[state.index] = entry;
          return { ...state, entries: updated };
        }
        return state;
      }
      // 新しいページへの遷移。index より先（forward 履歴）は失う。
      // ページ切替時点の table_selected_id は旧ページの値が残っているのが
      // 通常で（clearSelection はこの microtask の後に走る）、新しい
      // ページのエントリに古い値を混ぜないため、tableSelectedId は undefined
      // にして push する。ロード完了後の selectOnly で上の fill-in 経路に
      // 乗って埋められる。
      const truncated = state.entries.slice(0, state.index + 1);
      truncated.push({ ...entry, tableSelectedId: undefined });
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
    const current = currentEntry();
    internal.update((s) => ({ ...s, index: targetIndex }));

    pendingNavigation = target;

    // 同じページ内での移動（tableSelectedId だけが違う）は selected_id を
    // 動かさないので loader が起動しない。代わりに table_selected_id を
    // 直接巻き戻す。workspace 系はすべて同値で no-op になる。
    if (pageEqual(current, target)) {
      table_selected_id.set(target.tableSelectedId);
      return;
    }

    // ページ自体が変わるナビゲーション。ページ内のタスク行も復元したい場合、
    // loader が読みに行く pendingTaskDetailSelection にヒントを置く。
    // `tableSelectedId` が未定義のときは触らない（loader は
    // selectOnly(undefined) に倒す）。
    if (
      (target.selectedType === "Projects" || target.selectedType === "WorkspaceProject") &&
      target.selectedId &&
      target.tableSelectedId
    ) {
      setPendingTaskDetailSelection({
        projectId: target.selectedId,
        taskId: target.tableSelectedId,
        selectedType: target.selectedType,
        projectDir: target.projectDir,
      });
    } else {
      setPendingTaskDetailSelection(undefined);
    }

    // activeWorkspacePath を先に戻す。workspace_store.setActive は disk から
    // projects 一覧を再読込する async 関数で、その間 activeWorkspacePath は
    // 旧値のまま。サイドバーの projects 表示は遅延更新になるが、
    // tree の読み込みは activeProjectDir に直接依存するため問題ない。
    const currentWorkspacePath = get(workspace_store).activeWorkspacePath ?? null;
    if (target.workspacePath && target.workspacePath !== currentWorkspacePath) {
      // fire-and-forget。失敗しても画面遷移自体は進む。
      void workspace_store.setActive(target.workspacePath);
    }

    // WorkspaceProject の場合は activeProjectDir を選択 store より先に戻す。
    // MenuList.selectWorkspaceProject() と同じ順序にしておかないと
    // selected_id の subscriber (loadWorkspaceData) が古い activeProjectDir
    // を読んで、他プロジェクトのタスクから unknown ノードを作ってしまう。
    if (target.selectedType === "WorkspaceProject" && target.projectDir) {
      workspace_store.setActiveProject(target.projectDir);
    }
    // 順序は selected_type を先にしておく。読み込み側 (ui.ts) は両方の変更を
    // microtask で 1 回にまとめてさばくため、どちらが先でも結果は同じだが
    // type が先のほうが「同 type 内での id 切替」と一貫した順序になる。
    selected_type.set(target.selectedType);
    selected_id.set(target.selectedId);
  }

  function pushSelection() {
    const entry = currentEntry();
    if (isEmptyEntry(entry)) return;

    internal.update((state) => {
      const current = state.entries[state.index];
      if (
        current &&
        pageEqual(current, entry) &&
        current.tableSelectedId === entry.tableSelectedId
      ) {
        // 既に同じ状態が積まれている。重複しない。
        return state;
      }
      const truncated = state.entries.slice(0, state.index + 1);
      truncated.push(entry);
      const overflow = truncated.length - MAX_HISTORY;
      if (overflow > 0) {
        truncated.splice(0, overflow);
      }
      return { entries: truncated, index: truncated.length - 1 };
    });

    // pushSelection の直後に subscriber 経由の commitRecord が microtask で
    // 走るが、その時点では state は既に entries[last] と一致しているため
    // no-op になる。ここでフラグを下ろしておくのは不要。
  }

  return {
    subscribe: internal.subscribe,
    init: () => {
      if (initialized) return;
      initialized = true;
      // ページ主軸 + サブ軸の各 store を購読し、microtask で 1 回にコアレスする。
      selected_type.subscribe(queueRecord);
      selected_id.subscribe(queueRecord);
      table_selected_id.subscribe(queueRecord);
      workspace_store.subscribe(queueRecord);
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
    pushSelection,
    reset: () => {
      internal.set({ entries: [], index: -1 });
      recordQueued = false;
      pendingNavigation = null;
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
