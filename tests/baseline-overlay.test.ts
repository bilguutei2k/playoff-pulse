import { describe, expect, it } from "vitest";

import { defaultModelSettings } from "@/lib/data/model-settings";
import { estimateBaselineBracketForecast } from "@/lib/model/bracket-simulator";
import { buildForecastSnapshot } from "@/lib/model/forecast";
import {
  baselineProbability,
  gameWinProbability,
  scenarioAdjustment,
} from "@/lib/model/probability";
import { estimateBaselineSeriesProbability } from "@/lib/model/simulator";
import type { PlayoffConfig, Series, Team } from "@/lib/model/types";

function team(id: string, impact: number, manualAdjustment = 0): Team {
  return {
    id,
    name: id,
    abbreviation: id,
    conference: "East",
    seed: id === "A" ? 1 : 8,
    eloRating: 1540,
    netRating: 4,
    manualAdjustment,
    players: [
      {
        id: `${id}-player`,
        name: `${id} Player`,
        teamId: id,
        impact,
        projectedMinutes: 40,
        injuryStatus: "healthy",
      },
    ],
  };
}

describe("evidenced baseline and scenario overlay", () => {
  const teamA = team("A", 8);
  const teamB = team("B", 0);

  it("defaults to zero when user-supplied scenario inputs are neutral", () => {
    expect(scenarioAdjustment()).toBe(0);
    const neutralA = { ...teamA, players: [], manualAdjustment: 0 };
    const neutralB = { ...teamB, players: [], manualAdjustment: 0 };
    expect(scenarioAdjustment(neutralA, neutralB, defaultModelSettings)).toBe(0);
  });

  it("player, minutes, injury, and manual inputs cannot change baseline probability", () => {
    const changedA: Team = {
      ...teamA,
      manualAdjustment: -3,
      players: teamA.players.map((player) => ({
        ...player,
        impact: 20,
        projectedMinutes: 0,
        injuryStatus: "out" as const,
      })),
    };

    expect(
      baselineProbability(teamA, teamB, teamA.id, defaultModelSettings),
    ).toBe(
      baselineProbability(changedA, teamB, teamA.id, defaultModelSettings),
    );
    expect(
      gameWinProbability(teamA, teamB, teamA.id, defaultModelSettings),
    ).not.toBe(
      gameWinProbability(changedA, teamB, teamA.id, defaultModelSettings),
    );
  });

  it("baseline series forecasts expose no scenario impacts", () => {
    const series: Series = {
      id: "baseline-isolation",
      round: "First Round",
      conference: "East",
      bracketOrder: 1,
      teamA: teamA.id,
      teamB: teamB.id,
      winsA: 0,
      winsB: 0,
      homePattern: ["A", "A", "B", "B", "A", "B", "A"],
    };
    const changedA = { ...teamA, manualAdjustment: 3 };
    const original = estimateBaselineSeriesProbability(
      series,
      { A: teamA, B: teamB },
      defaultModelSettings,
    );
    const changed = estimateBaselineSeriesProbability(
      series,
      { A: changedA, B: teamB },
      defaultModelSettings,
    );

    expect(changed.teamASeriesWinProbability).toBe(
      original.teamASeriesWinProbability,
    );
    expect(changed.scenarioImpacts).toEqual([]);
  });

  it("scenario inputs cannot perturb baseline bracket probabilities or its random seed", () => {
    const series: Series = {
      id: "baseline-finals",
      round: "NBA Finals",
      conference: "Finals",
      bracketOrder: 1,
      teamA: "A",
      teamB: "B",
      winsA: 0,
      winsB: 0,
      homePattern: ["A", "A", "B", "B", "A", "B", "A"],
    };
    const config: PlayoffConfig = {
      teams: [teamA, teamB],
      series: [series],
      marketOdds: [],
      notes: [],
    };
    const changedTeamA: Team = {
      ...teamA,
      manualAdjustment: -3,
      players: teamA.players.map((player) => ({
        ...player,
        impact: 25,
        projectedMinutes: 0,
        injuryStatus: "out" as const,
      })),
    };
    const changedConfig = { ...config, teams: [changedTeamA, teamB] };

    const original = estimateBaselineBracketForecast(
      config,
      defaultModelSettings,
      config.teams,
      500,
    );
    const changed = estimateBaselineBracketForecast(
      changedConfig,
      defaultModelSettings,
      changedConfig.teams,
      500,
    );
    expect(changed.rows).toEqual(original.rows);

    const quickSettings = {
      ...defaultModelSettings,
      simulationIterations: 500,
    };
    const publishedOriginal = buildForecastSnapshot(
      config,
      quickSettings,
      config.teams,
    );
    const publishedChanged = buildForecastSnapshot(
      changedConfig,
      quickSettings,
      changedConfig.teams,
    );
    expect(publishedChanged.seriesForecasts).toEqual(
      publishedOriginal.seriesForecasts,
    );
    expect(publishedChanged.bracketForecast.rows).toEqual(
      publishedOriginal.bracketForecast.rows,
    );
  });
});
