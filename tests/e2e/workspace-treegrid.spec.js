import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect, _electron as electron } from "@playwright/test";

const REPO_ROOT = path.resolve(__dirname, "../..");

test("revision conflict preserves body input and retry keeps external changes", async () => {
  const app = await launch(fixture());
  try {
    const page = app.window;
    await select(page, "root/alpha/shared");
    await page.getByRole("tab", { name: "本文", exact: true }).click();
    await page.getByRole("button", { name: /^メモ表示モード：/ }).click();
    await page.getByRole("option", { name: "編集", exact: true }).click();
    const file = path.join(app.workspacePath, ".task-manage", "graph-v1.json");
    const document = JSON.parse(fs.readFileSync(file, "utf8"));
    document.graph.revision++;
    document.graph.nodes.review.name = "External edit";
    fs.writeFileSync(file, JSON.stringify(document));
    await page.locator(".cm-content").fill("Keep input after conflict");
    await page.getByRole("button", { name: "今すぐ保存", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Workspace graph changed" })
    ).toBeVisible();
    await expect(page.locator(".cm-content")).toHaveText("Keep input after conflict");
    await page.getByRole("button", { name: "再試行", exact: true }).first().click();
    await expect.poll(() => graphOf(app).nodes.shared.body).toBe("Keep input after conflict");
    expect(graphOf(app).nodes.review.name).toBe("External edit");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await cleanup(app);
  }
});

test("Gantt rows align at both densities and pointer edits persist their dates", async () => {
  const app = await launch(fixture());
  try {
    const page = app.window;
    await page.getByRole("button", { name: "表示と操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "ガントチャートを表示", exact: true }).click();
    const ganttRow = page.locator('.GanttRow[data-row-path="root/alpha/review"]');
    const treeRow = page.locator('.TreeTable [data-row-path="root/alpha/review"]');
    for (const [label, height] of [
      ["標準", 32],
      ["コンパクト", 28],
    ]) {
      await page.getByRole("button", { name: "設定を開く", exact: true }).click();
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await ganttRow.boundingBox()).height).toBe(height);
      const tree = await treeRow.boundingBox(),
        gantt = await ganttRow.boundingBox();
      expect(gantt.y).toBeCloseTo(tree.y, 0);
      expect(tree.height).toBe(height);
    }
    await page.getByRole("button", { name: "日表示", exact: true }).click();
    const body = await page.locator(".GanttBody").boundingBox();
    const rowBox = await ganttRow.boundingBox();
    await page.mouse.move(body.x + 40, rowBox.y + rowBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(body.x + 120, rowBox.y + rowBox.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(() => Boolean(graphOf(app).nodes.review.startDate && graphOf(app).nodes.review.dueDate))
      .toBe(true);
    for (const [selector, field, dx] of [
      [".Bar", "startDate", 24],
      [".StartHandle", "startDate", -24],
      [".EndHandle", "dueDate", 24],
    ]) {
      const before = graphOf(app).nodes.review[field];
      const box = await ganttRow.locator(selector).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => graphOf(app).nodes.review[field]).not.toBe(before);
    }
  } finally {
    await cleanup(app);
  }
});

test("body conversion flushes edits and the replacement editor saves the new format", async () => {
  const app = await launch(fixture());
  try {
    const page = app.window;
    await select(page, "root/alpha/shared");
    await page.getByRole("tab", { name: "本文", exact: true }).click();
    await page.getByRole("button", { name: /^メモ表示モード：/ }).click();
    await page.getByRole("option", { name: "編集", exact: true }).click();
    await page.locator(".cm-content").fill("Pending before conversion");
    await page.getByRole("button", { name: "Node詳細の操作" }).click();
    await page.getByRole("menuitem", { name: "形式を変換", exact: true }).click();
    await page.getByRole("button", { name: /^(アーカイブする|完全に削除|実行する)$/ }).click();
    await expect(page.locator(".ql-editor")).toContainText("Pending before conversion");
    await page.locator(".body-toolbar").getByRole("button", { name: "編集", exact: true }).click();
    await page.locator(".ql-editor").fill("Edited after conversion");
    await page.getByRole("tab", { name: "概要", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.shared.format).toBe("quill");
    await expect
      .poll(() =>
        graphOf(app)
          .nodes.shared.body.ops.map((op) => op.insert)
          .join("")
      )
      .toBe("Edited after conversion\n");
    await select(page, "root/alpha/review");
    await select(page, "root/beta/shared");
    await page.getByRole("tab", { name: "本文", exact: true }).click();
    await expect(page.locator(".ql-editor")).toContainText("Edited after conversion");
  } finally {
    await cleanup(app);
  }
});

test("Markdown diagrams fit their SVG after a theme change and editor remount", async () => {
  const app = await launch(fixture());
  try {
    const page = app.window;
    await select(page, "root/alpha/shared");
    await page.getByRole("tab", { name: "本文", exact: true }).click();
    await page.getByRole("button", { name: /^メモ表示モード：/ }).click();
    await page.getByRole("option", { name: "編集", exact: true }).click();
    await page
      .locator(".cm-content")
      .fill('```mermaid\ngraph LR\nA --> B\n```\n\n```js\nconst value = "example";\n```');
    await page.getByRole("button", { name: /^メモ表示モード：/ }).click();
    await page.getByRole("option", { name: "プレビュー", exact: true }).click();
    const assertDiagram = async () => {
      await expect(page.locator(".mermaid-block svg")).toBeVisible();
      await expect
        .poll(() =>
          page.locator(".mermaid-block svg").evaluate((svg) => {
            const box = svg.getBBox(),
              view = svg.viewBox.baseVal;
            return (
              box.x >= view.x &&
              box.y >= view.y &&
              box.x + box.width <= view.x + view.width &&
              box.y + box.height <= view.y + view.height &&
              view.height < 200
            );
          })
        )
        .toBe(true);
      await expect(page.locator(".preview pre code")).toHaveText('const value = "example";\n');
    };
    await assertDiagram();
    await page.getByRole("checkbox", { name: /Dark.*Light/ }).click();
    await assertDiagram();
    await select(page, "root/alpha/review");
    await select(page, "root/beta/shared");
    await assertDiagram();
  } finally {
    await cleanup(app);
  }
});

test("closing with a pending Markdown edit persists it before the window exits", async () => {
  let app = await launch(fixture());
  try {
    const context = { tempDir: app.tempDir, workspacePath: app.workspacePath };
    await select(app.window, "root/alpha/shared");
    await app.window.getByRole("tab", { name: "本文", exact: true }).click();
    await app.window.getByRole("button", { name: /^メモ表示モード：/ }).click();
    await app.window.getByRole("option", { name: "編集", exact: true }).click();
    await app.window.locator(".cm-content").fill("Saved during window close");
    // Electron cancels beforeunload without a browser confirmation dialog.
    // The renderer resumes close after flushing; avoid Playwright's automatic
    // attempt to dismiss a dialog that Electron does not show.
    app.window.on("dialog", () => {});
    await Promise.all([
      app.window.waitForEvent("close"),
      app.window.getByRole("button", { name: "閉じる", exact: true }).click(),
    ]);
    await expect.poll(() => graphOf(app).nodes.shared.body).toBe("Saved during window close");
    await app.electronApp.close();
    app = await launch(context);
    expect(graphOf(app).nodes.shared.body).toBe("Saved during window close");
  } finally {
    await cleanup(app);
  }
});

test("detail view state leaves records unchanged and pending body saves keep their node", async () => {
  const app = await launch(fixture());
  try {
    const page = app.window;
    await select(page, "root/alpha/shared");
    const before = graphOf(app);
    await page.getByRole("tab", { name: "本文", exact: true }).click();
    await page.getByRole("tab", { name: /^添付/ }).click();
    await page.getByRole("tab", { name: "概要", exact: true }).click();
    await page.getByRole("button", { name: "表示と操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "列の設定", exact: true }).click();
    await page.getByRole("spinbutton", { name: "ステータスの幅", exact: true }).fill("180");
    await page.getByRole("spinbutton", { name: "ステータスの幅", exact: true }).blur();
    await page.keyboard.press("Escape");
    // 閉じたらメニューを開いたボタンへフォーカスが戻る。
    await expect(page.getByRole("button", { name: "表示と操作", exact: true })).toBeFocused();
    expect(graphOf(app)).toEqual(before);
    await page.getByRole("tab", { name: "本文", exact: true }).click();
    await page.getByRole("button", { name: /^メモ表示モード：/ }).click();
    await page.getByRole("option", { name: "編集", exact: true }).click();
    await page.locator(".cm-content").fill("Pending shared body");
    await select(page, "root/alpha/review");
    await select(page, "root/beta/shared");
    await expect.poll(() => graphOf(app).nodes.shared.body).toBe("Pending shared body");
    expect(graphOf(app).nodes.root.body).toEqual(before.nodes.root.body);
    expect(graphOf(app).nodes.review.body).toEqual(before.nodes.review.body);
    await page.getByRole("button", { name: /^メモ表示モード：/ }).click();
    await page.getByRole("option", { name: "プレビュー", exact: true }).click();
    await expect(page.locator(".node-detail .preview")).toContainText("Pending shared body");
    await page.getByRole("button", { name: "クイック追加", exact: true }).click();
    await page.getByRole("textbox", { name: "追加するタスク名" }).fill("Captured by button");
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "追加するタスク名" })).toHaveValue("");
    await page.getByRole("textbox", { name: "追加するタスク名" }).fill("Captured and closed");
    await page.getByRole("button", { name: "追加して閉じる", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Inboxへクイック追加" })).toHaveCount(0);
    const graph = graphOf(app);
    expect(
      Object.values(graph.nodes)
        .filter((node) => node.parents.some((p) => p.id === graph.inboxId))
        .map((n) => n.name)
    ).toEqual(expect.arrayContaining(["Captured by button", "Captured and closed"]));
  } finally {
    await cleanup(app);
  }
});

test("linking a descendant creates a terminal cycle; attachment survives undo and restart", async () => {
  let app = await launch(fixture());
  try {
    const page = app.window;
    await select(page, "root/alpha");
    await page.getByRole("button", { name: "所属先を追加", exact: true }).click();
    await page.getByRole("textbox", { name: "親ノードを追加", exact: true }).fill("review");
    await page.getByRole("listbox", { name: "親の候補" }).getByRole("option").first().click();
    await expect.poll(() => graphOf(app).nodes.alpha.parents.map((p) => p.id)).toContain("review");
    await expect(row(page, "root/alpha/review/alpha")).toBeVisible();
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.alpha.parents.map((p) => p.id)).toEqual(["root"]);
    await select(page, "root/alpha/shared");
    await page.getByRole("tab", { name: /添付/ }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("TreeGrid attachment"),
    });
    await expect.poll(() => graphOf(app).nodes.shared.attachments?.length).toBe(1);
    const attachment = graphOf(app).nodes.shared.attachments[0];
    expect(attachment.name).toBe("notes.txt");
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.shared.attachments?.length ?? 0).toBe(0);
    await page.getByRole("button", { name: "やり直し", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.shared.attachments?.length).toBe(1);
    const context = { tempDir: app.tempDir, workspacePath: app.workspacePath };
    await app.electronApp.close();
    app = await launch(context);
    await select(app.window, "root/alpha/shared");
    await app.window.getByRole("tab", { name: /^添付/ }).click();
    await expect(app.window.getByRole("button", { name: /notes.txt/ }).first()).toBeVisible();
  } finally {
    await cleanup(app);
  }
});
const node = (id, parents = [], extra = {}) => ({
  id,
  name: id,
  parents: parents.map((id, order) => ({ id, order })),
  createdAt: "2026-01-01",
  ...extra,
});

test("drop before, after and onto the root persists the requested occurrence", async () => {
  const context = fixture();
  const file = path.join(context.workspacePath, ".task-manage", "graph-v1.json");
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  ["shared", "review", "implementation"].forEach((id, order) => {
    document.graph.nodes[id].parents.find((p) => p.id === "alpha").order = order;
  });
  fs.writeFileSync(file, JSON.stringify(document));
  const app = await launch(context);
  try {
    const page = app.window;
    const order = () =>
      Object.values(graphOf(app).nodes)
        .filter((n) => n.parents.some((p) => p.id === "alpha"))
        .sort(
          (a, b) =>
            a.parents.find((p) => p.id === "alpha").order -
            b.parents.find((p) => p.id === "alpha").order
        )
        .map((n) => n.id);
    await row(page, "root/alpha/implementation").dragTo(row(page, "root/alpha/review"), {
      sourcePosition: { x: 100, y: 12 },
      targetPosition: { x: 100, y: 2 },
    });
    await page.getByRole("button", { name: "移動", exact: true }).click();
    await expect.poll(order).toEqual(["shared", "implementation", "review"]);
    await row(page, "root/alpha/implementation").dragTo(row(page, "root/alpha/review"), {
      sourcePosition: { x: 100, y: 12 },
      targetPosition: {
        x: 100,
        y: (await row(page, "root/alpha/review").boundingBox()).height - 2,
      },
    });
    await page.getByRole("button", { name: "移動", exact: true }).click();
    await expect.poll(order).toEqual(["shared", "review", "implementation"]);
    await row(page, "root/alpha/implementation").dragTo(row(page, "root"), {
      sourcePosition: { x: 100, y: 12 },
      targetPosition: { x: 100, y: 15 },
    });
    await page.getByRole("button", { name: "移動", exact: true }).click();
    await expect
      .poll(() => graphOf(app).nodes.implementation.parents.map((p) => p.id))
      .toEqual(["root"]);
  } finally {
    await cleanup(app);
  }
});

test("Inbox is protected and notifications do not shift the tree", async () => {
  const context = fixture();
  const file = path.join(context.workspacePath, ".task-manage", "graph-v1.json");
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  document.graph.inboxId = "inbox";
  document.graph.nodes.inbox = node("inbox", ["root"], { name: "Inbox" });
  fs.writeFileSync(file, JSON.stringify(document));
  const app = await launch(context);
  try {
    const page = app.window;
    await select(page, "root/inbox");
    await expect(
      page.getByRole("button", { name: "プロジェクトルートはアーカイブできません" })
    ).toBeDisabled();
    const before = await page.getByRole("treegrid").boundingBox();
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send("save-error", "Verification: save failed");
    });
    await expect(page.getByRole("alert")).toContainText("Verification: save failed");
    expect(await page.getByRole("treegrid").boundingBox()).toEqual(before);
    await app.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(800, 520)
    );
    await page.getByRole("button", { name: "ステータスフィルター", exact: true }).click();
    const panel = await page.locator(".StatusFilterPanel").boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
  } finally {
    await cleanup(app);
  }
});
test("archiving a shared node asks whether to clear one place or the whole node", async () => {
  const app = await launch(fixture());
  try {
    const page = app.window;
    await expect(row(page, "root/alpha/shared")).toBeVisible();
    await expect(row(page, "root/beta/shared")).toBeVisible();

    // この場所だけ: alpha の下の行だけが消え、beta の下は現役のまま。
    await select(page, "root/alpha/shared");
    await row(page, "root/alpha/shared").getByRole("button", { name: "タスク操作を開く" }).click();
    await page.getByRole("menuitem", { name: "アーカイブ", exact: true }).click();
    await page.getByRole("button", { name: "この場所だけ", exact: true }).click();
    await expect(row(page, "root/alpha/shared")).toHaveCount(0);
    await expect(row(page, "root/beta/shared")).toBeVisible();
    await expect
      .poll(() => graphOf(app).nodes.shared.parents.find((p) => p.id === "alpha").archived)
      .toBe(true);
    expect(graphOf(app).nodes.shared.archived).toBeUndefined();
    expect(graphOf(app).nodes.shared.parents.find((p) => p.id === "beta").archived).toBeUndefined();

    // アーカイブ表示から復元すると、その行が戻る。
    await page.getByRole("button", { name: "表示と操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "アーカイブ済みを表示", exact: true }).click();
    await expect(row(page, "root/alpha/shared")).toBeVisible();
    await row(page, "root/alpha/shared").getByRole("button", { name: "タスク操作を開く" }).click();
    await page.getByRole("menuitem", { name: "復元", exact: true }).click();
    await expect
      .poll(() => graphOf(app).nodes.shared.parents.find((p) => p.id === "alpha").archived)
      .toBeUndefined();
    await page.getByRole("button", { name: "表示と操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "アーカイブ済みを隠す", exact: true }).click();

    // ノード全体: どの親の下からも消える。
    await select(page, "root/alpha/shared");
    await row(page, "root/alpha/shared").getByRole("button", { name: "タスク操作を開く" }).click();
    await page.getByRole("menuitem", { name: "アーカイブ", exact: true }).click();
    await page.getByRole("button", { name: "ノード全体", exact: true }).click();
    await expect(row(page, "root/alpha/shared")).toHaveCount(0);
    await expect(row(page, "root/beta/shared")).toHaveCount(0);
    await expect.poll(() => graphOf(app).nodes.shared.archived).toBe(true);
  } finally {
    await cleanup(app);
  }
});
test("archiving a branch hides everything under it and restoring a deep row brings the path back", async () => {
  const app = await launch(fixture());
  try {
    const page = app.window;
    // まず配下（alpha / shared / cycle）だけをアーカイブしておく。
    await select(page, "root/alpha/shared/cycle");
    await row(page, "root/alpha/shared/cycle")
      .getByRole("button", { name: "タスク操作を開く" })
      .click();
    await page.getByRole("menuitem", { name: "アーカイブ", exact: true }).click();
    await page.getByRole("button", { name: /^(アーカイブする|完全に削除|実行する)$/ }).click();
    await expect.poll(() => graphOf(app).nodes.cycle.archived).toBe(true);

    // 次に中間（alpha の下の shared）をこの場所だけアーカイブすると、その下の行も消える。
    await select(page, "root/alpha/shared");
    await row(page, "root/alpha/shared").getByRole("button", { name: "タスク操作を開く" }).click();
    await page.getByRole("menuitem", { name: "アーカイブ", exact: true }).click();
    await page.getByRole("button", { name: "この場所だけ", exact: true }).click();
    await expect(row(page, "root/alpha/shared")).toHaveCount(0);
    await expect(row(page, "root/alpha/shared/cycle")).toHaveCount(0);
    await expect(row(page, "root/beta/shared")).toBeVisible();

    // 最下位の行を復元すると、経路上の中間（alpha→shared の辺）も外れて行が戻る。
    await page.getByRole("button", { name: "表示と操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "アーカイブ済みを表示", exact: true }).click();
    await row(page, "root/alpha/shared/cycle")
      .getByRole("button", { name: "タスク操作を開く" })
      .click();
    await page.getByRole("menuitem", { name: "復元", exact: true }).click();
    // ノード側の復元は archived を false にする（キーは残る）。辺側はキーごと消す。
    await expect.poll(() => graphOf(app).nodes.cycle.archived).toBeFalsy();
    await expect
      .poll(() => graphOf(app).nodes.shared.parents.find((p) => p.id === "alpha").archived)
      .toBeUndefined();
    await page.getByRole("button", { name: "表示と操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "アーカイブ済みを隠す", exact: true }).click();
    await expect(row(page, "root/alpha/shared")).toBeVisible();
    await expect(row(page, "root/alpha/shared/cycle")).toBeVisible();
  } finally {
    await cleanup(app);
  }
});

function fixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-treegrid-"));
  const workspacePath = path.join(tempDir, "workspace");
  fs.mkdirSync(path.join(workspacePath, ".task-manage"), { recursive: true });
  const nodes = [
    node("root"),
    node("alpha", ["root"]),
    node("beta", ["root"]),
    node("shared", ["alpha", "beta", "cycle"], {
      status: "In Progress",
      tags: ["design"],
      body: "shared body",
      format: "markdown",
    }),
    node("cycle", ["shared"]),
    node("review", ["alpha"], { status: "Open" }),
    node("implementation", ["alpha"], { status: "Open" }),
  ];
  const graph = {
    schemaVersion: 1,
    workspaceId: "treegrid-test",
    rootId: "root",
    revision: 0,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
  fs.writeFileSync(
    path.join(workspacePath, ".task-manage", "graph-v1.json"),
    JSON.stringify({ schemaVersion: 1, graph, undo: [], redo: [] })
  );
  fs.writeFileSync(path.join(tempDir, "db.json"), "[]");
  fs.writeFileSync(
    path.join(tempDir, "meta.json"),
    JSON.stringify({
      theme: "dark",
      workspaces: [{ label: "TreeGrid", path: workspacePath }],
      activeWorkspace: workspacePath,
    })
  );
  return { tempDir, workspacePath };
}
async function launch(context) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({
    args: [".", ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    cwd: REPO_ROOT,
    env: {
      ...env,
      PLAYWRIGHT_TEST: "true",
      TASK_MANAGE_DATA_DIR: context.tempDir,
      TASK_MANAGE_OPEN_DEVTOOLS: "false",
    },
  });
  const window = await electronApp.firstWindow();
  const errors = [];
  window.on("pageerror", (e) => errors.push(e.message));
  try {
    await expect(window.getByRole("main", { name: "Workspace TreeGrid" })).toBeVisible();
    await expect(window.getByRole("treegrid")).toBeVisible();
  } catch (e) {
    const diagnostics = JSON.stringify({ errors, body: await window.locator("body").innerText() });
    await electronApp.close();
    throw new Error(`${e.message}\n${diagnostics}`, { cause: e });
  }
  return { ...context, electronApp, window };
}
const graphOf = (app) =>
  JSON.parse(fs.readFileSync(path.join(app.workspacePath, ".task-manage", "graph-v1.json"), "utf8"))
    .graph;
const row = (page, occurrence) => page.locator(`[data-row-path="${occurrence}"]`);
async function select(page, occurrence, modifiers = []) {
  await row(page, occurrence).getByRole("gridcell").nth(1).click({ modifiers });
}
async function cleanup(app) {
  await app.electronApp.close();
  fs.rmSync(app.tempDir, { recursive: true, force: true });
}

test("TreeGrid scope, search, filter, columns and terminal cycles", async () => {
  const testInfo = test.info();
  const app = await launch(fixture()),
    page = app.window;
  try {
    await expect(page.locator(".cycle-reference")).toHaveCount(2);
    await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
    await page.getByRole("button", { name: "alpha", exact: true }).click();
    await expect(row(page, "alpha/shared")).toBeVisible();
    await expect(row(page, "root/beta")).toHaveCount(0);
    await page.getByRole("textbox", { name: "タスク一覧を絞り込み" }).fill("review");
    await expect(row(page, "alpha/review")).toBeVisible();
    await expect(row(page, "alpha/implementation")).toHaveCount(0);
    await page.getByRole("textbox", { name: "タスク一覧を絞り込み" }).fill("");
    await page.getByRole("button", { name: "ステータスフィルター", exact: true }).click();
    await page.getByText("未着手", { exact: true }).last().click();
    await page.keyboard.press("Escape");
    await expect(row(page, "alpha/review")).toBeVisible();
    await expect(row(page, "alpha/shared")).toHaveCount(0);
    await page.getByRole("button", { name: "ステータスフィルター", exact: true }).click();
    await page.getByRole("button", { name: "フィルター解除", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "表示と操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "列の設定", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "カラム表示設定" });
    await dialog.getByRole("checkbox", { name: "タグ", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "開始日", exact: true }).uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: /タグ/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /開始日/ })).toHaveCount(0);
    await page.getByRole("button", { name: "表示と操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "すべて折りたたみ", exact: true }).click();
    await expect(page.getByRole("treegrid").getByRole("row")).toHaveCount(2);
    await page.getByRole("button", { name: "表示と操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "すべて展開", exact: true }).first().click();
    await expect(page.locator(".cycle-reference")).toHaveCount(1);
    const handle = await page.locator(".TreeTable .Resizer").first().boundingBox();
    await page.mouse.move(handle.x + 3, handle.y + 10);
    await page.mouse.down();
    await page.mouse.move(handle.x - 37, handle.y + 10, { steps: 8 });
    await page.mouse.up();
    const statusWidth = (await page.getByRole("columnheader", { name: /ステータス/ }).boundingBox())
      .width;
    await app.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 650)
    );
    await expect
      .poll(
        async () =>
          (await page.getByRole("columnheader", { name: /ステータス/ }).boundingBox()).width
      )
      .toBe(statusWidth);
    await expect(page.getByRole("button", { name: "表示と操作", exact: true })).toBeVisible();
    await select(page, "alpha/shared");
    await page.screenshot({ path: testInfo.outputPath("treegrid-900.png") });
    await page.reload();
    await expect(page.getByRole("treegrid")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await page.getByRole("columnheader", { name: /ステータス/ }).boundingBox()).width
      )
      .toBe(statusWidth);
    await app.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 720)
    );
    await page.getByRole("button", { name: "設定を開く", exact: true }).click();
    await page.getByRole("button", { name: "コンパクト", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: testInfo.outputPath("treegrid-compact.png") });
  } finally {
    await cleanup(app);
  }
});

test("detail windows share canonical edits and history", async () => {
  const app = await launch(fixture()),
    page = app.window;
  try {
    await select(page, "root/beta/shared");
    const opened = app.electronApp.waitForEvent("window");
    await page.getByRole("button", { name: "Node詳細の操作" }).click();
    await page.getByRole("menuitem", { name: "別Windowで開く", exact: true }).click();
    const detail = await opened;
    for (const light of [true, false]) {
      await page.getByRole("checkbox", { name: "Dark / Light", exact: true }).setChecked(light);
      await expect
        .poll(() =>
          detail.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--fg-default").trim()
          )
        )
        .toBe(light ? "#262d32" : "#e8edf0");
    }
    await page.getByRole("button", { name: "設定を開く", exact: true }).click();
    await page.getByRole("button", { name: "コンパクト", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        detail.evaluate(() => document.documentElement.classList.contains("density-compact"))
      )
      .toBe(true);
    await detail.getByRole("button", { name: "編集", exact: true }).click();
    await detail.getByRole("textbox", { name: "タスク名", exact: true }).fill("window edit");
    await detail.getByRole("textbox", { name: "タスク名", exact: true }).blur();
    await expect(
      page.getByRole("textbox", { name: "window editのタスク名", exact: true })
    ).toHaveCount(4);
    await detail.close();
    await page.bringToFront();
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.shared.name).toBe("shared");
  } finally {
    await cleanup(app);
  }
});

test("shared node edits, atomic bulk undo and graph persistence across restart", async () => {
  let app = await launch(fixture());
  try {
    const page = app.window;
    await select(page, "root/beta/shared");
    await page.getByRole("button", { name: "編集", exact: true }).click();
    await page.getByRole("textbox", { name: "タスク名", exact: true }).fill("updated shared");
    await page.getByRole("textbox", { name: "タスク名", exact: true }).blur();
    await expect.poll(() => graphOf(app).nodes.shared.name).toBe("updated shared");
    await expect(
      page.getByRole("textbox", { name: "updated sharedのタスク名", exact: true })
    ).toHaveCount(4);
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.shared.name).toBe("shared");
    await page.getByRole("button", { name: "やり直し", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.shared.name).toBe("updated shared");
    await select(page, "root/alpha/review");
    await select(page, "root/alpha/implementation", ["Control"]);
    await expect(page.getByRole("toolbar", { name: "一括操作" })).toBeVisible();
    await page.getByRole("button", { name: "ステータス変更", exact: true }).click();
    await page.getByRole("option", { name: "Completed", exact: true }).click();
    await expect
      .poll(() => [graphOf(app).nodes.review.status, graphOf(app).nodes.implementation.status])
      .toEqual(["Completed", "Completed"]);
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect
      .poll(() => [graphOf(app).nodes.review.status, graphOf(app).nodes.implementation.status])
      .toEqual(["Open", "Open"]);
    const context = { tempDir: app.tempDir, workspacePath: app.workspacePath };
    await app.electronApp.close();
    app = await launch(context);
    await expect(
      app.window.getByRole("textbox", { name: "updated sharedのタスク名", exact: true })
    ).toHaveCount(4);
    expect(graphOf(app).nodes.shared.parents.map((p) => p.id)).toEqual(["alpha", "beta", "cycle"]);
  } finally {
    await cleanup(app);
  }
});

test("move and detach use the displayed parent; cyclic copy stays in TreeGrid", async () => {
  const app = await launch(fixture()),
    page = app.window;
  try {
    await select(page, "root/beta/shared");
    await page.getByRole("button", { name: "Node詳細の操作" }).click();
    await page.getByRole("menuitem", { name: "配置を変更", exact: true }).click();
    await page.getByRole("combobox", { name: "配置先の親" }).selectOption("review");
    await page.getByRole("button", { name: "移動", exact: true }).click();
    await expect
      .poll(() =>
        graphOf(app)
          .nodes.shared.parents.map((p) => p.id)
          .sort()
      )
      .toEqual(["alpha", "cycle", "review"]);
    await expect(row(page, "root/alpha/review/shared")).toHaveAttribute("tabindex", "0");
    // The next edge command must address the occurrence that was just moved,
    // without asking the user to find and select it again.
    await page.getByRole("button", { name: "Node詳細の操作" }).click();
    await page.getByRole("menuitem", { name: "配置を変更", exact: true }).click();
    await page.getByRole("dialog").getByRole("combobox").first().selectOption("detach");
    await page.getByRole("button", { name: "配置を外す", exact: true }).click();
    await expect
      .poll(() =>
        graphOf(app)
          .nodes.shared.parents.map((p) => p.id)
          .sort()
      )
      .toEqual(["alpha", "cycle"]);
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(row(page, "root/beta/shared")).toBeVisible();
    await select(page, "root/beta/shared");
    await page.getByRole("button", { name: "Node詳細の操作" }).click();
    await page.getByRole("menuitem", { name: "配置を変更", exact: true }).click();
    await page.getByRole("dialog").getByRole("combobox").first().selectOption("detach");
    await page.getByRole("button", { name: "配置を外す", exact: true }).click();
    await expect
      .poll(() =>
        graphOf(app)
          .nodes.shared.parents.map((p) => p.id)
          .sort()
      )
      .toEqual(["alpha", "cycle"]);
    await select(page, "root/alpha/shared");
    await page.getByRole("button", { name: "Node詳細の操作" }).click();
    await page.getByRole("menuitem", { name: "コピー先を指定", exact: true }).click();
    await page.getByRole("combobox", { name: "配置先の親" }).selectOption("beta");
    await page.getByRole("combobox", { name: "コピー範囲" }).selectOption("subgraph");
    await page.getByRole("dialog").getByRole("button", { name: "コピー", exact: true }).click();
    await expect.poll(() => Object.keys(graphOf(app).nodes).length).toBe(9);
    await expect(page.getByRole("treegrid")).toBeVisible();
    await expect(page.locator(".cycle-reference")).toHaveCount(2);
  } finally {
    await cleanup(app);
  }
});

test("sidebar overlays the tree and Back restores the same selected detail across scopes", async () => {
  const app = await launch(fixture());
  try {
    const page = app.window;
    await select(page, "root/alpha/shared");
    const before = await page.getByRole("treegrid").boundingBox();
    await page.getByRole("button", { name: "サイドバーを表示", exact: true }).click();
    await expect(page.getByRole("complementary")).toBeVisible();
    const after = await page.getByRole("treegrid").boundingBox();
    expect(after.x).toBe(before.x);
    expect(after.width).toBe(before.width);
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "alpha", exact: true })
      .click();
    await expect(row(page, "alpha/shared")).toBeVisible();
    await page.getByRole("button", { name: "戻る", exact: true }).click();
    await expect(row(page, "root/alpha/shared")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".detail-header h2")).toHaveText("shared");
    await page.getByRole("button", { name: "進む", exact: true }).click();
    await expect(page.locator(".detail-header h2")).toHaveText("alpha");
    await select(page, "alpha/review");
    const labels = page.locator(".detail-label");
    const positions = await labels.evaluateAll((nodes) =>
      nodes.map((n) => n.getBoundingClientRect().y)
    );
    await expect(page.locator(".detail-fields")).toContainText("未設定");
    await page.getByRole("button", { name: "編集", exact: true }).click();
    expect(
      await labels.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y))
    ).toEqual(positions);
  } finally {
    await cleanup(app);
  }
});

