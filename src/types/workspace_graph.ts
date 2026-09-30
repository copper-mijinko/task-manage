import type { WorkspaceAttachment, WorkspaceTask } from "./workspace";

export type WorkspaceNodeStatus =
  | "Undefined"
  | "Open"
  | "Pending"
  | "In Progress"
  | "Completed"
  | "Canceled";

export interface WorkspaceGraphNode extends Omit<WorkspaceTask, "status"> {
  status?: WorkspaceNodeStatus;
  attachments?: WorkspaceAttachment[];
}

export interface WorkspaceGraph {
  schemaVersion: 1;
  workspaceId: string;
  rootId: string;
  inboxId?: string;
  revision: number;
  nodes: Record<string, WorkspaceGraphNode>;
  positions?: Record<string, { x: number; y: number }>;
  /**
   * 元に戻す / やり直しの残り段数。main プロセスが添える非永続フィールドで、
   * ファイルには書かれない。ツールバーの「元に戻す」「やり直し」を正しく
   * 無効化するために使う。
   */
  history?: { undo: number; redo: number };
}

export type GraphCommandOrigin = "graph" | "tree" | "finder";
export type WorkspaceGraphCommand =
  | { type: "batch"; commands: WorkspaceGraphCommand[] }
  | {
      type: "create-node";
      parentId: string;
      node: Partial<Omit<WorkspaceGraphNode, "id" | "parents">> & { name?: string };
      order?: number;
    }
  | { type: "set-position"; nodeId: string; x: number; y: number }
  | { type: "update-node"; nodeId: string; changes: Partial<WorkspaceGraphNode> }
  | { type: "link"; childId: string; parentId: string; order?: number }
  | {
      type: "move";
      childId: string;
      fromParentId: string;
      toParentId: string;
      order?: number;
    }
  | { type: "detach"; childId: string; parentId: string }
  | {
      /** その辺だけをアーカイブ／復元する（ノード自体の archived とは独立）。 */
      type: "archive-edge";
      childId: string;
      parentId: string;
      archived: boolean;
    }
  | { type: "delete-node"; nodeId: string }
  | {
      type: "copy";
      order?: number;
      nodeId: string;
      targetParentId: string;
      mode: "node" | "share-children" | "subgraph";
    };

/**
 * 操作の結果を、変わったノードだけで伝える形。画面は持っているグラフ
 * （`baseRevision`）にこれを当てて、新しいグラフ（`revision`）を作る。
 */
export interface WorkspaceGraphDelta {
  baseRevision: number;
  revision: number;
  /** 変わった・増えたノード。`null` はそのノードが消えたこと。 */
  nodes: Record<string, WorkspaceGraphNode | null>;
  /** ノード以外の欄（`inboxId`・`positions`）で変わったもの。`null` はその欄が無くなったこと。 */
  fields: { inboxId?: string | null; positions?: WorkspaceGraph["positions"] | null };
  history: { undo: number; redo: number };
}

/** コマンドの結果。main は差分（`delta`）で返し、全体（`graph`）は読み直したときだけ。 */
export interface WorkspaceGraphCommandResult {
  selectedNodeIds: string[];
  graph?: WorkspaceGraph;
  delta?: WorkspaceGraphDelta | null;
}

/** 元に戻す / やり直しの結果。 */
export interface WorkspaceGraphHistoryResult {
  changed: boolean;
  graph?: WorkspaceGraph;
  delta?: WorkspaceGraphDelta | null;
}
