export type WorkspaceTaskStatus = "Open" | "Pending" | "In Progress" | "Completed" | "Canceled";

export interface WorkspaceMemo {
  title: string;
  content: string; // Markdown
}

export interface WorkspaceTask {
  id: string;
  name: string;
  status: WorkspaceTaskStatus;
  dueDate?: string; // YYYY-MM-DD
  /** Empty array means this is the root task (project itself). */
  parents: string[];
  memos: WorkspaceMemo[];
  createdAt: string; // YYYY-MM-DD
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
}

export interface WorkspaceProject {
  tasks: Record<string, WorkspaceTask>;
}
