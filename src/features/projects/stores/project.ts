import { get, writable, type Writable } from "svelte/store";
import { getDefaultProject } from "@features/tasks/utils/tree_control";
import type { ProjectListItem } from "@app-types/app";
import { filtered_data } from "@features/search/stores/search";
import * as platform from "@lib/ipc/platform";
import {
  selected_type,
  selected_id,
  table_selected_id,
  closed_row_paths,
  pendingTaskDetailSelection,
  clearPendingTaskDetailSelection,
} from "@stores/ui";

export interface ProjectIdsStore extends Writable<ProjectListItem[] | undefined> {
  init: () => Promise<void>;
  addProject: () => Promise<string>;
  deleteProject: (projectId: string) => void;
  setProjectOrder: (projects: ProjectListItem[]) => void;
}

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
            closed_row_paths.set(new Set());
          }
        });
      }

      let initialLoad: Promise<void> = Promise.resolve();

      subscribe((current) => {
        if (current === undefined) {
          initialLoad = platform.getProjectIDs().then((result) => {
            set(result);
          });
        }

        if (!current || current.length === 0) {
          selected_type.set(undefined);
          table_selected_id.set(undefined);
          closed_row_paths.update(() => new Set());
        }
      });

      return initialLoad;
    },
    addProject: async () => {
      const newProject = getDefaultProject();
      const existingNames = new Set((get({ subscribe }) ?? []).map((project) => project.name));
      const baseName = "新しいプロジェクト";
      let projectName = baseName;
      let suffix = 2;
      while (existingNames.has(projectName)) {
        projectName = `${baseName} ${suffix}`;
        suffix += 1;
      }
      newProject.data.data.name = projectName;
      await platform.addProject(newProject);
      const result = await platform.getProjectIDs();
      set(result);
      return newProject.data.id;
    },
    deleteProject: (projectId: string) => {
      platform.deleteProject(projectId);
      platform.getProjectIDs().then((result) => {
        set(result);
      });

      // 開閉状態の永続化キー。旧キー（ノード id 版）も一緒に片付ける。
      platform.deleteMetaData(`closed_paths_${projectId}`);
      platform.deleteMetaData(`closed_nodes_${projectId}`);

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
