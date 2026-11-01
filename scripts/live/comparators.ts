// Reference models used only in evaluation. Each is walk-forward: a prediction
// uses only games before it. None of these publish anything.

import { isRatable } from "../../src/lib/season/ratings";
import { teamIndex, SEASON_TEAMS } from "../../src/lib/season/teams";
import type { SeasonGame } from "../../src/lib/season/types";
import type { ScoredGame } from "./eval-metrics";

const TEAMS = SEASON_TEAMS.length;

function scoredRow(game: SeasonGame, p: number): ScoredGame {
  return {
    id: game.id,
    season: game.season,
    p,
    y: (game.homeScore as number) > (game.awayScore as number) ? 1 : 0,
  };
}

export type EloParams = { k: number; hca: number; carry: number };

/** Elo with a margin-of-victory multiplier (FiveThirtyEight's published form). */
export function eloPredictions(
  games: readonly SeasonGame[],
  params: EloParams,
): ScoredGame[] {
  const ratings = new Float64Array(TEAMS).fill(1505);
  const rows: ScoredGame[] = [];
  let currentSeason: number | null = null;
  for (const game of games) {
    if (!isRatable(game)) continue;
    if (game.season !== currentSeason) {
      if (currentSeason !== null) {
        for (let index = 0; index < TEAMS; index += 1) {
          ratings[index] = params.carry * ratings[index] + (1 - params.carry) * 1505;
        }
      }
      currentSeason = game.season;
    }
    const home = teamIndex(game.homeId);
    const away = teamIndex(game.awayId);
    const difference = ratings[home] - ratings[away] + (game.neutral ? 0 : params.hca);
    const p = 1 / (1 + 10 ** (-difference / 400));
    const row = scoredRow(game, p);
    rows.push(row);
    const margin = Math.abs((game.homeScore as number) - (game.awayScore as number));
    const winnerDifference = row.y === 1 ? difference : -difference;
    const multiplier = (margin + 3) ** 0.8 / (7.5 + 0.006 * winnerDifference);
    const change = params.k * multiplier * (row.y - p);
    ratings[home] += change;
    ratings[away] -= change;
  }
  return rows;
}

export type SrsParams = { ridge: number; hca: number; scale: number };

/** Ridge SRS on season-to-date games, refit daily, with a logistic link. */
export function srsToDatePredictions(
  games: readonly SeasonGame[],
  params: SrsParams,
): ScoredGame[] {
  const rows: ScoredGame[] = [];
  const bySeason = new Map<number, SeasonGame[]>();
  for (const game of games) {
    if (!isRatable(game)) continue;
    const list = bySeason.get(game.season) ?? [];
    list.push(game);
    bySeason.set(game.season, list);
  }
  for (const seasonGames of bySeason.values()) {
    const seen: SeasonGame[] = [];
    let ratings: Float64Array = new Float64Array(TEAMS);
    let currentDate: string | null = null;
    for (const game of seasonGames) {
      if (game.etDate !== currentDate) {
        currentDate = game.etDate;
        ratings = solveSrs(seen, params);
      }
      const home = teamIndex(game.homeId);
      const away = teamIndex(game.awayId);
      const margin = ratings[home] - ratings[away] + (game.neutral ? 0 : params.hca);
      rows.push(scoredRow(game, 1 / (1 + Math.exp(-margin / params.scale))));
      seen.push(game);
    }
  }
  return rows;
}

function solveSrs(games: readonly SeasonGame[], params: SrsParams): Float64Array {
  let ratings: Float64Array = new Float64Array(TEAMS);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sums = new Float64Array(TEAMS);
    const counts = new Float64Array(TEAMS);
    for (const game of games) {
      const home = teamIndex(game.homeId);
      const away = teamIndex(game.awayId);
      const margin =
        (game.homeScore as number) -
        (game.awayScore as number) -
        (game.neutral ? 0 : params.hca);
      sums[home] += margin + ratings[away];
      counts[home] += 1;
      sums[away] += -margin + ratings[home];
      counts[away] += 1;
    }
    const next = new Float64Array(TEAMS);
    for (let index = 0; index < TEAMS; index += 1) {
      next[index] = sums[index] / (counts[index] + params.ridge);
    }
    ratings = next;
  }
  return ratings;
}

/** Always the home-win rate of all earlier seasons; a sanity floor. */
export function homeRatePredictions(games: readonly SeasonGame[]): ScoredGame[] {
  const rows: ScoredGame[] = [];
  let wins = 0;
  let total = 0;
  let seasonWins = 0;
  let seasonTotal = 0;
  let currentSeason: number | null = null;
  for (const game of games) {
    if (!isRatable(game)) continue;
    if (game.season !== currentSeason) {
      wins += seasonWins;
      total += seasonTotal;
      seasonWins = 0;
      seasonTotal = 0;
      currentSeason = game.season;
    }
    const p = total > 0 ? wins / total : 0.6;
    const row = scoredRow(game, game.neutral ? 0.5 : p);
    rows.push(row);
    if (!game.neutral) {
      seasonWins += row.y;
      seasonTotal += 1;
    }
  }
  return rows;
}

