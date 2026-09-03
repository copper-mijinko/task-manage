import { describe, expect, it } from "vitest";
import {
  daysBetweenIsoDates,
  dueDateUrgency,
  dueDateUrgencyLabel,
  isSettledStatus,
  todayIso,
} from "../../src/lib/utils/date_urgency";

const TODAY = "2026-09-03";

describe("todayIso", () => {
  it("ローカルの暦日を返す（深夜でも翌日にならない）", () => {
    expect(todayIso(new Date(2026, 8, 3, 23, 30))).toBe("2026-09-03");
    expect(todayIso(new Date(2026, 8, 3, 0, 5))).toBe("2026-09-03");
  });
});

describe("daysBetweenIsoDates", () => {
  it("暦日の差を返す", () => {
    expect(daysBetweenIsoDates(TODAY, "2026-09-10")).toBe(7);
    expect(daysBetweenIsoDates(TODAY, "2026-09-01")).toBe(-2);
    expect(daysBetweenIsoDates(TODAY, TODAY)).toBe(0);
  });

  it("夏時間の切り替えをまたいでも整数日になる", () => {
    expect(daysBetweenIsoDates("2026-03-07", "2026-03-09")).toBe(2);
  });

  it("日付として読めなければ null", () => {
    expect(daysBetweenIsoDates(TODAY, "")).toBeNull();
    expect(daysBetweenIsoDates(TODAY, "not-a-date")).toBeNull();
  });
});

describe("isSettledStatus", () => {
  it("完了と中止だけを終了扱いにする", () => {
    expect(isSettledStatus("Completed")).toBe(true);
    expect(isSettledStatus("Canceled")).toBe(true);
    expect(isSettledStatus("In Progress")).toBe(false);
    expect(isSettledStatus(undefined)).toBe(false);
  });
});

describe("dueDateUrgency", () => {
  it("過ぎた期限は overdue", () => {
    expect(dueDateUrgency("2026-09-02", "Open", TODAY)).toBe("overdue");
  });

  it("当日は today（期限切れとは区別する）", () => {
    expect(dueDateUrgency(TODAY, "Open", TODAY)).toBe("today");
  });

  it("5 日未満先は due-soon、それ以降は none", () => {
    expect(dueDateUrgency("2026-09-07", "Open", TODAY)).toBe("due-soon");
    expect(dueDateUrgency("2026-09-08", "Open", TODAY)).toBe("none");
    expect(dueDateUrgency("2026-10-01", "Open", TODAY)).toBe("none");
  });

  it("完了 / 中止のタスクは急かさない", () => {
    expect(dueDateUrgency("2026-08-31", "Completed", TODAY)).toBe("none");
    expect(dueDateUrgency("2026-08-31", "Canceled", TODAY)).toBe("none");
    expect(dueDateUrgency("2026-08-31", "Open", TODAY)).toBe("overdue");
  });

  it("期限がなければ none", () => {
    expect(dueDateUrgency("", "Open", TODAY)).toBe("none");
    expect(dueDateUrgency(undefined, "Open", TODAY)).toBe("none");
  });

  it("暦日で判定するので時刻や時差でぶれない", () => {
    // ローカル 23:00 でも「明日が期限」は today にならない。
    const lateToday = todayIso(new Date(2026, 8, 3, 23, 59));
    expect(dueDateUrgency("2026-09-04", "Open", lateToday)).toBe("due-soon");
    // 逆に日付が変わった直後の「昨日が期限」はすぐ overdue になる。
    const justAfterMidnight = todayIso(new Date(2026, 8, 4, 0, 1));
    expect(dueDateUrgency("2026-09-03", "Open", justAfterMidnight)).toBe("overdue");
  });
});

describe("dueDateUrgencyLabel", () => {
  it("超過日数と残り日数を添える", () => {
    expect(dueDateUrgencyLabel("2026-09-01", "Open", TODAY)).toBe(
      "期限切れ: 2026-09-01（2日超過）"
    );
    expect(dueDateUrgencyLabel(TODAY, "Open", TODAY)).toBe("今日が期限: 2026-09-03");
    expect(dueDateUrgencyLabel("2026-09-06", "Open", TODAY)).toBe(
      "期限間近: 2026-09-06（あと3日）"
    );
  });

  it("状態がなければ undefined（ツールチップを出さない）", () => {
    expect(dueDateUrgencyLabel("2026-10-01", "Open", TODAY)).toBeUndefined();
    expect(dueDateUrgencyLabel("2026-09-01", "Completed", TODAY)).toBeUndefined();
    expect(dueDateUrgencyLabel("", "Open", TODAY)).toBeUndefined();
  });
});
