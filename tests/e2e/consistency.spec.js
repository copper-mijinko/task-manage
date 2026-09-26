// 画面の表示の整合性。同じノードは、ツリーの行・詳細ペイン・ガント・
// サイドバー・ヘッダーのバッジ・別ウィンドウのどこで見ても同じ値と名前で
// 見え、編集・元に戻す・起動し直しのあとも揃ったままであること。
import { test, expect } from "@playwright/test";
import {
  createWorkspace,
  graphOf,
  largeNodes,
  node,
  overflow,
  projectNodes,
  row,
  rowMenu,
  run,
  saved,
  select,
} from "./support.js";

/** 表示上の「値なし」をそろえる（行は「—」、詳細は「未設定」）。 */
const blank = (text) => {
  const value = (text ?? "").replace("↳", "").trim();
  return value === "—" || value === "未設定" ? "" : value;
};

/** ツリーの行に出ている値。 */
function rowView(page, path) {
  return row(page, path).evaluate((element) => {
    const text = (selector) => element.querySelector(selector)?.textContent ?? "";
    return {
      name: element.querySelector('input[type="text"]')?.value ?? "",
      status: text(".s-label"),
      start: text('[aria-label$="の開始日"]'),
      due: text('[aria-label$="の期限日"]'),
    };
  });
}

/** 詳細ペイン（読み取り表示）に出ている値。 */
function detailView(page) {
  return page.getByRole("region", { name: "ノード詳細" }).evaluate((element) => {
    const fields = {};
    for (const field of element.querySelectorAll(".detail-field")) {
      const label = field.querySelector(".detail-label")?.textContent.trim();
      fields[label] = field.querySelector(".detail-value")?.textContent ?? "";
    }
    return {
      title: element.querySelector("h2")?.textContent.trim() ?? "",
      name: fields["ノード名"],
      status: fields["ステータス"],
      start: fields["開始日"],
      due: fields["期限日"],
      tags: fields["タグ"],
    };
  });
}

/** ガントの行の棒の種類（期間 / 期限だけ / 開始だけ / なし）。 */
function ganttBar(page, path) {
  return page
    .locator(`.GanttRow[data-row-path="${path}"]`)
    .evaluate((element) => element.querySelector(".Bar")?.getAttribute("aria-label") ?? "なし");
}

/** 行・詳細・ガント・ファイルが同じ値を指していることを確かめる。 */
async function expectAgreement(app, path, expected) {
  const page = app.window;
  const id = path.split("/").at(-1);
  await expect
    .poll(async () => {
      const r = await rowView(page, path);
      return { name: r.name, status: blank(r.status), start: blank(r.start), due: blank(r.due) };
    })
    .toEqual({
      name: expected.name,
      status: expected.status,
      start: expected.start,
      due: expected.due,
    });
  await expect
    .poll(async () => {
      const d = await detailView(page);
      return {
        title: d.title,
        name: d.name,
        status: blank(d.status),
        start: blank(d.start),
        due: blank(d.due),
        tags: blank(d.tags),
      };
    })
    .toEqual({
      title: expected.name,
      name: expected.name,
      status: expected.status,
      start: expected.start,
      due: expected.due,
      tags: expected.tags,
    });
  const bar =
    expected.start && expected.due
      ? "期間を移動"
      : expected.due
        ? "期限日を変更"
        : expected.start
          ? "開始日を変更"
          : "なし";
  await expect.poll(() => ganttBar(page, path)).toBe(bar);
  const saved_ = graphOf(app).nodes[id];
  expect({
    name: saved_.name,
    start: saved_.startDate ?? "",
    due: saved_.dueDate ?? "",
    tags: (saved_.tags ?? []).join(" · "),
  }).toEqual({
    name: expected.name,
    start: expected.start,
    due: expected.due,
    tags: expected.tags,
  });
}

