import { describe, expect, it } from "vitest";
import type { OddsHistoryFile } from "@/lib/season/odds-history";
import { teamOddsHistory } from "@/lib/view/team-odds-history";

/** A two-team, three-date view; each value encodes its date row and team column. */
function view(dates = ["2026-11-01", "2026-11-02", "2026-11-03"]): OddsHistoryFile {
  const teamIds = ["2", "17"];
  const matrix = (base: number, step: number) => dates.map((_, row) => teamIds.map((__, column) => Number((base + row * step + column * step * 10).toFixed(4))));
  return {
    version: 1,
    season: 2027,
    seasonLabel: "2026-27",
    teamIds,
    dates,
    makePlayoffs: matrix(0.5, 0.01),
    topSix: matrix(0.3, 0.01),
    playIn: matrix(0.2, 0.001),
    champion: matrix(0.05, 0.001),
    projectedWins: matrix(41.25, 0.5),
    rating: matrix(1.5, 0.1),
  };
}

describe("teamOddsHistory", () => {
  it("copies one team's column exactly, oldest first, and marks the slate date", () => {
    expect(teamOddsHistory(view(), "17", "2026-11-03")).toEqual([
      { date: "2026-11-01", today: false, makePlayoffs: 0.6, champion: 0.06, projectedWins: 46.25 },
      { date: "2026-11-02", today: false, makePlayoffs: 0.61, champion: 0.061, projectedWins: 46.75 },
      { date: "2026-11-03", today: true, makePlayoffs: 0.62, champion: 0.062, projectedWins: 47.25 },
    ]);
    expect(teamOddsHistory(view(), "2", "2026-11-03")?.map((point) => point.makePlayoffs)).toEqual([0.5, 0.51, 0.52]);
  });

  it("marks no date as today when the slate is not in the view", () => {
    expect(teamOddsHistory(view(), "2", "2026-11-04")?.some((point) => point.today)).toBe(false);
  });

  it("is null without the view, for a team not in it, and with fewer than two dates", () => {
    expect(teamOddsHistory(null, "2", "2026-11-03")).toBeNull();
    expect(teamOddsHistory(view(), "99", "2026-11-03")).toBeNull();
    expect(teamOddsHistory(view(["2026-11-03"]), "2", "2026-11-03")).toBeNull();
    expect(teamOddsHistory(view([]), "2", "2026-11-03")).toBeNull();
  });

  it("is null rather than inventing a point when a row is missing", () => {
    const file = view();
    file.champion = file.champion.slice(0, 2);
    expect(teamOddsHistory(file, "2", "2026-11-03")).toBeNull();
  });
});
