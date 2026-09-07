import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect, _electron as electron } from "@playwright/test";

const ROOT = "workspace-root";
const REPO_ROOT = path.resolve(__dirname, "../..");

function node(id, name, parents = []) {
  return {
    id,
    name,
    parents: parents.map((parent, order) => ({ id: parent, order })),
    createdAt: "2026-01-01",
  };
}

function fixture(nodes) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-node-graph-"));
  const workspacePath = path.join(tempDir, "workspace");
  fs.mkdirSync(path.join(workspacePath, ".task-manage"), { recursive: true });
  const seedProject = path.join(workspacePath, "seed-project");
  fs.mkdirSync(seedProject);
  fs.writeFileSync(
    path.join(seedProject, "_project.md"),
    "---\nid: seed-project\nname: Seed Project\ncreated: 2026-01-01\n---\n"
  );
  fs.copyFileSync(path.join(__dirname, "fixtures", "db.json"), path.join(tempDir, "db.json"));
  fs.writeFileSync(
    path.join(tempDir, "meta.json"),
    JSON.stringify({
      theme: "dark",
      workspaces: [{ label: "Node Test Workspace", path: workspacePath }],
      activeWorkspace: workspacePath,
    })
  );
  const graph = { schemaVersion: 1, workspaceId: "node-test", rootId: ROOT, revision: 0, nodes };
  fs.writeFileSync(
    path.join(workspacePath, ".task-manage", "graph-v1.json"),
    JSON.stringify({ schemaVersion: 1, graph, undo: [], redo: [] })
  );
  return { tempDir, workspacePath };
}

async function launch(context) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({
    args: [".", "--no-sandbox"],
    cwd: REPO_ROOT,
    env: {
      ...env,
      ELECTRON_DISABLE_SANDBOX: "1",
      PLAYWRIGHT_TEST: "true",
      TASK_MANAGE_DATA_DIR: context.tempDir,
      TASK_MANAGE_OPEN_DEVTOOLS: "false",
    },
  });
  const window = await electronApp.firstWindow();
  await expect(window.getByRole("main", { name: "Workspace nodes" })).toBeVisible();
  return { ...context, electronApp, window };
}

const readGraph = (workspacePath) =>
  JSON.parse(fs.readFileSync(path.join(workspacePath, ".task-manage", "graph-v1.json"), "utf8"))
    .graph;
const graphNode = (window, name) => window.locator(`svg.graph g[aria-label="${name}"]`);
const tabs = (window) => window.locator('nav[aria-label="\u8868\u793a\u5f62\u5f0f"] button');
function controls(window) {
  const fieldset = window.locator("aside.inspector fieldset").first();
  return {
    source: fieldset.locator("select").nth(0),
    target: fieldset.locator("select").nth(1),
    buttons: fieldset.locator(".buttons button"),
  };
}
async function selectNode(app, name) {
  await graphNode(app.window, name).click();
  await expect(app.window.locator("aside.inspector h2")).toHaveText(name);
}
async function close(app) {
  let timer;
  try {
    await Promise.race([
      app.electronApp.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Electron close timed out")), 5_000);
      }),
    ]);
  } catch {
    app.electronApp.process().kill();
  } finally {
    clearTimeout(timer);
  }
}
function cleanup(context) {
  fs.rmSync(context.tempDir, { recursive: true, force: true });
}

