import fs from "fs";
import os from "os";
import path from "path";
import { test, expect, _electron as electron } from "@playwright/test";

/** 1 つのプロジェクト（project-1）と 1 つのノード（task-1）を持つワークスペース。 */
function createTempDataDirectory() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-"));
  const workspacePath = path.join(tempDir, "workspace");
  fs.mkdirSync(path.join(workspacePath, ".task-manage"), { recursive: true });
  const node = (id, name, parentId, order, extra = {}) => ({
    id,
    name,
    parents: parentId ? [{ id: parentId, order }] : [],
    createdAt: "2026-01-01",
    tags: [],
    attachments: [],
    ...extra,
  });
  const nodes = [
    node("root", "Workspace", null, 0),
    node("project-1", "Sample Project", "root", 0, { status: "Open" }),
    node("task-1", "First Task", "project-1", 0, { status: "Open" }),
  ];
  const graph = {
    schemaVersion: 1,
    workspaceId: "smoke-test",
    rootId: "root",
    revision: 0,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
  fs.writeFileSync(
    path.join(workspacePath, ".task-manage", "graph-v1.json"),
    JSON.stringify({ schemaVersion: 1, graph, undo: [], redo: [] })
  );
  fs.writeFileSync(
    path.join(tempDir, "meta.json"),
    JSON.stringify({
      theme: "dark",
      workspaces: [{ label: "Smoke", path: workspacePath }],
      activeWorkspace: workspacePath,
    })
  );
  return { tempDir, workspacePath };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const graphOf = (app) =>
  readJson(path.join(app.workspacePath, ".task-manage", "graph-v1.json")).graph;

async function launchSeededApp() {
  const { tempDir, workspacePath } = createTempDataDirectory();
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({
    args: [".", "--no-sandbox"],
    cwd: path.resolve(__dirname, "../.."),
    env: {
      ...launchEnv,
      ELECTRON_DISABLE_SANDBOX: "1",
      PLAYWRIGHT_TEST: "true",
      TASK_MANAGE_DATA_DIR: tempDir,
      TASK_MANAGE_OPEN_DEVTOOLS: "false",
    },
  });

  const window = await electronApp.firstWindow();
  await expect(window.getByText("Task Manage")).toBeVisible();
  await expect(window.locator("#project-1")).toBeVisible();
  await expect(window.locator("#task-1")).toBeVisible();

  return { tempDir, workspacePath, electronApp, window };
}

async function closeSeededApp(context) {
  try {
    await context.electronApp.close();
  } finally {
    fs.rmSync(context.tempDir, { recursive: true, force: true });
  }
}

async function openTaskDetailWindow(app) {
  const detailData = {
    workspacePath: app.workspacePath,
    projectId: "project-1",
    taskId: "task-1",
    taskName: "First Task",
  };
  const detailWindowPromise = app.electronApp.waitForEvent("window");

  await app.window.evaluate((payload) => {
    window.electronAPI.openTaskDetailWindow(payload);
  }, detailData);

  const detailWindow = await detailWindowPromise;
  // The standalone detail window renders the same Card as the main pane, so
  // the node name lives in the Card title rather than a separate H1.
  await expect(
    detailWindow.getByRole("heading", { name: new RegExp(detailData.taskName) })
  ).toBeVisible();

  return detailWindow;
}

/** main プロセスのグラフへ直接コマンドを送る（別ウィンドウからの編集を模す）。 */
async function executeGraphCommand(app, command) {
  await app.window.evaluate(
    async ({ workspacePath, command }) => {
      const graph = await window.electronAPI.wsReadGraph(workspacePath);
      await window.electronAPI.wsExecuteGraphCommand(
        workspacePath,
        command,
        "tree",
        graph.revision
      );
    },
    { workspacePath: app.workspacePath, command }
  );
}

test("loads the seeded workspace graph in Electron", async () => {
  const app = await launchSeededApp();

  try {
    await expect(app.window.locator('#project-1 input[type="text"]').first()).toHaveValue(
      "Sample Project"
    );
    await expect(app.window.locator('#task-1 input[type="text"]').first()).toHaveValue(
      "First Task"
    );
  } finally {
    await closeSeededApp(app);
  }
});

test("rejects renderer-invented workspace registration", async () => {
  const app = await launchSeededApp();
  const inventedWorkspace = path.join(app.tempDir, "invented-workspace");
  fs.mkdirSync(inventedWorkspace, { recursive: true });

  try {
    const result = await app.window.evaluate(async (workspacePath) => {
      window.electronAPI.wsSetWorkspaces({
        workspaces: [{ path: workspacePath, label: "Invented" }],
        activeWorkspace: workspacePath,
      });
      try {
        await window.electronAPI.wsReadGraph(workspacePath);
        return "read";
      } catch (error) {
        return String(error.message);
      }
    }, inventedWorkspace);

    expect(result).toMatch(/not registered/);
    expect(fs.existsSync(path.join(inventedWorkspace, ".task-manage"))).toBe(false);
  } finally {
    await closeSeededApp(app);
  }
});

test("collapses and restores detail from the tree-priority split boundary", async () => {
  const app = await launchSeededApp();

  try {
    await app.window.locator("#task-1").dispatchEvent("click");

    const splitRoot = app.window.locator(".Content > .SplitPaneRoot");
    const panes = splitRoot.locator(":scope > .Pane");
    const resizer = app.window.getByRole("separator", { name: "ツリーと詳細の幅を変更" });
    await expect(resizer).toBeVisible();
    const treeMinimum = await panes.nth(0).evaluate((pane) => {
      const cssValue = window.getComputedStyle(pane).minWidth;
      const numericValue = parseFloat(cssValue);
      if (cssValue.endsWith("rem")) {
        return (
          numericValue * parseFloat(window.getComputedStyle(document.documentElement).fontSize)
        );
      }
      return numericValue;
    });

    const rootBox = await splitRoot.boundingBox();
    let resizerBox = await resizer.boundingBox();
    expect(rootBox).not.toBeNull();
    expect(resizerBox).not.toBeNull();

    // Drag to the right edge: only the detail pane collapses and the 5px
    // boundary remains reachable at the edge.
    await app.window.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 40);
    await app.window.mouse.down();
    await app.window.mouse.move(rootBox.x + rootBox.width + 100, resizerBox.y + 40);
    await app.window.mouse.up();

    await expect(panes.nth(1)).toHaveClass(/PaneCollapsed/);
    await expect(resizer).toBeVisible();
    await expect(resizer).toHaveAttribute("aria-valuenow", "100");
    await app.window.getByRole("button", { name: "表示と操作", exact: true }).click();
    await expect(
      app.window.getByRole("menuitemcheckbox", { name: "詳細欄", checked: false })
    ).toBeVisible();
    await app.window.keyboard.press("Escape");

    // Drag the retained edge left to restore the detail pane.
    resizerBox = await resizer.boundingBox();
    await app.window.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 40);
    await app.window.mouse.down();
    await app.window.mouse.move(rootBox.x + rootBox.width * 0.62, resizerBox.y + 40);
    await app.window.mouse.up();

    await expect(panes.nth(1)).not.toHaveClass(/PaneCollapsed/);
    await app.window.getByRole("button", { name: "表示と操作", exact: true }).click();
    await expect(
      app.window.getByRole("menuitemcheckbox", { name: "詳細欄", checked: true })
    ).toBeVisible();
    await app.window.keyboard.press("Escape");

    // Dragging hard left must not collapse the priority tree pane; it clamps
    // at its declared minimum instead.
    resizerBox = await resizer.boundingBox();
    await app.window.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 40);
    await app.window.mouse.down();
    await app.window.mouse.move(rootBox.x + 5, resizerBox.y + 40);
    await app.window.mouse.up();

    await expect(panes.nth(0)).not.toHaveClass(/PaneCollapsed|PaneMini/);
    expect((await panes.nth(0).boundingBox()).width).toBeGreaterThanOrEqual(treeMinimum - 1);
  } finally {
    await closeSeededApp(app);
  }
});

