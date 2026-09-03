import { get, writable } from "svelte/store";
import * as platform from "@lib/ipc/platform";
import { normalizeTagList } from "@lib/utils/tags";
import { normalizeMemoKind } from "@features/memos/utils/memo_utils";
import { workspace_store } from "@features/workspace/stores/workspace";
import type { WorkspaceTask } from "@app-types/workspace";

/**
 * ナレッジビュー（ワークスペース横断）の状態。
 *
 * メモはタスクの下にぶら下がっているので、どのタスクに書いたか覚えていないと
 * 辿り着けなかった。ナレッジ（`kind: knowledge`）はタスクより長生きする前提の
 * 記録なので、生まれた場所とは切り離して一覧できないと意味がない。
 *
 * 読み込みは予定ビューと同じく main 側の workspace cache 経由（`preferCache`）。
 * 一覧に要るのはタイトルとタグだけなので本文は読まない。
 */

/** ナレッジビューを選択状態として表す sentinel id。予定 / Inbox と同じ考え方。 */
export const KNOWLEDGE_SELECTED_ID = "__knowledge__";

export interface KnowledgeItem {
  memoId: string;
  title: string;
  tags: string[];
  taskId: string;
  taskName: string;
  projectName: string;
  projectDir: string;
  projectRootId: string;
  /** ルートからの親タスク名。どの文脈で書かれたものかを示す。 */
  parentPath: string;
  /**
   * 由来のタスクがアーカイブ済みか。ナレッジはタスクの寿命に縛られないので
   * 一覧からは外さず、印だけ付ける。
   */
  fromArchivedTask: boolean;
}

export interface KnowledgeState {
  items: KnowledgeItem[];
  loading: boolean;
  /** 読み込めなかったプロジェクト名。全滅ではなく部分失敗を出すために持つ。 */
  failedProjects: string[];
  loadedAt: number | null;
}

export function buildKnowledgeItemsForProject(
  tasks: Record<string, WorkspaceTask>,
  project: { name: string; projectDir: string; rootId: string }
): KnowledgeItem[] {
  const nameById = new Map<string, string>();
  for (const task of Object.values(tasks)) {
    nameById.set(task.id, task.name);
  }

  // アーカイブは子孫にも波及する。`tasks` はフラットなので収束するまで伝播させる。
  const archived = new Set<string>();
  for (const task of Object.values(tasks)) {
    if (task.archived) archived.add(task.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of Object.values(tasks)) {
      if (archived.has(task.id)) continue;
      if ((task.parents ?? []).some((parentId) => archived.has(parentId))) {
        archived.add(task.id);
        changed = true;
      }
    }
  }

  const items: KnowledgeItem[] = [];
  for (const task of Object.values(tasks)) {
    const parentNames = (task.parents ?? [])
      .map((parentId) => nameById.get(parentId))
      .filter((name): name is string => Boolean(name) && name !== project.name);

    for (const memo of task.memos ?? []) {
      if (normalizeMemoKind(memo.kind) !== "knowledge") continue;
      items.push({
        memoId: memo.id,
        title: memo.title || "無題",
        tags: normalizeTagList(memo.tags),
        taskId: task.id,
        taskName: task.name,
        projectName: project.name,
        projectDir: project.projectDir,
        projectRootId: project.rootId,
        parentPath: parentNames.join(" / "),
        fromArchivedTask: archived.has(task.id),
      });
    }
  }
  return items;
}

export function sortKnowledgeItems(items: KnowledgeItem[]): KnowledgeItem[] {
  return [...items].sort((a, b) => {
    // 生きているものを先に出す。アーカイブ由来は参照できるだけでよい。
    if (a.fromArchivedTask !== b.fromArchivedTask) return a.fromArchivedTask ? 1 : -1;
    if (a.projectName !== b.projectName) return a.projectName < b.projectName ? -1 : 1;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
}

/** 一覧の絞り込み。タイトル・タグ・タスク名・プロジェクト名を対象にする。 */
export function filterKnowledgeItems(items: KnowledgeItem[], query: string): KnowledgeItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [item.title, item.taskName, item.projectName, item.parentPath, ...item.tags]
      .join(" ")
      .toLowerCase()
      .includes(needle)
  );
}

function createKnowledgeStore() {
  const { subscribe, set, update } = writable<KnowledgeState>({
    items: [],
    loading: false,
    failedProjects: [],
    loadedAt: null,
  });

  let loadToken = 0;

  async function load() {
    const token = ++loadToken;
    const { projects } = get(workspace_store);
    update((state) => ({ ...state, loading: true }));

    const failedProjects: string[] = [];
    const collected: KnowledgeItem[] = [];

    const results = await Promise.all(
      (projects ?? []).map(async (project) => {
        try {
          const result = await platform.wsReadProject(project.projectDir, { preferCache: true });
          if (!result?.tasks) return { project, items: [] as KnowledgeItem[], failed: true };
          return {
            project,
            items: buildKnowledgeItemsForProject(result.tasks, {
              name: project.name,
              projectDir: project.projectDir,
              rootId: project.rootId,
            }),
            failed: false,
          };
        } catch {
          return { project, items: [] as KnowledgeItem[], failed: true };
        }
      })
    );

    if (token !== loadToken) return;

    for (const result of results) {
      if (result.failed) failedProjects.push(result.project.name);
      collected.push(...result.items);
    }

    set({
      items: sortKnowledgeItems(collected),
      loading: false,
      failedProjects,
      loadedAt: Date.now(),
    });
  }

  return {
    subscribe,
    set,
    update,
    load,
    reset() {
      loadToken += 1;
      set({ items: [], loading: false, failedProjects: [], loadedAt: null });
    },
  };
}

export const knowledge_store = createKnowledgeStore();