test("tree row, detail pane, Gantt, sidebar and file agree through edits, undo and restart", async () => {
  await run(createWorkspace(), async (app) => {
    let page = app.window;
    await overflow(page, "ガントチャート", "menuitemcheckbox");
    await select(page, "root/work/spec");
    const original = {
      name: "Spec",
      status: "未着手",
      start: "",
      due: "2026-10-10",
      tags: "design",
    };
    await expectAgreement(app, "root/work/spec", original);

    // 行で状態を変える → 詳細にも同じ名前で出る。
    await row(page, "root/work/spec").getByRole("button", { name: "Specのステータス" }).click();
    await page.getByRole("option", { name: "進行中", exact: true }).click();
    // 詳細で開始日を入れる → 行とガント（期限だけ → 期間）が追従する。
    const detail = page.getByRole("region", { name: "ノード詳細" });
    await detail.getByRole("button", { name: "編集", exact: true }).click();
    await detail.getByLabel("開始日", { exact: true }).fill("2026-10-02");
    await expect.poll(() => graphOf(app).nodes.spec.startDate).toBe("2026-10-02");
    await detail.getByRole("button", { name: "編集終了", exact: true }).click();
    // 行で名前を変える → 詳細の見出しも変わる。
    await rowMenu(page, "root/work/spec", "名前を変更");
    const input = page.locator('.TableRow input[type="text"]:focus');
    await input.fill("Spec v2");
    await input.press("Enter");
    const edited = { ...original, name: "Spec v2", status: "進行中", start: "2026-10-02" };
    await expectAgreement(app, "root/work/spec", edited);

    // プロジェクトの名前は、ツリーとサイドバーの両方で変わる。
    await rowMenu(page, "root/work", "名前を変更");
    await page.locator('.TableRow input[type="text"]:focus').fill("Work 2");
    await page.locator('.TableRow input[type="text"]:focus').press("Enter");
    await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
    const sidebarProject = page.locator('[data-section="WorkspaceProject"][data-id="work"]');
    await expect(sidebarProject.getByRole("button", { name: "Work 2", exact: true })).toBeVisible();
    await saved(page);

    // 起動し直しても同じ。
    await app.restart();
    page = app.window;
    // ガントの表示は起動し直しても残る設定なので、消えていたときだけ出す。
    if ((await page.locator(".GanttRoot").count()) === 0)
      await overflow(page, "ガントチャート", "menuitemcheckbox");
    await select(page, "root/work/spec");
    await expectAgreement(app, "root/work/spec", edited);

    // 元に戻すと、すべての場所がいっしょに戻る。
    for (let step = 0; step < 4; step += 1) {
      const revision = graphOf(app).revision;
      await page.keyboard.press("Control+z");
      await expect.poll(() => graphOf(app).revision).not.toBe(revision);
    }
    await expectAgreement(app, "root/work/spec", original);
    await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
    await expect(
      page
        .locator('[data-section="WorkspaceProject"][data-id="work"]')
        .getByRole("button", { name: "Work", exact: true })
    ).toBeVisible();
  });
});

test("status names are the same in the row, detail pane, bulk menu, filter panel and filter chip", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    const optionNames = () => page.getByRole("listbox").getByRole("option").allTextContents();

    await row(page, "root/work/spec").getByRole("button", { name: "Specのステータス" }).click();
    const rowOptions = (await optionNames()).map((name) => name.trim());
    await page.keyboard.press("Escape");

    await select(page, "root/work/spec");
    await select(page, "root/work/build", ["Control"]);
    await page
      .getByRole("toolbar", { name: "一括操作" })
      .getByRole("button", { name: "ステータス変更", exact: true })
      .click();
    const bulkOptions = (await optionNames()).map((name) => name.trim());
    await page.keyboard.press("Escape");
    expect(bulkOptions).toEqual(rowOptions);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "ステータスフィルター", exact: true }).click();
    const filterOptions = await page
      .locator(".OptionRow .OptionLabel")
      .allTextContents()
      .then((names) => names.map((name) => name.trim()));
    // 絞り込みでは「なし」も状態のひとつとして同じ並びに出る（見出しが
    // 「ステータス」なので、選択肢の中の「ステータスなし」を短く呼ぶ）。
    expect(filterOptions.filter((name) => name !== "なし")).toEqual(
      rowOptions.filter((name) => name !== "ステータスなし")
    );

    // それぞれの状態で、行・詳細・絞り込み中の帯が同じ名前を出す。
    await page.keyboard.press("Escape");
    for (const name of rowOptions.filter((option) => option !== "ステータスなし")) {
      await row(page, "root/work/release")
        .getByRole("button", { name: "Releaseのステータス" })
        .click();
      await page.getByRole("option", { name, exact: true }).click();
      await select(page, "root/work/release");
      await expect
        .poll(async () => blank((await rowView(page, "root/work/release")).status))
        .toBe(name);
      await expect.poll(async () => blank((await detailView(page)).status)).toBe(name);
    }
    await page.getByRole("button", { name: "ステータスフィルター", exact: true }).click();
    await page.getByRole("checkbox", { name: "キャンセル" }).check();
    await page.keyboard.press("Escape");
    const chips = page.getByRole("status").filter({ hasText: "絞り込み中" });
    await expect(chips).toContainText("キャンセル");
    await expect(chips).not.toContainText("Canceled");
  });
});

