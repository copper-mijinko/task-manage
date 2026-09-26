import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  portableDataDirectory,
  usePortableDataDirectory,
  resolveAppDataPath,
} = require("../../electron/app-paths.js");

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

describe("portable data directory", () => {
  const created = [];
  afterEach(() => {
    for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  /** 展開したポータブル版のフォルダ（実行ファイルと、必要なら data）を作る。 */
  const extractedApp = ({ withData }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-portable-"));
    created.push(dir);
    const execPath = path.join(dir, "task-manage.exe");
    fs.writeFileSync(execPath, "");
    if (withData) fs.mkdirSync(path.join(dir, "data"));
    return { dir, execPath };
  };
  const packaged = () => {
    const paths = { userData: "/os/appdata/task-manage" };
    return {
      isPackaged: true,
      setPath: (name, value) => (paths[name] = value),
      getPath: (name) => paths[name],
    };
  };

  it("uses the data folder next to the executable and moves userData there", () => {
    const { dir, execPath } = extractedApp({ withData: true });
    const app = packaged();

    expect(usePortableDataDirectory(app, { env: {}, execPath })).toBe(path.join(dir, "data"));
    expect(resolveAppDataPath("meta.json", { env: {}, electronApp: app })).toBe(
      path.join(dir, "data", "meta.json")
    );
  });

  it("keeps the OS user-data directory when there is no data folder (installer)", () => {
    const { execPath } = extractedApp({ withData: false });
    const app = packaged();

    expect(usePortableDataDirectory(app, { env: {}, execPath })).toBeNull();
    expect(app.getPath("userData")).toBe("/os/appdata/task-manage");
  });

  it("ignores a data folder that is a file", () => {
    const { dir, execPath } = extractedApp({ withData: false });
    fs.writeFileSync(path.join(dir, "data"), "");
    expect(portableDataDirectory({ env: {}, electronApp: packaged(), execPath })).toBeNull();
  });

  it("lets TASK_MANAGE_DATA_DIR win over the portable folder", () => {
    const { execPath } = extractedApp({ withData: true });
    expect(
      portableDataDirectory({
        env: { TASK_MANAGE_DATA_DIR: "/tmp/x" },
        electronApp: packaged(),
        execPath,
      })
    ).toBeNull();
  });

  it("is never used in development", () => {
    const { execPath } = extractedApp({ withData: true });
    expect(
      portableDataDirectory({ env: {}, electronApp: { isPackaged: false }, execPath })
    ).toBeNull();
  });
});
