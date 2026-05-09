import { get } from "svelte/store";
import { vi } from "vitest";
import { saveStatus, selected_id, selected_type } from "../../src/stores/ui.ts";
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
    selected_type.set("Projects");
    selected_id.set("project-1");
    saveStatus.set("idle");
    tree_data.init();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: makeElectronAPI(),
    });
  });

  test("initial value is idle", () => {
    expect(get(saveStatus)).toBe("idle");
  });

  test("setting tree_data changes status to saving", () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("saving");
  });

  test("setting tree_data to undefined changes status to idle", () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("saving");

    tree_data.set(undefined);
    expect(get(saveStatus)).toBe("idle");
  });

  test("successful setTreeData changes status to saved", async () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("saving");

    await vi.runAllTimersAsync();

    expect(get(saveStatus)).toBe("saved");
    expect(window.electronAPI.setTreeData).toHaveBeenCalled();
  });

  test("persists edits made immediately after source data is loaded", async () => {
    tree_data.setFromSource(createProjectData());

    const edited = createProjectData();
    edited.data.data.name = "Edited Project";
    tree_data.set(edited);

    await vi.runAllTimersAsync();

    expect(window.electronAPI.setTreeData).toHaveBeenCalledWith(edited);
  });

  test("failed setTreeData changes status to error", async () => {
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

  test("saveStatus can be set to error directly", () => {
    saveStatus.set("error");
    expect(get(saveStatus)).toBe("error");
  });

  test("saveStatus can be reset to idle directly", () => {
    saveStatus.set("saved");
    saveStatus.set("idle");
    expect(get(saveStatus)).toBe("idle");
  });

  test("saving to error to idle transitions are allowed", async () => {
    tree_data.set(createProjectData());
    expect(get(saveStatus)).toBe("saving");

    saveStatus.set("error");
    expect(get(saveStatus)).toBe("error");

    saveStatus.set("idle");
    expect(get(saveStatus)).toBe("idle");
  });
});
