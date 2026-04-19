import { debounce, throttle } from "lodash";
import _ from "lodash";
import { get, writable, type Writable } from "svelte/store";
import { THEME_DARK, THEME_LIGHT } from "./common/theme";
import {
  filterTree,
  getDefaultProject,
  getNode,
  type ProjectData,
  type TreeData,
} from "./common/tree_control";
import type {
  FilterState,
  PendingTaskDetailSelection,
  ProjectListItem,
  SelectedType,
  ThemeName,
} from "./types/app";

type ThemePalette = {
  [key: string]: string | ThemePalette;
};

interface ProjectIdsStore extends Writable<ProjectListItem[] | undefined> {
  init: () => void;
  addProject: () => void;
  deleteProject: (projectId: string) => void;
  setProjectOrder: (projects: ProjectListItem[]) => void;
}

interface TreeDataStore extends Writable<ProjectData | undefined> {
  init: () => void;
}

interface SelectedIdStore extends Writable<string | undefined> {
  init: () => void;
}

interface ThemeStore extends Writable<ThemeName | undefined> {
  init: () => void;
}

interface FilterStore extends Writable<FilterState> {
  init: () => void;
}

interface ClosedNodeIdsStore extends Writable<Set<string>> {
  init: () => void;
  add: (nodeId: string) => void;
  delete: (nodeId: string) => void;
  cleanupNodeMetadata: (nodeId: string) => void;
}

const currentHash =
  typeof window !== "undefined" ? window.location.hash : "";
const currentSearch =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
const isTaskDetailWindow = currentHash === "#task-detail-window";
const detailProjectId = currentSearch.get("projectId") || undefined;
const detailTaskId = currentSearch.get("taskId") || undefined;
let pendingTaskDetailSelection: PendingTaskDetailSelection | undefined =
  isTaskDetailWindow && detailProjectId && detailTaskId
    ? { projectId: detailProjectId, taskId: detailTaskId }
    : undefined;

function clearPendingTaskDetailSelection() {
  pendingTaskDetailSelection = undefined;
}

