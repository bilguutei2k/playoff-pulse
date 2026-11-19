import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatDateTimePt,
  formatReportTime,
  formatTimePt,
  pacificZoneOfAll,
  pacificZoneOfDay,
  reportInstant,
} from "@/lib/utils/dates";

describe("date-and-time stamps", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints Pacific time with its own label, the date and time joined with a comma", () => {
    expect(formatDateTimePt("2026-11-11T04:50:00Z")).toBe("Nov 10, 8:50 PM PST");
    expect(formatDateTimePt("2026-10-21T13:05:00Z")).toBe("Oct 21, 6:05 AM PDT");
    expect(formatDateTimePt("2026-11-02T14:12:00Z")).toBe("Nov 2, 6:12 AM PST");
    expect(formatTimePt("2026-11-19T00:30:00Z")).toBe("4:30 PM PST");
    expect(formatTimePt("2027-04-11T02:00:00Z")).toBe("7:00 PM PDT");
  });

  it("prints the same text where the engine's own pattern says 'at' (Safari)", () => {
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (this: Intl.DateTimeFormat, date) {
      return original.call(this, date).map((p) => (p.type === "literal" && p.value === ", " ? { ...p, value: " at " } : p));
    });
    expect(formatDateTimePt("2026-11-11T04:50:00Z")).toBe("Nov 10, 8:50 PM PST");
    expect(formatDateTimePt("2026-11-02T14:12:00Z")).toBe("Nov 2, 6:12 AM PST");
  });

  it("labels a day's tips by the zone in force that day, and a mixed set as PT", () => {
    expect(pacificZoneOfDay("2027-03-13")).toBe("PST");
    expect(pacificZoneOfDay("2027-03-14")).toBe("PDT");
    expect(pacificZoneOfDay("2026-11-01")).toBe("PST");
    expect(pacificZoneOfAll(["2026-11-19T00:30:00Z", "2026-11-20T03:00:00Z"])).toBe("PST");
    expect(pacificZoneOfAll(["2027-03-13T03:00:00Z", "2027-03-15T02:00:00Z"])).toBe("PT");
  });
});

describe("injury report stamps", () => {
  it("reads the NBA's Eastern wall clock as an instant", () => {
    expect(reportInstant("2026-11-02T18:30")).toBe("2026-11-02T23:30:00.000Z");
    expect(reportInstant("2026-10-21T17:30")).toBe("2026-10-21T21:30:00.000Z");
    // The repeated hour when clocks fall back is read as standard time.
    expect(reportInstant("2026-11-01T01:30")).toBe("2026-11-01T06:30:00.000Z");
    expect(() => reportInstant("not a time")).toThrow();
  });

  it("prints a report in Pacific time, dated when its Pacific day is not the slate's", () => {
    expect(formatReportTime("2026-11-02T18:30", "2026-11-02")).toBe("3:30 PM PST");
    expect(formatReportTime("2026-11-01T17:30", "2026-11-02")).toBe("Nov 1, 2:30 PM PST");
    // The overnight report lands on the evening before in Pacific time.
    expect(formatReportTime("2026-11-04T01:30", "2026-11-04")).toBe("Nov 3, 10:30 PM PST");
    expect(formatReportTime("2026-11-01T00:15")).toBe("9:15 PM PDT");
  });
});
