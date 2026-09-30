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

  test("keeps the path in the message for a file changed outside the app, and treats it as a rejection", () => {
    // Electron は、名前を持つエラーを「ExternalChangeError: …」の形で送ってくる。
    const changed = new Error(
      "Error invoking remote method 'ws:execute-graph-command': ExternalChangeError: ファイルがアプリの外で変更されています: alpha/task-a/_index.md。ワークスペース管理の「ディスクから読み込み直す」で読み直してから操作してください。"
    );
    expect(userErrorMessage(changed)).toContain("alpha/task-a/_index.md");
    expect(userErrorMessage(changed)).toMatch(/^ファイルがアプリの外で変更されています/);
    expect(userErrorMessage(changed)).not.toContain("Error");
    // 何も書いていないので、保存失敗にはしない。
    expect(isRejectedOperation(changed)).toBe(true);
  });

  test("drops a custom error name after the IPC prefix, not only `Error:`", () => {
    const named = new Error(
      "Error invoking remote method 'ws:execute-graph-command': SomeCustomError: 理由のメッセージ"
    );
    expect(userErrorMessage(named)).toBe("理由のメッセージ");
  });

  test("a file changed outside the app is still a rejection with a plain `Error:` prefix", () => {
    const changed = ipc("ファイルがアプリの外で変更されています: alpha/task-a/_index.md。");
    expect(userErrorMessage(changed)).toContain("alpha/task-a/_index.md");
    expect(userErrorMessage(changed)).not.toContain("Error invoking");
    // 何も書いていないので、保存失敗にはしない。
    expect(isRejectedOperation(changed)).toBe(true);
  });

  test("toUserError keeps the original error as the cause", () => {
    const original = ipc("Duplicate edges are not allowed");
    const wrapped = toUserError(original);
    expect(wrapped.message).toBe("同じ親子関係がすでにあります。");
    expect(wrapped.rejected).toBe(true);
    expect(wrapped.cause).toBe(original);
  });
});