function isThemeName(value: unknown): value is ThemeName {
  return value === "dark" || value === "light";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export const info_ids = writable<ProjectListItem[]>([
  { id: "9ba28822-6240-4280-9da3-63ac6b8356a6", name: "Usage" },
]);

// eslint-disable-next-line prefer-const
export let project_ids: ProjectIdsStore;
// eslint-disable-next-line prefer-const
export let tree_data: TreeDataStore;
// eslint-disable-next-line prefer-const
export let selected_type: Writable<SelectedType>;
// eslint-disable-next-line prefer-const
export let table_selected_id: Writable<string | undefined>;
// eslint-disable-next-line prefer-const
export let closed_node_ids: ClosedNodeIdsStore;
// eslint-disable-next-line prefer-const
export let selected_id: SelectedIdStore;
// eslint-disable-next-line prefer-const
export let theme: ThemeStore;
// eslint-disable-next-line prefer-const
export let filter: FilterStore;
// eslint-disable-next-line prefer-const
export let filtered_data: Writable<TreeData | null | undefined>;

export function setTaskDetailWindowTarget(projectId: string, taskId: string) {
  if (!projectId || !taskId) {
    pendingTaskDetailSelection = undefined;
    return;
  }

  pendingTaskDetailSelection = { projectId, taskId };
  selected_type.set("Projects");
  selected_id.set(projectId);
}

function createProjectIds(
  initialValue: ProjectListItem[] | undefined,
): ProjectIdsStore {
  const { subscribe, set, update } = writable<ProjectListItem[] | undefined>(
    initialValue,
  );
  let projectDeleteListenerRegistered = false;

  return {
    subscribe,
    set,
    update,
    init: () => {
      if (
        !projectDeleteListenerRegistered &&
        window.electronAPI?.onProjectDeleted
      ) {
        projectDeleteListenerRegistered = true;
        window.electronAPI.onProjectDeleted((deletedProjectId) => {
          window.electronAPI.getProjectIDs().then((result) => {
            set(result);
          });

          if (pendingTaskDetailSelection?.projectId === deletedProjectId) {
            clearPendingTaskDetailSelection();
          }

          if (deletedProjectId === get(selected_id)) {
            selected_type.set(undefined);
            selected_id.set(undefined);
            table_selected_id.set(undefined);
            filtered_data.set(undefined);
            closed_node_ids.set(new Set());
          }
        });
      }

      subscribe((current) => {
        if (current === undefined) {
          window.electronAPI.getProjectIDs().then((result) => {
            set(result);
          });
        }

        if (!current || current.length === 0) {
          selected_type.set(undefined);
          table_selected_id.set(undefined);
          closed_node_ids.update(() => new Set());
        }
      });
    },
    addProject: () => {
      const newProject = getDefaultProject();
      window.electronAPI.addProject(newProject);
      window.electronAPI.getProjectIDs().then((result) => {
        set(result);
      });
    },
    deleteProject: (projectId: string) => {
      window.electronAPI.deleteProject(projectId);
      window.electronAPI.getProjectIDs().then((result) => {
        set(result);
      });

      const metaKey = `closed_nodes_${projectId}`;
      window.electronAPI.deleteMetaData(metaKey);

      if (projectId === get(selected_id)) {
        selected_type.set(undefined);
        selected_id.set(undefined);
      }
    },
    setProjectOrder: (projects: ProjectListItem[]) => {
      window.electronAPI.setProjectOrder(projects);
    },
  };
}

function createTreeData(initialValue: ProjectData | undefined): TreeDataStore {
  const { subscribe, set, update } = writable<ProjectData | undefined>(
    initialValue,
  );
  let previousData: ProjectData | null = null;
  let skipPersistOnce = false;
  let syncListenerRegistered = false;

  const findRemovedNodeIds = (
    oldData: ProjectData | null | undefined,
    newData: ProjectData | null | undefined,
  ): string[] => {
    if (!oldData || !newData) return [];

    const collectNodeIds = (node: TreeData | undefined): string[] => {
      if (!node) return [];

      const ids = [node.id];
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          ids.push(...collectNodeIds(child));
        }
      }

      return ids;
    };

    const oldIds = oldData.data ? collectNodeIds(oldData.data) : [];
    const newIds = newData.data ? collectNodeIds(newData.data) : [];
    return oldIds.filter((id) => !newIds.includes(id));
  };

  const persistTreeData = throttle((current: ProjectData | undefined) => {
    if (!current) {
      return;
    }

    if (skipPersistOnce) {
      skipPersistOnce = false;
      previousData = _.cloneDeep(current);
      filter.set(get(filter));
      window.electronAPI.getProjectIDs().then((result) => {
        project_ids.set(result);
      });
      return;
    }

    if (previousData) {
      const removedIds = findRemovedNodeIds(previousData, current);
      if (removedIds.length > 0) {
        const projectId = get(selected_id);
        if (projectId) {
          closed_node_ids.update((currentState) => {
            const newState = new Set(currentState);
            removedIds.forEach((id) => {
              newState.delete(id);
            });

            const metaKey = `closed_nodes_${projectId}`;
            const idsArray = Array.from(newState);
            window.electronAPI.setMetaData(metaKey, idsArray);

            return newState;
          });
        }
      }
    }

    previousData = _.cloneDeep(current);
    filter.set(get(filter));
    window.electronAPI.setTreeData(current);
    window.electronAPI.getProjectIDs().then((result) => {
      project_ids.set(result);
    });
  }, 1000);

  return {
    subscribe,
    set,
    update,
    init: () => {
      if (
        !syncListenerRegistered &&
        window.electronAPI?.onTreeDataUpdated
      ) {
        syncListenerRegistered = true;
        window.electronAPI.onTreeDataUpdated((nextTreeData) => {
          if (!nextTreeData) {
            return;
          }

          const currentSelectedType = get(selected_type);
          const currentSelectedId = get(selected_id);
          const shouldSyncCurrentProject =
            currentSelectedType === "Projects" &&
            currentSelectedId === nextTreeData.data?.id;
          const shouldSyncTaskDetailWindow =
            pendingTaskDetailSelection?.projectId === nextTreeData.data?.id;

          if (!shouldSyncCurrentProject && !shouldSyncTaskDetailWindow) {
            return;
          }

          skipPersistOnce = true;
          set(nextTreeData);

          if (
            shouldSyncTaskDetailWindow &&
            pendingTaskDetailSelection?.taskId
          ) {
            if (
              getNode(
                pendingTaskDetailSelection.taskId,
                nextTreeData.data,
              )
            ) {
              table_selected_id.set(pendingTaskDetailSelection.taskId);
            } else {
              clearPendingTaskDetailSelection();
              table_selected_id.set(undefined);
            }
          }
        });
      }

      subscribe((current) => {
        if (current === undefined) {
          if (pendingTaskDetailSelection?.projectId) {
            selected_type.set("Projects");
            selected_id.set(pendingTaskDetailSelection.projectId);
            if (pendingTaskDetailSelection.taskId) {
              table_selected_id.set(pendingTaskDetailSelection.taskId);
            }
          } else {
            window.electronAPI.getInitialTreeData().then((result) => {
              selected_type.set("Projects");
              if (result !== undefined) {
                selected_id.set(result.data.id);
              }
            });
          }
        }

        persistTreeData(current);
      });
    },
  };
}

function createSelectedID(initialValue: string | undefined): SelectedIdStore {
  const { subscribe, set, update } = writable<string | undefined>(initialValue);

  return {
    subscribe,
    set,
    update,
    init: () => {
      subscribe((current) => {
        const currentSelectedType = get(selected_type);
        if (currentSelectedType === "Projects" && current) {
          window.electronAPI.getTreeData(current).then((result) => {
            tree_data.set(result);

            if (
              pendingTaskDetailSelection?.projectId === current &&
              pendingTaskDetailSelection.taskId
            ) {
              if (
                result?.data &&
                getNode(pendingTaskDetailSelection.taskId, result.data)
              ) {
                table_selected_id.set(pendingTaskDetailSelection.taskId);
              } else {
                clearPendingTaskDetailSelection();
                table_selected_id.set(undefined);
              }
            } else {
              table_selected_id.set(undefined);
            }
          });
        }
      });
    },
  };
}

