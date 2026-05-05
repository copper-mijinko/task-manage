import fs from "fs";
import os from "os";
import path from "path";
import { test, expect, _electron as electron } from "@playwright/test";

const FIXTURE_DIR = path.join(__dirname, "fixtures");

const WS_PROJECT_ID = "ws-proj-tagged";
const WS_TASK_ID = "ws-task-tagged";
const WS_MEMO_ID = "ws-memo-tagged";

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

  // Open the navigation drawer, then select the workspace project
  await window.getByRole("button", { name: "Open navigation menu" }).click();
  const projectBtn = window.locator("button.MenuRow", { hasText: "Tagged Project" });
  await projectBtn.waitFor();
  await projectBtn.click();
  await expect(window.locator(`#${WS_TASK_ID}`)).toBeVisible();

  return { tempDir, electronApp, window };
}

async function closeTagsApp(app) {
  try {
    await app.electronApp.close();
  } finally {
    fs.rmSync(app.tempDir, { recursive: true, force: true });
  }
}

test("tag browser appears in sidebar when workspace project has tagged memos", async () => {
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
    await expect(app.window.locator(`#${WS_TASK_ID}`)).toBeVisible();
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
    await expect(app.window.locator(`#${WS_TASK_ID}`)).toBeVisible();
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
    await window1.getByRole("button", { name: "Open navigation menu" }).click();
    const projectBtn1 = window1.locator("button.MenuRow", { hasText: "Tagged Project" });
    await projectBtn1.waitFor();
    await projectBtn1.click();
    await expect(window1.locator(`#${WS_TASK_ID}`)).toBeVisible();

    // Close the navigation drawer before interacting with task rows
    await window1.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(window1.locator(".Mask")).not.toBeVisible();

    // Dispatch click directly on the row element to avoid child stopPropagation
    await window1.locator(`#${WS_TASK_ID}`).dispatchEvent("click");

    const tagInput = window1.locator(".tag-input");
    await tagInput.fill("ux");
    await tagInput.press("Enter");
    await expect(window1.locator('[aria-label="Remove tag ux"]')).toBeVisible();

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
    await window2.getByRole("button", { name: "Open navigation menu" }).click();
    const projectBtn2 = window2.locator("button.MenuRow", { hasText: "Tagged Project" });
    await projectBtn2.waitFor();
    await projectBtn2.click();
    await expect(window2.locator(`#${WS_TASK_ID}`)).toBeVisible();
    await window2.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(window2.locator(".Mask")).not.toBeVisible();
    await window2.locator(`#${WS_TASK_ID}`).dispatchEvent("click");

    await expect(window2.locator('[aria-label="Remove tag ux"]')).toBeVisible();
  } finally {
    await app2.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
