// よく使う編集操作（行のメニュー・キーボード・元に戻す）を、組み合わせて通す。
import { test, expect } from "@playwright/test";
import {
  childrenOf,
  createWorkspace,
  graphOf,
  node,
  nodesNamed,
  overflow,
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
    // 画面が変わらないコピーは、通知で何を写したかを知らせる。
    await page.keyboard.press("Control+c");
    await expect(
      page.getByRole("status").filter({ hasText: "「Spec」をコピーしました" })
    ).toBeVisible();
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

    // 2 行を選んで Delete → 確認なしでどちらもアーカイブされ、表示から消える。
    await select(page, "root/work/build");
    await select(page, "root/work/release", ["Control"]);
    await page.keyboard.press("Delete");
    await expect(
      page.getByRole("status").filter({ hasText: "2 件をアーカイブしました" })
    ).toBeVisible();
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

    // 期限が開始より前になる変更は受け付けず、理由を日本語で出す。ファイルは
    // 変わっていないので、ヘッダーは「保存失敗」にならない。
    await detail.getByLabel("期限日", { exact: true }).fill("2026-10-01");
    await expect(page.getByRole("alert")).toContainText("開始日が期限日より後になっています");
    await expect(page.getByRole("alert")).not.toContainText("Error invoking");
    await expect(page.getByRole("status").filter({ hasText: "保存済み" })).toBeVisible();
    expect(graphOf(app).nodes.spec.dueDate).toBe("2026-10-10");
    await detail.getByLabel("期限日", { exact: true }).fill("2026-10-12");
    await expect.poll(() => graphOf(app).nodes.spec.dueDate).toBe("2026-10-12");
    await saved(page);

    const tags = detail.getByRole("textbox", { name: "ノードのタグ" });
    await tags.fill("urgent");
    await tags.press("Enter");
    // 追加の結果が画面に出てから外す（古い一覧から組み立てた変更で、追加が消えないように）。
    await expect(detail.getByRole("button", { name: "タグ urgent を外す" })).toBeVisible();
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

/** いまフォーカスのある行の名前（名前の入力中なら "editing"）。 */
const focusedRowName = (page) =>
  page.evaluate(() => {
    if (document.querySelector('.TableRow input[type="text"]:focus')) return "editing";
    const active = document.activeElement;
    return active?.getAttribute("role") === "row"
      ? active.querySelector('input[type="text"]').value
      : null;
  });

/**
 * Work の下に見えている行（「深さ:名前」）。ファイルは画面より先に書き換わるので、
 * ディスクだけを見て次のキーを押すと、画面が追いつく前のキーが取りこぼされる。
 * 次のキーの前に、画面にも結果が出るのを待つ。
 */
const shownUnderWork = async (page) => {
  const rows = await visibleRows(page);
  return rows.slice(rows.indexOf("1:Work") + 1, rows.indexOf("1:Home"));
};

test("keyboard editing: Enter adds and keeps going, Ctrl+Enter adds a child, F2 renames, Tab and Alt+arrows move", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await select(page, "root/work/spec");

    // Enter で下に追加 → 名前を入れて Enter → フォーカスは新しい行に戻り、
    // もう一度 Enter で続けて追加できる。
    await page.keyboard.press("Enter");
    await typeName(page, "One");
    await expect.poll(() => focusedRowName(page)).toBe("One");
    await page.keyboard.press("Enter");
    await typeName(page, "Two");
    await expect
      .poll(() => childrenOf(app, "work"))
      .toEqual(["Spec", "One", "Two", "Build", "Release"]);
    await expect.poll(() => focusedRowName(page)).toBe("Two");

    // Tab でインデント（One の子に）、Shift+Tab で戻す。フォーカスは動いた行に付いていく。
    await page.keyboard.press("Tab");
    await expect.poll(() => childrenOf(app, nodesNamed(app, "One")[0].id)).toEqual(["Two"]);
    await expect
      .poll(() => shownUnderWork(page))
      .toEqual(["2:Spec", "2:One", "3:Two", "2:Build", "2:Release"]);
    await expect.poll(() => focusedRowName(page)).toBe("Two");
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() => childrenOf(app, "work"))
      .toEqual(["Spec", "One", "Two", "Build", "Release"]);
    await expect
      .poll(() => shownUnderWork(page))
      .toEqual(["2:Spec", "2:One", "2:Two", "2:Build", "2:Release"]);
    await expect.poll(() => focusedRowName(page)).toBe("Two");

    // Alt+↑ / Alt+↓ で兄弟の中を動く。
    await page.keyboard.press("Alt+ArrowUp");
    await expect
      .poll(() => childrenOf(app, "work"))
      .toEqual(["Spec", "Two", "One", "Build", "Release"]);
    await expect
      .poll(() => shownUnderWork(page))
      .toEqual(["2:Spec", "2:Two", "2:One", "2:Build", "2:Release"]);
    await expect.poll(() => focusedRowName(page)).toBe("Two");
    await page.keyboard.press("Alt+ArrowDown");
    await expect
      .poll(() => childrenOf(app, "work"))
      .toEqual(["Spec", "One", "Two", "Build", "Release"]);
    await expect
      .poll(() => shownUnderWork(page))
      .toEqual(["2:Spec", "2:One", "2:Two", "2:Build", "2:Release"]);
    await expect.poll(() => focusedRowName(page)).toBe("Two");

    // F2 で名前を変え、Esc で取り消すと元の名前のまま行にフォーカスが戻る。
    await page.keyboard.press("F2");
    await expect.poll(() => focusedRowName(page)).toBe("editing");
    await page.keyboard.press("Escape");
    await expect.poll(() => focusedRowName(page)).toBe("Two");
    await page.keyboard.press("F2");
    await typeName(page, "Two renamed");
    await expect.poll(() => nodesNamed(app, "Two renamed").length).toBe(1);

    // Ctrl+Enter で子に追加。
    await page.keyboard.press("Control+Enter");
    await typeName(page, "Child");
    await expect
      .poll(() => childrenOf(app, nodesNamed(app, "Two renamed")[0].id))
      .toEqual(["Child"]);

    // メニューにもキーが出る（名前には混ざらない）。
    await rowMenu(page, "root/work/spec", "名前を変更");
    await page.keyboard.press("Escape");
    await row(page, "root/work/spec").getByRole("button", { name: "ノード操作を開く" }).click();
    await expect(page.getByRole("menuitem", { name: "インデント", exact: true })).toHaveAttribute(
      "aria-keyshortcuts",
      "Tab"
    );
    await page.keyboard.press("Escape");
  });
});

