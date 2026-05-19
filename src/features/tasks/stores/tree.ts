import { throttle } from "lodash";
import _ from "lodash";
import { get, writable, type Writable } from "svelte/store";
import * as platform from "@lib/ipc/platform";
import { getNode, type ProjectData, type TreeData } from "@features/tasks/utils/tree_control";
import {
  projectDataToWorkspaceTasks,
  workspaceToProjectData,
} from "@features/workspace/utils/workspace_tree";
import { filter } from "@features/search/stores/search";
import { project_ids } from "@features/projects/stores/project";
import {
  selected_type,
  selected_id,
  table_selected_id,
  closed_node_ids,
  pendingTaskDetailSelection,
  clearPendingTaskDetailSelection,
  saveStatus,
} from "@stores/ui";
import {
  workspace_store,
  workspace_tasks_cache,
  type WorkspaceState,
} from "@features/workspace/stores/workspace";
import type { SelectedType } from "@app-types/app";
import type { WorkspaceProjectListItem, WorkspaceTask } from "@app-types/workspace";

export interface TreeDataStore extends Writable<ProjectData | undefined> {
  init: () => void;
  setFromSource: (value: ProjectData | undefined) => void;
  resetForLoad: () => void;
  flushPendingPersist: () => void;
}

interface PersistContext {
  selectedType: SelectedType;
  selectedId: string | undefined;
  activeProjectDir: string | null;
  activeWorkspaceProject: WorkspaceProjectListItem | undefined;
  cachedWorkspaceTasks: Record<string, WorkspaceTask>;
}

const MAX_HISTORY = 50;
let undoStack: ProjectData[] = [];
let redoStack: ProjectData[] = [];
let skipSnapshot = false;
let pendingSkipSnapshot = false;

export const cancelPendingOperations = writable<number>(0);

function captureSnapshot(data: ProjectData) {
  undoStack.push(_.cloneDeep(data));
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }
  redoStack = [];
}

export function clearHistory() {
  undoStack = [];
  redoStack = [];
  skipSnapshot = true;
}

function getWorkspaceRootTask(tasks: WorkspaceTask[]): WorkspaceTask | undefined {
  return tasks.find((task) => task.parents.length === 0);
}

function getWorkspaceRootTaskFromRecord(
  tasks: Record<string, WorkspaceTask>
): WorkspaceTask | undefined {
  return Object.values(tasks).find((task) => task.parents.length === 0);
}

function getActiveWorkspaceProject(
  projects: WorkspaceProjectListItem[],
  activeProjectDir: string | null,
  selectedId: string | undefined
): WorkspaceProjectListItem | undefined {
  return projects.find(
    (project) => project.projectDir === activeProjectDir || project.rootId === selectedId
  );
}

function syncWorkspaceProjectSummaryFromTree(
  current: ProjectData | undefined,
  selectedType: SelectedType,
  selectedId: string | undefined,
  workspaceState: WorkspaceState
) {
  if (selectedType !== "WorkspaceProject" || !workspaceState.activeProjectDir || !current?.data) {
    return;
  }

  const activeProject = getActiveWorkspaceProject(
    workspaceState.projects,
    workspaceState.activeProjectDir,
    selectedId
  );
  workspace_store.syncProjectListItem(workspaceState.activeProjectDir, {
    rootId: current.data.id,
    name: current.data.data.name,
    order: activeProject?.order,
  });
}

