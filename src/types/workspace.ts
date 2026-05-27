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

export interface WorkspaceTask {
  id: string;
  name: string;
  status: WorkspaceTaskStatus;
  startDate?: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  /** Empty array means this is the root task (project itself). */
  parents: string[];
  memos: WorkspaceMemo[];
  attachments?: WorkspaceAttachment[];
  createdAt: string; // YYYY-MM-DD
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
