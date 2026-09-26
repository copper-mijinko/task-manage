// E2E の共通部品。各テストは一時ディレクトリにワークスペースと meta.json を
// 作り、TASK_MANAGE_DATA_DIR でアプリに渡す（利用者のデータには触れない）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, _electron as electron } from "@playwright/test";

const REPO_ROOT = path.resolve(__dirname, "../..");

/**
 * グラフのノード。`parents` は親の配列で、要素は親 id か `[親 id, 並び順]`。
 * 並び順はその親の下での位置（兄弟どうしで比べる）。省略時は 0。
 */
export function node(id, parents = [], extra = {}) {
  return {
    id,
    name: extra.name ?? id,
    parents: parents.map((parent) =>
      Array.isArray(parent) ? { id: parent[0], order: parent[1] } : { id: parent, order: 0 }
    ),
    createdAt: "2026-01-01",
    tags: [],
    attachments: [],
    ...extra,
  };
}

/**
 * よく使う形のワークスペース。
 *
 * root
 * ├─ work（プロジェクト）
 * │   ├─ spec      Open, 期限 2026-10-10, タグ design
 * │   ├─ build     In Progress, 期間 2026-10-01〜2026-10-20
 * │   └─ release   Pending, タグ release
 * ├─ home（プロジェクト）
 * │   └─ groceries Open
 * └─ Inbox
 *     └─ idea
 */
export function projectNodes() {
  return [
    node("root", [], { name: "Workspace" }),
    node("work", [["root", 0]], { name: "Work" }),
    node("spec", [["work", 0]], {
      name: "Spec",
      status: "Open",
      dueDate: "2026-10-10",
      tags: ["design"],
      body: "# Spec\n\nfirst draft",
      format: "markdown",
    }),
    node("build", [["work", 1]], {
      name: "Build",
      status: "In Progress",
      startDate: "2026-10-01",
      dueDate: "2026-10-20",
    }),
    node("release", [["work", 2]], { name: "Release", status: "Pending", tags: ["release"] }),
    node("home", [["root", 1]], { name: "Home" }),
    node("groceries", [["home", 0]], { name: "Groceries", status: "Open" }),
    node("inbox", [["root", 2]], { name: "Inbox" }),
    node("idea", [["inbox", 0]], { name: "Idea" }),
  ];
}

/** 約 `count` ノードの大きいワークスペース（100 ノードずつのプロジェクト）。 */
export function largeNodes(count = 2000) {
  const nodes = [node("root", [], { name: "Workspace" })];
  for (let p = 0; p * 100 < count; p += 1) {
    nodes.push(node(`p${p}`, [["root", p]], { name: `Project ${p}` }));
    for (let t = 0; t < 99; t += 1)
      nodes.push(
        node(`p${p}-t${t}`, [[`p${p}`, t]], {
          name: `Task ${p}-${t}`,
          status: ["Open", "In Progress", "Pending"][t % 3],
          dueDate: `2026-10-${String((t % 28) + 1).padStart(2, "0")}`,
        })
      );
  }
  return nodes;
}