test("detail edit mode stays on across rows; archive needs no confirmation and its notice undoes it; undo says what it reverted", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    const detail = page.getByRole("region", { name: "ノード詳細" });
    await select(page, "root/work/spec");
    await detail.getByRole("button", { name: "編集", exact: true }).click();
    await expect(detail.getByRole("textbox", { name: "ノード名", exact: true })).toHaveValue(
      "Spec"
    );
    // 別の行へ移っても編集モードのまま。
    await select(page, "root/work/build");
    await expect(detail.getByRole("textbox", { name: "ノード名", exact: true })).toHaveValue(
      "Build"
    );

    // アーカイブは確認なし。通知の「元に戻す」で戻る。
    await select(page, "root/work/release");
    await page.keyboard.press("Delete");
    const archived = page
      .getByRole("status")
      .filter({ hasText: "「Release」をアーカイブしました" });
    await expect(archived).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => graphOf(app).nodes.release.archived).toBe(true);
    await archived.getByRole("button", { name: "元に戻す" }).click();
    await expect.poll(() => graphOf(app).nodes.release.archived).toBeFalsy();
    await expect(row(page, "root/work/release")).toBeVisible();

    // 元に戻す / やり直すは、変わったノードの名前を知らせる。
    await rowMenu(page, "root/work/spec", "名前を変更");
    await typeName(page, "Spec 2");
    await expect.poll(() => graphOf(app).nodes.spec.name).toBe("Spec 2");
    await select(page, "root/home");
    await page.keyboard.press("Control+z");
    await expect(
      page.getByRole("status").filter({ hasText: "元に戻しました：「Spec」" })
    ).toBeVisible();
    await page.keyboard.press("Control+y");
    await expect(
      page.getByRole("status").filter({ hasText: "やり直しました：「Spec 2」" })
    ).toBeVisible();

    // 完全削除は、これまでどおり確認する。
    await overflow(page, "アーカイブ済みを表示", "menuitemcheckbox");
    await select(page, "root/work/release");
    await page.keyboard.press("Delete");
    await select(page, "root/work/release");
    await page.keyboard.press("Delete");
    await expect(page.getByText("完全削除の確認")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

test("focus stays usable after archive, undo and a status change, and F6 moves between the tree and the detail pane", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    const focused = () =>
      page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return "body";
        return active.getAttribute("role") === "row"
          ? `row:${active.dataset.rowPath}`
          : active.getAttribute("aria-label") || active.tagName;
      });

    // アーカイブした行の次の行にフォーカスが移り、そのまま矢印キーが効く。
    await select(page, "root/work/build");
    await page.keyboard.press("Delete");
    await expect.poll(focused).toBe("row:root/work/release");
    await page.keyboard.press("ArrowUp");
    await expect.poll(focused).toBe("row:root/work/spec");
    await page.keyboard.press("Control+z");
    await expect(row(page, "root/work/build")).toBeVisible();
    await expect.poll(focused).toMatch(/^row:/);

    // ステータスを選ぶと、開いたボタンへ戻る。
    await row(page, "root/work/spec").getByRole("button", { name: "Specのステータス" }).click();
    await page.getByRole("option", { name: "完了", exact: true }).click();
    await expect.poll(focused).toBe("Specのステータス");

    // F6 で詳細ペインへ、もう一度で行へ戻る。
    await select(page, "root/work/spec");
    await page.keyboard.press("F6");
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.querySelector("section.node-detail")?.contains(document.activeElement)
        )
      )
      .toBe(true);
    await page.keyboard.press("F6");
    await expect.poll(focused).toBe("row:root/work/spec");
  });
});

