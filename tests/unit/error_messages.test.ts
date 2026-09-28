import { describe, expect, test } from "vitest";
import {
  isRejectedOperation,
  toUserError,
  userErrorMessage,
} from "../../src/lib/utils/error_messages";

const ipc = (message: string) =>
  new Error(`Error invoking remote method 'ws:execute-graph-command': Error: ${message}`);

describe("error_messages", () => {
  test("drops the IPC prefix and translates known validation errors", () => {
    expect(userErrorMessage(ipc("Start date is after due date: alpha-a"))).toBe(
      "開始日が期限日より後になっています。日付を確認してください。"
    );
    expect(userErrorMessage(ipc("This view cannot create a cycle"))).toContain("循環");
    expect(userErrorMessage(ipc("Workspace graph changed; reload"))).toContain(
      "別の変更が先に保存されました"
    );
  });

  test("keeps unknown messages readable without the internal prefix", () => {
    expect(userErrorMessage(ipc("disk full"))).toBe("disk full");
    expect(userErrorMessage(new Error("Inboxは削除・アーカイブ・移動できません。"))).toBe(
      "Inboxは削除・アーカイブ・移動できません。"
    );
    expect(userErrorMessage("")).toBe("操作できませんでした。");
  });

  test("separates rejected operations from real save failures", () => {
    expect(isRejectedOperation(ipc("Start date is after due date: x"))).toBe(true);
    expect(isRejectedOperation(new Error("Inboxは削除・アーカイブ・移動できません。"))).toBe(true);
    expect(isRejectedOperation(ipc("EACCES: permission denied, open 'graph-v1.json'"))).toBe(false);
    expect(isRejectedOperation(ipc("Verification: save failed"))).toBe(false);
  });

  test("translates file and workspace failures without calling them rejections", () => {
    const denied = ipc("EACCES: permission denied, open 'graph-v1.json'");
    expect(userErrorMessage(denied)).toBe(
      "ファイルにアクセスできません（使用中か、権限がありません）。"
    );
    expect(isRejectedOperation(denied)).toBe(false);
    expect(userErrorMessage(ipc("Invalid workspace graph"))).toContain("読み込めませんでした");
    expect(isRejectedOperation(ipc("Invalid workspace graph"))).toBe(false);
    expect(userErrorMessage(ipc("Active workspace is not registered"))).toContain(
      "登録されていません"
    );
  });

  test("toUserError keeps the original error as the cause", () => {
    const original = ipc("Duplicate edges are not allowed");
    const wrapped = toUserError(original);
    expect(wrapped.message).toBe("同じ親子関係がすでにあります。");
    expect(wrapped.rejected).toBe(true);
    expect(wrapped.cause).toBe(original);
  });
});
