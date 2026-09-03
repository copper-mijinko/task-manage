const fs = require("fs");
const path = require("path");

/**
 * メインウィンドウの大きさ・位置・最大化状態を保存し、次回起動時に復元する。
 *
 * 保存先は `db.json` / `meta.json` とは別の小さな専用ファイル。起動時は
 * BrowserWindow を作る前に読む必要があり、そこで meta.json 全体を読むと
 * 起動時間の設計（ウィンドウを先に出す）を崩すため、最小限のファイルを
 * 同期で読む。
 */

const DEFAULT_STATE = {
  width: 1280,
  height: 860,
  minWidth: 700,
  minHeight: 600,
};

const MIN_VISIBLE_OVERLAP = 80;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 保存済みの状態を、現在のディスプレイ構成に対して安全な値へ丸める。
 *
 * - サイズは最小サイズと作業領域の大きさでクランプする
 * - 位置は、いずれかのディスプレイと十分に重なっている場合だけ採用する
 *   （外部ディスプレイを外した後に画面外へ復元されるのを防ぐ）
 */
function sanitizeWindowState(saved, displays, defaults = DEFAULT_STATE) {
  const minWidth = defaults.minWidth ?? DEFAULT_STATE.minWidth;
  const minHeight = defaults.minHeight ?? DEFAULT_STATE.minHeight;
  const areas = (displays ?? [])
    .map((display) => display?.workArea)
    .filter(
      (area) =>
        area &&
        isFiniteNumber(area.x) &&
        isFiniteNumber(area.y) &&
        area.width > 0 &&
        area.height > 0
    );

  const largest = areas.reduce(
    (best, area) => (!best || area.width * area.height > best.width * best.height ? area : best),
    null
  );

  const maxWidth = largest ? largest.width : Number.POSITIVE_INFINITY;
  const maxHeight = largest ? largest.height : Number.POSITIVE_INFINITY;

  const width = Math.round(
    Math.min(
      Math.max(isFiniteNumber(saved?.width) ? saved.width : defaults.width, minWidth),
      maxWidth
    )
  );
  const height = Math.round(
    Math.min(
      Math.max(isFiniteNumber(saved?.height) ? saved.height : defaults.height, minHeight),
      maxHeight
    )
  );

  const state = { width, height, isMaximized: saved?.isMaximized === true };

  if (isFiniteNumber(saved?.x) && isFiniteNumber(saved?.y)) {
    const x = Math.round(saved.x);
    const y = Math.round(saved.y);
    const visible = areas.some((area) => {
      const overlapX =
        Math.min(x + width, area.x + area.width) - Math.max(x, area.x) >= MIN_VISIBLE_OVERLAP;
      const overlapY =
        Math.min(y + height, area.y + area.height) - Math.max(y, area.y) >= MIN_VISIBLE_OVERLAP;
      return overlapX && overlapY;
    });
    // ディスプレイ情報が取れない環境（テスト等）では位置をそのまま尊重する。
    if (visible || areas.length === 0) {
      state.x = x;
      state.y = y;
    }
  }

  return state;
}

/** 保存対象のフィールドだけを取り出す。書き込み差分を小さく保つ。 */
function serializeWindowState(bounds, isMaximized) {
  const state = { isMaximized: isMaximized === true };
  if (isFiniteNumber(bounds?.width)) state.width = Math.round(bounds.width);
  if (isFiniteNumber(bounds?.height)) state.height = Math.round(bounds.height);
  if (isFiniteNumber(bounds?.x)) state.x = Math.round(bounds.x);
  if (isFiniteNumber(bounds?.y)) state.y = Math.round(bounds.y);
  return state;
}

function readWindowStateFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // 未作成・壊れたファイルは「保存なし」と同じ扱いにする。
    return null;
  }
}

function writeWindowStateFile(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 起動時に使う BrowserWindow の初期オプションを返す。
 * 最大化状態は BrowserWindow 生成後に `applyMaximized` で適用する。
 */
function loadWindowState(filePath, displays, defaults = DEFAULT_STATE) {
  const merged = { ...DEFAULT_STATE, ...defaults };
  const saved = readWindowStateFile(filePath);
  const sanitized = sanitizeWindowState(saved, displays, merged);
  return {
    ...sanitized,
    minWidth: merged.minWidth,
    minHeight: merged.minHeight,
  };
}

/**
 * ウィンドウの移動 / リサイズ / 最大化を監視して保存する。
 * リサイズ中に書き込みが走らないよう debounce し、閉じる直前に flush する。
 */
function trackWindowState(win, filePath, { debounceMs = 400, write = writeWindowStateFile } = {}) {
  let timer = null;
  let lastNormalBounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();

  function capture() {
    if (win.isDestroyed()) return null;
    // 最大化 / フルスクリーン中の bounds を保存すると、解除したときに
    // 画面いっぱいのサイズが「通常サイズ」として残ってしまう。
    if (!win.isMaximized() && !win.isFullScreen() && !win.isMinimized()) {
      lastNormalBounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    }
    return serializeWindowState(lastNormalBounds, win.isMaximized());
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const state = capture();
    if (state) write(filePath, state);
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const state = capture();
      if (state) write(filePath, state);
    }, debounceMs);
  }

  for (const event of ["resize", "move", "maximize", "unmaximize"]) {
    win.on(event, schedule);
  }
  win.on("close", flush);

  return { flush, schedule };
}

module.exports = {
  DEFAULT_STATE,
  loadWindowState,
  readWindowStateFile,
  sanitizeWindowState,
  serializeWindowState,
  trackWindowState,
  writeWindowStateFile,
};
