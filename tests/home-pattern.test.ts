import { describe, expect, it } from "vitest";

import { nextGameForecast } from "@/lib/model/simulator";
import type { ModelSettings, Series, Team } from "@/lib/model/types";

const teams: Record<string, Team> = {
  higher: {
    id: "higher",
    name: "Higher Seed",
    abbreviation: "HIG",
    conference: "East",
    seed: 1,
    eloRating: 1500,
    netRating: 0,
    manualAdjustment: 0,
    players: [],
  },
  lower: {
    id: "lower",
    name: "Lower Seed",
    abbreviation: "LOW",
    conference: "East",
    seed: 8,
    eloRating: 1500,
    netRating: 0,
    manualAdjustment: 0,
    players: [],
  },
};

const settings: ModelSettings = {
  playerWeight: 0,
  netRatingWeight: 0,
  eloWeight: 0,
  homeCourtAdvantage: 3,
  logisticScale: 6.5,
  simulationIterations: 1,
};

describe.each([
  {
    format: "2-2-1-1-1",
    expectedHosts: [
      "higher",
      "higher",
      "lower",
      "lower",
      "higher",
      "lower",
      "higher",
    ],
    winsRequired: 4,
  },
  {
    format: "2-3-2",
    expectedHosts: [
      "higher",
      "higher",
      "lower",
      "lower",
      "lower",
      "higher",
      "higher",
    ],
    winsRequired: 4,
  },
  {
    format: "2-2-1",
    expectedHosts: ["higher", "higher", "lower", "lower", "higher"],
    winsRequired: 3,
  },
])("$format home-court indexing", ({ format, expectedHosts, winsRequired }) => {
  it.each(expectedHosts.map((expectedHost, gamesPlayed) => ({
    expectedHost,
    gamesPlayed,
  })))(
    "uses the hand-written game slot after $gamesPlayed completed games",
    ({ expectedHost, gamesPlayed }) => {
      const winsB = Math.min(gamesPlayed, winsRequired - 1);
      const series: Series = {
        id: `${format}-${gamesPlayed}`,
        round: "First Round",
        conference: "East",
        bracketOrder: 0,
        teamA: "higher",
        teamB: "lower",
        winsA: gamesPlayed - winsB,
        winsB,
        homePattern: expectedHosts,
      };

      const forecast = nextGameForecast(series, teams, settings);
      expect(forecast?.gameNumber).toBe(gamesPlayed + 1);
      expect(forecast?.homeTeamId).toBe(expectedHost);
    },
  );
});
