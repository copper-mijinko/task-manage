import type { WorkspaceTaskStatus } from "@app-types/workspace";

/**
 * 期限日の「差し迫り具合」を 1 か所で決めるユーティリティ。
 *
 * これまで DateInput と TreeTableRow がそれぞれ別の計算を持っていて、同じタスクでも
 * 表示が食い違っていた（完了タスクの行は無色なのに、その行の日付入力だけ赤い、など）。
 * タスク一覧・タスク詳細・Inbox の判定はここに集約する。予定ビューは 7 日単位の
 * 別のまとめ方をするので、独自のバケット分けを持つ。
 *
 * 日付は `YYYY-MM-DD` のカレンダー日として扱い、暦日の差だけを見る。
 * `new Date("2026-09-03")` は UTC 深夜として解釈されるため、これを
 * ローカル現在時刻と直接引き算すると UTC+9 では「翌朝 9 時まで期限切れに
 * ならない」といった時差ぶんのずれが出る。
 */

/** 期限切れまでの猶予がこの日数未満なら「期限間近」。 */
export const DUE_SOON_DAYS = 5;

export type DateUrgency = "overdue" | "today" | "due-soon" | "none";

/** ローカルの今日を `YYYY-MM-DD` で返す。 */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `from` から `to` までの暦日数。過去なら負。日付として読めなければ null。 */
export function daysBetweenIsoDates(from: string, to: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };
  const fromUtc = parse(from);
  const toUtc = parse(to);
  if (fromUtc === null || toUtc === null) return null;
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

/** 期限の色付けを止めるステータス。終わったタスクは急かさない。 */
export function isSettledStatus(status?: string | WorkspaceTaskStatus | null): boolean {
  return status === "Completed" || status === "Canceled";
}

/**
 * 期限日の状態を返す。
 *
 * - 完了 / 中止のタスクは常に "none"（もう間に合わせる余地がない）
 * - 開始日など「期限ではない日付」にはそもそも使わない
 */
export function dueDateUrgency(
  dueDate: string | undefined | null,
  status?: string | WorkspaceTaskStatus | null,
  today: string = todayIso()
): DateUrgency {
  if (!dueDate || isSettledStatus(status)) return "none";
  const days = daysBetweenIsoDates(today, dueDate);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days < DUE_SOON_DAYS) return "due-soon";
  return "none";
}

/** ツールチップ用の日本語ラベル。状態がないときは undefined。 */
export function dueDateUrgencyLabel(
  dueDate: string | undefined | null,
  status?: string | WorkspaceTaskStatus | null,
  today: string = todayIso()
): string | undefined {
  const urgency = dueDateUrgency(dueDate, status, today);
  if (urgency === "none") return undefined;
  const days = daysBetweenIsoDates(today, dueDate as string);
  if (days === null) return undefined;
  if (urgency === "overdue") return `期限切れ: ${dueDate}（${-days}日超過）`;
  if (urgency === "today") return `今日が期限: ${dueDate}`;
  return `期限間近: ${dueDate}（あと${days}日）`;
}
