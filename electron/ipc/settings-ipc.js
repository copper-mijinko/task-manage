const log = require("electron-log/main");
const { broadcast } = require("../ipc-registrar");

/**
 * アプリ設定（`meta.json`）の読み書きと、レンダラーからのログ。
 *
 * @param {ReturnType<import("../ipc-registrar").createIpcRegistrar>} ipc
 * @param {ReturnType<import("../settings-store").createSettingsStore>} settings
 */
function registerSettingsIpc(ipc, settings) {
  ipc.handle("get-meta-data", (_event, key) => settings.get(key));
  ipc.on("set-meta-data", (event, key, value) => {
    const changed = settings.get(key) !== value;
    settings.set(key, value);
    // テーマは開いている他のウィンドウにも反映する。
    if (key === "theme" && changed) broadcast("theme-changed", value, event.sender);
  });
  ipc.on("delete-meta-data", (_event, key) => {
    if (key && settings.delete(key)) log.info(`Metadata key deleted: ${key}`);
  });
  ipc.handle("get-current-theme", () => settings.get("theme") || "dark");
  ipc.on("message", (_event, message) => log.info(message));
}

module.exports = { registerSettingsIpc };
