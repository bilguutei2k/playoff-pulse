// The day sentence and finals chart: wins and expected wins over the same games, and an
// even seal with no favorite (VA-9); the biggest miss linked to its game (NAV-29).

import { describe, expect, it } from "vitest";
import type { DayGame } from "@/lib/view/day";
import { daySummary, finalRow } from "@/lib/view/day-summary";

let nextId = 1;

/** A final with a sealed home win probability. Only the fields the summary reads. */
function final(homeId: string, awayId: string, homeWinProbability: number | null, homeScore: number, awayScore: number): DayGame {
  const id = String(nextId++);
  return {
    id,
    tipUtc: `2026-11-09T${String(nextId).padStart(2, "0")}:00:00Z`,
    etDate: "2026-11-09",
    homeId,
    awayId,
    neutral: false,
    status: "final",
    statusDetail: "Final",
    homeScore,
    awayScore,
    forecast: homeWinProbability === null ? null : { source: "sealed", homeWinProbability },
  } as unknown as DayGame;
}

const SAC = "23";
const DEN = "7";
const ATL = "1";
const BOS = "2";

describe("daySummary", () => {
  it("counts favorites won and expected wins over the same games, leaving an even seal out of both", () => {
    const games = [
      final(DEN, SAC, 0.72, 100, 110), // DEN favored, lost
      final(BOS, ATL, 0.6, 120, 100), // BOS favored, won
      final(ATL, BOS, 0.501, 101, 99), // 50-50 in whole percents: even
    ];
    const summary = daySummary(games);
    expect(summary.scored).toHaveLength(3);
    expect(summary.decided).toBe(2);
    expect(summary.even).toBe(1);
    expect(summary.favoritesWon).toBe(1);
    expect(summary.expected).toBeCloseTo(0.72 + 0.6, 10);
    expect(summary.sentence).toBe(
      "Favorites won 1 of 2. The biggest miss was Sacramento's win in Denver, where 548 gave the Nuggets 72%.",
    );
  });

  it("gives an even seal no favorite and no upset", () => {
    const row = finalRow(final(ATL, BOS, 0.5, 90, 95))!;
    expect(row.even).toBe(true);
    expect(row.favorite).toBeNull();
    expect(row.upset).toBeNull();
    expect(row.percents).toEqual({ home: 50, away: 50 });
    expect(row.brier).toBeCloseTo(0.25, 10);
  });

  it("links the biggest miss to its game and the favorite to its team", () => {
    const miss = final(DEN, SAC, 0.8, 100, 110);
    const parts = daySummary([miss, final(BOS, ATL, 0.7, 100, 110)]).sentenceParts!;
    const linked = parts.filter((part) => part.href);
    expect(linked).toEqual([
      { text: "Sacramento's win in Denver", href: `/game/${miss.id}` },
      { text: "Nuggets", href: "/teams/den" },
    ]);
  });

  it("writes no sentence when every final is even or unsealed", () => {
    const summary = daySummary([final(ATL, BOS, 0.5, 90, 95), final(DEN, SAC, null, 100, 90)]);
    expect(summary.scored).toHaveLength(1);
    expect(summary.decided).toBe(0);
    expect(summary.expected).toBe(0);
    expect(summary.sentence).toBeNull();
    expect(summary.sentenceParts).toBeNull();
  });

  it("says every favorite won without a miss clause", () => {
    const summary = daySummary([final(DEN, SAC, 0.7, 110, 100), final(BOS, ATL, 0.3, 100, 110), final(SAC, DEN, 0.6, 99, 90)]);
    expect(summary.sentence).toBe("All 3 favorites won.");
    expect(summary.favoritesWon).toBe(3);
  });
});
