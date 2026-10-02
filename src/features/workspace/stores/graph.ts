import { derived, get, readable, writable, type Readable } from "svelte/store";
import * as platform from "@lib/ipc/platform";
import { saveStatus } from "@stores/save_status";
import { toUserError, userErrorMessage } from "@lib/utils/error_messages";
import { showNotice } from "@stores/notice";
import { describeHistoryStep } from "@features/workspace/utils/graph_change";
import { filter } from "@features/search/stores/search";
import type {
  GraphCommandOrigin,
  WorkspaceGraph,
  WorkspaceGraphCommand,
  WorkspaceGraphDelta,
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
 * 全ノードの本文。読み込みでは本文を読まない（`bodyLoaded: false`）ので、本文の検索や
 * 全メモの形式変換のように、全ノードの本文が要るときだけまとめて読んで、ここに置く。
 * 1 つのノードの本文は、開いたときに `application.loadBody` が読む。
 */
export interface NodeBody {
  body: unknown;
  format: string;
}
export const node_bodies = writable<Record<string, NodeBody>>({});
/**
 * 全ノードの本文を読んでいる最中か（`loading`）、読めなかったか（`error`）。本文の検索は、
 * 読み終わるまで結果（件数）が確定しないので、画面に出して知らせる。
 */
export const bodies_status = writable<"idle" | "loading" | "error">("idle");
/**
 * 読み込みが `BODIES_SLOW_MS` を超えて続いているか。速い読み込みで「読み込み中」の表示が
 * 一瞬だけ出て消える（ちらつく）のを避けるため、表示はこちらを使う。
 */
export const BODIES_SLOW_MS = 250;
export const bodies_slow = writable(false);
let slowTimer: ReturnType<typeof setTimeout> | undefined;
function stopSlowTimer() {
  clearTimeout(slowTimer);
  slowTimer = undefined;
  bodies_slow.set(false);
}
/** 読んだ本文が古くなった（ワークスペースを読み込み直した）ときに増える。 */
export const bodies_epoch = writable(0);
let bodiesKey = "";
let bodiesPending: Promise<Record<string, NodeBody>> | undefined;

function clearNodeBodies() {
  stopSlowTimer();
  bodies_status.set("idle");
  bodies_epoch.update((epoch) => epoch + 1);
  node_bodies.set({});
  bodiesKey = "";
  bodiesPending = undefined;
}

/** 全ノードの本文を読む（読んだものは、ワークスペースを読み直すまで持つ）。 */
export function ensureAllBodies(): Promise<Record<string, NodeBody>> {
  const workspacePath = get(state).workspacePath;
  if (!workspacePath) return Promise.resolve({});
  const key = `${workspacePath}\0${generation}`;
  if (bodiesKey === key && bodiesPending) return bodiesPending;
  bodiesKey = key;
  bodies_status.set("loading");
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => {
    if (bodiesKey === key && get(bodies_status) === "loading") bodies_slow.set(true);
  }, BODIES_SLOW_MS);
  const pending = platform
    .wsReadAllNodeBodies(workspacePath)
    .then((bodies) => {
      if (bodiesKey === key) {
        node_bodies.set(bodies);
        stopSlowTimer();
        bodies_status.set("idle");
      }
      return bodies;
    })
    .catch((error) => {
      // 読めなかったら、次に必要になったときにもう一度読む。
      if (bodiesKey === key) {
        bodiesKey = "";
        stopSlowTimer();
        bodies_status.set("error");
      }
      throw error;
    });
  bodiesPending = pending;
  return pending;
}

/** 本文の検索がオンか。 */
const bodySearchOn = () => (get(filter)?.search_memo?.length ?? 0) > 0;

/**
 * 差分で本文を持つノード（編集の結果）は、本文を読んだものを捨てる。本文を持たない
 * ノードが増えたとき（作成の取り消しなど）は、本文の検索がオンなら読み直す。
 */
function syncBodiesWithDelta(delta: WorkspaceGraphDelta) {
  const dropped: string[] = [];
  let unread = false;
  for (const [id, node] of Object.entries(delta.nodes)) {
    if (node === null || node.bodyLoaded !== false) dropped.push(id);
    else unread = true;
  }
  if (dropped.length > 0) {
    const current = get(node_bodies);
    if (dropped.some((id) => id in current)) {
      const next = { ...current };
      for (const id of dropped) delete next[id];
      node_bodies.set(next);
    }
  }
  if (unread && bodySearchOn()) {
    bodiesKey = "";
    void ensureAllBodies().catch(() => {});
  }
}

// 本文の検索をオンにしたら、全ノードの本文を読む。
filter.subscribe(() => {
  if (bodySearchOn() && get(state).graph) void ensureAllBodies().catch(() => {});
});

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

/** main の結果・通知にある、全体（`graph`）か差分（`delta`）。 */
interface GraphPayload {
  graph?: WorkspaceGraph;
  delta?: WorkspaceGraphDelta | null;
}

