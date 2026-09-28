import { derived, get, readable, writable, type Readable } from "svelte/store";
import * as platform from "@lib/ipc/platform";
import { saveStatus } from "@stores/save_status";
import { toUserError, userErrorMessage } from "@lib/utils/error_messages";
import { showNotice } from "@stores/notice";
import { describeHistoryStep } from "@features/workspace/utils/graph_change";
import type {
  GraphCommandOrigin,
  WorkspaceGraph,
  WorkspaceGraphCommand,
} from "@app-types/workspace_graph";

interface GraphStoreState {
  graph: WorkspaceGraph | null;
  workspacePath: string | null;
  loading: boolean;
  error: string | null;
}

const state = writable<GraphStoreState>({
  graph: null,
  workspacePath: null,
  loading: false,
  error: null,
});
let operation = Promise.resolve<unknown>(undefined);
let generation = 0;

/**
 * 条件を満たすときだけ状態を置き換える。
 *
 * `state.update(() => current)` と書くと、中身が同じでも Svelte のストアは
 * オブジェクトを「変わった」とみなして購読者へ通知し、ツリーの射影が
 * 丸ごと作り直される。何もしないときは通知そのものを出さない。
 */
function replaceIf(next: (current: GraphStoreState) => GraphStoreState | null) {
  const current = get(state);
  const replacement = next(current);
  if (replacement && replacement !== current) state.set(replacement);
}

platform.onWorkspaceGraphUpdated((event) => {
  replaceIf((current) =>
    current.workspacePath === event.workspacePath &&
    (!current.graph || event.graph.revision > current.graph.revision)
      ? { ...current, graph: event.graph, error: null }
      : null
  );
});

/** `select` の結果が同じオブジェクトなら通知しない派生ストア。 */
function distinct<T>(select: (value: GraphStoreState) => T): Readable<T> {
  return readable(select(get(state)), (set) => {
    // 購読が始まった時点の値を渡す（作った時点の値のままにしない）。
    let last = select(get(state));
    set(last);
    return state.subscribe((value) => {
      const next = select(value);
      if (next !== last) {
        last = next;
        set(next);
      }
    });
  });
}

/**
 * 書き込み操作を 1 本の列に並べる。ヘッダーの保存状態もここで知らせる
 * （書き込み中 → 保存済み、失敗したら保存失敗）。
 */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  const next = operation
    .catch(() => undefined)
    .then(async () => {
      const before = get(saveStatus);
      saveStatus.set("writing");
      try {
        const result = await fn();
        saveStatus.set("saved");
        return result;
      } catch (error) {
        // 入力が受け付けられなかっただけならファイルは変わっていないので、
        // 保存状態は操作の前に戻す。本当に書けなかったときだけ保存失敗。
        const userError = toUserError(error);
        saveStatus.set(userError.rejected ? (before === "writing" ? "saved" : before) : "error");
        throw userError;
      }
    });
  operation = next;
  return next;
}

export const workspace_graph = distinct(($state) => $state.graph);

/**
 * 元に戻す / やり直しが実際に効くか。main プロセスが graph に添えてくる
 * 履歴の段数から導出する。`history` が来ない経路（古いキャッシュなど）では
 * 判定できないので、従来どおり有効として扱う。
 */
export const can_undo_graph = derived(state, ($state) =>
  $state.graph?.history ? $state.graph.history.undo > 0 : Boolean($state.graph)
);
export const can_redo_graph = derived(state, ($state) =>
  $state.graph?.history ? $state.graph.history.redo > 0 : Boolean($state.graph)
);

export const workspace_graph_store = {
  subscribe: state.subscribe,
  async load(workspacePath: string) {
    const loadGeneration = ++generation;
    state.set({ graph: null, workspacePath, loading: true, error: null });
    try {
      const graph = await platform.wsReadGraph(workspacePath);
      if (loadGeneration === generation) {
        state.update((current) =>
          current.workspacePath === workspacePath &&
          current.graph &&
          current.graph.revision > graph.revision
            ? { ...current, loading: false, error: null }
            : { graph, workspacePath, loading: false, error: null }
        );
      }
      return graph;
    } catch (error) {
      const message = userErrorMessage(error);
      if (loadGeneration === generation) {
        state.update((current) => ({ ...current, graph: null, loading: false, error: message }));
      }
      throw error;
    }
  },
  execute(
    command: WorkspaceGraphCommand,
    origin: GraphCommandOrigin = "graph",
    targetWorkspacePath?: string
  ) {
    const callSnapshot = get(state);
    const callGeneration = generation;
    return run(async () => {
      const workspacePath = targetWorkspacePath ?? callSnapshot.workspacePath;
      if (!workspacePath) throw new Error("No workspace graph is loaded");
      const latest = get(state);
      const graph =
        latest.workspacePath === workspacePath && callGeneration === generation && latest.graph
          ? latest.graph
          : await platform.wsReadGraph(workspacePath);
      try {
        const result = await platform.wsExecuteGraphCommand(
          workspacePath,
          command,
          origin,
          graph.revision
        );
        applyResult(workspacePath, callGeneration, result.graph);
        return result;
      } catch (error) {
        await handleGraphError(workspacePath, callGeneration, error);
        throw error;
      }
    });
  },
  /** `quiet` は通知を出さない（作成の取り消しなど、利用者が戻したと思っていない段）。 */
  undo({ quiet = false }: { quiet?: boolean } = {}) {
    return history("undo", quiet);
  },
  redo() {
    return history("redo");
  },
};

function history(direction: "undo" | "redo", quiet = false) {
  const callSnapshot = get(state);
  const callGeneration = generation;
  return run(async () => {
    const workspacePath = callSnapshot.workspacePath;
    if (!workspacePath) throw new Error("No workspace graph is loaded");
    const latest = get(state);
    const graph =
      latest.workspacePath === workspacePath && callGeneration === generation && latest.graph
        ? latest.graph
        : await platform.wsReadGraph(workspacePath);
    try {
      const result =
        direction === "undo"
          ? await platform.wsUndoGraph(workspacePath, graph.revision)
          : await platform.wsRedoGraph(workspacePath, graph.revision);
      applyResult(workspacePath, callGeneration, result.graph);
      // 何が戻ったのかは画面のどこにも出ないので、変わったノードの名前で知らせる。
      // 起動し直しても履歴は残るので、思わぬ段を戻したことに気づけるように。
      if (!quiet) showNotice(describeHistoryStep(direction, graph, result.graph));
      return result;
    } catch (error) {
      await handleGraphError(workspacePath, callGeneration, error);
      throw error;
    }
  });
}

function applyResult(workspacePath: string, operationGeneration: number, graph: WorkspaceGraph) {
  replaceIf((current) =>
    current.workspacePath === workspacePath &&
    operationGeneration === generation &&
    (!current.graph || graph.revision > current.graph.revision)
      ? { ...current, graph, error: null }
      : null
  );
}

async function handleGraphError(
  workspacePath: string,
  operationGeneration: number,
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/changed|conflict|revision/i.test(message)) return;
  try {
    const latest = await platform.wsReadGraph(workspacePath);
    state.update((current) =>
      current.workspacePath === workspacePath && operationGeneration === generation
        ? {
            ...current,
            graph:
              current.graph && current.graph.revision > latest.revision ? current.graph : latest,
            loading: false,
            error: message,
          }
        : current
    );
  } catch {
    state.update((current) =>
      current.workspacePath === workspacePath && operationGeneration === generation
        ? { ...current, error: message }
        : current
    );
  }
}
