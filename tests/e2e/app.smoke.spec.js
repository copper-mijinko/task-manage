import fs from "fs";
import os from "os";
import path from "path";
import { test, expect, _electron as electron } from "@playwright/test";

function createTempDataDirectory() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-"));
  const fixtureDir = path.join(__dirname, "fixtures");

  fs.copyFileSync(path.join(fixtureDir, "db.json"), path.join(tempDir, "db.json"));
  fs.copyFileSync(path.join(fixtureDir, "meta.json"), path.join(tempDir, "meta.json"));

  return tempDir;
}

function readJson(tempDir, fileName) {
  return JSON.parse(fs.readFileSync(path.join(tempDir, fileName), "utf8"));
}

async function launchSeededApp() {
  const tempDir = createTempDataDirectory();
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

  return { tempDir, electronApp, window };
}

async function closeSeededApp(context) {
  try {
    await context.electronApp.close();
  } finally {
    fs.rmSync(context.tempDir, { recursive: true, force: true });
  }
}

async function openTaskDetailWindow(
  app,
  detailData = {
    projectId: "project-1",
    taskId: "task-1",
    taskName: "First Task",
  }
) {
  const detailWindowPromise = app.electronApp.waitForEvent("window");

  await app.window.evaluate((payload) => {
    window.electronAPI.openTaskDetailWindow(payload);
  }, detailData);

  const detailWindow = await detailWindowPromise;
  // The standalone TaskDetail window renders the same pure Card as the main
  // pane, so the task name lives in the Card title rather than a separate H1.
  await expect(
    detailWindow.locator(".CardHeaderTitle", { hasText: detailData.taskName })
  ).toBeVisible();

  return detailWindow;
}

test("loads seeded project data in Electron", async () => {
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
    await expect(app.window.getByRole("button", { name: "詳細欄を表示" })).toBeVisible();

    // Drag the retained edge left to restore the detail pane.
    resizerBox = await resizer.boundingBox();
    await app.window.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 40);
    await app.window.mouse.down();
    await app.window.mouse.move(rootBox.x + rootBox.width * 0.62, resizerBox.y + 40);
    await app.window.mouse.up();

    await expect(panes.nth(1)).not.toHaveClass(/PaneCollapsed/);
    await expect(app.window.getByRole("button", { name: "詳細欄を隠す" })).toBeVisible();

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

test("filters the visible task rows from the project search box", async () => {
  const app = await launchSeededApp();

  try {
    const filterInput = app.window.getByLabel("タスク一覧を絞り込み");

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
    // The page-search overlay was replaced with a permanent header input
    // ("画面内をハイライト検索…"). Ctrl+F now focuses that input rather than
    // showing/hiding a separate dialog.
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
    // Escape clears the query (the input still exists in the header).
    await expect(pageSearchInput).toHaveValue("");
  } finally {
    await closeSeededApp(app);
  }
});

test("adds a sibling task from the project toolbar and persists it", async () => {
  const app = await launchSeededApp();

  try {
    await app.window.locator("#task-1").dispatchEvent("click");
    // Toolbar was renamed from `.TableButtons` to `.TbGroup` (one group per
    // logical button cluster — Add/Move/Expand/Undo/View). The first group's
    // first button is still タスク追加 (insert sibling).
    await app.window.locator(".TbGroup button").nth(0).click();

    await app.window.waitForTimeout(1200);

    const db = readJson(app.tempDir, "db.json");
    expect(db[0].data.children.some((child) => child.data.name === "new_task")).toBe(true);
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

    await app.window.waitForTimeout(200);
  } finally {
    const metaBeforeClose = readJson(app.tempDir, "meta.json");
    expect(metaBeforeClose.theme).toBe("light");
    await closeSeededApp(app);
  }
});

test("opens the task detail window for the selected task", async () => {
  const app = await launchSeededApp();

  try {
    const detailWindow = await openTaskDetailWindow(app);
    await expect(detailWindow).toHaveURL(/#task-detail-window/);
  } finally {
    await closeSeededApp(app);
  }
});

test("keeps the task detail window Card title in sync when the task name changes", async () => {
  const app = await launchSeededApp();

  try {
    const detailWindow = await openTaskDetailWindow(app);

    await app.window.evaluate(async () => {
      const project = await window.electronAPI.getTreeData("project-1");
      project.data.children[0].data.name = "Renamed Task";
      window.electronAPI.setTreeData(project);
    });

    await expect(
      detailWindow.locator(".CardHeaderTitle", { hasText: "Renamed Task" })
    ).toBeVisible();
  } finally {
    await closeSeededApp(app);
  }
});

test("shows a missing-task state when the selected task is deleted", async () => {
  const app = await launchSeededApp();

  try {
    const detailWindow = await openTaskDetailWindow(app);

    await app.window.evaluate(async () => {
      const project = await window.electronAPI.getTreeData("project-1");
      project.data.children = project.data.children.filter((child) => child.id !== "task-1");
      window.electronAPI.setTreeData(project);
    });

    await expect(detailWindow.getByText("タスクが見つかりません。")).toBeVisible();
    await expect(
      detailWindow.getByText("The target task was deleted. Rename is still tracked by task ID.")
    ).toBeVisible();
  } finally {
    await closeSeededApp(app);
  }
});

test("shows a missing-project state when the source project is deleted", async () => {
  const app = await launchSeededApp();

  try {
    const detailWindow = await openTaskDetailWindow(app);

    await app.window.evaluate(() => {
      window.electronAPI.deleteProject("project-1");
    });

    await expect(detailWindow.getByText("プロジェクトが見つかりません。")).toBeVisible();
    await expect(
      detailWindow.getByText("The project for this detail window was deleted.")
    ).toBeVisible();
  } finally {
    await closeSeededApp(app);
  }
});
