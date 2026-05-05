import { writable } from "svelte/store";
import { tree_data } from "./tree";
import type { TreeData } from "../common/tree_control";

/** tag name (lowercase) → set of task node IDs that have a memo with this tag */
export type TagIndex = Map<string, Set<string>>;

export const tag_index = writable<TagIndex>(new Map());
export const active_tag = writable<string | null>(null);

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
