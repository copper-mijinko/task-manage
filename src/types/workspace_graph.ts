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
  /** Import provenance used by the main process to resolve existing assets. */
  sourceProjectDir?: string;
  sourceTaskDir?: string;
  /** Node whose canonical asset directory this node may read after a copy. */
  assetOwnerId?: string;
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
   * 元に戻す / やり直しの残り段数。main プロセスが読み出し経路でだけ添える
   * 非永続フィールドで、`graph-v1.json` には書かれない。ツールバーの
   * 「元に戻す」「やり直し」を正しく無効化するために使う。
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

export interface WorkspaceGraphCommandResult {
  graph: WorkspaceGraph;
  selectedNodeIds: string[];
}
