import type { ModelSettings, Team, TeamForecast } from "@/lib/model/types";
import {
  eloToPointScale,
  playerMinuteWeightedImpact,
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