test("filters the visible rows from the project search box", async () => {
  const app = await launchSeededApp();

  try {
    const filterInput = app.window.getByLabel("ノード一覧を絞り込み");

    await filterInput.fill("missing");
    await expect(app.window.locator("#task-1")).toHaveCount(0);

    await filterInput.fill("First");
    await expect(app.window.locator("#task-1")).toBeVisible();
  } finally {
    await closeSeededApp(app);
  }
});

test("focuses the page-search input with Ctrl+F and clears it on Escape", async () => {
  const app = await launchSeededApp();

  try {
    await app.window.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
        })
      );
    });

    const pageSearchInput = app.window.locator('input[placeholder="画面内をハイライト検索…"]');
    await expect(pageSearchInput).toBeVisible();
    await expect(pageSearchInput).toBeFocused();

    await pageSearchInput.fill("First");
    await pageSearchInput.press("Escape");
    await expect(pageSearchInput).toHaveValue("");
  } finally {
    await closeSeededApp(app);
  }
});

test("adds a sibling node from the project toolbar and persists it", async () => {
  const app = await launchSeededApp();

  try {
    await app.window.locator("#task-1").dispatchEvent("click");
    // The first toolbar group's first button is ノード追加 (insert sibling).
    await app.window.locator(".TbGroup button").nth(0).click();

    await expect
      .poll(() =>
        Object.values(graphOf(app).nodes).some(
          (node) => node.name === "新しいノード" && node.parents.some((p) => p.id === "project-1")
        )
      )
      .toBe(true);
  } finally {
    await closeSeededApp(app);
  }
});

test("toggles the theme and persists the new value into meta.json", async () => {
  const app = await launchSeededApp();

  try {
    const themeToggle = app.window.locator(".ToggleButton");
    const themeCheckbox = app.window.locator('.ToggleButton input[type="checkbox"]');

    await expect(themeCheckbox).not.toBeChecked();

    await themeToggle.click();
    await expect(themeCheckbox).toBeChecked();

    await expect.poll(() => readJson(path.join(app.tempDir, "meta.json")).theme).toBe("light");
  } finally {
    await closeSeededApp(app);
  }
});

test("opens the node detail window for the selected node", async () => {
  const app = await launchSeededApp();

  try {
    const detailWindow = await openTaskDetailWindow(app);
    await expect(detailWindow).toHaveURL(/#task-detail-window/);
  } finally {
    await closeSeededApp(app);
  }
});

test("keeps the detail window Card title in sync when the node name changes", async () => {
  const app = await launchSeededApp();

  try {
    const detailWindow = await openTaskDetailWindow(app);

    await executeGraphCommand(app, {
      type: "update-node",
      nodeId: "task-1",
      changes: { name: "Renamed Task" },
    });

    await expect(detailWindow.getByRole("heading", { name: /Renamed Task/ })).toBeVisible();
  } finally {
    await closeSeededApp(app);
  }
});

test("shows a missing-node state when the selected node is deleted", async () => {
  const app = await launchSeededApp();

  try {
    const detailWindow = await openTaskDetailWindow(app);

    await executeGraphCommand(app, { type: "delete-node", nodeId: "task-1" });

    await expect(detailWindow.getByText("ノードが見つかりません。")).toBeVisible();
  } finally {
    await closeSeededApp(app);
  }
});
