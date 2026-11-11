import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDateTime, formatDateTimeEt, formatStampEt } from "@/lib/utils/dates";

describe("date-and-time stamps", () => {
  afterEach(() => vi.restoreAllMocks());

  it("joins the date and the time with a comma", () => {
    expect(formatStampEt("2026-11-11T04:50:00Z")).toBe("Nov 10, 11:50 PM EST");
    expect(formatStampEt("2026-10-21T13:05:00Z")).toBe("Oct 21, 9:05 AM EDT");
    expect(formatDateTimeEt("2026-11-02T14:12:00Z")).toBe("Nov 2, 9:12 AM ET");
    expect(formatDateTime("2026-11-02T14:12:00Z", false)).toBe("Nov 2, 9:12 AM EST");
  });

  it("prints the same text where the engine's own pattern says 'at' (Safari)", () => {
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (this: Intl.DateTimeFormat, date) {
      return original.call(this, date).map((p) => (p.type === "literal" && p.value === ", " ? { ...p, value: " at " } : p));
    });
    expect(formatStampEt("2026-11-11T04:50:00Z")).toBe("Nov 10, 11:50 PM EST");
    expect(formatDateTimeEt("2026-11-02T14:12:00Z")).toBe("Nov 2, 9:12 AM ET");
  });
});
