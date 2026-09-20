import type { MemoFormat } from "@features/memos/utils/memo_utils";

export type WorkspaceTaskStatus =
  | "Undefined"
  | "Open"
  | "Pending"
  | "In Progress"
  | "Completed"
  | "Canceled";

/** ノード本文の遅延読み込みで返るもの。 */
export interface NodeBody {
  body: unknown;
  format: MemoFormat;
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
  /**
   * この**辺だけ**をアーカイブしたか。多親ノードで「この場所からは片付けたい
   * が、他の親の下では現役のまま」を表す。ノード自体の `archived` とは別で、
   * どちらかが立っていればその行はアーカイブ扱いになる。
   */
  archived?: boolean;
  /** 辺をアーカイブした時刻（ISO 文字列）。 */
  archivedAt?: string;
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
  /**
   * ノード本文。`_index.md` のフロントマターより後ろがそのまま入る。
   *
   * 「1 つのメモ ＝ 1 つのノード」なので、ノードは 1 つだけ本文を持つ。
   * 複数の記録を持ちたいときは、タブではなく**子ノード**にする。
   */
  body?: unknown;
  /** 本文の形式。省略時はワークスペースでは `markdown`。 */
  format?: MemoFormat;
  /** 本文を読み込み済みか。一覧目的の読み出しでは本文を読まない。 */
  bodyLoaded?: boolean;
  /** Tags on the task itself. Persisted in `_index.md` / `_project.md` frontmatter. */
  tags?: string[];
  attachments?: WorkspaceAttachment[];
  createdAt: string; // YYYY-MM-DD
  /**
   * ルートノード（プロジェクト自身）の、ワークスペース内での並び順。
   * 通常ノードの並び順は `parents[].order` に持つ。
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