/** 持っているグラフに差分を当てて、新しいグラフを作る（ノードの表だけを浅く写す）。 */
export function applyGraphDelta(graph: WorkspaceGraph, delta: WorkspaceGraphDelta): WorkspaceGraph {
  const nodes = { ...graph.nodes };
  for (const [id, node] of Object.entries(delta.nodes)) {
    if (node === null) delete nodes[id];
    else nodes[id] = node;
  }
  const next: WorkspaceGraph = {
    ...graph,
    nodes,
    revision: delta.revision,
    history: delta.history,
  };
  const fields = delta.fields ?? {};
  if ("inboxId" in fields) {
    if (fields.inboxId) next.inboxId = fields.inboxId;
    else delete next.inboxId;
  }
  if ("positions" in fields) {
    if (fields.positions) next.positions = fields.positions;
    else delete next.positions;
  }
  return next;
}

/**
 * main の結果・通知から、新しいグラフを求める。
 * `undefined` は「当てられない」（まだグラフが無い・間の更新を取りこぼした）こと。
 */
function graphFromPayload(
  current: WorkspaceGraph | null,
  payload: GraphPayload
): WorkspaceGraph | undefined {
  if (payload.graph) return payload.graph;
  const delta = payload.delta;
  if (!delta) return current ?? undefined;
  if (!current) return undefined;
  // もう持っている（自分の操作の結果が、通知より先に届いたときなど）。
  if (delta.revision <= current.revision) return current;
  if (delta.baseRevision !== current.revision) return undefined;
  syncBodiesWithDelta(delta);
  return applyGraphDelta(current, delta);
}

/** 全体を読み直して、新しければ置き換える。差分が当てられなかったときの立て直し。 */
async function resync(workspacePath: string, operationGeneration: number) {
  try {
    const graph = await platform.wsReadGraph(workspacePath);
    replaceIf((current) =>
      current.workspacePath === workspacePath &&
      operationGeneration === generation &&
      (!current.graph || graph.revision > current.graph.revision)
        ? { ...current, graph, error: null }
        : null
    );
    return graph;
  } catch {
    // 次の操作（または読み込み）で改めて読み直される。
    return undefined;
  }
}

platform.onWorkspaceGraphUpdated((event) => {
  const current = get(state);
  if (current.workspacePath !== event.workspacePath) return;
  const next = graphFromPayload(current.graph, event);
  if (!next) {
    // 読み込み中なら、読み込みが最新を取ってくる。読み込み済みで抜けがあれば読み直す。
    if (current.graph) void resync(event.workspacePath, generation);
    return;
  }
  replaceIf((latest) =>
    latest.workspacePath === event.workspacePath &&
    (!latest.graph || next.revision > latest.graph.revision)
      ? { ...latest, graph: next, error: null }
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
    clearNodeBodies();
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
        const applied = await applyResult(workspacePath, callGeneration, result);
        return { ...result, graph: applied ?? result.graph };
      } catch (error) {
        await handleGraphError(workspacePath, callGeneration, error);
        throw error;
      }
    });
  },
  /**
   * ディスクから読み直す（ワークスペースのフォルダーを外で書き換えたとき）。
   * main は画面が持つリビジョンより大きな値で返すので、そのまま置き換えられる。
   */
  async reload(workspacePath: string) {
    const graph = await platform.wsReloadWorkspace(workspacePath);
    replaceIf((current) =>
      current.workspacePath === workspacePath &&
      (!current.graph || graph.revision >= current.graph.revision)
        ? { ...current, graph, loading: false, error: null }
        : null
    );
    // ディスクの内容に置き換わったので、読んでいた本文は古い。
    clearNodeBodies();
    if (bodySearchOn()) void ensureAllBodies().catch(() => {});
    return graph;
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
      const applied = await applyResult(workspacePath, callGeneration, result);
      // 何が戻ったのかは画面のどこにも出ないので、変わったノードの名前で知らせる。
      // 起動し直しても履歴は残るので、思わぬ段を戻したことに気づけるように。
      if (!quiet && applied) showNotice(describeHistoryStep(direction, graph, applied));
      return { ...result, graph: applied ?? result.graph };
    } catch (error) {
      await handleGraphError(workspacePath, callGeneration, error);
      throw error;
    }
  });
}

/**
 * 操作の結果を、いま持っているグラフに当てる。差分が当てられないときは全体を
 * 読み直す。返すのは、この結果を反映したグラフ。
 */
async function applyResult(
  workspacePath: string,
  operationGeneration: number,
  payload: GraphPayload
): Promise<WorkspaceGraph | undefined> {
  const snapshot = get(state);
  const inContext = snapshot.workspacePath === workspacePath && operationGeneration === generation;
  const next = inContext ? graphFromPayload(snapshot.graph, payload) : payload.graph;
  if (!next) return inContext ? resync(workspacePath, operationGeneration) : undefined;
  replaceIf((current) =>
    current.workspacePath === workspacePath &&
    operationGeneration === generation &&
    (!current.graph || next.revision > current.graph.revision)
      ? { ...current, graph: next, error: null }
      : null
  );
  return next;
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
