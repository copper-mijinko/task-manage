import { get } from "svelte/store";
import { vi, describe, test, expect, beforeEach } from "vitest";
import { column_settings, DEFAULT_COLUMN_SETTINGS } from "../../src/stores/column_settings.ts";

describe("column_settings store", () => {
  let mockSetMetaData;
  let mockGetMetaData;

  beforeEach(() => {
    mockSetMetaData = vi.fn();
    mockGetMetaData = vi.fn().mockResolvedValue(null);

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        setMetaData: mockSetMetaData,
        getMetaData: mockGetMetaData,
      },
    });

    column_settings.set([...DEFAULT_COLUMN_SETTINGS]);
  });

  test("has correct default settings", () => {
    const settings = get(column_settings);
    expect(settings.find((s) => s.id === "name").visible).toBe(true);
    expect(settings.find((s) => s.id === "status").visible).toBe(true);
    expect(settings.find((s) => s.id === "due date").visible).toBe(true);
    expect(settings.find((s) => s.id === "memo").visible).toBe(false);
  });

  test("name column is always first by default", () => {
    const settings = get(column_settings);
    expect(settings[0].id).toBe("name");
  });

  test("toggle changes column visibility", () => {
    column_settings.toggle("status");
    expect(get(column_settings).find((s) => s.id === "status").visible).toBe(false);

    column_settings.toggle("status");
    expect(get(column_settings).find((s) => s.id === "status").visible).toBe(true);
  });

  test("toggle does not affect name column", () => {
    column_settings.toggle("name");
    expect(get(column_settings).find((s) => s.id === "name").visible).toBe(true);
  });

  test("toggle saves to metaData", () => {
    column_settings.toggle("status");
    expect(mockSetMetaData).toHaveBeenCalledWith("column_settings", expect.any(Array));
  });

  test("moveUp reorders columns", () => {
    const before = get(column_settings).map((s) => s.id);
    const dueDateIndex = before.indexOf("due date");
    column_settings.moveUp("due date");
    const after = get(column_settings).map((s) => s.id);
    expect(after.indexOf("due date")).toBe(dueDateIndex - 1);
  });

  test("moveUp cannot move past name column", () => {
    // status is at index 1 (right after name)
    column_settings.moveUp("status");
    expect(get(column_settings)[0].id).toBe("name");
    expect(get(column_settings)[1].id).toBe("status");
  });

  test("moveDown reorders columns", () => {
    const before = get(column_settings).map((s) => s.id);
    const statusIndex = before.indexOf("status");
    column_settings.moveDown("status");
    const after = get(column_settings).map((s) => s.id);
    expect(after.indexOf("status")).toBe(statusIndex + 1);
  });

  test("moveDown does nothing for last column", () => {
    const before = get(column_settings).map((s) => s.id);
    const lastId = before[before.length - 1];
    column_settings.moveDown(lastId);
    const after = get(column_settings).map((s) => s.id);
    expect(after[after.length - 1]).toBe(lastId);
  });

  test("moveUp saves to metaData", () => {
    column_settings.moveUp("due date");
    expect(mockSetMetaData).toHaveBeenCalledWith("column_settings", expect.any(Array));
  });

  test("moveDown saves to metaData", () => {
    column_settings.moveDown("status");
    expect(mockSetMetaData).toHaveBeenCalledWith("column_settings", expect.any(Array));
  });

  test("init loads saved settings from metaData", async () => {
    const savedSettings = [
      { id: "name", label: "タスク名", visible: true },
      { id: "due date", label: "期限日", visible: true },
      { id: "status", label: "ステータス", visible: false },
      { id: "memo", label: "メモ数", visible: true },
    ];
    mockGetMetaData.mockResolvedValue(savedSettings);

    await column_settings.init();
    // Allow promise to settle
    await new Promise((r) => setTimeout(r, 0));

    const settings = get(column_settings);
    expect(settings.find((s) => s.id === "status").visible).toBe(false);
    expect(settings.find((s) => s.id === "memo").visible).toBe(true);
  });

  test("init preserves saved column ordering", async () => {
    const savedSettings = [
      { id: "name", label: "タスク名", visible: true },
      { id: "memo", label: "メモ数", visible: false },
      { id: "status", label: "ステータス", visible: true },
      { id: "due date", label: "期限日", visible: true },
    ];
    mockGetMetaData.mockResolvedValue(savedSettings);

    await column_settings.init();
    await new Promise((r) => setTimeout(r, 0));

    const ids = get(column_settings).map((s) => s.id);
    expect(ids.indexOf("memo")).toBeLessThan(ids.indexOf("status"));
  });

  test("init keeps defaults when metaData returns invalid data", async () => {
    mockGetMetaData.mockResolvedValue("invalid");

    await column_settings.init();
    await new Promise((r) => setTimeout(r, 0));

    const settings = get(column_settings);
    expect(settings).toEqual(DEFAULT_COLUMN_SETTINGS);
  });

  test("init keeps defaults when metaData fails", async () => {
    mockGetMetaData.mockRejectedValue(new Error("network error"));

    await column_settings.init();
    await new Promise((r) => setTimeout(r, 0));

    const settings = get(column_settings);
    expect(settings).toEqual(DEFAULT_COLUMN_SETTINGS);
  });
});
