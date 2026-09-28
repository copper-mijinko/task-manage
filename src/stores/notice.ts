import { writable } from "svelte/store";

/**
 * 画面右上に短く出す通知（操作の結果を知らせ、必要なら取り消せるようにする）。
 *
 * アーカイブや元に戻すは、何が起きたかが画面のどこにも出ないので、実行した
 * 直後に 1 行で知らせる。確認ダイアログで止める代わりに、あとから
 * 「元に戻す」を押せるようにする。
 */
export interface Notice {
  id: number;
  message: string;
  actionLabel?: string;
  action?: () => void;
}

export const notice = writable<Notice | null>(null);

let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showNotice(
  message: string,
  {
    actionLabel,
    action,
    timeout = 6000,
  }: { actionLabel?: string; action?: () => void; timeout?: number } = {}
): number {
  const id = ++sequence;
  notice.set({ id, message, actionLabel, action });
  clearTimeout(timer);
  timer = setTimeout(
    () => notice.update((current) => (current?.id === id ? null : current)),
    timeout
  );
  return id;
}

export function dismissNotice(id?: number) {
  notice.update((current) => (id === undefined || current?.id === id ? null : current));
}
