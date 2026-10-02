import type { WorkspaceInfo } from "./workspace";
import type {
  GraphCommandOrigin,
  WorkspaceGraph,
  WorkspaceGraphCommand,
  WorkspaceGraphCommandResult,
  WorkspaceGraphDelta,
  WorkspaceGraphHistoryResult,
} from "./workspace_graph";

/** ノードのフォルダーへ保存するファイルの種類（本文に貼る画像 / 添付）。 */
export type GraphAssetKind = "image" | "attachment";

/** ほかのウィンドウの変更の通知。差分（`delta`）か、読み直した全体（`graph`）。 */
export interface WorkspaceGraphUpdate {
  workspacePath: string;
  delta?: WorkspaceGraphDelta;
  graph?: WorkspaceGraph;
}

export type ThemeName = "dark" | "light";
export type SelectedType = "WorkspaceProject" | undefined;
export type FilterState = Record<string, string[]>;
export type SortDirection = "asc" | "desc";
export interface SortState {
  column: string;
  direction: SortDirection;
}

/** 詳細ウィンドウから本体へ「このノードを選んで」と頼むときの宛先。 */
export interface PendingTaskDetailSelection {
  occurrencePath?: string;
  projectId: string;
  taskId: string;
}

export interface TaskDetailWindowData extends PendingTaskDetailSelection {
  workspacePath: string;
  taskName: string;
  requestedAtEpochMs?: number;
}

export interface PerformanceMilestone {
  name:
    | "startup.mounted"
    | "startup.initialWorkspaceVisible"
    | "detail.taskDataLoaded"
    | "detail.interactive";
  durationMs: number;
  runId?: string;
}

export interface FindInPageResult {
  matches: number;
  activeMatchOrdinal: number;
}

/** 保存状態。`queued` は本文エディタに未保存の変更があるとき。 */
export type SaveStatus = "idle" | "queued" | "writing" | "saved" | "error";

export interface WindowState {
  isMaximized: boolean;
  isFullScreen: boolean;
}

export interface ElectronAPI {
  getMetaData: (key: string) => Promise<unknown>;
  setMetaData: (key: string, value: unknown) => void;
  deleteMetaData: (key: string) => void;
  getCurrentTheme: () => Promise<ThemeName>;
  onThemeChanged: (callback: (theme: ThemeName) => void) => void;
  onSaveError: (callback: (message: string) => void) => void;
  message: (message: string) => void;

  openExternalLink: (url: string) => void;
  openImageWindow: (src: string) => void;
  openImageExternal: (
    src: string
  ) => Promise<{ success: boolean; fallback?: boolean; error?: string }>;
  openTaskDetailWindow: (detailData: TaskDetailWindowData) => void;
  reportPerformanceMilestone: (payload: PerformanceMilestone) => void;

  findInPage: (text: string, options?: Record<string, unknown>) => Promise<FindInPageResult | void>;
  findInPageNext: (text: string) => Promise<void>;
  findInPagePrevious: (text: string) => Promise<FindInPageResult | void>;
  stopFindInPage: () => void;
  onSearchResultUpdated: (callback: (result: FindInPageResult) => void) => void;

  windowMinimize: () => void;
  windowToggleMaximize: () => void;
  windowClose: () => void;
  windowGetState: () => Promise<WindowState>;
  windowZoom: (action: "in" | "out" | "reset" | "get") => Promise<number>;
  onWindowStateChanged: (callback: (state: WindowState) => void) => void;

  wsGetWorkspaces: () => Promise<{ workspaces: WorkspaceInfo[]; activeWorkspace: string | null }>;
  wsSetWorkspaces: (config: { workspaces: WorkspaceInfo[]; activeWorkspace?: string }) => void;
  wsOpenWorkspace: (workspacePath: string) => Promise<{ success: boolean; error?: string }>;
  wsSelectDirectory: () => Promise<{ path: string | null; error?: string }>;
  wsReadGraph: (workspacePath: string) => Promise<WorkspaceGraph>;
  wsExecuteGraphCommand: (
    workspacePath: string,
    command: WorkspaceGraphCommand,
    origin: GraphCommandOrigin,
    expectedRevision: number
  ) => Promise<WorkspaceGraphCommandResult>;
  wsUndoGraph: (
    workspacePath: string,
    expectedRevision: number
  ) => Promise<WorkspaceGraphHistoryResult>;
  wsRedoGraph: (
    workspacePath: string,
    expectedRevision: number
  ) => Promise<WorkspaceGraphHistoryResult>;
  onWorkspaceGraphUpdated: (callback: (event: WorkspaceGraphUpdate) => void) => void;
  /** ディスクから読み直す（外で書き換えたファイルを取り込む）。 */
  wsReloadWorkspace: (workspacePath: string) => Promise<WorkspaceGraph>;
  /** ノードの本文。読み込みでは本文を読まない（`bodyLoaded: false`）ので、開いたときに読む。 */
  wsReadNodeBody: (
    workspacePath: string,
    nodeId: string
  ) => Promise<{ body: unknown; format: string }>;
  /** 全ノードの本文（本文の検索・全メモの形式変換のとき）。 */
  wsReadAllNodeBodies: (
    workspacePath: string
  ) => Promise<Record<string, { body: unknown; format: string }>>;
  wsSaveGraphAsset: (
    workspacePath: string,
    nodeId: string,
    fileName: string,
    bytes: Uint8Array,
    kind?: GraphAssetKind
  ) => Promise<{ relativePath: string }>;
  wsResolveGraphAsset: (
    workspacePath: string,
    nodeId: string,
    relativePath: string
  ) => Promise<{ url: string }>;
  wsOpenGraphAsset: (
    workspacePath: string,
    nodeId: string,
    relativePath: string,
    chooseProgram?: boolean
  ) => Promise<void>;
}
