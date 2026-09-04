import type { MemoFormat } from "@features/memos/utils/memo_utils";

export type WorkspaceTaskStatus = "Open" | "Pending" | "In Progress" | "Completed" | "Canceled";

export interface WorkspaceMemo {
  id: string;
  title: string;
  content: unknown;
  tags: string[];
  format?: MemoFormat;
  order?: number;
  bodyLoaded?: boolean;
}

export interface WorkspaceAttachment {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedAt?: string;
}

/**
 * 親へのリンク（＝ツリーの辺）。
 *
 * 並び順は**辺の属性**なので、親 id と同じ場所に置く。ノードに 1 つの
 * `order` を持たせると、多親ノードが親ごとに違う位置を取れない
 * （片方の親の下で並べ替えると、もう片方でも動いてしまう）。
 */
export interface WorkspaceParentLink {
  id: string;
  /** その親の下での並び順。未指定は「末尾」扱い。 */
  order?: number;
}

export interface WorkspaceTask {
  id: string;
  name: string;
  /**
   * ステータス。**省略可**。省略は「ステータスを持たないノード」を意味し、
   * `Open` へのフォールバックではない。ファイルでは `status:` キーごと書かない。
   */
  status?: WorkspaceTaskStatus;
  startDate?: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  /** Empty array means this is the root task (project itself). */
  parents: WorkspaceParentLink[];
  memos: WorkspaceMemo[];
  /** Tags on the task itself. Persisted in `_index.md` / `_project.md` frontmatter. */
  tags?: string[];
  attachments?: WorkspaceAttachment[];
  createdAt: string; // YYYY-MM-DD
  /**
   * ルートタスク（プロジェクト自身）の、ワークスペース内での並び順。
   * 通常タスクの並び順は `parents[].order` に持つ。
   */
  order?: number;
  /** Archived (soft-deleted) flag. Persisted in `_task.md` frontmatter. */
  archived?: boolean;
  /** ISO 8601 timestamp set when archived. */
  archivedAt?: string;
}

export interface WorkspaceInfo {
  path: string;
  label: string;
}

export interface WorkspaceProjectListItem {
  name: string;
  rootId: string;
  dirName: string;
  projectDir: string;
  order?: number;
}

export interface WorkspaceProject {
  tasks: Record<string, WorkspaceTask>;
}

export interface WorkspaceProjectPatch {
  tasks: WorkspaceTask[];
  deletedTaskIds: string[];
}
