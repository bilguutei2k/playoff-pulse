import type {
  BracketForecast,
  ModelSettings,
  PlayoffConfig,
  SeriesForecast,
  Team,
  TeamForecast,
} from "@/lib/model/types";
import { estimateBracketForecast } from "@/lib/model/bracket-simulator";
import { estimateSeriesProbability } from "@/lib/model/simulator";
import { estimateTeamForecasts } from "@/lib/model/team-strength";

export type ForecastSnapshot = {
  teams: Team[];
  teamsById: Record<string, Team>;
  teamForecasts: TeamForecast[];
  seriesForecasts: SeriesForecast[];
  bracketForecast: BracketForecast;
};

export function applyManualAdjustments(
  teams: Team[],
  adjustments: Record<string, number>,
): Team[] {
  return teams.map((team) => ({
    ...team,
    manualAdjustment: adjustments[team.id] ?? team.manualAdjustment,
  }));
}

export function buildForecastSnapshot(
  config: PlayoffConfig,
  settings: ModelSettings,
  teams = config.teams,
): ForecastSnapshot {
  const teamsById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const teamForecasts = estimateTeamForecasts(teams, settings);
  const seriesForecasts = config.series.map((series) =>
    estimateSeriesProbability(
      series,
      teamsById,
      settings,
      settings.simulationIterations,
    ),
  );
  const bracketForecast = estimateBracketForecast(
    { ...config, teams },
    settings,
    teams,
    settings.simulationIterations,
  );

  return {
    teams,
    teamsById,
    teamForecasts,
    seriesForecasts,
    bracketForecast,
  };
}
