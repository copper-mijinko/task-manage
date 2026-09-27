// 画面の見た目の整合性。主な画面と状態（開いたメニュー・ダイアログ・
// 詳細ペインの各タブ・一括操作・絞り込み・設定・密度・テーマ・窓の幅）を
// ひととおり開き、文字の重なり・見切れ・隠れた操作・画面外へのはみ出しが
// 無いことを layout_audit.js で確かめる。
import { test, expect } from "@playwright/test";
import { auditLayout, auditLayoutScrolled } from "./layout_audit.js";
import { createWorkspace, node, overflow, projectNodes, row, run, select } from "./support.js";

/** 長い名前・多親・タグの多いノードを足した、崩れが出やすいワークスペース。 */
function stressNodes() {
  return [
    ...projectNodes(),
    node("long", [["work", 3]], {
      name: "とても長いノード名がここに入って列の幅を超えても表示が崩れないかを確かめるためのノード",
      status: "Canceled",
      startDate: "2026-09-01",
      dueDate: "2026-12-31",
      tags: ["design", "release", "backend", "very-long-tag-name-for-layout"],
    }),
    node(
      "shared",
      [
        ["work", 4],
        ["home", 1],
      ],
      { name: "Shared across projects", status: "Pending" }
    ),
  ];
}

/** 開いた画面ごとに崩れを集め、最後にまとめて報告する。 */
function collector(page) {
  const found = [];
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 250)))
    );
  const check = async (label, options = {}) => {
    await settle();
    for (const issue of await auditLayoutScrolled(page, options)) found.push(`[${label}] ${issue}`);
  };
  return { found, check };
}

async function walkMainScreens(page, check, suffix) {
  await check(`一覧${suffix}`);

  await select(page, "root/work/long");
  await check(`詳細・概要${suffix}`);
  const detail = page.getByRole("region", { name: "ノード詳細" });
  await detail.getByRole("button", { name: "編集", exact: true }).click();
  await check(`詳細・編集${suffix}`);
  await detail.getByRole("button", { name: "編集終了", exact: true }).click();
  await page.getByRole("tab", { name: /^添付/ }).click();
  await check(`詳細・添付${suffix}`);
  await page.getByRole("tab", { name: "本文", exact: true }).click();
  await check(`詳細・本文${suffix}`);
  await page.getByRole("button", { name: /^メモ表示モード：/ }).click();
  await check(`本文・表示モード選択${suffix}`);
  await page.getByRole("option", { name: "編集", exact: true }).click();
  await check(`本文・編集${suffix}`);
  await page.getByRole("tab", { name: "概要", exact: true }).click();

  await select(page, "root/work/shared");
  await check(`詳細・多親${suffix}`);

  await row(page, "root/work/spec").getByRole("button", { name: "ノード操作を開く" }).click();
  await check(`行メニュー${suffix}`);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "表示と操作", exact: true }).click();
  await check(`表示と操作メニュー${suffix}`);
  await page.keyboard.press("Escape");

  await row(page, "root/work/spec").getByRole("button", { name: "Specのステータス" }).click();
  await check(`ステータス選択${suffix}`);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "ステータスフィルター", exact: true }).click();
  await check(`ステータス絞り込み${suffix}`);
  await page.getByRole("checkbox", { name: "未着手" }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "ノード一覧を絞り込み" }).fill("e");
  await check(`絞り込み中${suffix}`);
  await page
    .getByRole("status")
    .filter({ hasText: "絞り込み中" })
    .getByRole("button", { name: "すべてクリア" })
    .click();

  await select(page, "root/work/spec");
  await select(page, "root/work/shared", ["Shift"]);
  await check(`一括操作${suffix}`);
  await page
    .getByRole("toolbar", { name: "一括操作" })
    .getByRole("button", { name: "日付", exact: true })
    .click();
  await check(`一括・日付メニュー${suffix}`);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await select(page, "root/work/release");
  await page.keyboard.press("Delete");
  await check(`アーカイブの確認${suffix}`);
  await page.keyboard.press("Escape");

  await overflow(page, "列の設定");
  const columns = page.getByRole("dialog", { name: "列の設定" });
  await columns.getByRole("checkbox", { name: "タグ", exact: true }).check();
  await check(`列の設定${suffix}`);
  await page.keyboard.press("Escape");
  await check(`タグ列${suffix}`);
  await page.getByRole("button", { name: "タグフィルター", exact: true }).click();
  await check(`タグ絞り込み${suffix}`);
  await page.keyboard.press("Escape");
  await overflow(page, "列の設定");
  await columns.getByRole("checkbox", { name: "タグ", exact: true }).uncheck();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
  await check(`サイドバー${suffix}`);
  await page.getByRole("button", { name: "サイドバーを隠す", exact: true }).first().click();
}

