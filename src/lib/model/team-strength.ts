import type { ModelSettings, Team, TeamForecast } from "@/lib/model/types";
import {
  baselineTeamStrength,
  eloToPointScale,
  playerMinuteWeightedImpact,
  scenarioTeamAdjustment,
  teamStrength,
} from "@/lib/model/probability";

export function estimateTeamForecast(
  team: Team,
  settings: ModelSettings,
): TeamForecast {
  return {
    teamId: team.id,
    playerMinuteImpact: playerMinuteWeightedImpact(team),
    netRating: team.netRating,
    eloPointValue: eloToPointScale(team.eloRating),
    manualAdjustment: team.manualAdjustment,
    baselineStrength: baselineTeamStrength(team, settings),
    scenarioAdjustment: scenarioTeamAdjustment(team, settings),
    finalStrength: teamStrength(team, settings),
  };
}

export function estimateTeamForecasts(
  teams: Team[],
  settings: ModelSettings,
): TeamForecast[] {
  return teams
    .map((team) => estimateTeamForecast(team, settings))
    .sort((a, b) => b.finalStrength - a.finalStrength);
}
