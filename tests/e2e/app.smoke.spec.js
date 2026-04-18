const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect, _electron: electron } = require("@playwright/test");

function createTempDataDirectory() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-"));
  const fixtureDir = path.join(__dirname, "fixtures");

  fs.copyFileSync(path.join(fixtureDir, "db.json"), path.join(tempDir, "db.json"));
  fs.copyFileSync(path.join(fixtureDir, "meta.json"), path.join(tempDir, "meta.json"));

  return tempDir;
}

function readJson(tempDir, fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(tempDir, fileName), "utf8"),
  );
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

test("loads seeded project data in Electron", async () => {
  const app = await launchSeededApp();

  try {
    await expect(app.window.locator('#project-1 input[type="text"]').first()).toHaveValue("Sample Project");
    await expect(app.window.locator('#task-1 input[type="text"]').first()).toHaveValue("First Task");
  } finally {
    await closeSeededApp(app);
  }
});

test("filters the visible task rows from the project search box", async () => {
  const app = await launchSeededApp();

  try {
    const filterInput = app.window.locator('input[placeholder="filter tasks..."]');

    await filterInput.fill("missing");
    await expect(app.window.locator("#task-1")).toHaveCount(0);

    await filterInput.fill("First");
    await expect(app.window.locator("#task-1")).toBeVisible();
  } finally {
    await closeSeededApp(app);
  }
});

test("opens and closes the page search box with keyboard shortcuts", async () => {
  const app = await launchSeededApp();

  try {
    await app.window.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });

    const pageSearchInput = app.window.locator('input[placeholder="search..."]');
    await expect(pageSearchInput).toBeVisible();
    await expect(pageSearchInput).toBeFocused();

    await pageSearchInput.press("Escape");
    await expect(pageSearchInput).not.toBeVisible();
  } finally {
    await closeSeededApp(app);
  }
});

test("adds a sibling task from the project toolbar and persists it", async () => {
  const app = await launchSeededApp();

  try {
    await app.window.locator("#task-1").dispatchEvent("click");
    await app.window.locator(".TableButtons button").nth(0).click();

    await app.window.waitForTimeout(1200);

    const db = readJson(app.tempDir, "db.json");
    expect(
      db[0].data.children.some((child) => child.data.name === "new_task"),
    ).toBe(true);
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
