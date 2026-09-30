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
  rowMenu,
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

test("an Inbox item moves into a project from the row menu, choosing the destination by search", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await rowMenu(page, "root/inbox/idea", "移動…");
    const dialog = page.getByRole("dialog", { name: "移動先を選ぶ" });
    // 自分自身・いまの親（Inbox）は候補に出ない。打つと候補が縮む。
    const options = dialog.getByRole("listbox", { name: "移動先の親の候補" }).getByRole("option");
    await expect(options.filter({ hasText: "Inbox" })).toHaveCount(0);
    await dialog.getByRole("textbox", { name: "移動先の親" }).fill("wor");
    await expect(options.first().locator(".Name")).toHaveText("Work");
    await dialog.getByRole("textbox", { name: "移動先の親" }).press("Enter");
    await dialog.getByRole("button", { name: "移動", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => childrenOf(app, "work")).toContain("Idea");
    expect(childrenOf(app, "inbox")).toEqual([]);
    await expect(row(page, "root/work/idea")).toBeVisible();

    // 子孫は移動先に出ない（循環になるため）。
    await rowMenu(page, "root/work", "移動…");
    await dialog.getByRole("textbox", { name: "移動先の親" }).fill("spec");
    await expect(dialog.getByText("一致するノードがありません")).toBeVisible();
    await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test("adding a project starts naming it, and Esc cancels the new project", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    const projects = () =>
      childrenOf(app, "root").filter((name) => !["Work", "Home", "Inbox"].includes(name));
    const addProject = async () => {
      const button = page.getByRole("button", { name: "ワークスペースプロジェクトを追加" });
      if (!(await button.isVisible()))
        await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
      await button.click();
    };

    // 作った直後の名前入力を Esc で取り消すと、プロジェクトも残らない。
    await addProject();
    const input = page.locator('.TableRow input[type="text"]:focus');
    await expect(input).toHaveValue("新しいプロジェクト");
    await page.keyboard.press("Escape");
    await expect.poll(projects).toEqual([]);

    // 名前を入れて Enter で確定すると、その名前で残り、フォーカスは行に戻る。
    await addProject();
    await expect(input).toBeVisible();
    await page.keyboard.type("Plan");
    await page.keyboard.press("Enter");
    await expect.poll(projects).toEqual(["Plan"]);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("role")))
      .toBe("row");
  });
});

test("importing a Markdown project shows it right away and can be undone", async () => {
  const files = {
    "old/_project.md": "---\nid: old\nname: Old project\norder: 0\ncreatedAt: 2026-01-01\n---\n",
    "old/task/_index.md":
      "---\nid: old-task\nname: Old task\nparents:\n  - id: old\n    order: 0\ncreatedAt: 2026-01-02\n---\n",
  };
  await run(createWorkspace(undefined, { files }), async (app) => {
    const page = app.window;
    const manage = page.getByRole("button", { name: "ワークスペースを管理", exact: true });
    if (!(await manage.isVisible()))
      await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
    await manage.click();
    await page.getByRole("button", { name: "取り込めるプロジェクトを探す..." }).click();
    const option = page.getByRole("checkbox", { name: "Old project" });
    await expect(option).toBeChecked();
    await page.getByRole("button", { name: "選んだ 1 件を取り込む" }).click();
    await expect(page.getByText("取り込み済み")).toBeVisible();

    // もう一度選ぶと複製されることを知らせる。
    await option.check();
    await expect(page.getByText(/同じプロジェクトがもう 1 つ複製されます/)).toBeVisible();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();

    // 画面を操作し直さなくても、取り込んだ行が出て「元に戻す」が効く。
    await expect(row(page, "root/old")).toBeVisible();
    await expect(row(page, "root/old/old-task")).toBeVisible();
    const undo = page.getByRole("button", { name: "元に戻す", exact: true });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(row(page, "root/old")).toHaveCount(0);
    await expect.poll(() => graphOf(app).nodes.old).toBeUndefined();
  });
});

test("a project can be renamed from the sidebar menu", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    const sidebar = page.getByRole("complementary", { name: "ナビゲーション" });
    const openMenu = async () => {
      const trigger = sidebar.getByRole("button", { name: "Workの操作" });
      if (!(await trigger.isVisible()))
        await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
      await trigger.click();
      await page.getByRole("menuitem", { name: "名前を変更", exact: true }).click();
    };
    const input = sidebar.getByRole("textbox", { name: "プロジェクト名" });

    // Esc は取り消し。
    await openMenu();
    await expect(input).toHaveValue("Work");
    await input.fill("Nope");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    expect(graphOf(app).nodes.work.name).toBe("Work");

    // Enter で確定すると、サイドバーとツリーの両方の名前が変わる。
    await openMenu();
    await input.fill("Office");
    await input.press("Enter");
    await expect.poll(() => graphOf(app).nodes.work.name).toBe("Office");
    await expect(sidebar.getByRole("button", { name: "Office", exact: true })).toBeVisible();
    await expect(
      row(page, "root/work").getByRole("textbox", { name: "Officeのノード名" })
    ).toBeVisible();
  });
});
