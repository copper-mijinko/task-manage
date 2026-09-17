/**
 * 列幅はユーザーの手で決まる値なので保存する。キーに版を持たせているのは、
 * Tree Grid の既定配分を変えたとき（Name を主役にする再設計）に、古い保存値が
 * 残っていると新しい配分が一度も見えないため。版が上がったら旧キーは捨てて、
 * 新しい既定から始め直す（列幅はいつでもドラッグでやり直せる）。
 */
const KEY = "task-manage:treegrid-column-widths.v2";
const LEGACY_KEYS = ["task-manage:treegrid-column-widths"];

function dropLegacyWidths() {
  for (const legacyKey of LEGACY_KEYS) {
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      // ignore
    }
  }
}

export function readColumnWidths() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      dropLegacyWidths();
      return {};
    }
    const saved = JSON.parse(raw || "{}");
    return Object.fromEntries(
      Object.entries(saved).filter(
        ([, width]) => Number.isFinite(width) && width >= 32 && width <= 4000
      )
    );
  } catch {
    return {};
  }
}
export function saveColumnWidths(widths) {
  localStorage.setItem(KEY, JSON.stringify({ ...readColumnWidths(), ...widths }));
}
