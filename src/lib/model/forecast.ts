import type {
  BracketForecast,
  ModelSettings,
  PlayoffConfig,
  SeriesForecast,
  Team,
  TeamForecast,
} from "@/lib/model/types";
import { estimateBaselineBracketForecast } from "@/lib/model/bracket-simulator";
import { estimateBaselineSeriesProbability } from "@/lib/model/simulator";
import { estimateTeamForecasts } from "@/lib/model/team-strength";
import { MODEL_VERSION, RESEARCH_PROTOCOL_VERSION } from "@/lib/model/version";

export type ForecastSnapshot = {
  metadata: {
    modelVersion: string;
    researchProtocolVersion: string;
  };
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
    estimateBaselineSeriesProbability(
      series,
      teamsById,
      settings,
      settings.simulationIterations,
    ),
  );
  const bracketForecast = estimateBaselineBracketForecast(
    { ...config, teams },
    settings,
    teams,
    settings.simulationIterations,
  );

  return {
    metadata: {
      modelVersion: MODEL_VERSION,
      researchProtocolVersion: RESEARCH_PROTOCOL_VERSION,
    },
    teams,
    teamsById,
    teamForecasts,
    seriesForecasts,
    bracketForecast,
  };
}
