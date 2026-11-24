import { describe, expect, it } from "vitest";
import { earlierGameDays } from "@/lib/view/day-summary";

describe("the home page's last game day", () => {
  it("lists earlier game days, latest first, skipping days without games and today", () => {
    const counts = { "2026-11-19": 8, "2026-11-20": 9, "2026-11-21": 0, "2026-11-22": 7, "2026-11-23": 10, "2026-11-24": 3 };
    expect(earlierGameDays(counts, "2026-11-23", 3)).toEqual(["2026-11-22", "2026-11-20", "2026-11-19"]);
    expect(earlierGameDays(counts, "2026-11-23", 1)).toEqual(["2026-11-22"]);
    expect(earlierGameDays(counts, "2026-11-19", 3)).toEqual([]);
  });
});
