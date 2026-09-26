// 絞り込み・並べ替えの組み合わせ。条件を重ね、1 つずつ外し、編集や
// スコープの切り替えと混ぜても、見えている行が条件どおりであることを確かめる。
import { test, expect } from "@playwright/test";
import { createWorkspace, graphOf, overflow, row, run, select, visibleRows } from "./support.js";

const filterBox = (page) => page.getByRole("textbox", { name: "ノード一覧を絞り込み" });
const activeFilters = (page) => page.getByRole("status").filter({ hasText: "絞り込み中" });

/** サイドバーからプロジェクト（スコープ）を開く。閉じていれば開く。 */
async function openScope(page, name) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
  await button.click();
}

/** 見えている行のうち、`parent`（名前）の直下の行の名前。 */
async function rowsUnder(page, parent) {
  const rows = await visibleRows(page);
  const start = rows.findIndex((entry) => entry.endsWith(`:${parent}`));
  const depth = Number(rows[start].split(":")[0]);
  const result = [];
  for (const entry of rows.slice(start + 1)) {
    const entryDepth = Number(entry.split(":")[0]);
    if (entryDepth <= depth) break;
    if (entryDepth === depth + 1) result.push(entry.slice(entry.indexOf(":") + 1));
  }
  return result;
}

/** ステータスの絞り込みパネルで、指定した状態だけを選ぶ。 */
async function filterStatus(page, labels) {
  await page.getByRole("button", { name: "ステータスフィルター", exact: true }).click();
  const panel = page.locator(".StatusFilterPanel, [aria-label='ステータス フィルター']").first();
  for (const label of labels) await page.getByRole("checkbox", { name: label }).check();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
}

test("text, status and tag filters stack, can be removed one at a time, and clear together", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await filterStatus(page, ["未着手"]);
    // 未着手: Spec と Groceries（と、その祖先）
    await expect(row(page, "root/work/build")).toHaveCount(0);
    await expect(row(page, "root/work/release")).toHaveCount(0);
    await expect(row(page, "root/work/spec")).toBeVisible();
    await expect(row(page, "root/home/groceries")).toBeVisible();

    // 名前でも絞ると、両方を満たす行だけ残る。
    await filterBox(page).fill("Groc");
    await expect(row(page, "root/work/spec")).toHaveCount(0);
    await expect(row(page, "root/home/groceries")).toBeVisible();
    await activeFilters(page).getByRole("button", { name: "全文フィルタ「Groc」を削除" }).click();
    await expect(filterBox(page)).toHaveValue("");
    await expect(row(page, "root/work/spec")).toBeVisible();

    // タグの列を出し、行のタグをクリックすると、タグでも絞り込む。
    await overflow(page, "列の設定");
    await page
      .getByRole("dialog", { name: "列の設定" })
      .getByRole("checkbox", { name: "タグ", exact: true })
      .check();
    await page.keyboard.press("Escape");
    await row(page, "root/work/spec")
      .getByRole("button", { name: /design/ })
      .click();
    await expect(row(page, "root/home/groceries")).toHaveCount(0);
    await expect(row(page, "root/work/spec")).toBeVisible();
    await expect(activeFilters(page)).toContainText("未着手");
    await activeFilters(page).getByRole("button", { name: "すべてクリア" }).click();
    await expect(activeFilters(page)).toHaveCount(0);
    expect(await visibleRows(page)).toEqual([
      "0:Workspace",
      "1:Work",
      "2:Spec",
      "2:Build",
      "2:Release",
      "1:Home",
      "2:Groceries",
      "1:Inbox",
      "2:Idea",
    ]);
  });
});

test("clicking another filter right after typing is not swallowed by the pending text filter", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await filterBox(page).fill("Spec");
    await expect(row(page, "root/work/build")).toHaveCount(0);
    // 消した直後（反映待ちのうち）に別の絞り込みを押す。帯の出入りで表が
    // ずれても、押したボタンが効くこと。
    await filterBox(page).fill("");
    await filterStatus(page, ["保留"]);
    await expect(row(page, "root/work/release")).toBeVisible();
    await expect(row(page, "root/work/spec")).toHaveCount(0);
    await expect(filterBox(page)).toHaveValue("");
  });
});

test("filters follow edits and scope changes, and body search finds text inside notes", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await filterStatus(page, ["未着手"]);
    await expect(row(page, "root/work/spec")).toBeVisible();

    // 状態を変えると、条件から外れた行は消える。
    await row(page, "root/work/spec").getByRole("button", { name: "Specのステータス" }).click();
    await page.getByRole("option", { name: "進行中", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.spec.status).toBe("In Progress");
    await expect(row(page, "root/work/spec")).toHaveCount(0);

    // スコープを Home に切り替えても条件は残る。
    await openScope(page, "Home");
    await expect(row(page, "home/groceries")).toBeVisible();
    await activeFilters(page).getByRole("button", { name: "すべてクリア" }).click();

    // 本文検索は、名前に無い語でも本文に含まれていれば残す。
    await openScope(page, "Work");
    await filterBox(page).fill("draft");
    await expect(row(page, "work/spec")).toHaveCount(0);
    await page.getByRole("button", { name: "メモ本文も検索する" }).click();
    await expect(row(page, "work/spec")).toBeVisible();
    await expect(row(page, "work/build")).toHaveCount(0);
  });
});

test("sorting by name and due date reorders rows without changing the saved order", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    const workRows = () => rowsUnder(page, "Work");
    // 押すたびに 降順 → 昇順 → 並べ替えなし（保存されている順）。
    await page.getByRole("button", { name: /^ノード名(を並べ替え|：)/ }).click();
    await expect.poll(workRows).toEqual(["Spec", "Release", "Build"]);
    await page.getByRole("button", { name: /^ノード名(を並べ替え|：)/ }).click();
    await expect.poll(workRows).toEqual(["Build", "Release", "Spec"]);
    await page.getByRole("button", { name: /^ノード名(を並べ替え|：)/ }).click();
    await expect.poll(workRows).toEqual(["Spec", "Build", "Release"]);
    // 期限日の降順。期限の無い行は最後。
    await page.getByRole("button", { name: /^期限日(を並べ替え|：)/ }).click();
    await expect.poll(workRows).toEqual(["Build", "Spec", "Release"]);
    // 並べ替えは表示だけ。保存されている並び順はそのまま。
    const orders = ["spec", "build", "release"].map(
      (id) => graphOf(app).nodes[id].parents[0].order
    );
    expect(orders).toEqual([0, 1, 2]);
    await select(page, "root/work/build");
    await expect(row(page, "root/work/build")).toHaveAttribute("aria-selected", "true");
  });
});
