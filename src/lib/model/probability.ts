import type { ModelSettings, Team } from "@/lib/model/types";

const INJURY_MULTIPLIER = {
  healthy: 1,
  questionable: 0.75,
  limited: 0.6,
  out: 0,
} as const;

const DEFAULT_LOGISTIC_SCALE = 6.5;
const ELO_POINTS_PER_POINT = 35;
const PLAYOFF_ROTATION_MINUTES = 240;

export function clampProbability(probability: number): number {
  if (!Number.isFinite(probability)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, probability));
}

export function playerMinuteWeightedImpact(team: Team): number {
  const totalImpact = team.players.reduce((sum, player) => {
    if (player.injuryStatus === "out") {
      return sum;
    }

    const availability = INJURY_MULTIPLIER[player.injuryStatus];
    return sum + player.impact * player.projectedMinutes * availability;
  }, 0);

  return totalImpact / PLAYOFF_ROTATION_MINUTES;
}

export function eloToPointScale(eloRating: number): number {
  return (eloRating - 1500) / ELO_POINTS_PER_POINT;
}

export function teamStrength(team: Team, settings: ModelSettings): number {
  return (
    settings.playerWeight * playerMinuteWeightedImpact(team) +
    settings.netRatingWeight * team.netRating +
    settings.eloWeight * eloToPointScale(team.eloRating) +
    team.manualAdjustment
  );
}

export function expectedMargin(
  teamA: Team,
  teamB: Team,
  homeTeamId: string | null,
  settings: ModelSettings,
): number {
  const baseMargin = teamStrength(teamA, settings) - teamStrength(teamB, settings);

  if (homeTeamId === teamA.id) {
    return baseMargin + settings.homeCourtAdvantage;
  }

  if (homeTeamId === teamB.id) {
    return baseMargin - settings.homeCourtAdvantage;
  }

  return baseMargin;
}

export function marginToWinProbability(
  margin: number,
  logisticScale = DEFAULT_LOGISTIC_SCALE,
): number {
  if (!Number.isFinite(margin)) {
    return 0.5;
  }

  const scale =
    Number.isFinite(logisticScale) && logisticScale > 0
      ? logisticScale
      : DEFAULT_LOGISTIC_SCALE;

  return clampProbability(1 / (1 + Math.exp(-margin / scale)));
}

export function gameWinProbability(
  teamA: Team,
  teamB: Team,
  homeTeamId: string | null,
  settings: ModelSettings,
): number {
  return marginToWinProbability(
    expectedMargin(teamA, teamB, homeTeamId, settings),
    settings.logisticScale,
  );
}
