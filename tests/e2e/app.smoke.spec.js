const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  test,
  expect,
  _electron: electron,
} = require("@playwright/test");

function createTempDataDirectory() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-"));
  const fixtureDir = path.join(__dirname, "fixtures");

  fs.copyFileSync(path.join(fixtureDir, "db.json"), path.join(tempDir, "db.json"));
  fs.copyFileSync(path.join(fixtureDir, "meta.json"), path.join(tempDir, "meta.json"));

  return tempDir;
}

test("loads seeded project data in Electron", async () => {
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

  try {
    const window = await electronApp.firstWindow();

    await expect(window.getByText("Task Manage")).toBeVisible();
    await expect(window.getByText("Sample Project").first()).toBeVisible();
    await expect(window.getByText("First Task").first()).toBeVisible();
  } finally {
    await electronApp.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