function createTreeData(initialValue: ProjectData | undefined): TreeDataStore {
  const { subscribe, set, update } = writable<ProjectData | undefined>(initialValue);
  let previousData: ProjectData | null = null;
  let skipPersistOnce = false;
  let suppressInitialLoadOnce = false;
  let syncListenerRegistered = false;

  const findRemovedNodeIds = (
    oldData: ProjectData | null | undefined,
    newData: ProjectData | null | undefined
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
    const newIdSet = new Set(newIds);
    return oldIds.filter((id) => !newIdSet.has(id));
  };

  const persistTreeData = throttle(
    async (current: ProjectData | undefined, context: PersistContext) => {
      if (!current) {
        return;
      }

      const isWorkspace = context.selectedType === "WorkspaceProject";

      if (previousData) {
        if (!pendingSkipSnapshot) {
          captureSnapshot(previousData);
        }
        pendingSkipSnapshot = false;

        const removedIds = findRemovedNodeIds(previousData, current);
        if (removedIds.length > 0) {
          const projectId = context.selectedId;
          if (projectId) {
            closed_node_ids.update((currentState) => {
              const newState = new Set(currentState);
              removedIds.forEach((id) => {
                newState.delete(id);
              });

              const metaKey = `closed_nodes_${projectId}`;
              const idsArray = Array.from(newState);
              platform.setMetaData(metaKey, idsArray);

              return newState;
            });
          }
        }
      }

      previousData = _.cloneDeep(current);
      filter.set(get(filter));

      if (isWorkspace) {
        const activeProjectDir = context.activeProjectDir;
        if (!activeProjectDir) return;
        const cachedTasks = context.cachedWorkspaceTasks;
        const tasks = projectDataToWorkspaceTasks(current, cachedTasks);
        const rootTask = getWorkspaceRootTask(tasks);
        if (rootTask && typeof context.activeWorkspaceProject?.order === "number") {
          rootTask.order = context.activeWorkspaceProject.order;
        }
        try {
          platform
            .wsWriteProject(activeProjectDir, tasks)
            .then((result) => {
              if (!result?.success) {
                saveStatus.set("error");
              }
            })
            .catch(() => {
              saveStatus.set("error");
            });
          saveStatus.set("queued");
        } catch {
          saveStatus.set("error");
        }
      } else {
        try {
          await platform.setTreeData(current);
          saveStatus.set("saved");
        } catch {
          saveStatus.set("error");
        }
        platform.getProjectIDs().then((result) => {
          project_ids.set(result);
        });
      }
    },
    1000
  );

  return {
    subscribe,
    set,
    update,
    setFromSource: (value) => {
      skipPersistOnce = true;
      set(value);
    },
    resetForLoad: () => {
      suppressInitialLoadOnce = true;
      skipPersistOnce = true;
      set(undefined);
    },
    flushPendingPersist: () => {
      persistTreeData.flush();
    },
    init: () => {
      if (!syncListenerRegistered) {
        syncListenerRegistered = true;
        platform.onWorkspaceSaveStatus((event) => {
          const activeProjectDir = get(workspace_store).activeProjectDir;
          if (!event.projectDir || event.projectDir === activeProjectDir) {
            saveStatus.set(event.status);
          }
        });
        platform.onWorkspaceProjectUpdated((event) => {
          const rootTask = getWorkspaceRootTaskFromRecord(event.tasks);
          if (rootTask) {
            workspace_store.syncProjectListItem(event.projectDir, {
              rootId: rootTask.id,
              name: rootTask.name,
              order: rootTask.order,
            });
          }

          const currentSelectedType = get(selected_type);
          const currentSelectedId = get(selected_id);
          const activeProjectDir = get(workspace_store).activeProjectDir;

          if (
            currentSelectedType !== "WorkspaceProject" ||
            !currentSelectedId ||
            event.projectDir !== activeProjectDir
          ) {
            return;
          }

          workspace_tasks_cache.set(event.tasks);
          skipPersistOnce = true;
          set(workspaceToProjectData(event.tasks, currentSelectedId));
          saveStatus.set("saved");
        });
        platform.onTreeDataUpdated((nextTreeData) => {
          if (!nextTreeData) {
            return;
          }

          const currentSelectedType = get(selected_type);
          const currentSelectedId = get(selected_id);
          const shouldSyncCurrentProject =
            currentSelectedType === "Projects" && currentSelectedId === nextTreeData.data?.id;
          const shouldSyncTaskDetailWindow =
            pendingTaskDetailSelection?.projectId === nextTreeData.data?.id;

          if (!shouldSyncCurrentProject && !shouldSyncTaskDetailWindow) {
            return;
          }

          skipPersistOnce = true;
          set(nextTreeData);

          if (shouldSyncTaskDetailWindow && pendingTaskDetailSelection?.taskId) {
            if (getNode(pendingTaskDetailSelection.taskId, nextTreeData.data)) {
              table_selected_id.set(pendingTaskDetailSelection.taskId);
            } else {
              clearPendingTaskDetailSelection();
              table_selected_id.set(undefined);
            }
          }
        });
      }

      subscribe((current) => {
        const currentSelectedType = get(selected_type);
        const currentSelectedId = get(selected_id);
        const workspaceState = get(workspace_store);

        if (current === undefined) {
          if (suppressInitialLoadOnce) {
            suppressInitialLoadOnce = false;
          } else if (pendingTaskDetailSelection?.projectId) {
            selected_type.set("Projects");
            selected_id.set(pendingTaskDetailSelection.projectId);
            if (pendingTaskDetailSelection.taskId) {
              table_selected_id.set(pendingTaskDetailSelection.taskId);
            }
          } else {
            platform.getInitialTreeData().then((result) => {
              selected_type.set("Projects");
              if (result !== undefined) {
                selected_id.set(result.data.id);
              }
            });
          }
        }

        syncWorkspaceProjectSummaryFromTree(
          current,
          currentSelectedType,
          currentSelectedId,
          workspaceState
        );

        if (skipPersistOnce) {
          skipPersistOnce = false;
          previousData = current ? _.cloneDeep(current) : null;
          if (skipSnapshot) {
            pendingSkipSnapshot = true;
            skipSnapshot = false;
          }
          filter.set(get(filter));
          if (get(selected_type) !== "WorkspaceProject") {
            platform.getProjectIDs().then((result) => {
              project_ids.set(result);
            });
          }
          saveStatus.set("idle");
          return;
        }

        if (skipSnapshot) {
          pendingSkipSnapshot = true;
          skipSnapshot = false;
        } else if (current !== undefined) {
          pendingSkipSnapshot = false;
        }

        if (current !== undefined) {
          saveStatus.set("writing");
        } else {
          saveStatus.set("idle");
        }
        persistTreeData(current, {
          selectedType: currentSelectedType,
          selectedId: currentSelectedId,
          activeProjectDir: workspaceState.activeProjectDir,
          activeWorkspaceProject: getActiveWorkspaceProject(
            workspaceState.projects,
            workspaceState.activeProjectDir,
            currentSelectedId
          ),
          cachedWorkspaceTasks: get(workspace_tasks_cache),
        });
      });
    },
  };
}

// eslint-disable-next-line prefer-const
export let tree_data: TreeDataStore = createTreeData(undefined);

export function undoHistory() {
  if (undoStack.length === 0) return;
  const current = get(tree_data);
  if (current) {
    redoStack.push(_.cloneDeep(current));
    if (redoStack.length > MAX_HISTORY) {
      redoStack.shift();
    }
  }
  const previous = undoStack.pop()!;
  cancelPendingOperations.update((n) => n + 1);
  skipSnapshot = true;
  tree_data.set(previous);
}

export function redoHistory() {
  if (redoStack.length === 0) return;
  const current = get(tree_data);
  if (current) {
    undoStack.push(_.cloneDeep(current));
    if (undoStack.length > MAX_HISTORY) {
      undoStack.shift();
    }
  }
  const next = redoStack.pop()!;
  cancelPendingOperations.update((n) => n + 1);
  skipSnapshot = true;
  tree_data.set(next);
}
