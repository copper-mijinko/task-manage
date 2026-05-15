import { get, writable, type Writable } from "svelte/store";
import { getDefaultProject } from "@features/tasks/utils/tree_control";
import type { ProjectListItem } from "@app-types/app";
import { filtered_data } from "@features/search/stores/search";
import * as platform from "@lib/ipc/platform";
import {
  selected_type,
  selected_id,
  table_selected_id,
  closed_node_ids,
  pendingTaskDetailSelection,
  clearPendingTaskDetailSelection,
} from "@stores/ui";

export interface ProjectIdsStore extends Writable<ProjectListItem[] | undefined> {
  init: () => void;
  addProject: () => void;
  deleteProject: (projectId: string) => void;
  setProjectOrder: (projects: ProjectListItem[]) => void;
}

export const info_ids = writable<ProjectListItem[]>([
  { id: "9ba28822-6240-4280-9da3-63ac6b8356a6", name: "Usage" },
]);

function createProjectIds(initialValue: ProjectListItem[] | undefined): ProjectIdsStore {
  const { subscribe, set, update } = writable<ProjectListItem[] | undefined>(initialValue);
  let projectDeleteListenerRegistered = false;

  return {
    subscribe,
    set,
    update,
    init: () => {
      if (!projectDeleteListenerRegistered) {
        projectDeleteListenerRegistered = true;
        platform.onProjectDeleted((deletedProjectId) => {
          platform.getProjectIDs().then((result) => {
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
          platform.getProjectIDs().then((result) => {
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
      platform.addProject(newProject);
      platform.getProjectIDs().then((result) => {
        set(result);
      });
    },
    deleteProject: (projectId: string) => {
      platform.deleteProject(projectId);
      platform.getProjectIDs().then((result) => {
        set(result);
      });

      const metaKey = `closed_nodes_${projectId}`;
      platform.deleteMetaData(metaKey);

      if (projectId === get(selected_id)) {
        selected_type.set(undefined);
        selected_id.set(undefined);
      }
    },
    setProjectOrder: (projects: ProjectListItem[]) => {
      platform.setProjectOrder(projects);
    },
  };
}

// eslint-disable-next-line prefer-const
export let project_ids: ProjectIdsStore = createProjectIds(undefined);
