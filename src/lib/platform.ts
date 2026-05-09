import type {
  ElectronAPI,
  FindInPageResult,
  ProjectListItem,
  TaskDetailWindowData,
  ThemeName,
} from "../types/app";
import type {
  WorkspaceInfo,
  WorkspaceProject,
  WorkspaceProjectListItem,
  WorkspaceTask,
} from "../types/workspace";
import type { ProjectData } from "../common/tree_control";

// Single point where the Electron runtime is accessed.
// Returns Partial<ElectronAPI> so method-level guards work correctly
// even when test mocks define only a subset of the API.
// All exported functions are safe no-ops / return safe defaults when unavailable.
function api(): Partial<ElectronAPI> | undefined {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function isPlatformAvailable(): boolean {
  return api() !== undefined;
}

// ---------------------------------------------------------------------------
// Legacy project operations
// ---------------------------------------------------------------------------

export function getTreeData(projectId?: string): Promise<ProjectData | undefined> {
  return api()?.getTreeData?.(projectId) ?? Promise.resolve(undefined);
}

export function setTreeData(treeData: ProjectData): Promise<void> {
  return Promise.resolve(api()?.setTreeData?.(treeData));
}

export function getInitialTreeData(): Promise<ProjectData | undefined> {
  return api()?.getInitialTreeData?.() ?? Promise.resolve(undefined);
}

export function getProjectIDs(): Promise<ProjectListItem[]> {
  return api()?.getProjectIDs?.() ?? Promise.resolve([]);
}

export function setProjectOrder(projects: ProjectListItem[]): void {
  api()?.setProjectOrder?.(projects);
}

export function addProject(project: ProjectData): void {
  api()?.addProject?.(project);
}

export function deleteProject(projectId: string): void {
  api()?.deleteProject?.(projectId);
}

export function message(msg: string): void {
  api()?.message?.(msg);
}

// ---------------------------------------------------------------------------
// Metadata operations
// ---------------------------------------------------------------------------

export function getMetaData(key: string): Promise<unknown> {
  return api()?.getMetaData?.(key) ?? Promise.resolve(undefined);
}

export function setMetaData(key: string, value: unknown): void {
  api()?.setMetaData?.(key, value);
}

export function deleteMetaData(key: string): void {
  api()?.deleteMetaData?.(key);
}

// ---------------------------------------------------------------------------
// Window / navigation
// ---------------------------------------------------------------------------

export function openExternalLink(url: string): void {
  api()?.openExternalLink?.(url);
}

export function openTaskDetailWindow(detailData: TaskDetailWindowData): void {
  api()?.openTaskDetailWindow?.(detailData);
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export function getCurrentTheme(): Promise<ThemeName | undefined> {
  return api()?.getCurrentTheme?.() ?? Promise.resolve(undefined);
}

// ---------------------------------------------------------------------------
// Page search (find-in-page)
// ---------------------------------------------------------------------------

export function findInPage(
  text: string,
  options?: Record<string, unknown>
): Promise<FindInPageResult | void> {
  return api()?.findInPage?.(text, options) ?? Promise.resolve();
}

export function findInPageNext(text: string): Promise<void> {
  return api()?.findInPageNext?.(text) ?? Promise.resolve();
}

export function findInPagePrevious(text: string): Promise<FindInPageResult | void> {
  return api()?.findInPagePrevious?.(text) ?? Promise.resolve();
}

export function stopFindInPage(): void {
  api()?.stopFindInPage?.();
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

export function onThemeChanged(callback: (theme: ThemeName) => void): void {
  api()?.onThemeChanged?.(callback);
}

export function onTreeDataUpdated(callback: (treeData: ProjectData) => void): void {
  api()?.onTreeDataUpdated?.(callback);
}

export function onProjectDeleted(callback: (projectId: string) => void): void {
  api()?.onProjectDeleted?.(callback);
}

export function onSaveError(callback: (message: string) => void): void {
  api()?.onSaveError?.(callback);
}

export function onSearchResultUpdated(callback: (result: FindInPageResult) => void): void {
  api()?.onSearchResultUpdated?.(callback);
}

// ---------------------------------------------------------------------------
// Workspace operations
// ---------------------------------------------------------------------------

export function wsGetWorkspaces(): Promise<{
  workspaces: WorkspaceInfo[];
  activeWorkspace: string | null;
}> {
  return api()?.wsGetWorkspaces?.() ?? Promise.resolve({ workspaces: [], activeWorkspace: null });
}

export function wsSetWorkspaces(config: {
  workspaces: WorkspaceInfo[];
  activeWorkspace?: string;
}): void {
  api()?.wsSetWorkspaces?.(config);
}

export function wsListProjects(workspacePath: string): Promise<WorkspaceProjectListItem[]> {
  return api()?.wsListProjects?.(workspacePath) ?? Promise.resolve([]);
}

export function wsReadProject(projectDir: string): Promise<WorkspaceProject | undefined> {
  return api()?.wsReadProject?.(projectDir) ?? Promise.resolve(undefined);
}

export function wsWriteTask(
  projectDir: string,
  task: WorkspaceTask
): Promise<{ success: boolean; error?: string }> {
  return (
    api()?.wsWriteTask?.(projectDir, task) ??
    Promise.resolve({ success: false, error: "API unavailable" })
  );
}

export function wsSaveMemoImage(
  projectDir: string,
  taskId: string,
  bytes: Uint8Array,
  mimeType?: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  return (
    api()?.wsSaveMemoImage?.(projectDir, taskId, bytes, mimeType) ??
    Promise.resolve({ success: false, error: "API unavailable" })
  );
}

export function wsResolveMemoAsset(
  projectDir: string,
  taskId: string,
  assetPath: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  return (
    api()?.wsResolveMemoAsset?.(projectDir, taskId, assetPath) ??
    Promise.resolve({ success: false, error: "API unavailable" })
  );
}

export function wsWriteProject(
  projectDir: string,
  tasks: WorkspaceTask[]
): Promise<{ success: boolean; error?: string }> {
  return (
    api()?.wsWriteProject?.(projectDir, tasks) ??
    Promise.resolve({ success: false, error: "API unavailable" })
  );
}

export function wsDeleteTask(
  projectDir: string,
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  return (
    api()?.wsDeleteTask?.(projectDir, taskId) ??
    Promise.resolve({ success: false, error: "API unavailable" })
  );
}

export function wsCreateProject(
  workspacePath: string,
  name: string,
  id: string
): Promise<{ success: boolean; projectDir?: string; dirName?: string; error?: string }> {
  return (
    api()?.wsCreateProject?.(workspacePath, name, id) ??
    Promise.resolve({ success: false, error: "API unavailable" })
  );
}

export function wsSelectDirectory(): Promise<string | null> {
  return api()?.wsSelectDirectory?.() ?? Promise.resolve(null);
}

export function wsGetLegacyProjects(): Promise<{ id: string; name: string; taskCount: number }[]> {
  return api()?.wsGetLegacyProjects?.() ?? Promise.resolve([]);
}

export function wsExportLegacyProjects(workspacePath: string): Promise<{
  success: boolean;
  migrated: { name: string; count: number }[];
  errors: { name: string; error: string }[];
}> {
  return (
    api()?.wsExportLegacyProjects?.(workspacePath) ??
    Promise.resolve({ success: false, migrated: [], errors: [] })
  );
}

export function wsMigrateProjects(workspacePath: string): Promise<{
  success: boolean;
  migrated: { name: string; count: number }[];
  errors: { name: string; error: string }[];
}> {
  return (
    api()?.wsMigrateProjects?.(workspacePath) ??
    Promise.resolve({ success: false, migrated: [], errors: [] })
  );
}
