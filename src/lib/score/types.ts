// Shared types of the 548 score: the research pipeline (scripts/score/) builds these
// from ESPN game summaries, and the engine in this folder reads them. Pure data only.
//
// The 548 score is a player rating shown on the site. It is not an input of the live
// forecast: nothing under src/lib/season/ or src/lib/model/ may import from this folder.

import type { PlayerBoxLine } from "@/lib/season/player-stats";

/** Five ESPN athlete IDs on the floor for one team, sorted ascending as strings. */
export type Five = [string, string, string, string, string];

/** A stretch of play with the same ten players on the court. */
export type Stint = {
  period: number;
  /** Game-clock seconds the stint lasted. */
  seconds: number;
  home: Five;
  away: Five;
  /** Possessions that ended in the stint, by the side that had the ball. */
  homePossessions: number;
  awayPossessions: number;
  /**
   * Points scored in the stint. Free throws count for the ten players on the floor when
   * the foul was called, not for players who came in before the shots.
   */
  homePoints: number;
  awayPoints: number;
  /** Home score minus away score when the stint began. */
  startMargin: number;
};

/**
 * How the lineups at the start of each period were known. ESPN logs period-start
 * substitutions only in recent seasons; before that they are inferred from who acts
 * in the period before being substituted in.
 */
export type LineupSource = "substitutions" | "inferred";

/** How a game's rebuilt stints compare with its box score. */
export type LineupAudit = {
  source: LineupSource;
  /** Plays at which a side did not have exactly five players. Zero in a usable game. */
  wrongCountPlays: number;
  /** Largest absolute gap between a player's plus-minus from the stints and the box score's. */
  maxPlusMinusGap: number;
  /** Players whose stint plus-minus differs from the box score's by more than one point. */
  plusMinusMisses: number;
  /** Largest absolute gap, in minutes, between a player's stint time and box-score minutes. */
  maxMinutesGap: number;
  /** Stint points minus the final score, per side. Zero in a usable game. */
  homePointsGap: number;
  awayPointsGap: number;
  /** Why the game has no stints, or null when it has them. */
  rejected: string | null;
};

/** One finished game as the score reads it. */
export type ScoreGame = {
  gameId: string;
  /** NBA season by ending year: 2026 means 2025-26. */
  season: number;
  etDate: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  /** ESPN team ID to the full box lines of everyone who played. */
  box: Record<string, PlayerBoxLine[]>;
  /**
   * The game's stints in order, or null when the lineups could not be rebuilt well
   * enough (see `audit.rejected`). The box lines stay usable either way.
   */
  stints: Stint[] | null;
  audit: LineupAudit;
};
