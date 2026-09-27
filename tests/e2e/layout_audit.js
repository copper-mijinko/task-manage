// 画面の見た目の崩れを DOM の実寸から見つける。
//
// 目で見て気づくたぐいの不整合（文字どうしの重なり、省略記号なしの
// 見切れ、押せるはずの部品が別の要素の下に隠れる、画面の外へのはみ出し）
// を、要素の矩形と重なり順から機械的に拾う。スクリーンショットの比較と
// 違い、テーマや文言が変わっても誤検知しにくい。
import { expect } from "@playwright/test";

/** ページ内で実行する本体。`root` の中だけを調べる。 */
function audit({ root: rootSelector, ignore }) {
  const root = rootSelector ? document.querySelector(rootSelector) : document.body;
  if (!root) return [`root not found: ${rootSelector}`];
  const issues = [];
  const ignored = (element) => ignore.some((selector) => element.closest(selector));
  const describe = (element) => {
    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
    const cls = typeof element.className === "string" ? element.className.split(" ")[0] : "";
    return `${element.tagName.toLowerCase()}${cls ? "." + cls : ""} "${label}"`;
  };
  const shown = (element) => {
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)
        return false;
    }
    return true;
  };
  // 背景色の不透明度。color-mix() は `color(srgb r g b / a)` で返るので、
  // rgba() だけ見ていると半透明のチップを不透明と誤る。
  const alpha = (color) => {
    if (!color || color === "transparent") return 0;
    const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)/);
    if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
    const rgba = color.match(/rgba\(([^)]+)\)/);
    if (rgba) return Number(rgba[1].split(",")[3] ?? 1);
    return 1;
  };
  /** 指定した点で、`element` がそれより上の不透明な要素に隠されているか。 */
  const occludedAt = (element, x, y) => {
    for (const top of document.elementsFromPoint(x, y)) {
      if (top === element || element.contains(top) || top.contains(element)) return false;
      const style = getComputedStyle(top);
      if (
        alpha(style.backgroundColor) >= 0.9 ||
        style.backgroundImage !== "none" ||
        top.tagName === "IMG" ||
        top.tagName === "CANVAS"
      )
        return true;
    }
    return false;
  };
  /** スクロールや overflow で切り取られた後に、実際に見えている矩形。 */
  const visibleRect = (element, rect, { self = false } = {}) => {
    let { left, top, right, bottom } = rect;
    // 文字は自分の要素の overflow でも切られる（チップの中の文字など）。
    for (let node = self ? element : element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        const box = node.getBoundingClientRect();
        left = Math.max(left, box.left);
        top = Math.max(top, box.top);
        right = Math.min(right, box.right);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, innerWidth);
    bottom = Math.min(bottom, innerHeight);
    return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : null;
  };

  /**
   * `element` を含む浮いた層（固定配置、または z-index を持つ絶対配置）の
   * うち、`control` を含まないもの。そこに覆われるのはメニューやダイアログを
   * 開いている間だけで、崩れではない。
   */
  const floatingLayer = (element, control) => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (node.contains(control)) return null;
      const style = getComputedStyle(node);
      if (
        style.position === "fixed" ||
        // スクロールしても残る見出し（表の列見出し・経路表示）の下へ行が
        // 潜るのは、スクロールの途中の姿。
        style.position === "sticky" ||
        (style.position === "absolute" && style.zIndex !== "auto" && Number(style.zIndex) > 0)
      )
        return node;
    }
    return null;
  };

  // 文字の断片（テキストノードごとの行矩形）。
  const texts = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const element = node.parentElement;
    if (!element || ignored(element) || !shown(element)) continue;
    if (element.closest("svg, style, script, template, [aria-hidden='true'] .sr-only")) continue;
    const style = getComputedStyle(element);
    if (style.position === "absolute" && style.clip !== "auto") continue; // 読み上げ専用
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width < 2 || rect.height < 2) continue;
      const seen = visibleRect(element, rect, { self: true });
      if (seen) texts.push({ element, rect, seen });
    }
  }

  // 1. 文字どうしが重なって見える。
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i];
      const b = texts[j];
      if (a.element === b.element) continue;
      const left = Math.max(a.seen.left, b.seen.left);
      const right = Math.min(a.seen.right, b.seen.right);
      const top = Math.max(a.seen.top, b.seen.top);
      const bottom = Math.min(a.seen.bottom, b.seen.bottom);
      if (right - left < 3 || bottom - top < 3) continue;
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      // どちらかが上の不透明な要素に隠れていれば、重なりは見えない。
      if (occludedAt(a.element, x, y) || occludedAt(b.element, x, y)) continue;
      issues.push(`文字の重なり: ${describe(a.element)} と ${describe(b.element)}`);
    }
  }

  // 2. 省略記号なしで文字が切れている（overflow: hidden の箱からはみ出す）。
  for (const { element, rect } of texts) {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      const hidesX = style.overflowX === "hidden" || style.overflowX === "clip";
      const hidesY = style.overflowY === "hidden" || style.overflowY === "clip";
      if (!hidesX && !hidesY) {
        if (style.overflowX !== "visible" || style.overflowY !== "visible") break; // スクロール領域
        continue;
      }
      const box = node.getBoundingClientRect();
      const ellipsis =
        getComputedStyle(element).textOverflow === "ellipsis" ||
        style.textOverflow === "ellipsis" ||
        style.webkitLineClamp !== "none";
      const cutX = hidesX && (rect.right > box.right + 1 || rect.left < box.left - 1);
      const cutY =
        hidesY &&
        (rect.bottom > box.bottom + 2 || rect.top < box.top - 2) &&
        // 縦に丸ごと隠れている行（折りたたみ・仮想スクロール）は見切れではない。
        rect.top < box.bottom &&
        rect.bottom > box.top;
      if ((cutX && !ellipsis) || cutY) {
        issues.push(`見切れ: ${describe(element)} が ${describe(node)} からはみ出す`);
      }
      break;
    }
  }

  // 2b. 短い名前（状態・日付・見出し・ボタンの文字など）が省略記号で縮められている。
  // 長いノード名が「…」になるのは想定どおりだが、10 文字以下の名前が
  // 既定の幅で読めないのは列や部品の幅が足りていない。
  const truncated = new Set();
  for (const { element } of texts) {
    for (let node = element; node && node !== root.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.textOverflow !== "ellipsis" || style.overflowX === "visible") continue;
      const full = (node.textContent || "").trim();
      if (node.scrollWidth > node.clientWidth + 1 && full.length > 0 && full.length <= 10)
        truncated.add(node);
      break;
    }
  }
  for (const node of truncated) issues.push(`短い名前の省略: ${describe(node)}`);

  // 3. 押せる部品が別の要素の下に隠れている。
  const controls = root.querySelectorAll(
    "button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [role='checkbox'], [role='menuitem'], [role='option'], [role='tab']"
  );
  for (const control of controls) {
    if (ignored(control) || !shown(control) || control.disabled) continue;
    const rect = control.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const seen = visibleRect(control, rect);
    if (!seen) continue;
    // 見えている部分が元の半分未満なら、スクロールの途中なので調べない。
    if ((seen.right - seen.left) * (seen.bottom - seen.top) < (rect.width * rect.height) / 2)
      continue;
    const x = (seen.left + seen.right) / 2;
    const y = (seen.top + seen.bottom) / 2;
    // 画面全体を覆う背景（ダイアログの外側を押すと閉じる）は、上にダイアログが載る。
    if (rect.width * rect.height > innerWidth * innerHeight * 0.8) continue;
    const top = document.elementFromPoint(x, y);
    if (!top || top === control || control.contains(top) || top.contains(control)) continue;
    const label = top.closest("label");
    if (label && label.contains(control)) continue;
    if (top.closest("label")?.htmlFor === control.id) continue;
    // 開いたメニュー・ダイアログ・浮いたパネルが上に来るのは意図どおり。
    if (floatingLayer(top, control)) continue;
    issues.push(`隠れた操作: ${describe(control)} の上に ${describe(top)}`);
  }

  // 4. 画面の外へのはみ出し（横スクロールが出る、浮いた部品が画面外）。
  if (document.documentElement.scrollWidth > innerWidth + 1)
    issues.push(`横にはみ出し: ページ幅 ${document.documentElement.scrollWidth} > ${innerWidth}`);
  for (const popup of root.querySelectorAll(
    "[role='menu'], [role='listbox'], [role='dialog'], [role='tooltip']"
  )) {
    if (!shown(popup) || ignored(popup)) continue;
    const rect = popup.getBoundingClientRect();
    if (rect.width < 2) continue;
    if (
      rect.left < -1 ||
      rect.top < -1 ||
      rect.right > innerWidth + 1 ||
      rect.bottom > innerHeight + 1
    )
      issues.push(
        `画面外: ${describe(popup)} (${Math.round(rect.left)},${Math.round(rect.top)})-(${Math.round(rect.right)},${Math.round(rect.bottom)})`
      );
  }
  return [...new Set(issues)];
}

