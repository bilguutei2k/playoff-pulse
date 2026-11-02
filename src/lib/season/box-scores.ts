// The compact stored form of box scores, plus Hollinger Game Score. Pure data only.

/** One player's game: athlete ID, minutes, Game Score. */
export type StoredLine = [athleteId: string, minutes: number, gameScore: number];

export type StoredBoxScores = {
  season: number;
  /** Display names by athlete ID. */
  names: Record<string, string>;
  /** Game ID to team ID to the players who had minutes. */
  games: Record<string, Record<string, StoredLine[]>>;
};

export type CountingStats = {
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
};

/** Hollinger's Game Score, a single-number box-score summary of one game. */
export function gameScore(stats: CountingStats): number {
  return (
    stats.points +
    0.4 * stats.fieldGoalsMade -
    0.7 * stats.fieldGoalsAttempted -
    0.4 * (stats.freeThrowsAttempted - stats.freeThrowsMade) +
    0.7 * stats.offensiveRebounds +
    0.3 * stats.defensiveRebounds +
    stats.steals +
    0.7 * stats.assists +
    0.7 * stats.blocks -
    0.4 * stats.fouls -
    stats.turnovers
  );
}
