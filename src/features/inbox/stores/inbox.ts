import { derived, type Readable } from "svelte/store";
import { workspace_graph } from "@features/workspace/stores/graph";

/**
 * 「Inbox を開け」という一回限りの指示として `selected_id` に入れる値。
 * ページ（`WorkspaceTreeGridPage`）が受け取った直後に実ノードの id へ書き換える。
 */
export const INBOX_SELECTED_ID = "__inbox__";

/**
 * Inbox ビューが実際に開いているノード id を解決する。
 *
 * `INBOX_SELECTED_ID` はページ側がすぐ実ノードの id へ書き換えるので、
 * 「いま Inbox を表示しているか」を知りたい側はページと同じ解決規則を使う。
 */
export function resolveInboxNodeId(
  navigation: { inboxId?: string; names?: Record<string, string>; rootId?: string } | null
): string | undefined {
  if (!navigation) return undefined;
  if (navigation.inboxId) return navigation.inboxId;
  const named = Object.entries(navigation.names ?? {}).find(
    ([, name]) => name?.toLowerCase() === "inbox"
  );
  return named?.[0] ?? navigation.rootId;
}

/** Inbox 直下の、アーカイブしていないノードの数（ヘッダーのバッジ）。 */
export const inbox_count: Readable<number> = derived(workspace_graph, (graph) => {
  const inboxId = graph?.inboxId;
  if (!graph || !inboxId) return 0;
  let count = 0;
  for (const node of Object.values(graph.nodes)) {
    if (node.archived) continue;
    const link = node.parents.find((parent) => parent.id === inboxId);
    if (link && !link.archived) count += 1;
  }
  return count;
});