/** 崩れの一覧を返す。 */
export function auditLayout(page, { root = "", ignore = [] } = {}) {
  return page.evaluate(audit, { root, ignore });
}

/**
 * スクロールできる領域を上から順に送りながら調べる。画面に見えている範囲
 * しか調べられないので、詳細ペインの下のほうなどを取りこぼさないため。
 * 大きい領域（仮想スクロールの一覧）は `maxSteps` 画面ぶんで打ち切る。
 */
export async function auditLayoutScrolled(page, options = {}, { maxSteps = 4 } = {}) {
  const settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 150)))
    );
  const found = new Set(await auditLayout(page, options));
  const count = await page.evaluate((rootSelector) => {
    const root = rootSelector ? document.querySelector(rootSelector) : document.body;
    const scrollers = [...(root?.querySelectorAll("*") ?? [])].filter((element) => {
      const style = getComputedStyle(element);
      return (
        /(auto|scroll)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 4 &&
        element.clientHeight > 80
      );
    });
    scrollers.forEach((element, index) => (element.dataset.auditScroll = String(index)));
    return scrollers.length;
  }, options.root ?? "");
  for (let index = 0; index < count; index += 1) {
    for (let step = 1; step <= maxSteps; step += 1) {
      const more = await page.evaluate(
        ([id, n]) => {
          const element = document.querySelector(`[data-audit-scroll="${id}"]`);
          if (!element) return false;
          const target = Math.round(element.clientHeight * 0.9 * n);
          if (target >= element.scrollHeight - element.clientHeight + element.clientHeight * 0.9)
            return false;
          element.scrollTop = target;
          return true;
        },
        [index, step]
      );
      if (!more) break;
      await settle();
      for (const issue of await auditLayout(page, options)) found.add(issue);
    }
    await page.evaluate((id) => {
      const element = document.querySelector(`[data-audit-scroll="${id}"]`);
      if (element) element.scrollTop = 0;
    }, index);
  }
  await page.evaluate(() =>
    document.querySelectorAll("[data-audit-scroll]").forEach((element) => {
      delete element.dataset.auditScroll;
    })
  );
  return [...found];
}

/** 崩れが無いことを確かめる。`label` は失敗時にどの画面かを示す。 */
export async function expectCleanLayout(page, label, options = {}) {
  // アニメーションの途中を拾わないよう、落ち着くのを待つ。
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 250)))
  );
  const issues = await auditLayout(page, options);
  expect(issues, `layout issues in: ${label}`).toEqual([]);
}
