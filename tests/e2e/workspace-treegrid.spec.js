import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect, _electron as electron } from "@playwright/test";

const REPO_ROOT = path.resolve(__dirname, "../..");

test("linking a descendant creates a terminal cycle; attachment survives undo and restart", async () => {
  let app = await launch(fixture());
  try {
    const page = app.window;
    await select(page, "root/alpha");
    await page.getByRole("textbox", { name: "親ノードを追加", exact: true }).fill("review");
    await page.getByRole("listbox", { name: "親の候補" }).getByRole("option").first().click();
    await expect.poll(() => graphOf(app).nodes.alpha.parents.map((p) => p.id)).toContain("review");
    await expect(row(page, "root/alpha/review/alpha")).toBeVisible();
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect.poll(() => graphOf(app).nodes.alpha.parents.map((p) => p.id)).toEqual(["root"]);
    await select(page, "root/alpha/shared");
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
    await page.getByRole("combobox", { name: "Project scope" }).selectOption("alpha");
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
    await page.getByRole("button", { name: "列の表示設定" }).click();
    const dialog = page.getByRole("dialog", { name: "カラム表示設定" });
    await dialog.getByRole("checkbox", { name: "タグ", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "開始日", exact: true }).uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: /タグ/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /開始日/ })).toHaveCount(0);
    await page.getByRole("button", { name: "すべて折りたたみ", exact: true }).click();
    await expect(page.getByRole("treegrid").getByRole("row")).toHaveCount(2);
    await page.getByRole("button", { name: "すべて展開", exact: true }).first().click();
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
    await expect(page.getByRole("button", { name: "列の表示設定" })).toBeVisible();
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
    await page.getByRole("button", { name: "タスク詳細を別ウィンドウで開く", exact: true }).click();
    const detail = await opened;
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
    await page.getByText("配置とコピー", { exact: true }).click();
    await page.getByRole("combobox", { name: "配置先の親" }).selectOption("review");
    await page.getByRole("button", { name: "この配置を移動", exact: true }).click();
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
    await page.getByRole("button", { name: "この配置を外す", exact: true }).click();
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
    await page.getByRole("button", { name: "この配置を外す", exact: true }).click();
    await expect
      .poll(() =>
        graphOf(app)
          .nodes.shared.parents.map((p) => p.id)
          .sort()
      )
      .toEqual(["alpha", "cycle"]);
    await select(page, "root/alpha/shared");
    await page.getByRole("combobox", { name: "配置先の親" }).selectOption("beta");
    await page.getByRole("combobox", { name: "コピー範囲" }).selectOption("subgraph");
    await page.getByRole("button", { name: "指定した親へコピー", exact: true }).click();
    await expect.poll(() => Object.keys(graphOf(app).nodes).length).toBe(9);
    await expect(page.getByRole("treegrid")).toBeVisible();
    await expect(page.locator(".cycle-reference")).toHaveCount(2);
  } finally {
    await cleanup(app);
  }
});
