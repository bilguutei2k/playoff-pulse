import { describe, expect, it } from "vitest";
import { createFilterState, toRatingState } from "@/lib/season/ratings";
import { LIVE_PARAMS } from "@/lib/season/params";
import type { SeasonGame } from "@/lib/season/types";
import { formatDiff, liveClock, marginText, splitPercents, statusLabel } from "@/lib/view/card";
import { marginBreakdown } from "@/lib/view/margin";
import { projectGame } from "@/lib/view/projection";
import { calibrationBins, gameBrier } from "@/lib/view/record";
import { ordinal, recordsThrough } from "@/lib/view/teams";

const ratings = toRatingState(createFilterState(LIVE_PARAMS));
const state = { ratings, params: LIVE_PARAMS, ratingsHash: "x" };

describe("card wording", () => {
  it("splits whole percents that always add to 100", () => {
    for (const p of [0.001, 0.495, 0.5, 0.505, 0.644, 0.999]) {
      const { home, away } = splitPercents(p);
      expect(home + away).toBe(100);
    }
  });
  it("signs the model-minus-market difference with a true minus", () => {
    expect(formatDiff(64, 61)).toBe("+3");
    expect(formatDiff(61, 64)).toBe("−3");
    expect(formatDiff(50, 50)).toBe("0");
  });
  it("names the favorite and the margin", () => {
    expect(marginText(4.53, "2", "10")).toBe("548 favors BOS by 4.5");
    expect(marginText(-2, "2", "10")).toBe("548 favors HOU by 2.0");
    expect(marginText(0.01, "2", "10")).toBe("548 has it even");
  });
  it("reads ESPN's clock and final details", () => {
    expect(liveClock("9:56 - 3rd")).toBe("3rd 9:56");
    expect(statusLabel({ status: "final", statusDetail: "Final/OT" }).label).toBe("Final/OT");
    expect(statusLabel({ status: "final", statusDetail: "Final" }).label).toBe("Final");
    expect(statusLabel({ status: "in-progress", statusDetail: "Halftime" })).toEqual({ label: "Live · Halftime", live: true });
  });
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd",
    ]);
  });
});

describe("margin breakdown", () => {
  const context = { homeId: "2", awayId: "10", neutral: false, playoff: false, homeOnBackToBack: true, awayOnBackToBack: false };
  it("adds up to the forecast's own margin, to the tenth shown", () => {
    const projection = projectGame(state, { homeId: "2", awayId: "10", neutral: false, kind: "regular", etDate: "2027-01-10" }, { "2": ["2027-01-09"] });
    const absences = { home: 2.34, away: 0.41 };
    const total = projection.expectedMargin - (absences.home - absences.away);
    const result = marginBreakdown({ state, context, expectedMargin: total, absencePoints: absences, ratingsHash: "x" });
    expect(result.separated).toBe(true);
    const shown = result.parts.reduce((sum, part) => sum + part.display, 0);
    expect(shown).toBeCloseTo(Math.round(total * 10) / 10, 9);
    expect(result.parts.map((part) => part.key)).toEqual(["rating", "home", "rest", "absences"]);
  });
  it("joins rating and home court when the seal used other ratings", () => {
    const result = marginBreakdown({ state, context, expectedMargin: 3.3, absencePoints: null, ratingsHash: "other" });
    expect(result.separated).toBe(false);
    expect(result.parts[0].key).toBe("strength");
    expect(result.parts.reduce((sum, part) => sum + part.display, 0)).toBeCloseTo(3.3, 9);
  });
});

describe("projections", () => {
  it("mirror on a neutral court and pair with their complement", () => {
    const a = projectGame(state, { homeId: "2", awayId: "10", neutral: true, kind: "regular", etDate: "2027-01-10" }, {});
    const b = projectGame(state, { homeId: "10", awayId: "2", neutral: true, kind: "regular", etDate: "2027-01-10" }, {});
    expect(a.homeWinProbability + a.awayWinProbability).toBe(1);
    expect(a.homeWinProbability + b.homeWinProbability).toBeCloseTo(1, 12);
  });
});

describe("record helpers", () => {
  it("scores one game and bins calibration", () => {
    expect(gameBrier(0.7, true)).toBeCloseTo(0.09, 12);
    expect(gameBrier(0.7, false)).toBeCloseTo(0.49, 12);
    const seal = (p: number) => ({ homeWinProbability: p }) as never;
    const bins = calibrationBins([
      { seal: seal(0.62), homeWon: true, brier: 0, noFinalSeal: false, result: {} as never },
      { seal: seal(0.68), homeWon: false, brier: 0, noFinalSeal: false, result: {} as never },
    ]);
    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ count: 2, observed: 0.5 });
    expect(bins[0].forecast).toBeCloseTo(0.65, 12);
  });
  it("counts records through a date, that date included", () => {
    const game = (etDate: string, home: number, away: number): SeasonGame => ({
      id: etDate, season: 2027, kind: "regular", tipUtc: `${etDate}T23:00Z`, etDate,
      homeId: "2", awayId: "10", neutral: false, status: "final", homeScore: home, awayScore: away,
    });
    const lines = recordsThrough([game("2026-10-20", 100, 90), game("2026-10-22", 90, 100), game("2026-10-24", 99, 98)], "2026-10-22");
    expect(lines["2"]).toMatchObject({ wins: 1, losses: 1 });
    expect(lines["10"]).toMatchObject({ wins: 1, losses: 1 });
  });
});
