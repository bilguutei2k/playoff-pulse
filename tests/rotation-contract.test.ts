import { describe, expect, it } from "vitest";

import {
  LAGGED_ROTATION_CLAUSES,
  diagnoseLaggedRotationRejections,
  type LaggedRotationObservation,
} from "../src/lib/backtest/input-observations";
import type {
  HistoricalSeries,
  TeamSeasonSnapshot,
} from "../src/lib/backtest/types";

const series: HistoricalSeries[] = [
  {
    id: "2026-east-r1-a-b",
    season: 2026,
    round: "First Round",
    conference: "East",
    teamA: "A",
    teamB: "B",
    seedA: 1,
    seedB: 8,
    winsA: 4,
    winsB: 0,
    winner: "A",
    gamesPlayed: 4,
    seriesStartDate: "2026-04-18",
    seriesEndDate: "2026-04-24",
    homePattern: ["A", "A", "B", "B"],
    bubble: false,
  },
];

const playerNames = ["One", "Two", "Three", "Four", "Five", "Six"];
const snapshots: TeamSeasonSnapshot[] = [
  {
    teamId: "A",
    teamName: "A",
    season: 2026,
    conference: "East",
    seed: 1,
    snapshot_as_of: "2026-04-12",
    eloRating: 1500,
    netRating: 0,
    manualAdjustment: 0,
    players: playerNames.map((name) => ({
      name,
      bpm: 0,
      mpg: 30,
      gamesPlayed: 82,
      impact: 0,
      projectedMinutes: 40,
      availabilityStatus: "unknown_assumed_available",
    })),
    srs: 0,
    ortg: 110,
    drtg: 110,
    wins: 41,
    losses: 41,
    ratingSource: "srs_point_proxy",
    playerImpactSource: "bpm_proxy",
    rotationSource: "normalized_regular_season_mpg",
  },
];

function observation(
  overrides: Partial<LaggedRotationObservation> = {},
): LaggedRotationObservation {
  return {
    season: 2026,
    seriesId: series[0].id,
    teamId: "A",
    observedAt: "2026-04-17T12:00:00Z",
    method: "last_10_team_games_before_deadline",
    sourceUrl: "https://example.com/source",
    sourceLabel: "test",
    players: playerNames.map((playerName) => ({
      playerName,
      projectedMinutes: 40,
      gamesInLookback: 10,
    })),
    ...overrides,
  };
}

describe("lagged-rotation rejection diagnostics", () => {
  it("reports no eliminator when the source has no candidate observations", () => {
    const result = diagnoseLaggedRotationRejections([], series, snapshots);
    expect(result.candidateObservations).toBe(0);
    expect(result.largestEliminator).toBeNull();
    expect(result.largestEliminationCount).toBe(0);
    for (const clause of LAGGED_ROTATION_CLAUSES) {
      expect(result.rejectionCounts[clause], clause).toBe(0);
    }
  });

  it("attributes a 239-minute rotation only to the 240-minute clause", () => {
    const players = observation().players.map((player, index) => ({
      ...player,
      projectedMinutes: index === 0 ? 39 : 40,
    }));
    const result = diagnoseLaggedRotationRejections(
      [observation({ players })],
      series,
      snapshots,
    );
    expect(result.rejectionCounts.projectedMinutesTotal240).toBe(1);
    expect(result.largestEliminator).toBe("projectedMinutesTotal240");
    expect(
      Object.entries(result.rejectionCounts).filter(([, count]) => count > 0),
    ).toEqual([["projectedMinutesTotal240", 1]]);
  });

  it("counts timestamp and six-player failures independently", () => {
    const late = observation({ observedAt: "2026-04-18T00:00:00Z" });
    const shallow = observation({
      teamId: "B",
      players: playerNames.slice(0, 5).map((playerName) => ({
        playerName,
        projectedMinutes: 48,
        gamesInLookback: 10,
      })),
    });
    const result = diagnoseLaggedRotationRejections(
      [late, shallow],
      series,
      snapshots,
    );
    expect(result.rejectionCounts.timestampStrictlyBeforeDeadline).toBe(1);
    expect(result.rejectionCounts.atLeastSixPlayers).toBe(1);
  });
});