test("main screens, menus, dialogs and panels have no overlapping, clipped or hidden content", async () => {
  await run(createWorkspace(stressNodes()), async (app) => {
    const page = app.window;
    const { found, check } = collector(page);

    await walkMainScreens(page, check, "");

    await overflow(page, "ガントチャート", "menuitemcheckbox");
    await check("ガント");
    for (const scale of ["週表示", "月表示"]) {
      await page.getByRole("button", { name: scale, exact: true }).click();
      await check(`ガント・${scale}`);
    }

    await select(page, "root/work/long");
    const opened = app.electronApp.waitForEvent("window");
    await page.getByRole("button", { name: "ノード詳細の操作" }).click();
    await check("詳細の操作メニュー");
    await page.getByRole("menuitem", { name: "別Windowで開く", exact: true }).click();
    const detailWindow = await opened;
    await expect(detailWindow.getByRole("region", { name: "ノード詳細" })).toBeVisible();
    await detailWindow.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 250)))
    );
    for (const issue of await auditLayoutScrolled(detailWindow))
      found.push(`[別ウィンドウの詳細] ${issue}`);
    await detailWindow.close();

    await page.getByRole("button", { name: "クイック追加", exact: true }).click();
    await check("クイック追加");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "設定を開く", exact: true }).click();
    for (const category of ["外観", "日時フォーマット", "ショートカット", "バージョン情報"]) {
      await page.getByRole("dialog").getByRole("button", { name: category }).first().click();
      await check(`設定・${category}`);
    }
    await page.keyboard.press("Escape");

    expect(found).toEqual([]);
  });
});

test("the same screens stay clean in compact density, light theme and a narrow window", async () => {
  await run(createWorkspace(stressNodes()), async (app) => {
    const page = app.window;
    const { found, check } = collector(page);

    await page.getByRole("button", { name: "設定を開く", exact: true }).click();
    await page.getByRole("button", { name: "コンパクト", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("checkbox", { name: "Dark / Light", exact: true }).setChecked(true);
    await walkMainScreens(page, check, "・コンパクト・ライト");

    await app.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 650)
    );
    await walkMainScreens(page, check, "・幅900");

    expect(found).toEqual([]);
  });
});

test("the layout audit itself detects overlap, clipping, hidden controls and off-screen popups", async () => {
  await run(createWorkspace(stressNodes()), async (app) => {
    const page = app.window;
    // 検出器が何も拾えないまま緑になるのを防ぐ。わざと崩した部品を置いて、
    // 4 種類とも見つかることを確かめる。
    await page.evaluate(() => {
      const box = document.createElement("div");
      box.id = "audit-probe";
      box.style.cssText =
        "position:fixed;left:40px;top:120px;width:360px;height:200px;z-index:2147483647;background:#123;color:#fff;font:14px sans-serif";
      box.innerHTML = `
        <span style="position:absolute;left:10px;top:10px">重なる文字その一</span>
        <span style="position:absolute;left:20px;top:12px">重なる文字その二</span>
        <div style="position:absolute;left:10px;top:50px;width:60px;overflow:hidden;white-space:nowrap"><span>省略記号なしで切れる長い文字列</span></div>
        <button id="audit-covered" style="position:absolute;left:10px;top:90px;width:80px;height:30px">押せない</button>
        <div style="position:absolute;left:5px;top:85px;width:100px;height:40px;background:rgba(0,0,0,0.01)"></div>
        <ul role="menu" style="position:absolute;left:300px;top:150px;width:200px;height:100px;margin:0">画面外のメニュー</ul>`;
      document.body.appendChild(box);
      // 画面外判定のため、メニューを右端の外へ出す。
      box.querySelector("[role=menu]").style.left = `${innerWidth}px`;
    });
    const issues = (await auditLayout(page, { root: "#audit-probe" })).join("\n");
    expect(issues).toContain("文字の重なり");
    expect(issues).toContain("見切れ");
    expect(issues).toContain("隠れた操作: button");
    expect(issues).toContain("画面外");
    await page.evaluate(() => document.getElementById("audit-probe").remove());

    // 実際に起きた崩れ（所属する場所で名前とチップが同じ列に重なる）を
    // 再現すると、それも拾えること。
    await select(page, "root/work/spec");
    await page.addStyleTag({
      content: ".parent-location .parent-link { grid-column: 2 !important; }",
    });
    const real = await auditLayoutScrolled(page);
    expect(real.join("\n")).toContain("文字の重なり");
  });
});

