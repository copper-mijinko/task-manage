import { get, writable } from "svelte/store";

/** View state belongs to the workspace/scope, never to a saved graph record. */
export function createExpansionState(tree, scope, workspacePath) {
  const state = writable(new Set());
  const key = () => `task-manage:treegrid:${workspacePath}:${get(scope)}:closed`;
  const unsubscribe = scope.subscribe(() => {
    try {
      state.set(new Set(JSON.parse(localStorage.getItem(key()) || "[]")));
    } catch {
      state.set(new Set());
    }
  });
  function set(paths) {
    state.set(paths);
    localStorage.setItem(key(), JSON.stringify([...paths]));
  }
  const change = (fn) => {
    const paths = new Set(get(state));
    fn(paths);
    set(paths);
  };
  return {
    subscribe: state.subscribe,
    set,
    dispose: unsubscribe,
    add: (path) => change((paths) => paths.add(path)),
    delete: (path) => change((paths) => paths.delete(path)),
    expandAll: () => set(new Set()),
    collapseAll: () => {
      const paths = new Set();
      const visit = (node, parent = "") => {
        const path = parent ? `${parent}/${node.id}` : node.id;
        if (node.children.length) paths.add(path);
        node.children.forEach((child) => visit(child, path));
      };
      if (get(tree)?.data) visit(get(tree).data);
      set(paths);
    },
    expandNodeEverywhere: (id) =>
      change((paths) => {
        for (const path of paths) if (path.split("/").at(-1) === id) paths.delete(path);
      }),
    rekey: (oldPath, newPath) =>
      change((paths) => {
        for (const path of [...paths])
          if (path === oldPath || path.startsWith(oldPath + "/")) {
            paths.delete(path);
            paths.add(newPath + path.slice(oldPath.length));
          }
      }),
  };
}
