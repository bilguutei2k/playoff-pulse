// The five baseline models against which Playoff Pulse is evaluated.
// Each baseline returns predictedProbabilityA: P(teamA wins the series), where
// teamA is the higher seed in the normalized historical series.

import type { HistoricalSeries, ModelName, TeamSeasonSnapshot } from "./types";
import {
  historicalSeriesFormat,
  homePatternForHistoricalFormat,
} from "../../src/lib/backtest/series-formats";
import { defaultModelSettings } from "../../src/lib/data/model-settings";
import { estimateBaselineSeriesProbability } from "../../src/lib/model/simulator";
import type { ModelSettings, Series, Team } from "../../src/lib/model/types";

export const DIRECTIONAL_PRIOR = 0.65;
export const PROBABILITY_EPSILON = 1e-7;

export function clampBaseline(p: number): number {
  return Math.min(1 - PROBABILITY_EPSILON, Math.max(PROBABILITY_EPSILON, p));
}

function settingsForSeries(series: HistoricalSeries, settings: ModelSettings): ModelSettings {
  if (!series.bubble) {
    return settings;
  }

  return {
    ...settings,
    homeCourtAdvantage: 0,
  };
}

// Historical homePattern only covers games actually played (a sweep records
// four entries). Simulating from 0-0 with the truncated pattern would place
// unplayed games 5-7 on neutral court, understating home-court advantage in
// series that ended early. Reconstruct the complete registered pattern from
// the Game 1 host using the season-and-round format registry.
export function fullHomePattern(series: HistoricalSeries): string[] {
  const hostTeam = series.homePattern[0];
  if (hostTeam !== series.teamA && hostTeam !== series.teamB) {
    throw new Error(
      `Game 1 host ${hostTeam} for ${series.id} is not one of its teams.`,
    );
  }

  const otherTeam = hostTeam === series.teamA ? series.teamB : series.teamA;
  const format = historicalSeriesFormat(series.season, series.round);
  const pattern = homePatternForHistoricalFormat(
    format,
    hostTeam,
    otherTeam,
  );

  series.homePattern.forEach((homeTeam, index) => {
    if (pattern[index] !== homeTeam) {
      throw new Error(
        `${series.id} game ${index + 1} was hosted by ${homeTeam}, which breaks the ${format.label} pattern (expected ${pattern[index]}). Correct the data or the sourced format registry before backtesting this series.`,
      );
    }
  });

  return pattern;
}

function historicalSeriesToModelSeries(series: HistoricalSeries): Series {
  const format = historicalSeriesFormat(series.season, series.round);
  return {
    id: series.id,
    round: series.round === "First Round"
      ? "First Round"
      : series.round === "Conference Semifinal"
        ? "Conference Semifinal"
        : "Conference Final",
    conference: series.conference === "West" ? "West" : "East",
    bracketOrder: 0,
    teamA: series.teamA,
    teamB: series.teamB,
    winsA: 0,
    winsB: 0,
    homePattern: fullHomePattern(series),
    winsRequired: format.winsRequired,
  };
}

function modelPrediction(
  series: HistoricalSeries,
  teamASnapshot: TeamSeasonSnapshot,
  teamBSnapshot: TeamSeasonSnapshot,
  settings: ModelSettings,
): number {
  const teamA = snapshotToTeam(teamASnapshot, series.id);
  const teamB = snapshotToTeam(teamBSnapshot, series.id);
  const forecast = estimateBaselineSeriesProbability(
    historicalSeriesToModelSeries(series),
    {
      [teamA.id]: teamA,
      [teamB.id]: teamB,
    },
    settingsForSeries(series, settings),
  );

  return clampBaseline(forecast.teamASeriesWinProbability);
}

export function coinflipPrediction(_series: HistoricalSeries): number {
  void _series;
  return 0.5;
}

export function higherSeedPrediction(_series: HistoricalSeries): number {
  void _series;
  return DIRECTIONAL_PRIOR;
}

export function homeTeamPrediction(series: HistoricalSeries): number {
  if (series.bubble) {
    return 0.5;
  }

  return DIRECTIONAL_PRIOR;
}

const SRS_PROXY_ONLY_SETTINGS: ModelSettings = {
  ...defaultModelSettings,
  playerWeight: 0,
  netRatingWeight: 0,
  eloWeight: 1,
};

export function srsProxyOnlyPrediction(
  series: HistoricalSeries,
  teamASnapshot: TeamSeasonSnapshot,
  teamBSnapshot: TeamSeasonSnapshot,
): number {
  return modelPrediction(series, teamASnapshot, teamBSnapshot, SRS_PROXY_ONLY_SETTINGS);
}

const NET_RATING_ONLY_SETTINGS: ModelSettings = {
  ...defaultModelSettings,
  playerWeight: 0,
  netRatingWeight: 1,
  eloWeight: 0,
};

export function netRatingOnlyPrediction(
  series: HistoricalSeries,
  teamASnapshot: TeamSeasonSnapshot,
  teamBSnapshot: TeamSeasonSnapshot,
): number {
  return modelPrediction(series, teamASnapshot, teamBSnapshot, NET_RATING_ONLY_SETTINGS);
}

export function snapshotToTeam(
  snapshot: TeamSeasonSnapshot,
  seriesId: string,
): Team {
  return {
    id: snapshot.teamId,
    name: snapshot.teamName,
    abbreviation: snapshot.teamId,
    conference: snapshot.conference,
    seed: snapshot.seed,
    eloRating: snapshot.eloRating,
    netRating: snapshot.netRating,
    manualAdjustment: snapshot.manualAdjustment,
    players: snapshot.players.map((player, index) => ({
      id: `${seriesId}-${snapshot.teamId}-${index + 1}`,
      name: player.name,
      teamId: snapshot.teamId,
      impact: player.impact,
      projectedMinutes: player.projectedMinutes,
      injuryStatus: "healthy",
    })),
  };
}

export function predict(
  modelName: ModelName,
  series: HistoricalSeries,
  teamASnapshot: TeamSeasonSnapshot,
  teamBSnapshot: TeamSeasonSnapshot,
): number {
  switch (modelName) {
    case "coinflip":
      return clampBaseline(coinflipPrediction(series));
    case "higher_seed":
      return clampBaseline(higherSeedPrediction(series));
    case "home_team":
      return clampBaseline(homeTeamPrediction(series));
    case "srs_proxy_only":
      return srsProxyOnlyPrediction(series, teamASnapshot, teamBSnapshot);
    case "net_rating_only":
      return netRatingOnlyPrediction(series, teamASnapshot, teamBSnapshot);
    case "playoff_pulse":
      throw new Error("playoff_pulse is handled by run-backtest.ts.");
  }
}

export { SRS_PROXY_ONLY_SETTINGS, NET_RATING_ONLY_SETTINGS, historicalSeriesToModelSeries, settingsForSeries };
