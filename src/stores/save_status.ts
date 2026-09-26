import { writable } from "svelte/store";
import type { SaveStatus } from "@app-types/app";

/**
 * ヘッダーの保存状態。グラフの操作（`workspace_graph_store`）が、書き込み中・
 * 保存済み・失敗を知らせる。
 */
export const saveStatus = writable<SaveStatus>("idle");
