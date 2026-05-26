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
  selected_ids,
  selection_anchor_id,
} from "@stores/ui";
import {
  workspace_store,
  workspace_tasks_cache,
  type WorkspaceState,
} from "@features/workspace/stores/workspace";
import { isPreferMemoryActive } from "@features/workspace/stores/policy";
import type { SelectedType } from "@app-types/app";
import type {
  WorkspaceProjectListItem,
  WorkspaceProjectPatch,
  WorkspaceTask,
} from "@app-types/workspace";

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

function applyWorkspaceRootOrder(
  tasks: WorkspaceTask[],
  activeWorkspaceProject: WorkspaceProjectListItem | undefined
) {
  const rootTask = getWorkspaceRootTask(tasks);
  if (rootTask && typeof activeWorkspaceProject?.order === "number") {
    rootTask.order = activeWorkspaceProject.order;
  }
}

function comparableWorkspaceTask(task: WorkspaceTask) {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    parents: task.parents ?? [],
    memos: (task.memos ?? []).map((memo) => ({
      id: memo.id,
      title: memo.title,
      content: memo.content,
      tags: memo.tags ?? [],
      format: memo.format ?? "markdown",
      order: memo.order ?? null,
    })),
    attachments: (task.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      relativePath: attachment.relativePath,
      size: attachment.size,
      modifiedAt: attachment.modifiedAt ?? null,
    })),
    createdAt: task.createdAt,
    order: task.order ?? null,
  };
}

function buildWorkspacePatch(
  current: ProjectData,
  previous: ProjectData | null,
  context: PersistContext
): { fullSnapshot: boolean; allTasks: WorkspaceTask[]; patch: WorkspaceProjectPatch } {
  const allTasks = projectDataToWorkspaceTasks(current, context.cachedWorkspaceTasks);
  applyWorkspaceRootOrder(allTasks, context.activeWorkspaceProject);

  if (!previous?.data) {
    return {
      fullSnapshot: true,
      allTasks,
      patch: { tasks: allTasks, deletedTaskIds: [] },
    };
  }

  const previousTasks = projectDataToWorkspaceTasks(previous, context.cachedWorkspaceTasks);
  applyWorkspaceRootOrder(previousTasks, context.activeWorkspaceProject);

  const previousById = new Map(previousTasks.map((task) => [task.id, task]));
  const currentIds = new Set(allTasks.map((task) => task.id));
  const dirtyTasks = allTasks.filter((task) => {
    const previousTask = previousById.get(task.id);
    return (
      !previousTask ||
      !_.isEqual(comparableWorkspaceTask(task), comparableWorkspaceTask(previousTask))
    );
  });
  const deletedTaskIds = [...previousById.keys()].filter((id) => !currentIds.has(id));

  return {
    fullSnapshot: false,
    allTasks,
    patch: { tasks: dirtyTasks, deletedTaskIds },
  };
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
      const previousWorkspaceData = previousData;

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

          // Prune multi-selection when nodes disappear (delete, undo of add, etc.).
          const removedSet = new Set(removedIds);
          selected_ids.update((currentState) => {
            if (currentState.size === 0) return currentState;
            let changed = false;
            const newState = new Set<string>();
            for (const id of currentState) {
              if (removedSet.has(id)) {
                changed = true;
              } else {
                newState.add(id);
              }
            }
            if (!changed) return currentState;
            // If anchor is gone, re-pick from remaining or clear.
            const currentAnchor = get(selection_anchor_id);
            if (currentAnchor !== undefined && removedSet.has(currentAnchor)) {
              const first = newState.values().next();
              selection_anchor_id.set(first.done ? undefined : (first.value as string));
            }
            if (newState.size === 0) {
              table_selected_id.set(undefined);
            } else if (newState.size === 1) {
              table_selected_id.set(newState.values().next().value as string);
            } else {
              const anchor = get(selection_anchor_id);
              if (anchor !== undefined) table_selected_id.set(anchor);
            }
            return newState;
          });
        }
      }

      previousData = _.cloneDeep(current);
      filter.set(get(filter));

      if (isWorkspace) {
        const activeProjectDir = context.activeProjectDir;
        if (!activeProjectDir) return;
        const { fullSnapshot, allTasks, patch } = buildWorkspacePatch(
          current,
          previousWorkspaceData,
          context
        );
        if (!fullSnapshot && patch.tasks.length === 0 && patch.deletedTaskIds.length === 0) {
          saveStatus.set("saved");
          return;
        }
        try {
          const forceLocal = isPreferMemoryActive();
          const options = forceLocal ? { forceLocal: true } : undefined;
          const writePromise = fullSnapshot
            ? platform.wsWriteProject(activeProjectDir, allTasks, options)
            : platform.wsWriteProjectPatch(activeProjectDir, patch, options);
          writePromise
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
            pendingTaskDetailSelection?.selectedType !== "WorkspaceProject" &&
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
            selected_type.set(pendingTaskDetailSelection.selectedType ?? "Projects");
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