test("persists explicit Undefined status through a genuine Electron restart", async () => {
  const context = fixture({
    [ROOT]: node(ROOT, "Workspace"),
    draft: node("draft", "Draft", [ROOT]),
  });
  let app = await launch(context);
  try {
    expect(readGraph(context.workspacePath).nodes.draft).not.toHaveProperty("status");
    await selectNode(app, "Draft");
    await app.window.locator("aside.inspector select").first().selectOption("Undefined");
    await expect.poll(() => readGraph(context.workspacePath).nodes.draft.status).toBe("Undefined");
    await tabs(app.window).nth(3).click();
    await expect(app.window.locator('.NodeGanttRow[data-row-id="draft"]')).toContainText("Draft");
    await expect(
      app.window.locator('.NodeGanttRow[data-row-id="draft"] .NodeGanttUnset')
    ).toBeVisible();

    await close(app);
    app = await launch(context);
    await selectNode(app, "Draft");
    await expect(app.window.locator("aside.inspector select").first()).toHaveValue("Undefined");
    expect(readGraph(context.workspacePath).nodes.draft.status).toBe("Undefined");
  } finally {
    await close(app).catch(() => {});
    cleanup(context);
  }
});
test("moves and detaches one occurrence while preserving other parents and descendants", async () => {
  const context = fixture({
    [ROOT]: node(ROOT, "Workspace"),
    a: node("a", "A", [ROOT]),
    b: node("b", "B", [ROOT]),
    target: node("target", "Target", [ROOT]),
    shared: node("shared", "Shared", ["a", "b"]),
    child: node("child", "Child", ["shared"]),
  });
  const app = await launch(context);
  try {
    await selectNode(app, "Shared");
    let placement = controls(app.window);
    await placement.source.selectOption("a");
    await placement.target.selectOption("target");
    await placement.buttons.nth(1).click();
    await expect
      .poll(() => readGraph(context.workspacePath).nodes.shared.parents.map((p) => p.id))
      .toEqual(["b", "target"]);
    expect(readGraph(context.workspacePath).nodes.child.parents.map((p) => p.id)).toEqual([
      "shared",
    ]);
    placement = controls(app.window);
    await placement.source.selectOption("target");
    await placement.buttons.nth(2).click();
    await expect
      .poll(() => readGraph(context.workspacePath).nodes.shared.parents.map((p) => p.id))
      .toEqual(["b"]);
    expect(readGraph(context.workspacePath).nodes.child.parents.map((p) => p.id)).toEqual([
      "shared",
    ]);
    await app.window.getByRole("button", { name: "\u5143\u306b\u623b\u3059" }).click();
    await expect
      .poll(() => readGraph(context.workspacePath).nodes.shared.parents.map((p) => p.id))
      .toEqual(["b", "target"]);
    await expect(
      app.window.getByText("\u5c65\u6b74\u3092\u66f4\u65b0\u3057\u307e\u3057\u305f", {
        exact: true,
      })
    ).toBeVisible();
    await app.window.getByRole("button", { name: "\u5143\u306b\u623b\u3059" }).click();
    await expect
      .poll(() => readGraph(context.workspacePath).nodes.shared.parents.map((p) => p.id))
      .toEqual(["a", "b"]);
  } finally {
    await close(app).catch(() => {});
    cleanup(context);
  }
});
test("creates a graph cycle, cuts it in Tree and Finder, and rejects a Tree cycle edit", async () => {
  const context = fixture({
    [ROOT]: node(ROOT, "Workspace"),
    a: node("a", "A", [ROOT]),
    b: node("b", "B", ["a"]),
    c: node("c", "C", [ROOT]),
    d: node("d", "D", ["c"]),
  });
  const app = await test.step("launch cycle fixture", () => launch(context));
  try {
    await test.step("create cycle in graph", async () => {
      await selectNode(app, "A");
      const placement = controls(app.window);
      await placement.target.selectOption("b");
      await placement.buttons.nth(0).click();
      await expect
        .poll(() => readGraph(context.workspacePath).nodes.a.parents.map((p) => p.id))
        .toEqual([ROOT, "b"]);
    });
    await test.step("expand cycle to terminal Tree row", async () => {
      await tabs(app.window).nth(1).click();
      const tree = app.window.getByRole("tree", { name: "\u30c4\u30ea\u30fc" });
      for (const name of ["Workspace", "A", "B"]) {
        const row = tree.getByRole("button", { name, exact: true }).locator("..");
        const toggle = row.locator("button.twisty");
        if (await toggle.isEnabled()) await toggle.click();
      }
      const terminal = tree.getByRole("treeitem").filter({ hasText: "\u5faa\u74b0\u53c2\u7167" });
      await expect(terminal).toHaveCount(1);
      await expect(terminal.locator("button.twisty")).toBeDisabled();
    });
    await test.step("navigate Finder cycle", async () => {
      await tabs(app.window).nth(2).click();
      const finder = app.window.getByLabel("Finder");
      await finder.getByRole("button", { name: /^A/ }).first().click();
      await finder.getByRole("button", { name: /^B/ }).first().click();
      await expect(
        finder.getByRole("button", { name: /A.*\u5faa\u74b0\u53c2\u7167/ })
      ).toBeVisible();
    });
    await test.step("reject cycle edit from Tree", async () => {
      await tabs(app.window).nth(1).click();
      const tree = app.window.getByRole("tree", { name: "\u30c4\u30ea\u30fc" });
      await tree.getByRole("button", { name: "C", exact: true }).click();
      const placement = controls(app.window);
      await placement.target.selectOption("d");
      await placement.buttons.nth(0).click();
      await expect(app.window.getByRole("alert")).toContainText("\u5faa\u74b0");
      expect(readGraph(context.workspacePath).nodes.c.parents.map((p) => p.id)).toEqual([ROOT]);
    });
  } finally {
    await close(app).catch(() => {});
    cleanup(context);
  }
});
