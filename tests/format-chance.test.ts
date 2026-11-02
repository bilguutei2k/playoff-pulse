import { describe, expect, it } from "vitest";
import { formatChance, formatPercent, formatPointChange } from "@/lib/utils/format";

describe("live probability formatting", () => {
  it("rounds to whole percents", () => {
    expect(formatChance(0.351407)).toBe("35%");
    expect(formatChance(0.5)).toBe("50%");
    expect(formatChance(0.688191)).toBe("69%");
  });

  it("never shows a simulated long shot as impossible or certain", () => {
    expect(formatChance(0)).toBe("<1%");
    expect(formatChance(0.0001)).toBe("<1%");
    expect(formatChance(0.0049)).toBe("<1%");
    expect(formatChance(0.005)).toBe("1%");
    expect(formatChance(0.994)).toBe("99%");
    expect(formatChance(0.995)).toBe(">99%");
    expect(formatChance(1)).toBe(">99%");
  });

  it("shows settled outcomes exactly when asked", () => {
    expect(formatChance(0, { exact: true })).toBe("0%");
    expect(formatChance(1, { exact: true })).toBe("100%");
    expect(formatChance(0.001, { exact: true })).toBe("<1%");
  });

  it("clamps out-of-range input", () => {
    expect(formatChance(-0.2)).toBe("<1%");
    expect(formatChance(1.3)).toBe(">99%");
  });

  it("leaves the archive formatter unchanged", () => {
    expect(formatPercent(0.351407)).toBe("35.1%");
  });

  it("formats changes as signed percentage points", () => {
    expect(formatPointChange(0.0143)).toBe("+1.4");
    expect(formatPointChange(-0.0062)).toBe("−0.6");
    expect(formatPointChange(0.0004)).toBe("0.0");
  });
});
