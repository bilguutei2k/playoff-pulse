// Team display helpers shared by every page: one naming style per surface, ranks by
// the published rating, standings order by record. Display only, no model math.

import { canonicalTeamAbbreviation } from "@/lib/live-data/espn-abbreviations";
import { teamPairColors, teamDisplayColor } from "@/lib/season/team-colors";
import { SEASON_TEAMS, teamById } from "@/lib/season/teams";
import type { Conference, LiveState, SeasonGame, TeamForecast } from "@/lib/season/types";

export const PANEL_COLOR = "#ffffff";

export type TeamDisplay = {
  id: string;
  /** NBA tricode, e.g. "NYK", for tables and compact labels. */
  code: string;
  /** "Knicks", for cards and lists. */
  shortName: string;
  /** "New York Knicks", for headings. */
  name: string;
  /** Lower-case ESPN abbreviation, the team page's URL segment. */
  slug: string;
  conference: Conference;
};

export function teamDisplay(id: string): TeamDisplay {
  const team = teamById(id);
  return {
    id,
    code: canonicalTeamAbbreviation(team.abbreviation),
    shortName: team.shortName,
    name: team.name,
    slug: team.abbreviation.toLowerCase(),
    conference: team.conference,
  };
}

export function teamHref(id: string): string {
  return `/teams/${teamDisplay(id).slug}`;
}

/** A team from its URL segment: the ESPN abbreviation, or the NBA tricode as an alias. */
export function teamBySlug(slug: string): TeamDisplay | null {
  const lower = slug.toLowerCase();
  const team =
    SEASON_TEAMS.find((row) => row.abbreviation.toLowerCase() === lower) ??
    SEASON_TEAMS.find((row) => canonicalTeamAbbreviation(row.abbreviation).toLowerCase() === lower);
  return team ? teamDisplay(team.id) : null;
}

export function teamColor(id: string): string {
  return teamDisplayColor(id, PANEL_COLOR);
}

/** Colors for the two halves of one bar, distinct from each other, visible on panels. */
export function pairColors(firstId: string, secondId: string): [string, string] {
  return teamPairColors(firstId, secondId, PANEL_COLOR);
}

/** 1 is the highest published rating. Ties share the better rank. */
export function ratingRanks(teams: readonly TeamForecast[]): Record<string, number> {
  const sorted = [...teams].sort((a, b) => b.rating - a.rating);
  const ranks: Record<string, number> = {};
  sorted.forEach((team, index) => {
    const previous = sorted[index - 1];
    ranks[team.teamId] =
      previous && previous.rating === team.rating ? ranks[previous.teamId] : index + 1;
  });
  return ranks;
}

export type TeamLine = {
  wins: number;
  losses: number;
  rating: number;
  /** Rank in the published rating; 0 when not shown (past days). */
  rank: number;
};

/** Record, rating and rank for every team, from the published forecast. */
export function teamLines(state: Pick<LiveState, "forecast">): Record<string, TeamLine> {
  const ranks = ratingRanks(state.forecast.teams);
  return Object.fromEntries(
    state.forecast.teams.map((team) => [
      team.teamId,
      { wins: team.wins, losses: team.losses, rating: team.rating, rank: ranks[team.teamId] },
    ]),
  );
}

/**
 * Each team's record through an ET date (that date's finals included), from the
 * games store: what a past day's cards show, since ranks then are not published.
 */
export function recordsThrough(
  games: readonly SeasonGame[],
  etDate: string,
): Record<string, TeamLine> {
  const lines: Record<string, TeamLine> = {};
  for (const team of SEASON_TEAMS) lines[team.id] = { wins: 0, losses: 0, rating: 0, rank: 0 };
  for (const game of games) {
    if (game.etDate > etDate || game.status !== "final" || game.kind === "cup-final") continue;
    if (game.homeScore === null || game.awayScore === null) continue;
    const homeWon = game.homeScore > game.awayScore;
    lines[game.homeId][homeWon ? "wins" : "losses"] += 1;
    lines[game.awayId][homeWon ? "losses" : "wins"] += 1;
  }
  return lines;
}

/**
 * Conference order by record: win percentage, then wins, then rating as a display
 * tiebreak. The NBA's tiebreak rules decide seeds in the simulation; this is only
 * the order a standings list shows today.
 */
export function conferenceOrder(teams: readonly TeamForecast[], conference: Conference): TeamForecast[] {
  const pct = (team: TeamForecast) =>
    team.wins + team.losses === 0 ? 0.5 : team.wins / (team.wins + team.losses);
  return teams
    .filter((team) => teamById(team.teamId).conference === conference)
    .sort((a, b) => pct(b) - pct(a) || b.wins - a.wins || b.rating - a.rating);
}

/** "3rd", "21st". */
export function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th";
  return `${value}${suffix}`;
}

/** "4–2": records use an en dash everywhere. */
export function formatRecord(wins: number, losses: number): string {
  return `${wins}–${losses}`;
}
