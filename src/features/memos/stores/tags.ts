import { get, writable } from "svelte/store";

/** tag name (lowercase) → そのタグを持つノード id の集合 */
export type TagIndex = Map<string, Set<string>>;

/** 開いているプロジェクトのタグ索引。`WorkspaceTreeGridPage` がツリーから作る。 */
export const tag_index = writable<TagIndex>(new Map());
/** サイドバーで選んだタグ。ツリーをそのタグを持つノードに絞る。 */
export const active_tag = writable<string | null>(null);

tag_index.subscribe((index) => {
  const active = get(active_tag);
  if (active && !index.has(active)) {
    active_tag.set(null);
  }
});