test("less common states stay clean: inherited dates, archived rows, relation editing, dialogs, errors, sticky path, narrow window and zoom", async () => {
  const nodes = [
    ...stressNodes(),
    node("sub", [["build", 0]], { name: "Sub task under build", status: "Open" }),
    node("old", [["work", 5]], { name: "Archived work", status: "Completed", archived: true }),
    ...Array.from({ length: 40 }, (_, index) =>
      node(`filler${index}`, [["home", index + 2]], { name: `Filler ${index}`, status: "Open" })
    ),
  ];
  await run(createWorkspace(nodes), async (app) => {
    const page = app.window;
    const { found, check } = collector(page);

    // 親から受け継いだ期限（↳）の行と詳細。
    await select(page, "root/work/build/sub");
    await check("受け継いだ期限");

    // 所属先の追加パネル。
    await page.getByRole("button", { name: "所属先を追加" }).click();
    await check("所属先の追加");
    await page.keyboard.press("Escape");

    // アーカイブ済みの行と、その詳細の注意書き。
    await overflow(page, "アーカイブ済みを表示", "menuitemcheckbox");
    await select(page, "root/work/old");
    await check("アーカイブ済みの詳細");
    await overflow(page, "アーカイブ済みを表示", "menuitemcheckbox");

    // 一括の日付ダイアログ。
    await select(page, "root/work/spec");
    await select(page, "root/work/release", ["Shift"]);
    await page
      .getByRole("toolbar", { name: "一括操作" })
      .getByRole("button", { name: "日付", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "期限日を設定", exact: true }).click();
    await check("期限日を設定ダイアログ");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // 保存に失敗したときの表示。
    await select(page, "root/work/build");
    const detail = page.getByRole("region", { name: "ノード詳細" });
    await detail.getByRole("button", { name: "編集", exact: true }).click();
    await detail.getByLabel("期限日", { exact: true }).fill("2026-09-01");
    await expect(page.getByRole("status").filter({ hasText: "保存失敗" })).toBeVisible();
    await check("保存失敗");
    await detail.getByLabel("期限日", { exact: true }).fill("2026-10-20");
    await detail.getByRole("button", { name: "編集終了", exact: true }).click();

    // 下へスクロールしたときの経路表示（見出しの下に親の経路が出る）。
    await page
      .locator(".TableRow[data-row-path]")
      .first()
      .evaluate((element) => {
        let scroller = element.parentElement;
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
          scroller = scroller.parentElement;
        scroller.scrollTop = scroller.scrollHeight / 2;
      });
    await expect(page.locator(".StickyTrailContent")).toBeVisible();
    await check("経路表示");

    // Inbox の画面。
    await page.getByRole("button", { name: "Inboxを開く" }).click();
    await check("Inbox");

    // いちばん狭い窓。
    await app.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(700, 600)
    );
    await openProject(page, "Work");
    await select(page, "work/long");
    await check("最小の窓");

    // 表示倍率を上げる。
    await app.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 720)
    );
    await page.getByRole("button", { name: "設定を開く", exact: true }).click();
    for (let step = 0; step < 3; step += 1)
      await page.getByRole("button", { name: "拡大", exact: true }).click();
    await check("拡大の設定");
    await page.keyboard.press("Escape");
    await check("拡大");

    expect(found).toEqual([]);
  });
});

/** サイドバーからプロジェクトを開く（閉じていれば開いてから）。 */
async function openProject(page, name) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
  await button.click();
  const hide = page.getByRole("button", { name: "サイドバーを隠す", exact: true }).first();
  if (await hide.isVisible()) await hide.click();
}
