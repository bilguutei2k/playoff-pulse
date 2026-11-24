import { describe, expect, it } from "vitest";
import type { OddsHistoryFile } from "@/lib/season/odds-history";
import { SEASON_TEAMS } from "@/lib/season/teams";
import { oddsChartData, seriesPoints } from "@/lib/view/odds-chart";

const ids = SEASON_TEAMS.map((team) => team.id);

describe("odds chart data", () => {
  it("keeps title odds from the state's history, sorted, missing teams at zero", () => {
    const data = oddsChartData(
      [
        { date: "2026-11-03", champion: { [ids[0]]: 0.2 } },
        { date: "2026-11-02", champion: { [ids[0]]: 0.1, [ids[1]]: 0.05 } },
      ],
      null,
    );
    expect(data.champion.dates).toEqual(["2026-11-02", "2026-11-03"]);
    expect(data.champion.values[0][0]).toBe(0.1);
    expect(data.champion.values[1][1]).toBe(0);
    expect(data.makePlayoffs).toBeNull();
    expect(data.projectedWins).toBeNull();
    const points = seriesPoints(data.champion);
    expect(points[1]).toEqual({ date: "2026-11-03", values: Object.fromEntries(ids.map((id, j) => [id, j === 0 ? 0.2 : 0])) });
  });

  it("takes playoff odds and projected wins from the view, untouched", () => {
    const row = ids.map((_, j) => j / 100);
    const view = {
      version: 1,
      season: 2027,
      seasonLabel: "2026-27",
      teamIds: ids,
      dates: ["2026-11-02"],
      makePlayoffs: [row],
      topSix: [row],
      playIn: [row],
      champion: [row],
      projectedWins: [ids.map(() => 41.25)],
      rating: [row],
    } satisfies OddsHistoryFile;
    const data = oddsChartData([], view);
    expect(data.makePlayoffs!.values).toBe(view.makePlayoffs);
    expect(seriesPoints(data.projectedWins!)[0].values[ids[3]]).toBe(41.25);
    expect(data.champion.dates).toEqual([]);
  });
});
