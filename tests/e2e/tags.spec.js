import fs from "fs";
import os from "os";
import path from "path";
import { test, expect, _electron as electron } from "@playwright/test";

const FIXTURE_DIR = path.join(__dirname, "fixtures");

const WS_PROJECT_ID = "ws-proj-tagged";
const WS_TASK_ID = "ws-task-tagged";
const WS_MEMO_ID = "ws-memo-tagged";

const graphNode = (window, name) =>
  window
    .getByRole("treegrid")
    .getByRole("row")
    .filter({ has: window.getByRole("textbox", { name: `${name}のタスク名`, exact: true }) })
    .first();

/** Build workspace fixture files directly without importing the CommonJS workspace.js */
function buildWorkspaceTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-tags-"));
  fs.copyFileSync(path.join(FIXTURE_DIR, "db.json"), path.join(tempDir, "db.json"));

  const wsDir = path.join(tempDir, "ws");
  const projectDir = path.join(wsDir, "tagged-project");
  const taskDir = path.join(projectDir, WS_TASK_ID);
  fs.mkdirSync(taskDir, { recursive: true });

  fs.writeFileSync(
    path.join(projectDir, "_project.md"),
    "---\nid: " + WS_PROJECT_ID + "\nname: Tagged Project\nstatus: Open\ncreated: 2026-01-01\n---\n"
  );

  fs.writeFileSync(
    path.join(taskDir, "_index.md"),
    "---\nid: " +
      WS_TASK_ID +
      "\nname: Tagged Task\nstatus: Open\nparents:\n  - " +
      WS_PROJECT_ID +
      "\ncreated: 2026-01-01\n---\n"
  );

  fs.writeFileSync(
    path.join(taskDir, WS_MEMO_ID + ".md"),
    "---\nid: " +
      WS_MEMO_ID +
      "\ntitle: Design Notes\ntags:\n  - design\n  - frontend\n---\n\nSome design thoughts\n"
  );

  const meta = {
    theme: "dark",
    workspaces: [{ name: "Test Workspace", path: wsDir }],
    activeWorkspace: wsDir,
  };
  fs.writeFileSync(path.join(tempDir, "meta.json"), JSON.stringify(meta));

  return tempDir;
}

async function launchTagsApp() {
  const tempDir = buildWorkspaceTempDir();
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

  // Open the drawer and select the workspace project. Project selection closes
  // the drawer so the task area is immediately usable; reopen it for tag tests.
  await window
    .getByRole("button", { name: "\u30b5\u30a4\u30c9\u30d0\u30fc\u3092\u8868\u793a" })
    .click();
  const projectBtn = window
    .getByRole("complementary")
    .getByRole("button", { name: "Tagged Project", exact: true });
  await projectBtn.waitFor();
  await projectBtn.click();
  await expect(graphNode(window, "Tagged Task")).toBeVisible();
  await window
    .getByRole("button", { name: "\u30b5\u30a4\u30c9\u30d0\u30fc\u3092\u8868\u793a" })
    .click();

  return { tempDir, electronApp, window };
}

async function closeTagsApp(app) {
  try {
    await app.electronApp.close();
  } finally {
    fs.rmSync(app.tempDir, { recursive: true, force: true });
  }
}

test("tag browser appears in sidebar when workspace project has tagged nodes", async () => {
  const app = await launchTagsApp();
  try {
    await expect(app.window.locator(".TagContents")).toBeVisible();
    await expect(
      app.window.locator(".TagContents").getByText("design", { exact: false })
    ).toBeVisible();
    await expect(
      app.window.locator(".TagContents").getByText("frontend", { exact: false })
    ).toBeVisible();
  } finally {
    await closeTagsApp(app);
  }
});

test("clicking a tag in the sidebar filters to tasks with that tag", async () => {
  const app = await launchTagsApp();
  try {
    await app.window.locator(".TagContents button").filter({ hasText: "design" }).click();
    await expect(graphNode(app.window, "Tagged Task")).toBeVisible();
  } finally {
    await closeTagsApp(app);
  }
});

test("clicking the active tag again clears the filter", async () => {
  const app = await launchTagsApp();
  try {
    const tagButton = app.window.locator(".TagContents button").filter({ hasText: "design" });
    await tagButton.click();
    await tagButton.click();
    await expect(graphNode(app.window, "Tagged Task")).toBeVisible();
  } finally {
    await closeTagsApp(app);
  }
});

test("tag input adds a chip and the tag persists after app restart", async () => {
  const tempDir = buildWorkspaceTempDir();
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  const launchOpts = {
    args: [".", "--no-sandbox"],
    cwd: path.resolve(__dirname, "../.."),
    env: {
      ...launchEnv,
      ELECTRON_DISABLE_SANDBOX: "1",
      PLAYWRIGHT_TEST: "true",
      TASK_MANAGE_DATA_DIR: tempDir,
      TASK_MANAGE_OPEN_DEVTOOLS: "false",
    },
  };

  // First launch: add a tag via the tag input bar
  const app1 = await electron.launch(launchOpts);
  try {
    const window1 = await app1.firstWindow();
    await expect(window1.getByText("Task Manage")).toBeVisible();
    // Open the persistent sidebar from the header.
    await window1
      .getByRole("button", { name: "\u30b5\u30a4\u30c9\u30d0\u30fc\u3092\u8868\u793a" })
      .click();
    const projectBtn1 = window1
      .getByRole("complementary")
      .getByRole("button", { name: "Tagged Project", exact: true });
    await projectBtn1.waitFor();
    await projectBtn1.click();
    await expect(graphNode(window1, "Tagged Task")).toBeVisible();

    // Dispatch click directly on the row element to avoid child stopPropagation
    await graphNode(window1, "Design Notes").click();

    // The imported memo is a graph node, so edit its tags in the shared inspector.
    const tagInput = window1.locator(".tag-input");
    await tagInput.fill("ux");
    await tagInput.press("Enter");
    await expect(window1.locator(".tag-chip").filter({ hasText: "ux" })).toBeVisible();

    // Wait for debounced save (500ms) + buffer
    await window1.waitForTimeout(1000);
  } finally {
    await app1.close();
  }

  // Second launch: verify tag persisted
  const app2 = await electron.launch(launchOpts);
  try {
    const window2 = await app2.firstWindow();
    await expect(window2.getByText("Task Manage")).toBeVisible();
    await window2
      .getByRole("button", { name: "\u30b5\u30a4\u30c9\u30d0\u30fc\u3092\u8868\u793a" })
      .click();
    const projectBtn2 = window2
      .getByRole("complementary")
      .getByRole("button", { name: "Tagged Project", exact: true });
    await projectBtn2.waitFor();
    await projectBtn2.click();
    await expect(graphNode(window2, "Tagged Task")).toBeVisible();
    await graphNode(window2, "Design Notes").click();

    await expect(window2.locator(".tag-chip").filter({ hasText: "ux" })).toBeVisible();
  } finally {
    await app2.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