test("drop copy preserves source edges and creates an independently editable subtree", async () => {
  const app = await launch(fixture());
  try {
    const page = app.window;
    const original = graphOf(app).nodes.shared;
    await row(page, "root/alpha/shared").dragTo(row(page, "root/beta"), {
      sourcePosition: { x: 100, y: 12 },
      targetPosition: { x: 100, y: 18 },
    });
    await expect(page.getByRole("dialog", { name: "ドロップ操作を選択" })).toBeVisible();
    expect(graphOf(app).nodes.shared).toEqual(original);
    await page.getByRole("button", { name: "子孫もコピー", exact: true }).click();
    // 複製は「… のコピー」に改名される（同名だと、同じノードの 2 つ目の
    // 出現なのか別ノードなのか行から判別できないため）。
    await expect
      .poll(
        () => Object.values(graphOf(app).nodes).filter((n) => n.name === "shared のコピー").length
      )
      .toBe(1);
    expect(graphOf(app).nodes.shared.name).toBe("shared");
    const copy = Object.values(graphOf(app).nodes).find((n) => n.name === "shared のコピー");
    expect(copy.parents.some((p) => p.id === "beta")).toBe(true);
    expect(graphOf(app).nodes.shared).toEqual(original);
    await select(page, `root/beta/${copy.id}`);
    await page.getByRole("button", { name: "編集", exact: true }).click();
    await page.getByRole("textbox", { name: "タスク名", exact: true }).fill("Independent copy");
    await page.getByRole("textbox", { name: "タスク名", exact: true }).blur();
    await expect.poll(() => graphOf(app).nodes[copy.id].name).toBe("Independent copy");
    expect(graphOf(app).nodes.shared.name).toBe("shared");
  } finally {
    await cleanup(app);
  }
});
