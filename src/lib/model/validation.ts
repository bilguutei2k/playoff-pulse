import type {
  ModelSettings,
  PlayoffConfig,
  ValidationResult,
} from "@/lib/model/types";
import { assessBracketCoverage } from "@/lib/model/bracket-simulator";
import { gameWinProbability } from "@/lib/model/probability";

export function validateConfig(
  config: PlayoffConfig,
  settings: ModelSettings,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const teamIds = new Set(config.teams.map((team) => team.id));
  const teamsById = Object.fromEntries(
    config.teams.map((team) => [team.id, team]),
  );

  for (const team of config.teams) {
    for (const player of team.players) {
      if (player.teamId !== team.id) {
        errors.push(`${player.name} references team ${player.teamId}, expected ${team.id}.`);
      }

      if (player.projectedMinutes < 0) {
        errors.push(`${player.name} has negative projected minutes.`);
      }
    }
  }

  for (const series of config.series) {
    if (!Number.isInteger(series.bracketOrder) || series.bracketOrder <= 0) {
      errors.push(`${series.id} must include a positive integer bracketOrder.`);
    }

    if (!teamIds.has(series.teamA)) {
      errors.push(`${series.id} references missing teamA ${series.teamA}.`);
    }

    if (!teamIds.has(series.teamB)) {
      errors.push(`${series.id} references missing teamB ${series.teamB}.`);
    }

    for (const homeTeamId of series.homePattern) {
      if (homeTeamId !== series.teamA && homeTeamId !== series.teamB) {
        errors.push(`${series.id} has invalid homePattern team ${homeTeamId}.`);
      }
    }

    if (series.homePattern.length !== 7) {
      warnings.push(`${series.id} should include seven possible home games.`);
    }

    if (!Number.isInteger(series.winsA) || !Number.isInteger(series.winsB)) {
      errors.push(`${series.id} has a non-integer series score.`);
    }

    if (series.winsA < 0 || series.winsB < 0) {
      errors.push(`${series.id} has a negative series score.`);
    }

    if (series.winsA > 4 || series.winsB > 4) {
      errors.push(`${series.id} has a series score above four wins.`);
    }

    if (series.winsA === 4 && series.winsB === 4) {
      errors.push(`${series.id} cannot have both teams at four wins.`);
    }

    if (series.winsA + series.winsB > 7) {
      errors.push(`${series.id} has more than seven completed games.`);
    }

    if (teamIds.has(series.teamA) && teamIds.has(series.teamB)) {
      const completedGames = series.winsA + series.winsB;
      const probability = gameWinProbability(
        teamsById[series.teamA],
        teamsById[series.teamB],
        series.homePattern[completedGames] ?? null,
        settings,
      );

      if (probability < 0 || probability > 1 || Number.isNaN(probability)) {
        errors.push(`${series.id} generated an invalid probability.`);
      }
    }
  }

  for (const conference of ["East", "West"] as const) {
    for (const round of ["First Round", "Conference Semifinal", "Conference Final"] as const) {
      const orders = config.series
        .filter((series) => series.conference === conference && series.round === round)
        .map((series) => series.bracketOrder);
      const uniqueOrders = new Set(orders);

      if (orders.length !== uniqueOrders.size) {
        errors.push(`${conference} ${round} has duplicate bracketOrder values.`);
      }
    }
  }

  warnings.push(...assessBracketCoverage(config).warnings);

  const weightSum =
    settings.playerWeight + settings.netRatingWeight + settings.eloWeight;

  if (weightSum < 0.5 || weightSum > 1.5) {
    errors.push(`Model weights sum to ${weightSum.toFixed(2)}, outside the sensible range.`);
  }

  if (Math.abs(weightSum - 1) > 0.15) {
    warnings.push(`Model weights sum to ${weightSum.toFixed(2)} rather than 1.00.`);
  }

  if (settings.homeCourtAdvantage < 0 || settings.homeCourtAdvantage > 5) {
    warnings.push("Home-court advantage is outside the expected NBA playoff range.");
  }

  if (!Number.isInteger(settings.simulationIterations) || settings.simulationIterations <= 0) {
    errors.push("Simulation iterations must be a positive integer.");
  }

  if (settings.logisticScale <= 0) {
    errors.push("Logistic scale must be positive.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
