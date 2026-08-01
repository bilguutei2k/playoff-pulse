import { describe, expect, it } from "vitest";

import {
  historicalSeriesFormat,
  homePatternForHistoricalFormat,
} from "@/lib/backtest/series-formats";
import type { HistoricalRound } from "@/lib/backtest/types";
import { estimateSeriesProbability, simulateSeriesOutcome } from "@/lib/model/simulator";
import type { ModelSettings, Series, Team } from "@/lib/model/types";

const ROUNDS: HistoricalRound[] = [
  "First Round",
  "Conference Semifinal",
  "Conference Final",
  "NBA Finals",
];

describe("historical series-format registry", () => {
  it.each([
    [1984, "First Round", "best_of_five_2_2_1"],
    [1984, "NBA Finals", "best_of_seven_2_2_1_1_1"],
    [1985, "First Round", "best_of_five_2_2_1"],
    [1985, "NBA Finals", "best_of_seven_2_3_2"],
    [2002, "First Round", "best_of_five_2_2_1"],
    [2003, "First Round", "best_of_seven_2_2_1_1_1"],
    [2013, "NBA Finals", "best_of_seven_2_3_2"],
    [2014, "NBA Finals", "best_of_seven_2_2_1_1_1"],
    [2026, "NBA Finals", "best_of_seven_2_2_1_1_1"],
  ] as const)(
    "maps %i %s to %s",
    (season, round, expectedFormat) => {
      expect(historicalSeriesFormat(season, round).id).toBe(expectedFormat);
    },
  );

  it("registers exactly one format for every season and round in scope", () => {
    for (let season = 1984; season <= 2026; season += 1) {
      for (const round of ROUNDS) {
        expect(() => historicalSeriesFormat(season, round)).not.toThrow();
      }
    }
  });

  it.each([1983, 2027])("fails closed outside the registered seasons (%i)", (season) => {
    expect(() => historicalSeriesFormat(season, "First Round")).toThrow(
      "Expected exactly one registered series-format era",
    );
  });

  it.each([
    ["best_of_five_2_2_1", ["A", "A", "B", "B", "A"]],
    [
      "best_of_seven_2_2_1_1_1",
      ["A", "A", "B", "B", "A", "B", "A"],
    ],
    [
      "best_of_seven_2_3_2",
      ["A", "A", "B", "B", "B", "A", "A"],
    ],
  ] as const)("materializes the hand-checked %s venue sequence", (id, expected) => {
    const format = [1984, 1985, 2003]
      .flatMap((season) => ROUNDS.map((round) => historicalSeriesFormat(season, round)))
      .find((candidate) => candidate.id === id);

    expect(format).toBeDefined();
    expect(homePatternForHistoricalFormat(format!, "A", "B")).toEqual(expected);
  });
});

describe("best-of-five model propagation", () => {
  const teams: Record<string, Team> = {
    A: {
      id: "A",
      name: "A",
      abbreviation: "A",
      conference: "East",
      seed: 1,
      eloRating: 1500,
      netRating: 0,
      manualAdjustment: 0,
      players: [],
    },
    B: {
      id: "B",
      name: "B",
      abbreviation: "B",
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
    homeCourtAdvantage: 0,
    logisticScale: 6.5,
    simulationIterations: 1,
  };
  const series: Series = {
    id: "best-of-five",
    round: "First Round",
    conference: "East",
    bracketOrder: 1,
    teamA: "A",
    teamB: "B",
    winsA: 0,
    winsB: 0,
    homePattern: ["A", "A", "B", "B", "A"],
    winsRequired: 3,
  };

  it("uses three wins in the exact forecast", () => {
    const forecast = estimateSeriesProbability(series, teams, settings, 1);
    expect(forecast.teamASeriesWinProbability).toBeCloseTo(0.5, 12);
    expect(Object.keys(forecast.finalScoreProbabilities).sort()).toEqual([
      "0-3",
      "1-3",
      "2-3",
      "3-0",
      "3-1",
      "3-2",
    ]);
  });

  it("terminates simulation at exactly three wins", () => {
    const outcome = simulateSeriesOutcome(series, teams, settings, () => 0);
    expect(outcome).toMatchObject({ winnerId: "A", winsA: 3, winsB: 0 });
    expect(outcome.gamesPlayed).toBe(3);
  });
});
