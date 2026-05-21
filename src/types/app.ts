import type { ProjectData } from "@features/tasks/utils/tree_control";
import type {
  WorkspaceInfo,
  WorkspaceProject,
  WorkspaceProjectListItem,
  WorkspaceTask,
} from "./workspace";

export type ThemeName = "dark" | "light";
export type SelectedType = "Projects" | "Info" | "WorkspaceProject" | undefined;
export type FilterState = Record<string, string[]>;
export type SortDirection = "asc" | "desc";
export interface SortState {
  column: string;
  direction: SortDirection;
}

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

export type SaveStatus =
  | "idle"
  | "queued"
  | "writing"
  | "retrying"
  | "saved"
  | "error"
  | "conflict";

export interface WorkspaceSaveStatusEvent {
  projectDir: string;
  status: SaveStatus;
  message?: string;
}

export interface WorkspaceProjectUpdatedEvent {
  projectDir: string;
  tasks: Record<string, WorkspaceTask>;
  reason: "external-update" | "conflict-reload";
}

export interface WorkspaceConflictEvent {
  projectDir: string;
  path?: string;
  message: string;
}

export interface WorkspaceNoticeEvent {
  kind: "workspace-updated" | "conflicted-copy" | "overwritten-external" | "error";
  projectDir?: string;
  path?: string;
  message: string;
}

export interface WorkspaceFlushStartEvent {
  reason?: string;
}

export interface WorkspaceFlushCompleteEvent {
  forced?: boolean;
}

export interface WindowState {
  isMaximized: boolean;
  isFullScreen: boolean;
}

export type WorkspaceConflictPolicy = "ask" | "prefer-memory";

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
  findInPage: (text: string, options?: Record<string, unknown>) => Promise<FindInPageResult | void>;
  findInPageNext: (text: string) => Promise<void>;
  findInPagePrevious: (text: string) => Promise<FindInPageResult | void>;
  stopFindInPage: () => void;
  onSearchResultUpdated: (callback: (result: FindInPageResult) => void) => void;
  onThemeChanged: (callback: (theme: ThemeName) => void) => void;
  onTreeDataUpdated: (callback: (treeData: ProjectData) => void) => void;
  onProjectDeleted: (callback: (projectId: string) => void) => void;
  onSaveError: (callback: (message: string) => void) => void;
  onWorkspaceSaveStatus: (callback: (event: WorkspaceSaveStatusEvent) => void) => void;
  onWorkspaceProjectUpdated: (callback: (event: WorkspaceProjectUpdatedEvent) => void) => void;
  onWorkspaceConflict: (callback: (event: WorkspaceConflictEvent) => void) => void;
  onWorkspaceNotice: (callback: (event: WorkspaceNoticeEvent) => void) => void;
  onWorkspaceFlushStart: (callback: (event: WorkspaceFlushStartEvent) => void) => void;
  onWorkspaceFlushComplete: (callback: (event: WorkspaceFlushCompleteEvent) => void) => void;
  getCurrentTheme: () => Promise<ThemeName>;

  // Window controls
  windowMinimize: () => void;
  windowToggleMaximize: () => void;
  windowClose: () => void;
  windowGetState: () => Promise<WindowState>;
  onWindowStateChanged: (callback: (state: WindowState) => void) => void;

  // Workspace API
  wsGetWorkspaces: () => Promise<{ workspaces: WorkspaceInfo[]; activeWorkspace: string | null }>;
  wsSetWorkspaces: (config: { workspaces: WorkspaceInfo[]; activeWorkspace?: string }) => void;
  wsListProjects: (workspacePath: string) => Promise<WorkspaceProjectListItem[]>;
  wsSetProjectOrder: (
    workspacePath: string,
    projects: WorkspaceProjectListItem[]
  ) => Promise<{ success: boolean; projects?: WorkspaceProjectListItem[]; error?: string }>;
  wsReadProject: (projectDir: string) => Promise<WorkspaceProject>;
  wsWriteTask: (
    projectDir: string,
    task: WorkspaceTask
  ) => Promise<{ success: boolean; error?: string }>;
  wsSaveMemoImage: (
    projectDir: string,
    taskId: string,
    bytes: Uint8Array,
    mimeType?: string
  ) => Promise<{ success: boolean; path?: string; error?: string }>;
  wsResolveMemoAsset: (
    projectDir: string,
    taskId: string,
    assetPath: string
  ) => Promise<{ success: boolean; url?: string; error?: string }>;
  wsWriteProject: (
    projectDir: string,
    tasks: WorkspaceTask[],
    options?: { forceLocal?: boolean }
  ) => Promise<{ success: boolean; queued?: boolean; error?: string }>;
  wsDeleteTask: (
    projectDir: string,
    taskId: string
  ) => Promise<{ success: boolean; error?: string }>;
  wsCreateProject: (
    workspacePath: string,
    name: string,
    id: string,
    order?: number
  ) => Promise<{ success: boolean; projectDir?: string; dirName?: string; error?: string }>;
  wsDeleteProject: (projectDir: string) => Promise<{ success: boolean; error?: string }>;
  wsResolveConflict: (
    projectDir: string,
    action: "reload" | "keep-local"
  ) => Promise<{ success: boolean; error?: string }>;
  wsOpenWorkspace: (workspacePath: string) => Promise<{ success: boolean; error?: string }>;
  wsOpenTaskFolder: (
    projectDir: string,
    taskId: string
  ) => Promise<{ success: boolean; error?: string }>;
  wsSelectDirectory: () => Promise<{ path: string | null; error?: string }>;
  wsGetLegacyProjects: () => Promise<{ id: string; name: string; taskCount: number }[]>;
  wsExportLegacyProjects: (
    workspacePath: string,
    options?: { memoFormat?: "preserve" | "markdown" }
  ) => Promise<{
    success: boolean;
    migrated: { name: string; count: number }[];
    errors: { name: string; error: string }[];
  }>;
  wsMigrateProjects: (
    workspacePath: string,
    options?: { memoFormat?: "preserve" | "markdown" }
  ) => Promise<{
    success: boolean;
    migrated: { name: string; count: number }[];
    errors: { name: string; error: string }[];
  }>;
}
