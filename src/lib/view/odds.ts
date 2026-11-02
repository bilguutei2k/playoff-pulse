// Rows for the odds table and the team pages: the published forecast's own fields,
// with display names attached. Nothing here is computed beyond counting each team's
// regular-season games for the projected loss column.

import type { Conference, LiveState, SeasonGame } from "@/lib/season/types";
import { ratingRanks, teamDisplay } from "@/lib/view/teams";

export type OddsRow = {
  teamId: string;
  code: string;
  shortName: string;
  name: string;
  slug: string;
  conference: Conference;
  wins: number;
  losses: number;
  rating: number;
  ratingRank: number;
  /** Rating minus points lost to current absences; null when the model has no injury term. */
  ratingNow: number | null;
  projectedWins: number;
  projectedLosses: number;
  projectedWinsP10: number;
  projectedWinsP90: number;
  seeds: number[];
  playIn: number;
  makePlayoffs: number;
  topSix: number;
  reachConferenceFinals: number;
  reachFinals: number;
  champion: number;
};

const DEFAULT_SEASON_GAMES = 82;

/** Regular-season games on each team's schedule; the NBA Cup final does not count. */
export function seasonLengths(games: readonly SeasonGame[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const game of games) {
    if (game.kind !== "regular" || game.status === "canceled") continue;
    counts[game.homeId] = (counts[game.homeId] ?? 0) + 1;
    counts[game.awayId] = (counts[game.awayId] ?? 0) + 1;
  }
  return counts;
}

export function oddsRows(state: LiveState, games: readonly SeasonGame[]): OddsRow[] {
  const ranks = ratingRanks(state.forecast.teams);
  const lengths = seasonLengths(games);
  const modeled = state.injury !== null;
  return state.forecast.teams.map((team) => {
    const display = teamDisplay(team.teamId);
    const length = lengths[team.teamId] ?? DEFAULT_SEASON_GAMES;
    return {
      teamId: team.teamId,
      code: display.code,
      shortName: display.shortName,
      name: display.name,
      slug: display.slug,
      conference: display.conference,
      wins: team.wins,
      losses: team.losses,
      rating: team.rating,
      ratingRank: ranks[team.teamId],
      ratingNow: modeled ? (state.currentRatings[team.teamId] ?? team.rating) : null,
      projectedWins: team.projectedWins,
      projectedLosses: Math.max(0, length - team.projectedWins),
      projectedWinsP10: team.projectedWinsP10,
      projectedWinsP90: team.projectedWinsP90,
      seeds: team.seedProbabilities,
      playIn: team.playIn,
      makePlayoffs: team.makePlayoffs,
      topSix: team.topSix,
      reachConferenceFinals: team.reachConferenceFinals,
      reachFinals: team.reachFinals,
      champion: team.champion,
    };
  });
}

/** "+5.8", "−1.7": ratings are points per game against an average team. */
export function formatRating(value: number): string {
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}
