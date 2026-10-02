const { dialog, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const log = require("electron-log/main");
const workspaceGraph = require("../workspace-graph");
const { createWorkspaceApplication } = require("../workspace-application");
const { normalizePathForCompare, validateWorkspaceConfig } = require("../ipc-security");
const { openDirectoryInExplorer, openPathWithProgramPicker } = require("../os-open");
const { planConversion, convertLegacyWorkspace } = require("../store/convert-legacy");
const { broadcast } = require("../ipc-registrar");

const IMAGE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/**
 * ワークスペースの IPC。データの正本はワークスペースのフォルダーの Markdown
 * ファイル（1 ノード 1 ファイル）で、読み書きはすべてグラフのコマンドを通る。
 *
 * @param {ReturnType<import("../ipc-registrar").createIpcRegistrar>} ipc
 * @param {object} deps
 * @param {ReturnType<import("../settings-store").createSettingsStore>} deps.settings
 * @param {ReturnType<import("../ipc-security").createWorkspaceAuthorizer>} deps.workspaceAuthorizer
 * @param {() => string[]} deps.knownWorkspacePaths
 */
function registerWorkspaceIpc(ipc, { settings, workspaceAuthorizer, knownWorkspacePaths }) {
  // フォルダー選択ダイアログで選ばれたパス。ここにあるものだけを新しい
  // ワークスペースとして登録できる。
  const approvedWorkspacePaths = new Set();

  // 手で直したファイルの誤りなど、読み込み時の警告はログに残す。
  workspaceGraph.setWarningHandler((message) => log.warn(message));

  const application = createWorkspaceApplication({
    authorize: (workspacePath) => workspaceAuthorizer.assertKnownWorkspace(workspacePath),
    initialize: (workspacePath) => workspaceGraph.readWorkspaceGraph(workspacePath),
    repository: workspaceGraph,
    // 要求元のウィンドウは結果を戻り値で受け取るので送らない。`payload` は
    // 差分（`{ delta }`）か、読み直したときの全体（`{ graph }`）。
    publish: (workspacePath, payload, requester) =>
      broadcast("workspace-graph-updated", { workspacePath, ...payload }, requester),
    openAsset: async (resolvedPath, chooseProgram) => {
      if (chooseProgram) return openPathWithProgramPicker(resolvedPath);
      const error = await shell.openPath(resolvedPath);
      if (error) throw new Error(error);
    },
  });

  ipc.handle("ws:get-workspaces", () => ({
    workspaces: settings.get("workspaces") || [],
    activeWorkspace: settings.get("activeWorkspace") || null,
  }));

  ipc.on("ws:set-workspaces", (_event, config) => {
    try {
      const validated = validateWorkspaceConfig({
        config,
        currentWorkspacePaths: knownWorkspacePaths(),
        approvedWorkspacePaths,
      });
      settings.set("workspaces", validated.workspaces);
      settings.set("activeWorkspace", validated.activeWorkspace);
      workspaceAuthorizer.reset();
    } catch (err) {
      log.warn("Rejected workspace configuration:", err.message);
    }
  });

  ipc.handle("ws:open-workspace", async (_event, { workspacePath }) => {
    try {
      if (!workspacePath || typeof workspacePath !== "string") {
        return { success: false, error: "No workspace is selected" };
      }
      return openDirectoryInExplorer(await workspaceAuthorizer.assertKnownWorkspace(workspacePath));
    } catch (err) {
      log.error("ws:open-workspace error:", err.message);
      return { success: false, error: err.message };
    }
  });

  ipc.handle("ws:select-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "ワークスペースのフォルダーを選択",
    });
    if (result.canceled || !result.filePaths[0]) return { path: null };

    const selected = result.filePaths[0];
    let entries;
    try {
      entries = await fs.promises.readdir(selected, { withFileTypes: true });
    } catch (err) {
      log.error("ws:select-directory readdir error:", err.message);
      return { path: null, error: `フォルダの読み取りに失敗しました: ${err.message}` };
    }

    // 受け付けるのは、空のフォルダー・既存のワークスペース・旧 Markdown
    // プロジェクトを含むフォルダーのどれか。
    const isWorkspace =
      entries.length === 0 ||
      workspaceGraph.isWorkspaceFolder(selected) ||
      entries.some(
        (entry) =>
          entry.isDirectory() && fs.existsSync(path.join(selected, entry.name, "_project.md"))
      );
    if (!isWorkspace) {
      return {
        path: null,
        error:
          "選択したフォルダは空でも既存のワークスペースでもありません。空のフォルダ、または既存のワークスペースを選択してください。",
      };
    }
    approvedWorkspacePaths.add(normalizePathForCompare(selected));
    return { path: selected };
  });

  // 旧形式のフォルダーを、別の場所へ変換して書き出す（移行のための一時的な機能）。
  // 元のフォルダーと書き出し先は、ここでダイアログから選ばせる。書き出し先は、そのまま
  // ワークスペースとして登録できるよう、承認済みにする。
  ipc.handle("ws:convert-legacy", async () => {
    try {
      const picked = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "変換する旧形式のフォルダーを選択",
      });
      if (picked.canceled || !picked.filePaths[0]) return { path: null };
      const source = picked.filePaths[0];
      const plan = planConversion(source);
      const confirmed = await dialog.showMessageBox({
        type: "question",
        buttons: ["書き出し先を選ぶ", "キャンセル"],
        defaultId: 0,
        cancelId: 1,
        title: "旧形式から変換",
        message: `メモのノード ${plan.memoNodes} 件のうち、${plan.merge.length} 件を親の本文にまとめます。`,
        detail:
          "メモが 1 つだけで名前が「memo」、かつ親の本文が空のものだけです。" +
          (plan.keep.length > 0
            ? `親に本文があるため、そのままにするもの: ${plan.keep.length} 件。`
            : "") +
          "\n元のフォルダーは変更しません。別の空のフォルダーへ書き出します。",
      });
      if (confirmed.response !== 0) return { path: null };
      const target = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "書き出し先の空のフォルダーを選択",
      });
      if (target.canceled || !target.filePaths[0]) return { path: null };
      const dest = target.filePaths[0];
      await convertLegacyWorkspace(source, dest, {
        read: (workspace) => workspaceGraph.readWorkspaceGraph(workspace),
        execute: (...args) => workspaceGraph.executeWorkspaceGraphCommand(...args),
        forget: (workspace) => workspaceGraph.forgetWorkspace(workspace),
      });
      approvedWorkspacePaths.add(normalizePathForCompare(dest));
      return { path: dest, merged: plan.merge.length, kept: plan.keep.length };
    } catch (err) {
      log.error("ws:convert-legacy error:", err.message);
      return { path: null, error: err.message };
    }
  });

  ipc.handle("ws:read-graph", (_event, { workspacePath }) => application.read(workspacePath));
  ipc.handle("ws:execute-graph-command", (event, request) =>
    application.execute({ ...request, requester: event.sender })
  );
  ipc.handle("ws:undo-graph", (event, request) =>
    application.history({ ...request, direction: "undo", requester: event.sender })
  );
  ipc.handle("ws:redo-graph", (event, request) =>
    application.history({ ...request, direction: "redo", requester: event.sender })
  );
  ipc.handle("ws:reload-workspace", (event, { workspacePath }) =>
    application.reload({ workspacePath, requester: event.sender })
  );
  ipc.handle("ws:read-node-body", (_event, { workspacePath, nodeId }) =>
    application.readBody({ workspacePath, nodeId })
  );
  ipc.handle("ws:read-all-node-bodies", (_event, { workspacePath }) =>
    application.readAllBodies({ workspacePath })
  );
  ipc.handle("ws:open-graph-asset", (_event, request) => application.openAsset(request));
  ipc.handle("ws:save-graph-asset", (_event, { workspacePath, nodeId, fileName, bytes, kind }) =>
    application.saveAsset({ workspacePath, nodeId, fileName, bytes, kind })
  );
  ipc.handle("ws:resolve-graph-asset", async (_event, { workspacePath, nodeId, relativePath }) => {
    const resolved = await application.resolveAsset({ workspacePath, nodeId, relativePath });
    const mimeType = IMAGE_MIME_TYPES[path.extname(resolved).toLowerCase()];
    if (!mimeType) throw new Error("Only image assets can be resolved for renderer display");
    const bytes = await fs.promises.readFile(resolved);
    return { url: `data:${mimeType};base64,${bytes.toString("base64")}` };
  });

  return application;
}

module.exports = { registerWorkspaceIpc };