function createTheme(initialValue: ThemeName | undefined): ThemeStore {
  const { subscribe, set, update } = writable<ThemeName | undefined>(
    initialValue,
  );

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

function createFilter(initialValue: FilterState): FilterStore {
  const { subscribe, set, update } = writable<FilterState>(initialValue);

  const applyFilteredData = debounce(
    (current: FilterState, currentTreeData: ProjectData) => {
      const filtered = filterTree(currentTreeData.data, current);
      if (
        get(table_selected_id) &&
        filtered &&
        getNode(get(table_selected_id) as string, filtered)
      ) {
        ;
      } else {
        table_selected_id.set(undefined);
      }

      filtered_data.set(filtered);
    },
    300,
  );

  const hasActiveFilters = (current: FilterState) =>
    Object.keys(current || {}).some(
      (key) => current[key] && current[key].length > 0,
    );

  return {
    subscribe,
    set,
    update,
    init: () => {
      subscribe((current) => {
        const currentTreeData = get(tree_data);
        if (!currentTreeData) return;

        if (!hasActiveFilters(current)) {
          applyFilteredData.cancel();
          const nextTree = currentTreeData.data;
          if (
            get(table_selected_id) &&
            nextTree &&
            getNode(get(table_selected_id) as string, nextTree)
          ) {
            ;
          } else {
            table_selected_id.set(undefined);
          }

          filtered_data.set(nextTree);
          return;
        }

        applyFilteredData(current, currentTreeData);
      });
    },
  };
}

tree_data = createTreeData(undefined);

function collectNodeAndDescendantIds(node: TreeData | undefined): string[] {
  if (!node) return [];

  const ids = [node.id];
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      ids.push(...collectNodeAndDescendantIds(child));
    }
  }

  return ids;
}

function createClosedNodeIds(initialValue: Set<string>): ClosedNodeIdsStore {
  const projectExpandedStates = new Map<string, Set<string>>();
  const { subscribe, set, update } = writable<Set<string>>(
    initialValue || new Set(),
  );

  const loadState = async (projectId: string) => {
    if (!projectId) return undefined;

    try {
      const metaKey = `closed_nodes_${projectId}`;
      const result = await window.electronAPI.getMetaData(metaKey);

      const newState = isStringArray(result) ? new Set(result) : new Set<string>();
      projectExpandedStates.set(projectId, newState);
      set(newState);
      return newState;
    } catch {
      return new Set<string>();
    }
  };

  const saveState = (projectId: string, state: Set<string>) => {
    if (!projectId) return;

    try {
      const metaKey = `closed_nodes_${projectId}`;
      const idsArray = Array.from(state);
      window.electronAPI.setMetaData(metaKey, idsArray);
    } catch {
      // ignore save error
    }
  };

  return {
    subscribe,
    set,
    update,
    add: (nodeId: string) => {
      const projectId = get(selected_id);
      if (!projectId) return;

      update((currentState) => {
        const newState = new Set(currentState);
        newState.add(nodeId);
        projectExpandedStates.set(projectId, newState);
        saveState(projectId, newState);
        return newState;
      });
    },
    delete: (nodeId: string) => {
      const projectId = get(selected_id);
      if (!projectId) return;

      update((currentState) => {
        const newState = new Set(currentState);
        newState.delete(nodeId);
        projectExpandedStates.set(projectId, newState);
        saveState(projectId, newState);
        return newState;
      });
    },
    init: () => {
      selected_id.subscribe(async (projectId) => {
        if (projectId) {
          if (projectExpandedStates.has(projectId)) {
            set(projectExpandedStates.get(projectId) as Set<string>);
          } else {
            await loadState(projectId);
          }
        }
      });
    },
    cleanupNodeMetadata: (nodeId: string) => {
      const projectId = get(selected_id);
      const currentTreeData = get(tree_data);
      if (!projectId || !currentTreeData) return;

      const node = getNode(nodeId, currentTreeData.data);
      if (!node) return;

      const nodeIds = collectNodeAndDescendantIds(node);

      update((currentState) => {
        const newState = new Set(currentState);
        nodeIds.forEach((id) => {
          newState.delete(id);
        });

        projectExpandedStates.set(projectId, newState);

        const metaKey = `closed_nodes_${projectId}`;
        const idsArray = Array.from(newState);
        window.electronAPI.setMetaData(metaKey, idsArray);

        return newState;
      });
    },
  };
}

project_ids = createProjectIds(undefined);
selected_type = writable<SelectedType>(undefined);
table_selected_id = writable<string | undefined>(undefined);
closed_node_ids = createClosedNodeIds(new Set<string>());
selected_id = createSelectedID(undefined);
theme = createTheme(undefined);
filter = createFilter({});
filtered_data = writable<TreeData | null | undefined>(undefined);

export const showPageSearch = writable(false);

export function init_store() {
  tree_data.init();
  project_ids.init();
  selected_id.init();
  filter.init();
  theme.init();
  closed_node_ids.init();
}
