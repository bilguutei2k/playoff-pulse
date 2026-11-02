import { describe, expect, it } from "vitest";
import { impliedHomeProbability } from "@/lib/season/market";
import type { MarketReference } from "@/lib/season/types";

function market(homeMoneyline: number | null, awayMoneyline: number | null): MarketReference {
  return { provider: "DraftKings", homeMoneyline, awayMoneyline, homeSpread: null };
}

describe("market reference", () => {
  it("removes the vig from a favorite and an underdog", () => {
    // -166 implies 0.6241 and +140 implies 0.4167, so the normalized home share is 0.5996.
    const home = impliedHomeProbability(market(-166, 140));
    expect(home).toBeCloseTo(0.62406 / (0.62406 + 0.41667), 4);
    expect(home).toBeCloseTo(0.5996, 4);
  });

  it("gives the away favorite the larger share", () => {
    const home = impliedHomeProbability(market(210, -258));
    expect(home).not.toBeNull();
    expect(home!).toBeLessThan(0.5);
    // 100/310 = 0.3226 and 258/358 = 0.7207, normalized home = 0.3092.
    expect(home).toBeCloseTo(0.32258 / (0.32258 + 0.72067), 4);
  });

  it("returns an even split for a pick'em priced on both sides", () => {
    expect(impliedHomeProbability(market(-110, -110))).toBeCloseTo(0.5, 10);
    expect(impliedHomeProbability(market(100, 100))).toBeCloseTo(0.5, 10);
  });

  it("sums to 1 across both sides", () => {
    const home = impliedHomeProbability(market(-300, 240))!;
    const away = impliedHomeProbability(market(240, -300))!;
    expect(home + away).toBeCloseTo(1, 10);
  });

  it("returns null when either line is missing or invalid", () => {
    expect(impliedHomeProbability(market(null, 140))).toBeNull();
    expect(impliedHomeProbability(market(-166, null))).toBeNull();
    expect(impliedHomeProbability(market(null, null))).toBeNull();
    expect(impliedHomeProbability(market(50, -120))).toBeNull();
    expect(impliedHomeProbability(market(Number.NaN, -120))).toBeNull();
  });

  it("stays within 0 and 1 for extreme lines", () => {
    const home = impliedHomeProbability(market(-100000, 5000))!;
    expect(home).toBeGreaterThan(0.97);
    expect(home).toBeLessThanOrEqual(1);
  });
});
