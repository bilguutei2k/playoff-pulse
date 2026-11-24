import { describe, expect, it } from "vitest";
import type { OddsHistoryFile } from "@/lib/season/odds-history";
import type { SeasonGame } from "@/lib/season/types";
import { oddsMoves } from "@/lib/view/odds-moves";

const ids = ["1", "2", "3", "4", "5", "6", "7", "8"];

function history(rows: number[][], dates = rows.map((_, i) => `2026-11-${String(20 + i).padStart(2, "0")}`)): OddsHistoryFile {
  const zero = rows.map(() => ids.map(() => 0));
  return {
    version: 1,
    season: 2027,
    seasonLabel: "2026-27",
    teamIds: ids,
    dates,
    makePlayoffs: rows,
    topSix: zero,
    playIn: zero,
    champion: zero,
    projectedWins: zero,
    rating: zero,
  };
}

const game = (over: Partial<SeasonGame>): SeasonGame => ({
  id: "g",
  season: 2027,
  kind: "regular",
  tipUtc: "2026-11-21T00:00:00Z",
  etDate: "2026-11-20",
  homeId: "1",
  awayId: "2",
  neutral: false,
  status: "final",
  homeScore: 113,
  awayScore: 106,
  ...over,
});

describe("odds moves", () => {
  it("is null without the view, with one date, or with no move of a point", () => {
    expect(oddsMoves(null, [])).toBeNull();
    expect(oddsMoves(history([[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]]), [])).toBeNull();
    expect(
      oddsMoves(history([ids.map(() => 0.5), [0.509, 0.491, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]]), []),
    ).toBeNull();
  });

  it("takes the last two dates and keeps at most three each way, largest first", () => {
    const rows = [
      ids.map(() => 0.9),
      ids.map(() => 0.5),
      [0.6, 0.55, 0.52, 0.51, 0.45, 0.3, 0.49, 0.5],
    ];
    // The latest slate has a final, so the last two entries are compared.
    const moves = oddsMoves(history(rows), [game({ etDate: "2026-11-22", tipUtc: "2026-11-23T00:00:00Z", homeId: "7", awayId: "8" })])!;
    expect(moves.kind).toBe("since");
    expect(moves.from).toBe("2026-11-21");
    expect(moves.to).toBe("2026-11-22");
    expect(moves.rises.map((m) => [m.teamId, m.change])).toEqual([
      ["1", 0.1],
      ["2", 0.05],
      ["3", 0.02],
    ]);
    expect(moves.falls.map((m) => [m.teamId, m.change])).toEqual([
      ["6", -0.2],
      ["5", -0.05],
      ["7", -0.01],
    ]);
    expect(moves.rises[0]).toMatchObject({ before: 0.5, now: 0.6 });
  });

  it("counts exactly one point, despite floating-point dust", () => {
    const moves = oddsMoves(history([ids.map(() => 0.5023), [0.5123, 0.5023, 0.5023, 0.5023, 0.5023, 0.5023, 0.5023, 0.4923]]), [])!;
    expect(moves.rises.map((m) => m.change)).toEqual([0.01]);
    expect(moves.falls.map((m) => m.change)).toEqual([-0.01]);
  });

  it("puts the final played since the earlier date beside each move, from the team's side", () => {
    // Dates 2026-11-20 and 2026-11-21: the 20th's entry already counts the 20th's games.
    const games = [
      game({ id: "a", etDate: "2026-11-21", homeId: "1", awayId: "2", homeScore: 113, awayScore: 106 }),
      game({ id: "b", etDate: "2026-11-20", homeId: "3", awayId: "4", homeScore: 99, awayScore: 101 }),
      game({ id: "c", etDate: "2026-11-21", homeId: "4", awayId: "5", status: "in-progress", homeScore: 50, awayScore: 48 }),
    ];
    const moves = oddsMoves(history([ids.map(() => 0.5), [0.6, 0.4, 0.55, 0.45, 0.55, 0.5, 0.5, 0.5]]), games)!;
    expect(moves.rises.find((m) => m.teamId === "1")!.game).toEqual({ opponentId: "2", won: true, teamScore: 113, opponentScore: 106 });
    expect(moves.falls.find((m) => m.teamId === "2")!.game).toEqual({ opponentId: "1", won: false, teamScore: 106, opponentScore: 113 });
    // Team 3's final was on the earlier date, which its entry already counts.
    expect(moves.rises.find((m) => m.teamId === "3")!.game).toBeNull();
    // Teams 4 and 5 are still playing: no result yet.
    expect(moves.falls.find((m) => m.teamId === "4")!.game).toBeNull();
    expect(moves.rises.find((m) => m.teamId === "5")!.game).toBeNull();
  });
});

describe("odds moves before the latest slate's first final", () => {
  // Three entries: Nov 20, Nov 21 (a full night of games), Nov 22 (the slate has rolled, nothing final yet).
  const rows = [
    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    [0.58, 0.44, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    [0.582, 0.441, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  ];
  const lastNight = game({ id: "a", etDate: "2026-11-21", tipUtc: "2026-11-22T00:00:00Z", homeId: "1", awayId: "2", homeScore: 113, awayScore: 106 });

  it("shows the slate before, with its results, and says it is that day", () => {
    const upcoming = game({ id: "b", etDate: "2026-11-22", tipUtc: "2026-11-23T00:00:00Z", status: "scheduled", homeScore: null, awayScore: null });
    const moves = oddsMoves(history(rows), [lastNight, upcoming]);
    expect(moves?.kind).toBe("day");
    expect([moves?.from, moves?.to]).toEqual(["2026-11-20", "2026-11-21"]);
    expect(moves?.rises.map((move) => [move.teamId, move.change, move.now])).toEqual([["1", 0.08, 0.58]]);
    expect(moves?.falls.map((move) => [move.teamId, move.change])).toEqual([["2", -0.06]]);
    expect(moves?.rises[0].game).toEqual({ opponentId: "2", won: true, teamScore: 113, opponentScore: 106 });
  });

  it("goes back to the latest slate as soon as it has a final", () => {
    const tonight = game({ id: "b", etDate: "2026-11-22", tipUtc: "2026-11-23T00:00:00Z", homeId: "3", awayId: "4" });
    const later = rows.map((row) => [...row]);
    later[2][2] = 0.53;
    const moves = oddsMoves(history(later), [lastNight, tonight]);
    expect(moves?.kind).toBe("since");
    expect([moves?.from, moves?.to]).toEqual(["2026-11-21", "2026-11-22"]);
    expect(moves?.rises.map((move) => move.teamId)).toEqual(["3"]);
  });

  it("keeps the last two entries when the history has only two", () => {
    const moves = oddsMoves(history(rows.slice(0, 2)), []);
    expect(moves?.kind).toBe("since");
    expect([moves?.from, moves?.to]).toEqual(["2026-11-20", "2026-11-21"]);
  });

  it("is absent when the slate before moved nobody a point", () => {
    const flat = [rows[0], rows[0].map((value) => value + 0.004), rows[0]];
    expect(oddsMoves(history(flat), [])).toBeNull();
  });
});
