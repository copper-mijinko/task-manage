import { get, writable } from "svelte/store";
import { tree_data } from "./tree";
import { selected_type } from "./ui";
import type { TreeData } from "../common/tree_control";
import type { SelectedType } from "../types/app";

/** tag name (lowercase) → set of task node IDs that have a memo with this tag */
export type TagIndex = Map<string, Set<string>>;
export type MemoTagScope = "quill" | "markdown" | "none";

export const tag_index = writable<TagIndex>(new Map());
export const active_tag = writable<string | null>(null);

export function memoTagScopeForSelectedType(selectedType: SelectedType): MemoTagScope {
  if (selectedType === "WorkspaceProject") return "markdown";
  if (selectedType === "Projects") return "quill";
  return "none";
}

tree_data.subscribe((projectData) => {
  const index = new Map<string, Set<string>>();

  function walk(nodes: TreeData[]) {
    for (const node of nodes ?? []) {
      for (const memo of node.data.memo ?? []) {
        for (const tag of (memo.tags as string[]) ?? []) {
          const normalized = tag.toLowerCase();
          if (!index.has(normalized)) index.set(normalized, new Set());
          index.get(normalized)!.add(node.id);
        }
      }
      walk(node.children ?? []);
    }
  }

  walk(projectData?.data ? [projectData.data] : []);
  tag_index.set(index);
});

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
