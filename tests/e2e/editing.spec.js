// よく使う編集操作（行のメニュー・キーボード・元に戻す）を、組み合わせて通す。
import { test, expect } from "@playwright/test";
import {
  childrenOf,
  createWorkspace,
  graphOf,
  nodesNamed,
  row,
  rowMenu,
  run,
  saved,
  select,
  visibleRows,
} from "./support.js";

/** 名前入力中のノード名を確定する（追加直後は名前の入力になる）。 */
async function typeName(page, name) {
  const input = page.locator('.TableRow input[type="text"]:focus');
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press("Enter");
}

test("row menu: add, rename, move, indent and outdent persist, then undo and redo walk back in order", async () => {
  await run(createWorkspace(), async (app) => {
    let page = app.window;
    await rowMenu(page, "root/work/spec", "子ノードを追加");
    await typeName(page, "Draft");
    await expect.poll(() => childrenOf(app, "spec")).toEqual(["Draft"]);

    await rowMenu(page, "root/work/spec", "下にノードを追加");
    await typeName(page, "Review");
    await expect
      .poll(() => childrenOf(app, "work"))
      .toEqual(["Spec", "Review", "Build", "Release"]);
    const review = nodesNamed(app, "Review")[0].id;

    await rowMenu(page, `root/work/${review}`, "下に移動");
    await expect
      .poll(() => childrenOf(app, "work"))
      .toEqual(["Spec", "Build", "Review", "Release"]);

    await rowMenu(page, `root/work/${review}`, "インデント");
    await expect.poll(() => childrenOf(app, "build")).toEqual(["Review"]);

    await rowMenu(page, `root/work/build/${review}`, "アウトデント");
    await expect
      .poll(() => childrenOf(app, "work"))
      .toEqual(["Spec", "Build", "Review", "Release"]);

    await rowMenu(page, `root/work/${review}`, "名前を変更");
    await typeName(page, "Review 2");
    await expect.poll(() => nodesNamed(app, "Review 2").length).toBe(1);
    await saved(page);

    // 元に戻すは、行った順の逆にたどる（入力欄の外で Ctrl+Z）。
    await select(page, "root/work/release");
    const undo = async (expected) => {
      await page.keyboard.press("Control+z");
      await expect.poll(expected.read).toEqual(expected.value);
    };
    await undo({ read: () => nodesNamed(app, "Review").length, value: 1 });
    await undo({ read: () => childrenOf(app, "build"), value: ["Review"] });
    await undo({ read: () => childrenOf(app, "build"), value: [] });
    await undo({
      read: () => childrenOf(app, "work"),
      value: ["Spec", "Review", "Build", "Release"],
    });
    await page.keyboard.press("Control+y");
    await expect
      .poll(() => childrenOf(app, "work"))
      .toEqual(["Spec", "Build", "Review", "Release"]);

    await app.restart();
    page = app.window;
    expect(childrenOf(app, "work")).toEqual(["Spec", "Build", "Review", "Release"]);
    expect(childrenOf(app, "spec")).toEqual(["Draft"]);
    await expect(row(page, `root/work/${review}`)).toBeVisible();
  });
});

/** いま操作している（Tab の停留点になっている）行の経路。 */
const activeRow = (page) =>
  page.locator('.TableRow[tabindex="0"]').evaluate((element) => element.dataset.rowPath);

test("keyboard: arrows move and expand, Ctrl+C / Ctrl+V copy a subtree, Ctrl+A and Delete archive the selection", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await select(page, "root/work/spec");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => activeRow(page)).toBe("root/work/build");
    await page.keyboard.press("Home");
    await expect.poll(() => activeRow(page)).toBe("root");
    await page.keyboard.press("End");
    await expect.poll(() => activeRow(page)).toBe("root/inbox/idea");

    // 左で親へ戻り、もう一度左で畳む。右で開き直し、もう一度右で最初の子へ。
    await select(page, "root/work/spec");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => activeRow(page)).toBe("root/work");
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, "root/work/spec")).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(row(page, "root/work/spec")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => activeRow(page)).toBe("root/work/spec");

    // コピーして別のプロジェクトへ貼る。複製は元と独立して編集できる。
    await page.keyboard.press("Control+c");
    await select(page, "root/home");
    await page.keyboard.press("Control+v");
    await expect.poll(() => childrenOf(app, "home")).toEqual(["Groceries", "Spec のコピー"]);
    const copy = nodesNamed(app, "Spec のコピー")[0];
    expect(copy.body).toBe(graphOf(app).nodes.spec.body);
    await rowMenu(page, `root/home/${copy.id}`, "名前を変更");
    await typeName(page, "Spec (home)");
    await expect.poll(() => nodesNamed(app, "Spec (home)").length).toBe(1);
    expect(graphOf(app).nodes.spec.name).toBe("Spec");

    // Ctrl+A で見えている行をすべて選び、Esc で解除する。
    await select(page, "root/work/spec");
    await page.keyboard.press("Control+a");
    await expect(page.getByRole("toolbar", { name: "一括操作" })).toContainText("件選択");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("toolbar", { name: "一括操作" })).toHaveCount(0);

    // 2 行を選んで Delete → 確認 → どちらもアーカイブされ、表示から消える。
    await select(page, "root/work/build");
    await select(page, "root/work/release", ["Control"]);
    await page.keyboard.press("Delete");
    await page.getByRole("button", { name: "アーカイブする", exact: true }).click();
    await expect
      .poll(() => [graphOf(app).nodes.build.archived, graphOf(app).nodes.release.archived])
      .toEqual([true, true]);
    await expect(row(page, "root/work/build")).toHaveCount(0);
    await expect(row(page, "root/work/release")).toHaveCount(0);
    expect(await visibleRows(page)).toContain("2:Spec");
  });
});