/** ワークスペース（と任意で追加のファイル）を一時ディレクトリに作る。 */
export function createWorkspace(nodes = projectNodes(), { meta = {}, files = {} } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-e2e-"));
  const workspacePath = path.join(tempDir, "workspace");
  fs.mkdirSync(path.join(workspacePath, ".task-manage"), { recursive: true });
  const graph = {
    schemaVersion: 1,
    workspaceId: "e2e",
    rootId: "root",
    revision: 0,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
  fs.writeFileSync(
    path.join(workspacePath, ".task-manage", "graph-v1.json"),
    JSON.stringify({ schemaVersion: 1, graph, undo: [], redo: [] })
  );
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(workspacePath, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.writeFileSync(
    path.join(tempDir, "meta.json"),
    JSON.stringify({
      theme: "dark",
      workspaces: [{ label: "E2E", path: workspacePath }],
      activeWorkspace: workspacePath,
      ...meta,
    })
  );
  return { tempDir, workspacePath };
}

/**
 * アプリを起動する。画面の捕捉されない例外（pageerror）はすべて記録する。
 * 操作が「何も起きない」だけでコンソールに例外が出る不具合を見逃さないため、
 * `run` はこれが 1 件でもあれば失敗にする。
 */
export async function launch(context, pageErrors = []) {
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
  const watch = (page) => page.on("pageerror", (error) => pageErrors.push(error.message));
  electronApp.on("window", watch);
  const window = await electronApp.firstWindow();
  watch(window);
  try {
    await expect(window.getByRole("treegrid")).toBeVisible();
  } catch (error) {
    await electronApp.close();
    throw new Error(`${error.message}\n${JSON.stringify(pageErrors)}`, { cause: error });
  }
  return { ...context, electronApp, window, pageErrors };
}

/**
 * ワークスペースでアプリを起動して `body` を実行し、必ず閉じて片付ける。
 *
 * `app.restart()` で同じデータのまま起動し直せる（`app.window` などが
 * 新しいものに入れ替わる）。本体が成功したときだけ、画面で例外が出て
 * いないことを確かめる（失敗時は本来の失敗を隠さない）。
 */
export async function run(context, body) {
  const app = await launch(context);
  app.restart = async () => {
    await app.electronApp.close();
    const next = await launch(context, app.pageErrors);
    app.electronApp = next.electronApp;
    app.window = next.window;
    return app;
  };
  let succeeded = false;
  try {
    await body(app);
    succeeded = true;
  } finally {
    await app.electronApp.close().catch(() => {});
    fs.rmSync(context.tempDir, { recursive: true, force: true });
  }
  if (succeeded) expect(app.pageErrors, "uncaught exceptions in the renderer").toEqual([]);
}

export const graphFile = (app) => path.join(app.workspacePath, ".task-manage", "graph-v1.json");
export const readDocument = (app) => JSON.parse(fs.readFileSync(graphFile(app), "utf8"));
export const graphOf = (app) => readDocument(app).graph;
export const metaOf = (app) =>
  JSON.parse(fs.readFileSync(path.join(app.tempDir, "meta.json"), "utf8"));

/** 名前でノードを探す（新しく作ったノードは id が分からないため）。 */
export const nodesNamed = (app, name) =>
  Object.values(graphOf(app).nodes).filter((candidate) => candidate.name === name);
export const childrenOf = (app, parentId) =>
  Object.values(graphOf(app).nodes)
    .filter((candidate) => candidate.parents.some((parent) => parent.id === parentId))
    .sort(
      (a, b) =>
        a.parents.find((p) => p.id === parentId).order -
        b.parents.find((p) => p.id === parentId).order
    )
    .map((candidate) => candidate.name);

export const row = (page, occurrence) => page.locator(`.TableRow[data-row-path="${occurrence}"]`);

/** 行を選ぶ（ノード名の欄をクリック）。 */
export async function select(page, occurrence, modifiers = []) {
  await row(page, occurrence).getByRole("gridcell").nth(1).click({ modifiers });
}

/** 見えている行の「深さ:名前」を上から順に返す。 */
export async function visibleRows(page) {
  return page
    .locator(".TableRow[data-row-path]")
    .evaluateAll((rows) =>
      rows.map(
        (element) =>
          `${element.dataset.rowPath.split("/").length - 1}:${element.querySelector('input[type="text"]')?.value}`
      )
    );
}

/** 行の三点リーダメニューから項目を選ぶ。 */
export async function rowMenu(page, occurrence, item) {
  await row(page, occurrence).getByRole("button", { name: "ノード操作を開く" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** ツールバーの「表示と操作」メニューから項目を選ぶ。 */
export async function overflow(page, item, role = "menuitem") {
  await page.getByRole("button", { name: "表示と操作", exact: true }).click();
  await page.getByRole(role, { name: item, exact: true }).click();
}

/** 保存が終わるまで待つ（ヘッダの保存状態）。 */
export async function saved(page) {
  await expect(page.getByRole("status").filter({ hasText: "保存済み" })).toBeVisible();
}
