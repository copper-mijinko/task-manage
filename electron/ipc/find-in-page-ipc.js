const log = require("electron-log/main");

/**
 * 画面内検索（Chromium の findInPage）。検索は IPC を送ってきたウィンドウで行う。
 *
 * @param {ReturnType<import("../ipc-registrar").createIpcRegistrar>} ipc
 */
function registerFindInPageIpc(ipc) {
  function resetHighlights(contents, notifyResult) {
    contents.stopFindInPage("clearSelection");
    if (notifyResult) {
      contents.send("search-result-updated", { matches: 0, activeMatchOrdinal: 0 });
    }
  }

  ipc.handle("find-in-page", async (event, text, options = {}) => {
    const contents = event.sender;
    if (!text || !text.trim()) {
      resetHighlights(contents, true);
      return { matches: 0, activeMatchOrdinal: 0 };
    }
    try {
      // 前回のハイライトを消してから少し待たないと、Chromium が前の結果を返す。
      resetHighlights(contents, false);
      await new Promise((resolve) => setTimeout(resolve, 200));
      contents.findInPage(text.trim(), { ...options, findNext: false });
      contents.findInPage(text.trim(), { findNext: true, forward: true });
    } catch (error) {
      log.error("Search error:", error);
    }
  });

  ipc.handle("find-in-page-next", (event, text = "") => {
    if (!text || !text.trim()) return;
    try {
      event.sender.findInPage(text.trim(), { findNext: true, forward: true });
    } catch (error) {
      log.error("Search next error:", error);
    }
  });

  ipc.handle("find-in-page-previous", (event, text = "") => {
    if (!text || !text.trim()) return { matches: 0, activeMatchOrdinal: 0 };
    try {
      event.sender.findInPage(text.trim(), { findNext: true, forward: false });
    } catch (error) {
      log.error("Search previous error:", error);
    }
  });

  ipc.on("stop-find-in-page", (event) => {
    try {
      resetHighlights(event.sender, true);
    } catch (error) {
      log.error("Search reset error:", error);
    }
  });
}

/** findInPage の結果を、そのウィンドウのレンダラーへ送る。 */
function forwardFindInPageResults(contents) {
  contents.on("found-in-page", (_event, result) => {
    contents.send("search-result-updated", result);
  });
}

module.exports = { registerFindInPageIpc, forwardFindInPageResults };