test("detail pane: name, status, dates, tags and body edits save, reject an inverted range, and undo across a restart", async () => {
  await run(createWorkspace(), async (app) => {
    let page = app.window;
    await select(page, "root/work/spec");
    await page.getByRole("button", { name: "編集", exact: true }).click();
    const detail = page.getByRole("region", { name: "ノード詳細" });

    await detail.getByRole("textbox", { name: "ノード名", exact: true }).fill("Spec v2");
    await detail.getByRole("textbox", { name: "ノード名", exact: true }).press("Enter");
    await expect.poll(() => graphOf(app).nodes.spec.name).toBe("Spec v2");

    await detail.getByRole("button", { name: "ステータス", exact: true }).click();
    await page.getByRole("option", { name: "完了", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.spec.status).toBe("Completed");

    await detail.getByLabel("開始日", { exact: true }).fill("2026-10-05");
    await expect.poll(() => graphOf(app).nodes.spec.startDate).toBe("2026-10-05");

    // 期限が開始より前になる変更は保存されず、失敗が見える。
    await detail.getByLabel("期限日", { exact: true }).fill("2026-10-01");
    await expect(page.getByRole("status").filter({ hasText: "保存失敗" })).toBeVisible();
    expect(graphOf(app).nodes.spec.dueDate).toBe("2026-10-10");
    await detail.getByLabel("期限日", { exact: true }).fill("2026-10-12");
    await expect.poll(() => graphOf(app).nodes.spec.dueDate).toBe("2026-10-12");
    await saved(page);

    const tags = detail.getByRole("textbox", { name: "ノードのタグ" });
    await tags.fill("urgent");
    await tags.press("Enter");
    await detail.getByRole("button", { name: "タグ design を外す" }).click();
    await expect.poll(() => graphOf(app).nodes.spec.tags).toEqual(["urgent"]);

    // ツリーの行にも同じ値が出る。
    const specRow = row(page, "root/work/spec");
    await expect(specRow.getByRole("textbox", { name: "Spec v2のノード名" })).toBeVisible();
    await expect(specRow.getByRole("button", { name: "Spec v2の期限日" })).toHaveText("2026-10-12");

    await page.getByRole("tab", { name: "本文", exact: true }).click();
    await page.getByRole("button", { name: /^メモ表示モード：/ }).click();
    await page.getByRole("option", { name: "編集", exact: true }).click();
    await page.locator(".cm-content").fill("# Spec\n\nsecond draft");
    await expect.poll(() => graphOf(app).nodes.spec.body).toBe("# Spec\n\nsecond draft");
    await saved(page);

    // 履歴はファイルに残るので、起動し直しても元に戻せる。
    await app.restart();
    page = app.window;
    await select(page, "root/work/release");
    await page.keyboard.press("Control+z");
    await expect.poll(() => graphOf(app).nodes.spec.body).toBe("# Spec\n\nfirst draft");
    await page.keyboard.press("Control+z");
    await expect.poll(() => graphOf(app).nodes.spec.tags).toEqual(["design", "urgent"]);
    await page.keyboard.press("Control+z");
    await expect.poll(() => graphOf(app).nodes.spec.tags).toEqual(["design"]);
    await page.keyboard.press("Control+z");
    await expect.poll(() => graphOf(app).nodes.spec.dueDate).toBe("2026-10-10");
    await page.keyboard.press("Control+z");
    await expect.poll(() => graphOf(app).nodes.spec.startDate).toBeUndefined();
    await page.keyboard.press("Control+z");
    await expect.poll(() => graphOf(app).nodes.spec.status).toBe("Open");
    await page.keyboard.press("Control+z");
    await expect.poll(() => graphOf(app).nodes.spec.name).toBe("Spec");
    await expect(
      row(page, "root/work/spec").getByRole("textbox", { name: "Specのノード名" })
    ).toBeVisible();
  });
});
