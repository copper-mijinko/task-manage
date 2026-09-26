import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { resolveAppDataPath } = require("../../electron/app-paths.js");

describe("resolveAppDataPath", () => {
  const created = [];
  afterEach(() => {
    for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-paths-"));
    created.push(dir);
    return dir;
  };

  it("uses TASK_MANAGE_DATA_DIR first and creates it", () => {
    const dir = path.join(tempDir(), "data");
    const app = { isPackaged: true, getPath: () => "/should/not/be/used" };
    expect(
      resolveAppDataPath("meta.json", { env: { TASK_MANAGE_DATA_DIR: dir }, electronApp: app })
    ).toBe(path.join(dir, "meta.json"));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("stores data in the OS user-data directory when packaged", () => {
    const userData = path.join(tempDir(), "userData");
    const app = { isPackaged: true, getPath: (name) => (name === "userData" ? userData : "") };
    expect(resolveAppDataPath("meta.json", { env: {}, electronApp: app })).toBe(
      path.join(userData, "meta.json")
    );
    expect(fs.existsSync(userData)).toBe(true);
  });

  it("keeps development data next to the main-process sources", () => {
    const app = { isPackaged: false, getPath: () => "/unused" };
    expect(resolveAppDataPath("meta.json", { env: {}, electronApp: app })).toBe(
      path.resolve(__dirname, "../../electron/meta.json")
    );
  });
});
