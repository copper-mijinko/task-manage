// 日々の流れ: クイック追加から Inbox を片付ける、見た目の設定が起動し直しても
// 残る、大きいワークスペースでも探して選んで直せる。
import { test, expect } from "@playwright/test";
import {
  childrenOf,
  createWorkspace,
  graphOf,
  largeNodes,
  overflow,
  row,
  run,
  select,
} from "./support.js";

const inboxBadge = (page) =>
  page.getByRole("button", { name: "Inboxを開く" }).locator(".InboxBtnBadge");

test("quick capture adds to the Inbox from anywhere, the badge counts it, and the Inbox view lists it", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await expect(inboxBadge(page)).toHaveText("1");

    // Enter は続けて追加、Shift+Enter は追加して閉じる。
    await page.keyboard.press("Control+Shift+I");
    const dialog = page.getByRole("dialog", { name: "Inboxへクイック追加" });
    const input = dialog.getByRole("textbox");
    await input.fill("Call Bob");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await input.fill("Buy milk");
    await input.press("Shift+Enter");
    await expect(dialog).toHaveCount(0);

    await expect
      .poll(() => childrenOf(app, "inbox").sort())
      .toEqual(["Buy milk", "Call Bob", "Idea"]);
    await expect(inboxBadge(page)).toHaveText("3");

    await page.getByRole("button", { name: "Inboxを開く" }).click();
    const bob = Object.values(graphOf(app).nodes).find((n) => n.name === "Call Bob");
    await expect(row(page, `inbox/${bob.id}`)).toBeVisible();

    // 片付けると（アーカイブ）バッジが減る。
    await select(page, `inbox/${bob.id}`);
    await page.keyboard.press("Delete");
    await page.getByRole("button", { name: "アーカイブする", exact: true }).click();
    await expect(inboxBadge(page)).toHaveText("2");
  });
});

test("density and column choices survive a restart", async () => {
  await run(createWorkspace(), async (app) => {
    let page = app.window;
    await page.getByRole("button", { name: "設定を開く", exact: true }).click();
    await page.getByRole("button", { name: "コンパクト", exact: true }).click();
    await page.keyboard.press("Escape");
    await overflow(page, "列の設定");
    const dialog = page.getByRole("dialog", { name: "列の設定" });
    await dialog.getByRole("checkbox", { name: "タグ", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "開始日", exact: true }).uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: /タグ/ })).toBeVisible();

    await app.restart();
    page = app.window;
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains("density-compact"))
      )
      .toBe(true);
    await expect(page.getByRole("columnheader", { name: /タグ/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /開始日/ })).toHaveCount(0);
    await expect(row(page, "root/work/spec").getByRole("button", { name: /design/ })).toBeVisible();
  });
});

test("a large workspace renders a window of rows, and search, keyboard jumps and edits still reach far rows", async () => {
  await run(createWorkspace(largeNodes(2000)), async (app) => {
    const page = app.window;
    const rendered = await page.locator(".TableRow[data-row-path]").count();
    expect(rendered).toBeGreaterThan(10);
    expect(rendered).toBeLessThan(400);

    // 末尾へ飛ぶと、最後の行が描かれて操作対象になる。
    await select(page, "root/p0");
    await page.keyboard.press("End");
    await expect(row(page, "root/p19/p19-t98")).toBeVisible();
    await expect(row(page, "root/p19/p19-t98")).toHaveAttribute("tabindex", "0");

    // 遠くの行を検索で見つけて、そのまま状態を変える。
    await page.getByRole("textbox", { name: "ノード一覧を絞り込み" }).fill("Task 7-42");
    await expect(row(page, "root/p7/p7-t42")).toBeVisible();
    await expect(row(page, "root/p0/p0-t0")).toHaveCount(0);
    await select(page, "root/p7/p7-t42");
    await row(page, "root/p7/p7-t42")
      .getByRole("button", { name: "Task 7-42のステータス" })
      .click();
    await page.getByRole("option", { name: "完了", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes["p7-t42"].status).toBe("Completed");

    // 絞り込みを外すと行は何百行も下へ動くが、選んでいる行は見える位置に戻る。
    await page.getByRole("textbox", { name: "ノード一覧を絞り込み" }).fill("");
    await expect(row(page, "root/p7/p7-t42")).toBeVisible();
    await expect(row(page, "root/p7/p7-t42")).toHaveAttribute("aria-selected", "true");
    await expect(row(page, "root/p0/p0-t0")).toHaveCount(0);
  });
});
