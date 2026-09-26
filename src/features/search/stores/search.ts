import { writable } from "svelte/store";
import type { FilterState } from "@app-types/app";

/**
 * ツリーの絞り込み条件（列ごとの値の配列）。絞り込んだ結果は
 * ツリーグリッドのアプリケーション（`application.filtered`）が導く。
 */
export const filter = writable<FilterState>({});
export const pageSearchQuery = writable<string>("");

/**
 * ページ内検索の一致のうち、ツリーが画面外でも描いておく行の上限。よくある語
 * では全行が一致するので、全部描くと仮想化前と同じ重さになる。
 */
export const PAGE_SEARCH_PIN_LIMIT = 100;

/**
 * ページ内検索の件数が「一部だけ」かどうか。ツリーは見えている行の周りしか
 * 描かないので、一致する行が多いと描いていない一致が残り、画面の文字から
 * 数えた件数も「何番目か」も全体とずれる。そのときヘッダーは順番を出さず、
 * 「100+ 件」とだけ出す。
 */
export const pageSearchCountIsPartial = writable<boolean>(false);
