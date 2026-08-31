import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { _electron as electron } from "@playwright/test";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const fixtureDir = path.join(repositoryRoot, "tests", "e2e", "fixtures");
const requestedSamples = Number.parseInt(process.env.PERF_SAMPLES ?? "3", 10);
const sampleCount =
  Number.isFinite(requestedSamples) && requestedSamples > 0 ? requestedSamples : 3;
const imageDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function roundTiming(value) {
  return typeof value === "number" ? Math.round(value) : value;
}

function median(values) {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

async function measureSample() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-performance-"));
  fs.copyFileSync(path.join(fixtureDir, "db.json"), path.join(tempDir, "db.json"));
  fs.copyFileSync(path.join(fixtureDir, "meta.json"), path.join(tempDir, "meta.json"));

  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  let electronApp;
  try {
    const startupStartedAt = performance.now();
    electronApp = await electron.launch({
      args: [".", "--no-sandbox"],
      cwd: repositoryRoot,
      env: {
        ...launchEnv,
        ELECTRON_DISABLE_SANDBOX: "1",
        PLAYWRIGHT_TEST: "true",
        TASK_MANAGE_DATA_DIR: tempDir,
        TASK_MANAGE_OPEN_DEVTOOLS: "false",
      },
    });

    const mainWindow = await electronApp.firstWindow();
    await mainWindow.locator("#project-1").waitFor({ state: "visible" });
    const startupInteractiveMs = roundTiming(performance.now() - startupStartedAt);
    const renderer = await mainWindow.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      return {
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
        loadMs: navigation?.loadEventEnd ?? null,
        firstContentfulPaintMs:
          performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        rendererToMountMs: performance.getEntriesByName("renderer-to-mount")[0]?.duration ?? null,
      };
    });

    const detailStartedAt = performance.now();
    const detailWindowPromise = electronApp.waitForEvent("window");
    await mainWindow.evaluate(() => {
      window.electronAPI.openTaskDetailWindow({
        projectId: "project-1",
        taskId: "task-1",
        taskName: "First Task",
      });
    });
    const detailWindow = await detailWindowPromise;
    await detailWindow.locator(".CardHeaderTitle", { hasText: "First Task" }).waitFor({
      state: "visible",
    });
    const detailInteractiveMs = roundTiming(performance.now() - detailStartedAt);
    await detailWindow.close();

    async function measureImageOpen() {
      const imageStartedAt = performance.now();
      const imageWindowPromise = electronApp.waitForEvent("window");
      await mainWindow.evaluate((src) => window.electronAPI.openImageWindow(src), imageDataUrl);
      const imageWindow = await imageWindowPromise;
      await imageWindow.waitForURL(/^data:image\/png/);
      await imageWindow.waitForLoadState("load");
      const elapsed = roundTiming(performance.now() - imageStartedAt);
      await imageWindow.close();
      return elapsed;
    }

    return {
      startupInteractiveMs,
      detailInteractiveMs,
      imageFirstOpenMs: await measureImageOpen(),
      imageReopenMs: await measureImageOpen(),
      renderer: Object.fromEntries(
        Object.entries(renderer).map(([key, value]) => [key, roundTiming(value)])
      ),
    };
  } finally {
    if (electronApp) await electronApp.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const samples = [];
for (let index = 0; index < sampleCount; index += 1) {
  process.stderr.write(`Measuring sample ${index + 1}/${sampleCount}...\n`);
  samples.push(await measureSample());
}

const timingKeys = [
  "startupInteractiveMs",
  "detailInteractiveMs",
  "imageFirstOpenMs",
  "imageReopenMs",
];
const rendererKeys = Object.keys(samples[0]?.renderer ?? {});
const result = {
  sampleCount,
  median: {
    ...Object.fromEntries(
      timingKeys.map((key) => [key, median(samples.map((sample) => sample[key]))])
    ),
    renderer: Object.fromEntries(
      rendererKeys.map((key) => [key, median(samples.map((sample) => sample.renderer[key]))])
    ),
  },
  samples,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
