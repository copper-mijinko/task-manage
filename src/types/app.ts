import type { ProjectData } from "../common/tree_control";
import type {
  WorkspaceInfo,
  WorkspaceProject,
  WorkspaceProjectListItem,
  WorkspaceTask,
} from "./workspace";

export type ThemeName = "dark" | "light";
export type SelectedType = "Projects" | "Info" | undefined;
export type FilterState = Record<string, string[]>;

export interface ProjectListItem {
  id: string;
  name: string;
}

export interface PendingTaskDetailSelection {
  projectId: string;
  taskId: string;
}

export interface TaskDetailWindowData extends PendingTaskDetailSelection {
  taskName: string;
}

export interface FindInPageResult {
  matches: number;
  activeMatchOrdinal: number;
}

export interface ElectronAPI {
  setTreeData: (treeData: ProjectData) => void;
  getTreeData: (projectId?: string) => Promise<ProjectData | undefined>;
  getMetaData: (key: string) => Promise<unknown>;
  setMetaData: (key: string, value: unknown) => void;
  deleteMetaData: (key: string) => void;
  getInitialTreeData: () => Promise<ProjectData | undefined>;
  getProjectIDs: () => Promise<ProjectListItem[]>;
  setProjectOrder: (projects: ProjectListItem[]) => void;
  addProject: (project: ProjectData) => void;
  deleteProject: (projectId: string) => void;
  message: (message: string) => void;
  openExternalLink: (url: string) => void;
  openTaskDetailWindow: (detailData: TaskDetailWindowData) => void;
  getTaskDetailWindowData: () => Promise<TaskDetailWindowData>;
  findInPage: (text: string, options?: Record<string, unknown>) => Promise<FindInPageResult | void>;
  findInPageNext: (text: string) => Promise<void>;
  findInPagePrevious: (text: string) => Promise<FindInPageResult | void>;
  stopFindInPage: () => void;
  onSearchResultUpdated: (callback: (result: FindInPageResult) => void) => void;
  onThemeChanged: (callback: (theme: ThemeName) => void) => void;
  onTreeDataUpdated: (callback: (treeData: ProjectData) => void) => void;
  onProjectDeleted: (callback: (projectId: string) => void) => void;
  onSaveError: (callback: (message: string) => void) => void;
  getCurrentTheme: () => Promise<ThemeName>;

  // Workspace API
  wsGetWorkspaces: () => Promise<{ workspaces: WorkspaceInfo[]; activeWorkspace: string | null }>;
  wsSetWorkspaces: (config: { workspaces: WorkspaceInfo[]; activeWorkspace?: string }) => void;
  wsListProjects: (workspacePath: string) => Promise<WorkspaceProjectListItem[]>;
  wsReadProject: (projectDir: string) => Promise<WorkspaceProject>;
  wsWriteTask: (
    projectDir: string,
    task: WorkspaceTask
  ) => Promise<{ success: boolean; error?: string }>;
  wsDeleteTask: (
    projectDir: string,
    taskId: string
  ) => Promise<{ success: boolean; error?: string }>;
  wsCreateProject: (
    workspacePath: string,
    name: string,
    id: string
  ) => Promise<{ success: boolean; projectDir?: string; dirName?: string; error?: string }>;
  wsSelectDirectory: () => Promise<string | null>;
  wsGetLegacyProjects: () => Promise<{ id: string; name: string; taskCount: number }[]>;
  wsMigrateProjects: (workspacePath: string) => Promise<{
    success: boolean;
    migrated: { name: string; count: number }[];
    errors: { name: string; error: string }[];
  }>;
}
