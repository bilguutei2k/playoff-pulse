import type {
  GameForecast,
  ModelSettings,
  Series,
  SeriesForecast,
  SeriesSimulationOutcome,
  Team,
} from "@/lib/model/types";
import {
  clampProbability,
  expectedMargin,
  gameWinProbability,
  playerMinuteWeightedImpact,
  teamStrength,
} from "@/lib/model/probability";
import { solveSeriesExactly } from "@/lib/model/series-solver";
import {
  estimateAvailabilityScenarios,
  estimateSeriesUncertainty,
} from "@/lib/model/uncertainty";
import type { RandomSource } from "@/lib/model/random";

function getGameNumber(winsA: number, winsB: number): number {
  return winsA + winsB + 1;
}

export { createSeededRandom } from "@/lib/model/random";

export function nextGameForecast(
  series: Series,
  teamsById: Record<string, Team>,
  settings: ModelSettings,
): GameForecast | null {
  if (series.winsA >= 4 || series.winsB >= 4) {
    return null;
  }

  const teamA = teamsById[series.teamA];
  const teamB = teamsById[series.teamB];

  if (!teamA || !teamB) {
    throw new Error(`Cannot forecast ${series.id}: one or both teams are missing.`);
  }

  const gameNumber = getGameNumber(series.winsA, series.winsB);
  const homeTeamId = series.homePattern[gameNumber - 1] ?? null;
  const teamAWinProbability = clampProbability(
    gameWinProbability(teamA, teamB, homeTeamId, settings),
  );
  const homeCourt =
    homeTeamId === teamA.id
      ? settings.homeCourtAdvantage
      : homeTeamId === teamB.id
        ? -settings.homeCourtAdvantage
        : 0;
  const drivers = [
    {
      label: "Player rotation",
      marginPointsForTeamA:
        settings.playerWeight *
        (playerMinuteWeightedImpact(teamA) - playerMinuteWeightedImpact(teamB)),
    },
    {
      label: "Net rating",
      marginPointsForTeamA:
        settings.netRatingWeight * (teamA.netRating - teamB.netRating),
    },
    {
      label: "Rating proxy",
      marginPointsForTeamA:
        settings.eloWeight * ((teamA.eloRating - teamB.eloRating) / 35),
    },
    {
      label: "Manual adjustment",
      marginPointsForTeamA: teamA.manualAdjustment - teamB.manualAdjustment,
    },
    { label: "Home court", marginPointsForTeamA: homeCourt },
  ];

  return {
    gameNumber,
    homeTeamId: homeTeamId ?? "neutral",
    expectedMarginForTeamA: expectedMargin(teamA, teamB, homeTeamId, settings),
    teamAWinProbability,
    teamBWinProbability: clampProbability(1 - teamAWinProbability),
    drivers,
  };
}

export function simulateSeriesOutcome(
  series: Series,
  teamsById: Record<string, Team>,
  settings: ModelSettings,
  random: RandomSource,
): SeriesSimulationOutcome {
  const teamA = teamsById[series.teamA];
  const teamB = teamsById[series.teamB];

  if (!teamA || !teamB) {
    throw new Error(`Cannot simulate ${series.id}: one or both teams are missing.`);
  }

  let winsA = series.winsA;
  let winsB = series.winsB;
  let gamesPlayed = 0;

  while (winsA < 4 && winsB < 4) {
    const gameNumber = getGameNumber(winsA, winsB);
    const homeTeamId = series.homePattern[gameNumber - 1] ?? null;
    const probabilityA = clampProbability(
      gameWinProbability(teamA, teamB, homeTeamId, settings),
    );

    if (random() < probabilityA) {
      winsA += 1;
    } else {
      winsB += 1;
    }

    gamesPlayed += 1;
  }

  return {
    winnerId: winsA === 4 ? series.teamA : series.teamB,
    loserId: winsA === 4 ? series.teamB : series.teamA,
    winsA,
    winsB,
    gamesPlayed,
  };
}

export function estimateSeriesProbability(
  series: Series,
  teamsById: Record<string, Team>,
  settings: ModelSettings,
  iterations = settings.simulationIterations,
): SeriesForecast {
  const teamA = teamsById[series.teamA];
  const teamB = teamsById[series.teamB];
  void iterations; // retained for API compatibility; central series estimates are exact.

  if (!teamA || !teamB) {
    throw new Error(`Cannot simulate ${series.id}: one or both teams are missing.`);
  }

  const solution = solveSeriesExactly(
    series.winsA,
    series.winsB,
    (gameNumber) =>
      gameWinProbability(
        teamA,
        teamB,
        series.homePattern[gameNumber - 1] ?? null,
        settings,
      ),
  );
  const teamASeriesWinProbability = solution.teamAWinProbability;

  return {
    seriesId: series.id,
    teamAId: series.teamA,
    teamBId: series.teamB,
    winsA: series.winsA,
    winsB: series.winsB,
    nextGame: nextGameForecast(series, teamsById, settings),
    teamASeriesWinProbability,
    teamBSeriesWinProbability: clampProbability(1 - teamASeriesWinProbability),
    expectedGamesRemaining: solution.expectedGamesRemaining,
    iterations: 0,
    computationMethod: "exact",
    finalScoreProbabilities: solution.finalScoreProbabilities,
    uncertainty: estimateSeriesUncertainty(series, teamA, teamB, settings),
    scenarioImpacts: estimateAvailabilityScenarios(series, teamA, teamB, settings),
    teamStrengthDifference:
      teamStrength(teamA, settings) - teamStrength(teamB, settings),
  };
}