test("tree and Gantt show the same rows in the same order at the same height through collapse, filter, sort and scroll", async () => {
  await run(createWorkspace(largeNodes(600)), async (app) => {
    const page = app.window;
    await overflow(page, "ガントチャート", "menuitemcheckbox");
    const pairs = () =>
      page.evaluate(() => {
        const top = (element) => Math.round(element.getBoundingClientRect().top);
        const tree = [...document.querySelectorAll(".TableRow[data-row-path]")];
        const gantt = new Map(
          [...document.querySelectorAll(".GanttRow[data-row-path]")].map((element) => [
            element.dataset.rowPath,
            element,
          ])
        );
        const body = document.querySelector(".GanttBody").getBoundingClientRect();
        const visible = tree.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= body.top && rect.bottom <= body.bottom;
        });
        return {
          count: visible.length,
          missing: visible
            .filter((element) => !gantt.has(element.dataset.rowPath))
            .map((element) => element.dataset.rowPath),
          misaligned: visible
            .filter(
              (element) =>
                gantt.has(element.dataset.rowPath) &&
                Math.abs(top(element) - top(gantt.get(element.dataset.rowPath))) > 1
            )
            .map((element) => element.dataset.rowPath),
        };
      });
    const expectAligned = async () => {
      await expect.poll(pairs).toMatchObject({ missing: [], misaligned: [] });
      expect((await pairs()).count).toBeGreaterThan(3);
    };

    await expectAligned();
    await row(page, "root/p0").getByRole("button", { name: "ノードを折りたたむ" }).click();
    await expectAligned();
    await page.getByRole("textbox", { name: "ノード一覧を絞り込み" }).fill("Task 3-");
    await expect(row(page, "root/p3/p3-t5")).toBeVisible();
    await expectAligned();
    await page.getByRole("textbox", { name: "ノード一覧を絞り込み" }).fill("");
    await page.getByRole("button", { name: /^期限日(を並べ替え|：)/ }).click();
    await expectAligned();
    await select(page, "root/p1");
    await page.keyboard.press("End");
    // 末尾の行が描かれて操作対象になり、ガントも同じ位置まで追従する。
    const last = page.locator('.TableRow[tabindex="0"]');
    await expect(last).toBeVisible();
    expect(
      await page
        .locator(".TableRow[data-row-path]")
        .last()
        .evaluate((element) => element.getAttribute("tabindex"))
    ).toBe("0");
    await expectAligned();
  });
});

test("a node shown under two parents, the Inbox badge and the detail window stay in step with the main window", async () => {
  const nodes = [
    ...projectNodes(),
    node(
      "shared",
      [
        ["work", 3],
        ["home", 1],
      ],
      { name: "Shared", status: "Open" }
    ),
  ];
  await run(createWorkspace(nodes), async (app) => {
    const page = app.window;
    // 2 か所に出ている同じノードは、片方で変えるともう片方も変わる。
    await row(page, "root/work/shared").getByRole("button", { name: "Sharedのステータス" }).click();
    await page.getByRole("option", { name: "保留", exact: true }).click();
    await expect
      .poll(async () => blank((await rowView(page, "root/home/shared")).status))
      .toBe("保留");

    // Inbox のバッジは Inbox 直下の行の数と一致する。
    const badge = page.getByRole("button", { name: "Inboxを開く" }).locator(".InboxBtnBadge");
    const inboxRows = () => page.locator('.TableRow[data-row-path^="root/inbox/"]').count();
    await expect(badge).toHaveText(String(await inboxRows()));
    await rowMenu(page, "root/inbox", "子ノードを追加");
    await page.locator('.TableRow input[type="text"]:focus').fill("Later");
    await page.locator('.TableRow input[type="text"]:focus').press("Enter");
    await expect.poll(inboxRows).toBe(2);
    await expect(badge).toHaveText("2");

    // 別ウィンドウの詳細で名前を変えると、本体の両方の行と詳細が変わる。
    await select(page, "root/home/shared");
    const opened = app.electronApp.waitForEvent("window");
    await page.getByRole("button", { name: "ノード詳細の操作" }).click();
    await page.getByRole("menuitem", { name: "別Windowで開く", exact: true }).click();
    const detailWindow = await opened;
    const other = detailWindow.getByRole("region", { name: "ノード詳細" });
    await other.getByRole("button", { name: "編集", exact: true }).click();
    await other.getByRole("textbox", { name: "ノード名", exact: true }).fill("Shared 2");
    await other.getByRole("textbox", { name: "ノード名", exact: true }).blur();
    await expect.poll(async () => (await rowView(page, "root/work/shared")).name).toBe("Shared 2");
    await expect.poll(async () => (await rowView(page, "root/home/shared")).name).toBe("Shared 2");
    await expect.poll(async () => (await detailView(page)).title).toBe("Shared 2");
    // 別ウィンドウの見出しは、開いた行（Home の下）の経路を出す。
    await expect(other.locator("h2")).toHaveText("Workspace / Home / Shared 2");
    // 本体で変えた状態は、別ウィンドウの詳細にも同じ名前で出る。
    await other.getByRole("button", { name: "編集終了", exact: true }).click();
    await row(page, "root/work/shared")
      .getByRole("button", { name: "Shared 2のステータス" })
      .click();
    await page.getByRole("option", { name: "完了", exact: true }).click();
    await expect
      .poll(async () =>
        blank(
          await other.evaluate((element) => {
            for (const field of element.querySelectorAll(".detail-field"))
              if (field.querySelector(".detail-label")?.textContent.trim() === "ステータス")
                return field.querySelector(".detail-value")?.textContent;
            return "";
          })
        )
      )
      .toBe("完了");
  });
});
