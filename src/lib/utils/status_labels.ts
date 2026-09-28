/**
 * ステータスの値と画面上の名前。
 *
 * 以前はコンポーネントごとに対応表を持っていて、一括操作の選択肢と
 * 絞り込み中の帯だけが英語の値（Open / Completed）をそのまま出していた。
 * 同じ状態が場所によって違う名前で見えないよう、ここだけで定義する。
 */

/** ステータスを持たないノード。既定値ではなく、他と対等な状態のひとつ。 */
export const NO_STATUS = "";

/** 選択肢に並べる順。 */
export const STATUS_VALUES = [
  NO_STATUS,
  "Undefined",
  "Open",
  "Pending",
  "In Progress",
  "Completed",
  "Canceled",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  [NO_STATUS]: "なし",
  Undefined: "未定義",
  Open: "未着手",
  Pending: "保留",
  "In Progress": "進行中",
  Completed: "完了",
  Canceled: "キャンセル",
};

/**
 * 旧形式から持ち込まれた「未定義」。「ステータスなし」と見分けがつかず、
 * 選択肢に並んでいても選ぶ理由が無いので、新しく選ぶ一覧には出さない。
 * すでにこの状態のノードでは、いまの値として表示できるよう選択肢に残す。
 */
export const LEGACY_STATUS = "Undefined";

/** 新しく選べる状態（「未定義」を除く）。 */
export const SELECTABLE_STATUS_VALUES = STATUS_VALUES.filter((value) => value !== LEGACY_STATUS);

/** `current` の状態のノードに出す選択肢。 */
export function statusChoices(current: string | null | undefined): readonly string[] {
  return current === LEGACY_STATUS ? STATUS_VALUES : SELECTABLE_STATUS_VALUES;
}

/**
 * 状態を選ぶ一覧（行のステータス・一括変更）での「なし」の名前。単独の
 * 「なし」だと何が無いのか分からないので、選択肢の中ではこう呼ぶ。
 */
export const NO_STATUS_OPTION_LABEL = "ステータスなし";

/** 画面に出す名前。知らない値はそのまま返す。 */
export function statusLabel(value: string | null | undefined): string {
  return STATUS_LABELS[value ?? NO_STATUS] ?? String(value);
}

/** 選択肢として出す名前（「なし」だけ言い換える）。 */
export function statusOptionLabel(value: string | null | undefined): string {
  return (value ?? NO_STATUS) === NO_STATUS ? NO_STATUS_OPTION_LABEL : statusLabel(value);
}
