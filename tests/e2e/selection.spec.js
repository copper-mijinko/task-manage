// 複数選択と一括操作。ヘッダの全選択・範囲選択・一括の状態/日付/コピー/
// 移動と、アーカイブ済みを含む選択の削除を組み合わせて通す。
import { test, expect } from "@playwright/test";
import { childrenOf, createWorkspace, graphOf, overflow, row, run, select } from "./support.js";

const bulkBar = (page) => page.getByRole("toolbar", { name: "一括操作" });

test("header checkbox selects every visible row and clears it again", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await page.getByRole("checkbox", { name: "すべて選択" }).click();
    // ルート（ワークスペース）は選べないので、見えている 8 行。
    await expect(bulkBar(page)).toContainText("8件選択");
    await page.getByRole("checkbox", { name: "選択を解除" }).click();
    await expect(bulkBar(page)).toHaveCount(0);

    // 畳んだ枝の中は選ばない（見えている行だけ）。
    await row(page, "root/work").getByRole("button", { name: "ノードを折りたたむ" }).click();
    await page.getByRole("checkbox", { name: "すべて選択" }).click();
    await expect(bulkBar(page)).toContainText("5件選択");
  });
});

test("range selection drives bulk status, dates, move and copy, and one undo reverts one bulk step", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await select(page, "root/work/spec");
    await select(page, "root/work/release", ["Shift"]);
    await expect(bulkBar(page)).toContainText("3件選択");

    await bulkBar(page).getByRole("button", { name: "ステータス変更", exact: true }).click();
    await page.getByRole("option", { name: "完了", exact: true }).click();
    await expect
      .poll(() => ["spec", "build", "release"].map((id) => graphOf(app).nodes[id].status))
      .toEqual(["Completed", "Completed", "Completed"]);

    await bulkBar(page).getByRole("button", { name: "日付", exact: true }).click();
    await page.getByRole("menuitem", { name: "期限日を設定", exact: true }).click();
    const dateDialog = page.getByRole("dialog", { name: "期限日を設定" });
    await dateDialog.locator('input[type="date"]').fill("2026-11-30");
    await dateDialog.getByRole("button", { name: "適用", exact: true }).click();
    await expect
      .poll(() => ["spec", "build", "release"].map((id) => graphOf(app).nodes[id].dueDate))
      .toEqual(["2026-11-30", "2026-11-30", "2026-11-30"]);

    await bulkBar(page).getByRole("button", { name: "日付", exact: true }).click();
    await page.getByRole("menuitem", { name: "開始日をクリア", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.build.startDate).toBeUndefined();

    // 1 回の元に戻すで、直前の一括操作（開始日のクリア）だけが戻る。
    await page.keyboard.press("Control+z");
    await expect.poll(() => graphOf(app).nodes.build.startDate).toBe("2026-10-01");
    expect(graphOf(app).nodes.spec.dueDate).toBe("2026-11-30");

    // 上の 2 行だけ選び直して、まとめて 1 つ下へ。
    await select(page, "root/work/spec");
    await select(page, "root/work/build", ["Shift"]);
    await page.getByRole("button", { name: "2件 下に移動", exact: true }).click();
    await expect.poll(() => childrenOf(app, "work")).toEqual(["Release", "Spec", "Build"]);

    // まとめてコピーして、別のプロジェクトへ貼る。
    await bulkBar(page).getByRole("button", { name: "コピー", exact: true }).click();
    await select(page, "root/home");
    await page.keyboard.press("Control+v");
    await expect
      .poll(() => childrenOf(app, "home"))
      .toEqual(["Groceries", "Spec のコピー", "Build のコピー"]);
  });
});

test("deleting a mixed selection archives active rows and permanently deletes archived ones; restore brings a row back", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await select(page, "root/work/release");
    await page.getByRole("button", { name: "アーカイブ", exact: true }).click();
    await page.getByRole("button", { name: "アーカイブする", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.release.archived).toBe(true);
    await expect(row(page, "root/work/release")).toHaveCount(0);

    await overflow(page, "アーカイブ済みを表示", "menuitemcheckbox");
    await expect(row(page, "root/work/release")).toBeVisible();

    await select(page, "root/work/build");
    await select(page, "root/work/release", ["Control"]);
    await page.keyboard.press("Delete");
    await expect(page.getByText("アーカイブと完全削除の確認")).toBeVisible();
    await page.getByRole("button", { name: "実行する", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.release).toBeUndefined();
    await expect.poll(() => graphOf(app).nodes.build.archived).toBe(true);

    await select(page, "root/work/build");
    await page.getByRole("button", { name: "アーカイブから復元", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.build.archived).toBeFalsy();
    await overflow(page, "アーカイブ済みを表示", "menuitemcheckbox");
    await expect(row(page, "root/work/build")).toBeVisible();
    expect(childrenOf(app, "work")).toEqual(["Spec", "Build"]);
  });
});
