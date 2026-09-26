const { BrowserWindow, ipcMain } = require("electron");
const log = require("electron-log/main");

/**
 * 信頼できる送り手（アプリ自身のレンダラー）からの IPC だけを受け付ける
 * `handle` / `on` を作る。
 *
 * @param {(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => boolean} isTrustedSender
 */
function createIpcRegistrar(isTrustedSender) {
  return {
    /**
     * @param {string} channel
     * @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown} handler
     */
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event)) {
          log.warn(`Rejected IPC from an untrusted sender: ${channel}`);
          throw new Error("Untrusted IPC sender");
        }
        return handler(event, ...args);
      });
    },
    /**
     * @param {string} channel
     * @param {(event: Electron.IpcMainEvent, ...args: any[]) => unknown} handler
     */
    on(channel, handler) {
      ipcMain.on(channel, (event, ...args) => {
        if (!isTrustedSender(event)) {
          log.warn(`Rejected IPC from an untrusted sender: ${channel}`);
          return;
        }
        return handler(event, ...args);
      });
    },
  };
}

/** 開いているすべてのウィンドウへ送る。`except` は送り元を除くとき。 */
function broadcast(channel, payload, except = null) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents !== except) win.webContents.send(channel, payload);
  }
}

module.exports = { createIpcRegistrar, broadcast };
