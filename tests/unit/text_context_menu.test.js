import { describe, expect, test, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { attachTextContextMenu } = require("../../electron/window-controls.js");

function setup() {
  let handler;
  const win = { webContents: { on: (event, fn) => event === "context-menu" && (handler = fn) } };
  const popup = vi.fn();
  const menu = { buildFromTemplate: vi.fn(() => ({ popup })) };
  attachTextContextMenu(win, menu);
  return { open: (params) => handler({}, params), menu, popup, win };
}

describe("text context menu", () => {
  test("offers cut, copy, paste and select all in an editable field", () => {
    const { open, menu, popup, win } = setup();
    open({ isEditable: true, selectionText: "", editFlags: { canCut: false, canPaste: true } });
    const template = menu.buildFromTemplate.mock.calls[0][0];
    expect(template.filter((item) => item.role).map((item) => [item.label, item.enabled])).toEqual([
      ["切り取り", false],
      ["コピー", true],
      ["貼り付け", true],
      ["すべて選択", undefined],
    ]);
    expect(popup).toHaveBeenCalledWith({ window: win });
  });

  test("offers copy for selected text and nothing elsewhere", () => {
    const { open, menu } = setup();
    open({ isEditable: false, selectionText: "spec" });
    expect(menu.buildFromTemplate.mock.calls[0][0].map((item) => item.label)).toEqual(["コピー"]);
    open({ isEditable: false, selectionText: "  " });
    expect(menu.buildFromTemplate).toHaveBeenCalledTimes(1);
  });
});
