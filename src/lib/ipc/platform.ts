import type {
  ElectronAPI,
  FindInPageResult,
  MarkdownImportSource,
  PerformanceMilestone,
  TaskDetailWindowData,
  ThemeName,
  WindowState,
} from "@app-types/app";
import type { WorkspaceInfo } from "@app-types/workspace";
import type {
  GraphCommandOrigin,
  WorkspaceGraph,
  WorkspaceGraphCommand,
  WorkspaceGraphCommandResult,
} from "@app-types/workspace_graph";

// Single point where the Electron runtime is accessed.
// Returns Partial<ElectronAPI> so method-level guards work correctly
// even when test mocks define only a subset of the API.
// All exported functions are safe no-ops / return safe defaults when unavailable.
function api(): Partial<ElectronAPI> | undefined {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

/**
 * IPC に渡す値を素のオブジェクト・配列へ写す。
 *
 * Svelte 5 の `$state` に入れたオブジェクトは Proxy になり、structured clone
 * できない（"An object could not be cloned"）。どこかの状態から来た値でも
 * 送れるよう、境界でまとめて写す。`undefined` の値（フィールドを消す指示）は
 * 残す。
 */
function plain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(plain) as T;
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, plain(item)])
      ) as T;
    }
  }
  return value;
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
  api()?.setMetaData?.(key, plain(value));
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

export function openImageWindow(src: string): void {
  api()?.openImageWindow?.(src);
}

export function openImageExternal(
  src: string
): Promise<{ success: boolean; fallback?: boolean; error?: string }> {
  return (
    api()?.openImageExternal?.(src) ??
    Promise.resolve({ success: false, fallback: true, error: "API unavailable" })
  );
}

export function openTaskDetailWindow(detailData: TaskDetailWindowData): void {
  api()?.openTaskDetailWindow?.(plain({ ...detailData, requestedAtEpochMs: Date.now() }));
}

export function reportPerformanceMilestone(payload: PerformanceMilestone): void {
  api()?.reportPerformanceMilestone?.(payload);
}

// ---------------------------------------------------------------------------
// Window controls
// ---------------------------------------------------------------------------

export function windowMinimize(): void {
  api()?.windowMinimize?.();
}

export function windowToggleMaximize(): void {
  api()?.windowToggleMaximize?.();
}

export function windowClose(): void {
  api()?.windowClose?.();
}

export function windowGetState(): Promise<WindowState> {
  return api()?.windowGetState?.() ?? Promise.resolve({ isMaximized: false, isFullScreen: false });
}

export function windowZoom(action: "in" | "out" | "reset" | "get"): Promise<number> {
  return api()?.windowZoom?.(action) ?? Promise.resolve(100);
}

export function onWindowStateChanged(callback: (state: WindowState) => void): void {
  api()?.onWindowStateChanged?.(callback);
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
  api()?.wsSetWorkspaces?.(plain(config));
}

export function wsOpenWorkspace(
  workspacePath: string
): Promise<{ success: boolean; error?: string }> {
  return (
    api()?.wsOpenWorkspace?.(workspacePath) ??
    Promise.resolve({ success: false, error: "API unavailable" })
  );
}

export interface WsSelectDirectoryResult {
  path: string | null;
  error?: string;
}

export function wsSelectDirectory(): Promise<WsSelectDirectoryResult> {
  return api()?.wsSelectDirectory?.() ?? Promise.resolve({ path: null });
}

export function wsReadGraph(workspacePath: string): Promise<WorkspaceGraph> {
  const fn = api()?.wsReadGraph;
  if (!fn) return Promise.reject(new Error("Workspace graph API unavailable"));
  return fn(workspacePath);
}

export function wsExecuteGraphCommand(
  workspacePath: string,
  command: WorkspaceGraphCommand,
  origin: GraphCommandOrigin,
  expectedRevision: number
): Promise<WorkspaceGraphCommandResult> {
  const fn = api()?.wsExecuteGraphCommand;
  if (!fn) return Promise.reject(new Error("Workspace graph API unavailable"));
  return fn(workspacePath, plain(command), origin, expectedRevision);
}

export function wsUndoGraph(
  workspacePath: string,
  expectedRevision: number
): Promise<{ graph: WorkspaceGraph; changed: boolean }> {
  const fn = api()?.wsUndoGraph;
  if (!fn) return Promise.reject(new Error("Workspace graph API unavailable"));
  return fn(workspacePath, expectedRevision);
}

export function wsRedoGraph(
  workspacePath: string,
  expectedRevision: number
): Promise<{ graph: WorkspaceGraph; changed: boolean }> {
  const fn = api()?.wsRedoGraph;
  if (!fn) return Promise.reject(new Error("Workspace graph API unavailable"));
  return fn(workspacePath, expectedRevision);
}

export function onWorkspaceGraphUpdated(
  callback: (event: { workspacePath: string; graph: WorkspaceGraph }) => void
): void {
  api()?.onWorkspaceGraphUpdated?.(callback);
}

export function wsListMarkdownImports(workspacePath: string): Promise<MarkdownImportSource[]> {
  const fn = api()?.wsListMarkdownImports;
  if (!fn) return Promise.reject(new Error("Workspace graph API unavailable"));
  return fn(workspacePath);
}

export function wsImportMarkdownProjects(
  workspacePath: string,
  dirNames: string[],
  expectedRevision?: number
): Promise<WorkspaceGraphCommandResult> {
  const fn = api()?.wsImportMarkdownProjects;
  if (!fn) return Promise.reject(new Error("Workspace graph API unavailable"));
  return fn(workspacePath, plain(dirNames), expectedRevision);
}

export function wsSaveGraphAsset(
  workspacePath: string,
  nodeId: string,
  fileName: string,
  bytes: Uint8Array
): Promise<{ relativePath: string }> {
  const fn = api()?.wsSaveGraphAsset;
  if (!fn) return Promise.reject(new Error("Workspace graph asset API unavailable"));
  return fn(workspacePath, nodeId, fileName, bytes);
}

export function wsResolveGraphAsset(
  workspacePath: string,
  nodeId: string,
  relativePath: string
): Promise<{ url: string }> {
  const fn = api()?.wsResolveGraphAsset;
  if (!fn) return Promise.reject(new Error("Workspace graph asset API unavailable"));
  return fn(workspacePath, nodeId, relativePath);
}

export function wsOpenGraphAsset(
  workspacePath: string,
  nodeId: string,
  relativePath: string,
  chooseProgram = false
): Promise<void> {
  const fn = api()?.wsOpenGraphAsset;
  if (!fn) return Promise.reject(new Error("Workspace graph asset API unavailable"));
  return fn(workspacePath, nodeId, relativePath, chooseProgram);
}
