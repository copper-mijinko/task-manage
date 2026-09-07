import { derived, get, writable } from "svelte/store";
import * as platform from "@lib/ipc/platform";
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

platform.onWorkspaceGraphUpdated((event) => {
  state.update((current) =>
    current.workspacePath === event.workspacePath &&
    (!current.graph || event.graph.revision > current.graph.revision)
      ? { ...current, graph: event.graph, error: null }
      : current
  );
});

async function run<T>(fn: () => Promise<T>): Promise<T> {
  const next = operation.catch(() => undefined).then(fn);
  operation = next;
  return next;
}

export const workspace_graph = derived(state, ($state) => $state.graph);

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
      const message = error instanceof Error ? error.message : String(error);
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
  undo() {
    return history("undo");
  },
  redo() {
    return history("redo");
  },
};

function history(direction: "undo" | "redo") {
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
      return result;
    } catch (error) {
      await handleGraphError(workspacePath, callGeneration, error);
      throw error;
    }
  });
}

function applyResult(workspacePath: string, operationGeneration: number, graph: WorkspaceGraph) {
  state.update((current) =>
    current.workspacePath === workspacePath &&
    operationGeneration === generation &&
    (!current.graph || graph.revision > current.graph.revision)
      ? { ...current, graph, error: null }
      : current
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
