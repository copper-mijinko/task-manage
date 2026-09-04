import { get, writable } from "svelte/store";
import * as platform from "@lib/ipc/platform";
import { normalizeTagList } from "@lib/utils/tags";
import { workspace_store } from "@features/workspace/stores/workspace";
import type { WorkspaceTask, WorkspaceTaskStatus } from "@app-types/workspace";

/**
 * 予定ビュー（ワークスペース横断）の状態。
 *
 * これまでタスクは「選択中のプロジェクト 1 つ」の中でしか見えず、
 * 期限が近いものを把握するにはプロジェクトを 1 つずつ開いて回るしかなかった。
 * このストアはワークスペース配下の全プロジェクトを読み、期限でまとめた
 * 1 本のリストとして提供する。
 *
 * 読み込みは main 側の workspace cache 経由（`preferCache`）なので、
 * 通常はディスクを読み直さずメモリから返る。
 */

/** 予定ビューを選択状態として表す sentinel id。Inbox と同じ考え方。 */
export const AGENDA_SELECTED_ID = "__agenda__";

export type AgendaBucket = "overdue" | "today" | "soon" | "later" | "someday";

export interface AgendaItem {
  taskId: string;
  name: string;
  status: WorkspaceTaskStatus;
  dueDate?: string;
  startDate?: string;
  tags: string[];
  projectName: string;
  projectDir: string;
  projectRootId: string;
  /** ルートからの親タスク名。どの文脈のタスクか分かるように出す。 */
  parentPath: string;
  bucket: AgendaBucket;
  /** 期限までの日数。過ぎていれば負。期限なしは undefined。 */
  daysLeft?: number;
}

export interface AgendaState {
  items: AgendaItem[];
  loading: boolean;
  /** 読み込めなかったプロジェクト名。全滅ではなく部分失敗を出すために持つ。 */
  failedProjects: string[];
  loadedAt: number | null;
}

const DONE_STATUSES = new Set<WorkspaceTaskStatus>(["Completed", "Canceled"]);
/** 「まもなく」に入れる日数（今日を 0 として 7 日先まで）。 */
const SOON_DAYS = 7;

export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function daysBetweenIsoDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromUtc = Date.UTC(fy, (fm ?? 1) - 1, fd ?? 1);
  const toUtc = Date.UTC(ty, (tm ?? 1) - 1, td ?? 1);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

export function bucketForDueDate(dueDate: string | undefined, today: string): AgendaBucket {
  if (!dueDate) return "someday";
  const days = daysBetweenIsoDates(today, dueDate);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= SOON_DAYS) return "soon";
  return "later";
}

export const BUCKET_ORDER: AgendaBucket[] = ["overdue", "today", "soon", "later", "someday"];

export const BUCKET_LABELS: Record<AgendaBucket, string> = {
  overdue: "期限切れ",
  today: "今日",
  soon: "7日以内",
  later: "それ以降",
  someday: "期限なし",
};

/**
 * 1 プロジェクト分のタスク集合を予定アイテムへ変換する。
 * 完了 / 中止と、アーカイブされたタスク（およびその配下）は落とす。
 */
export function buildAgendaItemsForProject(
  tasks: Record<string, WorkspaceTask>,
  project: { name: string; projectDir: string; rootId: string },
  today: string
): AgendaItem[] {
  const archived = new Set<string>();
  const parentNameById = new Map<string, string>();
  for (const task of Object.values(tasks)) {
    parentNameById.set(task.id, task.name);
  }

  // アーカイブは子孫にも波及する。親から順に決めたいが `tasks` は
  // フラットなので、変化がなくなるまで伝播させる（プロジェクト単位で
  // 数十〜数百件なので実用上は 1〜2 周で収束する）。
  for (const task of Object.values(tasks)) {
    if (task.archived) archived.add(task.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of Object.values(tasks)) {
      if (archived.has(task.id)) continue;
      // 親が全てアーカイブされて初めて、そのタスクも辿れなくなる。多親では
      // 片方がアーカイブでも、もう片方から生きて辿れる（ツリーの
      // isNodeEffectivelyArchived と同じ規則）。
      const parents = task.parents ?? [];
      if (parents.length > 0 && parents.every((parent) => archived.has(parent.id))) {
        archived.add(task.id);
        changed = true;
      }
    }
  }

  const items: AgendaItem[] = [];
  for (const task of Object.values(tasks)) {
    if (archived.has(task.id)) continue;
    if (DONE_STATUSES.has(task.status)) continue;
    // ルートタスク（プロジェクトそのもの）は行として出さない。
    if ((task.parents ?? []).length === 0) continue;

    const parentNames = (task.parents ?? [])
      .map((parent) => parentNameById.get(parent.id))
      .filter((name): name is string => Boolean(name) && name !== project.name);

    items.push({
      taskId: task.id,
      name: task.name,
      status: task.status,
      dueDate: task.dueDate,
      startDate: task.startDate,
      tags: normalizeTagList(task.tags),
      projectName: project.name,
      projectDir: project.projectDir,
      projectRootId: project.rootId,
      parentPath: parentNames.join(" / "),
      bucket: bucketForDueDate(task.dueDate, today),
      daysLeft: task.dueDate ? daysBetweenIsoDates(today, task.dueDate) : undefined,
    });
  }
  return items;
}

/** 期限の早い順。期限なしは最後、同じ日ならプロジェクト名→タスク名で安定させる。 */
export function sortAgendaItems(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    if (a.projectName !== b.projectName) return a.projectName < b.projectName ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

function createAgendaStore() {
  const { subscribe, set, update } = writable<AgendaState>({
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

    const today = todayIsoDate();
    const failedProjects: string[] = [];
    const collected: AgendaItem[] = [];

    const results = await Promise.all(
      (projects ?? []).map(async (project) => {
        try {
          const result = await platform.wsReadProject(project.projectDir, { preferCache: true });
          if (!result?.tasks) return { project, items: [] as AgendaItem[], failed: true };
          return {
            project,
            items: buildAgendaItemsForProject(
              result.tasks,
              {
                name: project.name,
                projectDir: project.projectDir,
                rootId: project.rootId,
              },
              today
            ),
            failed: false,
          };
        } catch {
          return { project, items: [] as AgendaItem[], failed: true };
        }
      })
    );

    if (token !== loadToken) return;

    for (const result of results) {
      if (result.failed) failedProjects.push(result.project.name);
      collected.push(...result.items);
    }

    set({
      items: sortAgendaItems(collected),
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

export const agenda_store = createAgendaStore();
