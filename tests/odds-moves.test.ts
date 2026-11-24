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
    const moves = oddsMoves(history(rows), [])!;
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
