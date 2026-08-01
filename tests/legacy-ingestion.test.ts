import { describe, expect, it } from "vitest";
import {
  expectedLeagueTeamCount,
  parseTeamRatings,
} from "../scripts/backtest/scrape-bbref";
import { flagSnapshotExtremes } from "../scripts/backtest/ingest-1984-2002";
import type { TeamSeasonSnapshot } from "../src/lib/backtest/types";

function ratingsHtml(teamCount: number): string {
  const rows = Array.from({ length: teamCount }, (_, index) => {
    const teamId = `A${String(index).padStart(2, "0")}`;
    return `<tr>
      <td data-stat="team_name"><a href="/teams/${teamId}/1984.html">Team ${index}</a></td>
      <td data-stat="conf_id">${index % 2 === 0 ? "E" : "W"}</td>
      <td data-stat="wins">41</td><td data-stat="losses">41</td>
      <td data-stat="off_rtg">105</td><td data-stat="def_rtg">104</td>
      <td data-stat="net_rtg">1</td><td data-stat="mov_adj">0.5</td>
    </tr>`;
  }).join("");
  return `<table id="ratings"><tbody>${rows}</tbody></table>`;
}

function snapshot(overrides: Partial<TeamSeasonSnapshot>): TeamSeasonSnapshot {
  return {
    teamId: "BOS",
    teamName: "Boston Celtics",
    season: 1984,
    conference: "East",
    seed: 1,
    snapshot_as_of: "1984-04-15",
    eloRating: 1500,
    netRating: 5,
    manualAdjustment: 0,
    players: [],
    srs: 5,
    ortg: 110,
    drtg: 105,
    wins: 62,
    losses: 20,
    ratingSource: "srs_point_proxy",
    playerImpactSource: "bpm_proxy",
    rotationSource: "normalized_regular_season_mpg",
    ...overrides,
  };
}

describe("legacy Basketball-Reference ingestion", () => {
  it("accepts the 23-team 1984 ratings table without changing playoff bracket size", () => {
    expect(expectedLeagueTeamCount(1984)).toBe(23);
    expect(parseTeamRatings(ratingsHtml(23), 1984)).toHaveLength(23);
    expect(() => parseTeamRatings(ratingsHtml(22), 1984)).toThrow(
      "Expected 23 team ratings for 1984",
    );
  });

  it("flags historical-extreme violations without clamping source values", () => {
    const source = snapshot({ srs: 12.5, netRating: -14.25 });
    const flags = flagSnapshotExtremes([source], {
      srs: { min: -10, max: 10 },
      netRating: { min: -12, max: 12 },
    });

    expect(flags).toEqual([
      expect.objectContaining({ field: "srs", value: 12.5 }),
      expect.objectContaining({ field: "netRating", value: -14.25 }),
    ]);
    expect(source.srs).toBe(12.5);
    expect(source.netRating).toBe(-14.25);
  });
});
