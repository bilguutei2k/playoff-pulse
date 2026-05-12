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

export type RandomSource = () => number;

function hashSeed(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom(seed: number): RandomSource {
  let state = seed || 1;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function getGameNumber(winsA: number, winsB: number): number {
  return winsA + winsB + 1;
}

function teamSimulationSignature(team: Team, settings: ModelSettings): string {
  const playerSignature = team.players
    .map((player) =>
      [
        player.id,
        player.impact,
        player.projectedMinutes,
        player.injuryStatus,
      ].join(":"),
    )
    .join("|");

  return [
    team.id,
    team.eloRating,
    team.netRating,
    team.manualAdjustment,
    playerMinuteWeightedImpact(team).toFixed(4),
    teamStrength(team, settings).toFixed(4),
    playerSignature,
  ].join(";");
}

export function createSeededRandom(seedInput: string): RandomSource {
  return seededRandom(hashSeed(seedInput));
}

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

  return {
    gameNumber,
    homeTeamId: homeTeamId ?? "neutral",
    expectedMarginForTeamA: expectedMargin(teamA, teamB, homeTeamId, settings),
    teamAWinProbability,
    teamBWinProbability: clampProbability(1 - teamAWinProbability),
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
  const simulationCount = Math.max(1, Math.floor(iterations));

  if (!teamA || !teamB) {
    throw new Error(`Cannot simulate ${series.id}: one or both teams are missing.`);
  }

  let teamAWinsSeries = 0;
  let totalGamesRemaining = 0;
  const random = createSeededRandom(
    [
      series.id,
      series.winsA,
      series.winsB,
      series.homePattern.join(","),
      settings.homeCourtAdvantage,
      settings.logisticScale,
      simulationCount,
      teamSimulationSignature(teamA, settings),
      teamSimulationSignature(teamB, settings),
    ].join(":"),
  );

  for (let iteration = 0; iteration < simulationCount; iteration += 1) {
    const outcome = simulateSeriesOutcome(series, teamsById, settings, random);

    if (outcome.winnerId === series.teamA) {
      teamAWinsSeries += 1;
    }

    totalGamesRemaining += outcome.gamesPlayed;
  }

  const teamASeriesWinProbability = clampProbability(
    teamAWinsSeries / simulationCount,
  );

  return {
    seriesId: series.id,
    teamAId: series.teamA,
    teamBId: series.teamB,
    winsA: series.winsA,
    winsB: series.winsB,
    nextGame: nextGameForecast(series, teamsById, settings),
    teamASeriesWinProbability,
    teamBSeriesWinProbability: clampProbability(1 - teamASeriesWinProbability),
    expectedGamesRemaining: totalGamesRemaining / simulationCount,
    iterations: simulationCount,
    teamStrengthDifference:
      teamStrength(teamA, settings) - teamStrength(teamB, settings),
  };
}
