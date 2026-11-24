// The team page's next-game absence tile and the note on why it differs from the season
// odds' current absences (src/lib/view/team-page.ts).
import { describe, expect, it } from "vitest";
import type { GameProjection } from "@/lib/season/projections";
import type { PublishedAbsence } from "@/lib/season/types";
import { absenceGap, nextGameAbsence } from "@/lib/view/team-page";

const absence = (athleteId: string, name: string, points: number, status: PublishedAbsence["status"] = "O"): PublishedAbsence => ({
  teamId: "25",
  athleteId,
  name,
  status,
  reason: null,
  class: "short",
  gamesMissed: 1,
  expectedGames: 3,
  points,
});

function projection(over: Partial<GameProjection> = {}): GameProjection {
  return {
    gameId: "g1",
    etDate: "2026-11-24",
    tipUtc: "2026-11-25T00:30:00Z",
    homeId: "25",
    awayId: "16",
    neutral: false,
    kind: "regular",
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    expectedMargin: 3,
    homeOnBackToBack: false,
    awayOnBackToBack: false,
    basis: { kind: "report", reportAt: "2026-11-24T17:30:00Z", stale: false },
    absencePoints: { home: 6.4, away: 0 },
    unfiled: { home: false, away: false },
    drivers: {
      home: [
        { athleteId: "b", name: "Chet Holmgren", status: "O", points: 2.1 },
        { athleteId: "c", name: "Jalen Williams", status: "O", points: 1.8 },
        { athleteId: "d", name: "Alex Caruso", status: "Q", points: 0.4 },
        { athleteId: "e", name: "Isaiah Joe", status: "D", points: 2.1 },
      ],
      away: [],
    },
    driversComplete: true,
    ...over,
  } as GameProjection;
}

const current = {
  points: 10.6,
  absences: [absence("a", "Shai Gilgeous-Alexander", 4.1, null), absence("b", "Chet Holmgren", 2.1), absence("c", "Jalen Williams", 1.8), absence("d", "Alex Caruso", 0.7)],
};

describe("nextGameAbsence", () => {
  it("takes the game's projection for the team's side, with its basis", () => {
    const next = nextGameAbsence(projection(), "25", current);
    expect(next).toMatchObject({ points: 6.4, basis: "report", count: 4, fromProjection: true });
  });

  it("names current absences as the basis for an unfiled side or a current-absences projection", () => {
    expect(nextGameAbsence(projection({ unfiled: { home: true, away: false } }), "25", current).basis).toBe("current-absences");
    expect(nextGameAbsence(projection({ basis: { kind: "current-absences" } }), "25", current).basis).toBe("current-absences");
  });

  it("falls back to current absences without a projection for the game", () => {
    expect(nextGameAbsence(null, "25", current)).toEqual({ points: 10.6, basis: "current-absences", count: 4, source: "current", fromProjection: false, drivers: null });
    expect(nextGameAbsence(projection(), "99", current).fromProjection).toBe(false);
  });
});

describe("nextGameAbsence with a sealed game", () => {
  const sealDrivers = [
    { athleteId: "b", name: "Chet Holmgren", status: "O" as const, points: 2.1 },
    { athleteId: "c", name: "Jalen Williams", status: "O" as const, points: 1.8 },
    { athleteId: "z", name: "Bench Player", status: "O" as const, points: 0 },
  ];

  it("takes what the seal counted over a projection and over current absences", () => {
    const next = nextGameAbsence(
      projection({ absencePoints: { home: 9.9, away: 0 } }),
      "25",
      { points: 10.6, absences: [absence("a", "Shai Gilgeous-Alexander", 4.1)] },
      { points: 6.4, unfiled: false, drivers: sealDrivers },
    );
    expect(next.points).toBe(6.4);
    expect(next.source).toBe("seal");
    expect(next.basis).toBe("report");
    expect(next.count).toBe(2);
    expect(next.fromProjection).toBe(true);
  });

  it("takes the seal when the game has tipped and has no projection", () => {
    const next = nextGameAbsence(null, "25", { points: 10.6, absences: [] }, { points: 6.4, unfiled: false, drivers: sealDrivers });
    expect(next.points).toBe(6.4);
    expect(next.source).toBe("seal");
  });

  it("names current absences for a seal's unfiled side, and has no count when the seal's list is not complete", () => {
    const next = nextGameAbsence(null, "25", { points: 3, absences: [] }, { points: 3, unfiled: true, drivers: null });
    expect(next.basis).toBe("current-absences");
    expect(next.count).toBeNull();
    expect(next.drivers).toBeNull();
  });

  it("explains the gap from the seal's own list", () => {
    const current = { points: 8, absences: [absence("a", "Shai Gilgeous-Alexander", 4.1), absence("b", "Chet Holmgren", 2.1), absence("c", "Jalen Williams", 1.8)] };
    const next = nextGameAbsence(null, "25", current, { points: 3.9, unfiled: false, drivers: sealDrivers });
    const parts = absenceGap(current, next);
    expect(parts?.find((part) => part.kind === "not-on-report")?.players.map((player) => player.name)).toEqual(["Shai Gilgeous-Alexander"]);
  });
});

describe("absenceGap", () => {
  it("names who is out now but not on the report, who is weighted, and who is only on the report", () => {
    const parts = absenceGap(current, nextGameAbsence(projection(), "25", current));
    expect(parts).toEqual([
      { kind: "not-on-report", players: [{ athleteId: "a", name: "Shai Gilgeous-Alexander" }] },
      { kind: "weighted", players: [{ athleteId: "d", name: "Alex Caruso" }] },
      { kind: "only-on-report", players: [{ athleteId: "e", name: "Isaiah Joe" }] },
    ]);
  });

  it("says nothing when the totals agree within 0.1 or the next game is not priced on a report", () => {
    expect(absenceGap({ ...current, points: 6.45 }, nextGameAbsence(projection(), "25", current))).toBeNull();
    expect(absenceGap(current, nextGameAbsence(null, "25", current))).toBeNull();
  });
});
