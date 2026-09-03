import { describe, expect, it } from "vitest";
import { THEME_DARK, THEME_LIGHT } from "../../src/lib/utils/theme";

/**
 * 配色のコントラスト回帰テスト。
 *
 * 「文字に載せる色」と「アクセント色」を混同すると、12px の文字が読めなく
 * なる。実際、ステータスラベル・期限日・予定ビューの期限切れ表示はいずれも
 * アクセント色をそのまま文字色に使っていて、ライトテーマでは 2.96:1 まで
 * 落ちていた（WCAG AA は 4.5:1）。
 *
 * `*-text` トークンはその修正で足したもので、見た目の微調整のつもりで
 * `main` に戻されると同じ問題が再発する。ここで下限を固定しておく。
 */

const WCAG_AA_NORMAL_TEXT = 4.5;

function toRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const channel = (raw: number) => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 前景を背景に `ratio` の割合で重ねた結果（color-mix 相当）。 */
function blend(foreground: string, background: string, ratio: number): string {
  const fg = toRgb(foreground);
  const bg = toRgb(background);
  const channel = (i: number) => Math.round(fg[i] * ratio + bg[i] * (1 - ratio));
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

describe("theme contrast", () => {
  for (const [themeName, theme] of [
    ["dark", THEME_DARK],
    ["light", THEME_LIGHT],
  ] as const) {
    describe(themeName, () => {
      const c = theme.color;
      // トークンごとに「実際に載る背景」だけを見る。総当たりにすると
      // Primary の文字が期限切れバッジに載る、といった存在しない組み合わせ
      // まで縛ってしまう。行の淡い着色（アクセント 10%）と予定ビューの
      // バッジ（22%）は、素の背景と同じだけ厳しいので含める。
      const row = c.Main.light;
      const panel = c.Main.main;
      const overdueTint = blend(c.Error.main, row, 0.1);
      const dueSoonTint = blend(c.Warning.main, row, 0.1);
      const overdueBadge = blend(c.Error.main, panel, 0.22);

      const usage: Record<string, { color: string; backgrounds: Record<string, string> }> = {
        // 期限切れ: ツリーの行（淡い着色込み）、詳細ペイン、予定ビューのバッジ
        "Error.text": {
          color: c.Error.text,
          backgrounds: { row, panel, overdueTint, dueSoonTint, overdueBadge },
        },
        // 期限間近 / 当日: ツリーの行と詳細ペイン
        "Warning.text": {
          color: c.Warning.text,
          backgrounds: { row, panel, overdueTint, dueSoonTint },
        },
        // リンク風ボタンなど、淡い背景の上のプライマリ文字
        "Primary.text": {
          color: c.Primary.text,
          backgrounds: { row, panel },
        },
      };

      for (const [name, { color, backgrounds }] of Object.entries(usage)) {
        it(`${name} is defined`, () => {
          expect(color).toMatch(/^#[0-9a-f]{6}$/i);
        });

        for (const [bgName, bg] of Object.entries(backgrounds)) {
          it(`${name} meets AA on ${bgName}`, () => {
            expect(contrastRatio(color, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
          });
        }
      }

      it("Primary.text also carries Main-light text when used as a fill", () => {
        // SegmentedControl の選択中セグメントは Primary.text の塗りの上に
        // Main.light の文字を置く。
        expect(contrastRatio(c.Primary.text, c.Main.light)).toBeGreaterThanOrEqual(
          WCAG_AA_NORMAL_TEXT
        );
      });

      it("body text meets AA on the row and panel backgrounds", () => {
        expect(contrastRatio(c.Sub.main, c.Main.light)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
        expect(contrastRatio(c.Sub.main, c.Main.main)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      });
    });
  }
});
