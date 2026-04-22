import type { ProjectData } from "../common/tree_control";

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
}