test("a Quill body stays in edit mode when another node is selected", async () => {
  const nodes = [
    node("root", [], { name: "Workspace" }),
    node("a", [["root", 0]], { name: "A", body: "<p>alpha</p>", format: "quill" }),
    node("b", [["root", 1]], { name: "B", body: "<p>beta</p>", format: "quill" }),
  ];
  await run(createWorkspace(nodes), async (app) => {
    const page = app.window;
    const bodyToolbar = page.locator("section.node-detail .body-toolbar");
    await select(page, "root/a");
    await page.getByRole("tab", { name: "本文", exact: true }).click();
    await bodyToolbar.getByRole("button", { name: "編集", exact: true }).click();
    await expect(
      bodyToolbar.getByRole("button", { name: "プレビュー", exact: true })
    ).toBeVisible();
    // 別のノードへ移っても、本文は編集できるまま。
    await select(page, "root/b");
    await expect(page.getByRole("tab", { name: "本文", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(
      bodyToolbar.getByRole("button", { name: "プレビュー", exact: true })
    ).toBeVisible();
    await expect(page.locator("section.node-detail .ql-editor")).toHaveAttribute(
      "contenteditable",
      "true"
    );
  });
});

test("Esc right after adding cancels the new node, and Ctrl+X then Ctrl+V moves a node", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    const before = Object.keys(graphOf(app).nodes).length;

    // 追加直後の名前入力を Esc で取り消すと、ノードも残らない。
    await select(page, "root/work/spec");
    await page.keyboard.press("Enter");
    await expect(page.locator('.TableRow input[type="text"]:focus')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => Object.keys(graphOf(app).nodes).length).toBe(before);
    expect(nodesNamed(app, "新しいノード")).toEqual([]);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-row-path")))
      .toBe("root/work/spec");

    // 名前を付けてからの Esc（F2 の取り消し）はノードを消さない。
    await page.keyboard.press("F2");
    await page.keyboard.press("Escape");
    expect(graphOf(app).nodes.spec.name).toBe("Spec");

    // 切り取って別の親に貼ると、複製ではなく移動になる。
    await select(page, "root/inbox/idea");
    await page.keyboard.press("Control+x");
    await expect(
      page.getByRole("status").filter({ hasText: "「Idea」を切り取りました" })
    ).toBeVisible();
    await select(page, "root/work");
    await page.keyboard.press("Control+v");
    await expect.poll(() => childrenOf(app, "work")).toContain("Idea");
    expect(childrenOf(app, "inbox")).toEqual([]);
    expect(Object.keys(graphOf(app).nodes).length).toBe(before);
    expect(graphOf(app).nodes.idea.parents.map((parent) => parent.id)).toEqual(["work"]);
  });
});

test("the separate detail window shows the archive notice and its undo", async () => {
  await run(createWorkspace(), async (app) => {
    const page = app.window;
    await select(page, "root/work/release");
    const opened = app.electronApp.waitForEvent("window");
    await page.getByRole("button", { name: "ノード詳細の操作" }).click();
    await page.getByRole("menuitem", { name: "別Windowで開く", exact: true }).click();
    const detail = await opened;
    await detail.getByRole("button", { name: "ノード詳細の操作" }).click();
    await detail.getByRole("menuitem", { name: "アーカイブ", exact: true }).click();
    // 確認を挟まない操作なので、別ウィンドウでも通知と「元に戻す」を出す。
    const archived = detail
      .getByRole("status")
      .filter({ hasText: "「Release」をアーカイブしました" });
    await expect(archived).toBeVisible();
    await expect.poll(() => graphOf(app).nodes.release.archived).toBe(true);
    await archived.getByRole("button", { name: "元に戻す" }).click();
    await expect.poll(() => graphOf(app).nodes.release.archived).toBeFalsy();
  });
});
