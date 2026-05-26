import { describe, expect, it } from "vitest";
import { formatDate, formatTime } from "../../src/lib/utils/datetime_shortcuts";

describe("datetime shortcut formatters", () => {
  const sample = new Date(2026, 4, 6, 9, 4); // 2026-05-06 09:04 (local)

  describe("formatDate", () => {
    it("zero-pads month and day for slash format", () => {
      expect(formatDate(sample, "slash")).toBe("2026/05/06");
    });

    it("uses hyphens for iso format", () => {
      expect(formatDate(sample, "iso")).toBe("2026-05-06");
    });

    it("omits leading zeros on month/day for japanese format", () => {
      expect(formatDate(sample, "japanese")).toBe("2026年5月6日");
    });
  });

  describe("formatTime", () => {
    it("zero-pads hour and minute for slash format", () => {
      expect(formatTime(sample, "slash")).toBe("09:04");
    });

    it("uses HH:MM for iso format too", () => {
      expect(formatTime(sample, "iso")).toBe("09:04");
    });

    it("omits leading hour zero but keeps minute padding for japanese format", () => {
      expect(formatTime(sample, "japanese")).toBe("9時04分");
    });
  });
});
