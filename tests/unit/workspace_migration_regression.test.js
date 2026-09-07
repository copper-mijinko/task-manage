import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import workspace from "../../electron/workspace.js";

describe("legacy memo persistence regressions", () => {
  let tmp;
  let projectDir;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "memo-regression-"));
    ({ projectDir } = workspace.createProject(tmp, "Project", "root"));
    workspace.writeTask(
      projectDir,
      {
        id: "parent",
        name: "Parent",
        parents: [{ id: "root" }],
        body: "PARENT BODY",
      },
      new Map()
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function memo(dir = "", file = "memo.md", id = "memo") {
    const target = path.join(projectDir, dir);
    fs.writeFileSync(
      path.join(target, file),
      `---\n${id ? `id: ${id}\n` : ""}title: Memo\n---\n\nMEMO BODY ![](./assets/pic.png)\n`
    );
    fs.mkdirSync(path.join(target, "assets"), { recursive: true });
    fs.writeFileSync(path.join(target, "assets", "pic.png"), "IMAGE");
  }

  it.each(["", "parent"])(
    "loads the actual legacy file under %s synchronously and asynchronously",
    async (dir) => {
      memo(dir, "renamed.md");
      const { taskDirs } = await workspace.readProjectAsync(projectDir, {
        includeMemoContent: false,
      });
      expect(workspace.readTaskBody(projectDir, "memo", taskDirs).body).toContain("MEMO BODY");
      expect((await workspace.readTaskBodyAsync(projectDir, "memo", taskDirs)).body).toContain(
        "MEMO BODY"
      );
    }
  );

  it("preserves unloaded root memo bodies and images during a metadata-only patch", async () => {
    memo();
    const { tasks } = await workspace.readProjectAsync(projectDir, { includeMemoContent: false });
    await workspace.writeProjectPatchAsync(projectDir, {
      tasks: [{ ...tasks.get("memo"), name: "Renamed" }],
    });
    const reread = workspace.readProject(projectDir);
    expect(reread.tasks.get("memo").body).toContain("MEMO BODY");
    expect(fs.readFileSync(path.join(projectDir, "memo", "assets", "pic.png"), "utf8")).toBe(
      "IMAGE"
    );
    expect(fs.existsSync(path.join(projectDir, "memo.md"))).toBe(false);
  });

  it.each(["", "parent"])(
    "standalone saves migrate legacy memos without overwriting their parent under %s",
    async (dir) => {
      memo(dir);
      const { tasks, taskDirs } = await workspace.readProjectAsync(projectDir);
      await workspace.writeTaskAsync(
        projectDir,
        { ...tasks.get("memo"), body: "EDITED" },
        taskDirs
      );
      const reread = workspace.readProject(projectDir);
      expect(reread.tasks.get("parent").body).toBe("PARENT BODY");
      expect(reread.tasks.get("memo").body).toBe("EDITED");
      expect(fs.existsSync(path.join(projectDir, dir, "memo.md"))).toBe(false);
    }
  );

  it.each([true, false])(
    "deletes only a root legacy memo with migration metadata=%s",
    async (withMetadata) => {
      memo();
      const { taskDirs, legacyMemoFiles } = await workspace.readProjectAsync(projectDir);
      await workspace.deleteTaskDirAsync(
        projectDir,
        taskDirs,
        "memo",
        withMetadata ? legacyMemoFiles : undefined
      );
      expect(fs.existsSync(path.join(projectDir, "memo.md"))).toBe(false);
      expect(workspace.readProject(projectDir).tasks.has("root")).toBe(true);
    }
  );

  it.each(["snapshot", "patch"])(
    "migrates a surviving memo before deleting its old parent (%s)",
    async (mode) => {
      memo("parent");
      const { tasks } = await workspace.readProjectAsync(projectDir, { includeMemoContent: false });
      const moved = { ...tasks.get("memo"), parents: [{ id: "root" }] };
      if (mode === "snapshot")
        await workspace.writeProjectAsync(projectDir, [tasks.get("root"), moved]);
      else
        await workspace.writeProjectPatchAsync(projectDir, {
          tasks: [moved],
          deletedTaskIds: ["parent"],
        });
      expect(workspace.readProject(projectDir).tasks.get("memo").body).toContain("MEMO BODY");
      expect(fs.readFileSync(path.join(projectDir, "memo", "assets", "pic.png"), "utf8")).toBe(
        "IMAGE"
      );
      expect(fs.existsSync(path.join(projectDir, "parent"))).toBe(false);
    }
  );

  it.each(["", "../unsafe"])(
    "keeps generated IDs stable through lazy loading and saving: %s",
    async (id) => {
      memo("parent", "note.md", id);
      const first = await workspace.readProjectAsync(projectDir, { includeMemoContent: false });
      const second = workspace.readProject(projectDir);
      const node = [...first.tasks.values()].find((task) => task.name === "Memo");
      expect(second.tasks.has(node.id)).toBe(true);
      expect(
        (await workspace.readTaskBodyAsync(projectDir, node.id, first.taskDirs)).body
      ).toContain("MEMO BODY");
      await workspace.writeProjectPatchAsync(projectDir, { tasks: [node] });
      expect(workspace.readProject(projectDir).tasks.get(node.id).body).toContain("MEMO BODY");
      expect(fs.existsSync(path.join(projectDir, "parent", "note.md"))).toBe(false);
    }
  );

  it("aborts a snapshot before deletion or overwrite when an unloaded body cannot be read", async () => {
    const { tasks } = await workspace.readProjectAsync(projectDir, { includeMemoContent: false });
    const readFile = fs.promises.readFile.bind(fs.promises);
    vi.spyOn(fs.promises, "readFile").mockImplementation((file, ...args) => {
      if (String(file) === path.join(projectDir, "parent", "_index.md")) {
        return Promise.reject(Object.assign(new Error("read denied"), { code: "EACCES" }));
      }
      return readFile(file, ...args);
    });
    await expect(workspace.writeProjectAsync(projectDir, [...tasks.values()])).rejects.toThrow(
      "read denied"
    );
    expect(workspace.readProject(projectDir).tasks.get("parent").body).toBe("PARENT BODY");
  });

  it("round-trips colon tags while still parsing parent link maps", () => {
    const tags = ["scope:work", "owner: team", "https://example.test"];
    const { data } = workspace.parseFrontmatter(
      workspace.stringifyFrontmatter({ tags, parents: [{ id: "root", order: 2 }] })
    );
    expect(data.tags).toEqual(tags);
    expect(workspace.normalizeParentLinks(data.parents)).toEqual([{ id: "root", order: 2 }]);
  });
});
