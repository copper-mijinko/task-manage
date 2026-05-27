import { get, writable } from "svelte/store";
import { tree_data } from "@features/tasks/stores/tree";
import { selected_type, show_archived } from "@stores/ui";
import type { TreeData } from "@features/tasks/utils/tree_control";
import type { SelectedType } from "@app-types/app";

/** tag name (lowercase) → set of task node IDs that have a memo with this tag */
export type TagIndex = Map<string, Set<string>>;
export type MemoTagScope = "db" | "workspace" | "none";

export const tag_index = writable<TagIndex>(new Map());
export const active_tag = writable<string | null>(null);

export function memoTagScopeForSelectedType(selectedType: SelectedType): MemoTagScope {
  if (selectedType === "WorkspaceProject") return "workspace";
  if (selectedType === "Projects") return "db";
  return "none";
}

function rebuildTagIndex() {
  const projectData = get(tree_data);
  const includeArchived = get(show_archived);
  const index = new Map<string, Set<string>>();

  function walk(nodes: TreeData[], insideArchived: boolean) {
    for (const node of nodes ?? []) {
      const archivedHere = insideArchived || !!node.archived;
      // archived (および archived 配下) は show_archived = OFF のとき集計から外す。
      if (archivedHere && !includeArchived) continue;
      for (const memo of node.data.memo ?? []) {
        for (const tag of (memo.tags as string[]) ?? []) {
          const normalized = tag.toLowerCase();
          if (!index.has(normalized)) index.set(normalized, new Set());
          index.get(normalized)!.add(node.id);
        }
      }
      walk(node.children ?? [], archivedHere);
    }
  }

  walk(projectData?.data ? [projectData.data] : [], false);
  tag_index.set(index);
}

tree_data.subscribe(rebuildTagIndex);
show_archived.subscribe(rebuildTagIndex);

let currentTagScope: MemoTagScope | null = null;

selected_type.subscribe((selectedType) => {
  const nextScope = memoTagScopeForSelectedType(selectedType);
  if (currentTagScope !== null && nextScope !== currentTagScope) {
    active_tag.set(null);
  }
  currentTagScope = nextScope;
});

tag_index.subscribe((index) => {
  const active = get(active_tag);
  if (active && !index.has(active)) {
    active_tag.set(null);
  }
});
