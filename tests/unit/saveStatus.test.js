import { get } from "svelte/store";
import { vi } from "vitest";
import { saveStatus } from "../../src/stores/ui.ts";
import { tree_data } from "../../src/stores/tree.ts";

function makeElectronAPI(overrides = {}) {
  return {
    getInitialTreeData: vi.fn().mockResolvedValue(undefined),
    getProjectIDs: vi.fn().mockResolvedValue([]),
    getMetaData: vi.fn().mockResolvedValue(null),
    setMetaData: vi.fn(),
    setTreeData: vi.fn().mockResolvedValue(undefined),
    onTreeDataUpdated: vi.fn(),
    onProjectDeleted: vi.fn(),
    ...overrides,
  };
}

function createProjectData(id = "project-1") {
  return {
    headers: [{ name: "name", default_ratio: 10 }],
    data: {
      id,
      data: { name: "Sample Project", status: "Open", "due date": undefined, memo: [] },
      children: [],
    },
  };
}

describe("saveStatus store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI(),
    });
    saveStatus.set("idle");
    tree_data.init();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    // electronAPI を削除する前にタイマーを全部消化してから undefine
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI(),
    });
  });

  test("初期値は idle", () => {
    expect(get(saveStatus)).toBe("idle");
  });

  test("tree_data に値をセットすると saving になる", () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("saving");
  });

  test("tree_data に undefined をセットすると idle になる", () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("saving");

    tree_data.set(undefined);
    expect(get(saveStatus)).toBe("idle");
  });

  test("setTreeData 成功後に saved になる", async () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("saving");

    await vi.runAllTimersAsync();

    expect(get(saveStatus)).toBe("saved");
    expect(window.electronAPI.setTreeData).toHaveBeenCalled();
  });

  test("setTreeData が失敗すると error になる", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI({
        setTreeData: vi.fn().mockRejectedValue(new Error("disk full")),
      }),
    });

    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("saving");

    await vi.runAllTimersAsync();

    expect(get(saveStatus)).toBe("error");
  });

  test("saveStatus を直接 error にセットできる", () => {
    saveStatus.set("error");
    expect(get(saveStatus)).toBe("error");
  });

  test("saveStatus を直接 idle にリセットできる", () => {
    saveStatus.set("saved");
    saveStatus.set("idle");
    expect(get(saveStatus)).toBe("idle");
  });

  test("saving → error → idle の順に遷移できる", async () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("saving");

    saveStatus.set("error");
    expect(get(saveStatus)).toBe("error");

    saveStatus.set("idle");
    expect(get(saveStatus)).toBe("idle");
  });
});
