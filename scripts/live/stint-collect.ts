// The 548 score's live stints: who was on the floor for every stretch of every game, rebuilt
// from the ESPN summary the job already fetches for a game's player lines, and stored under
// data/live/stints/{seasonLabel}/{etDate}.json (`StintDay`, src/lib/score/live-stints.ts).
// Reading and building only; the pipeline decides when anything is written.
//
// Display only: stints feed the on-court part of the 548 score and nothing else. They are
// never a forecast input, and nothing here can throw: a game whose plays cannot be read or
// whose lineups fail the registered audit is recorded as rejected with its reason, and any
// other failure is returned as a problem for the log.
//
// The rebuild is the one scripts/score/build-games.ts runs for the registered seasons
// (parseScoreSummary, parsePlays, rebuildGame), repeated here so that script stays as it was.

import * as fs from "node:fs";
import * as path from "node:path";
import { fetchGameSummary, type FetchJson } from "../../src/lib/live-data/espn-season";
import { parsePlays, parseScoreSummary } from "../../src/lib/live-data/espn-plays";
import { rebuildGame } from "../../src/lib/score/lineups";
import {
  emptyStintDay,
  stintDayProblems,
  storeStint,
  type StintDay,
  type StoredStintGame,
} from "../../src/lib/score/live-stints";
import type { LineupAudit } from "../../src/lib/score/types";
import type { PlayerBoxLine, PlayerGamesDay } from "../../src/lib/season/player-stats";
import type { SeasonGame } from "../../src/lib/season/types";
import { LIVE_DIRECTORY } from "./game-store";

/**
 * Summaries fetched per run at most for games whose player lines are stored without
 * stints (newest first). They come out of the player store's own per-run cap
 * (`PLAYER_GAMES_PER_RUN`) and time budget, never on top of them.
 */
export const STINT_BACKFILL_PER_RUN = 10;

export function stintDayPath(seasonLabel: string, etDate: string): string {
  return path.join(LIVE_DIRECTORY, "stints", seasonLabel, `${etDate}.json`);
}

/**
 * Every stored stint day of the season, by ET date. Throws when a file cannot be read or is
 * malformed, so a caller never computes from part of the store.
 */
export function loadStintDays(seasonLabel: string, directory: string = path.join(LIVE_DIRECTORY, "stints", seasonLabel)): Map<string, StintDay> {
  const days = new Map<string, StintDay>();
  if (!fs.existsSync(directory)) return days;
  for (const file of fs.readdirSync(directory).sort()) {
    if (!file.endsWith(".json")) continue;
    const etDate = file.slice(0, -".json".length);
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), "utf-8"));
    const problems = stintDayProblems(raw, etDate);
    if (problems.length > 0) throw new Error(`stints ${seasonLabel}/${file}: ${problems.slice(0, 3).join("; ")}`);
    days.set(etDate, raw as StintDay);
  }
  return days;
}

function rejectedAudit(reason: string): LineupAudit {
  return {
    source: "inferred",
    wrongCountPlays: 0,
    maxPlusMinusGap: 0,
    plusMinusMisses: 0,
    maxMinutesGap: 0,
    homePointsGap: 0,
    awayPointsGap: 0,
    rejected: reason,
  };
}

/**
 * One game's stints from its ESPN summary, audited against its box score and final score.
 * Never throws: an unreadable summary, a box score with an empty side, plays that do not
 * parse or lineups that fail the audit give a rejected game with the reason.
 */
export function stintGameFromSummary(payload: unknown, game: SeasonGame): StoredStintGame {
  const homeScore = game.homeScore ?? 0;
  const awayScore = game.awayScore ?? 0;
  const base = { gameId: game.id, etDate: game.etDate, kind: game.kind, homeId: game.homeId, awayId: game.awayId, homeScore, awayScore };
  const rejected = (reason: string): StoredStintGame => ({ ...base, audit: rejectedAudit(reason), stints: null });
  try {
    if (game.status !== "final" || game.homeScore === null || game.awayScore === null) return rejected("game: not final");
    const summary = parseScoreSummary(payload, game.id);
    if (summary.homeId !== game.homeId || summary.awayId !== game.awayId) return rejected("box: summary teams differ from the schedule");
    if ([game.homeId, game.awayId].some((teamId) => summary.box[teamId].lines.every((line) => line.minutes === 0))) {
      return rejected("box: a team's box score is empty");
    }
    const box: Record<string, PlayerBoxLine[]> = {
      [game.homeId]: summary.box[game.homeId].lines,
      [game.awayId]: summary.box[game.awayId].lines,
    };
    const inactive: Record<string, string[]> = {
      [game.homeId]: summary.box[game.homeId].didNotPlay.map((row) => row.athleteId),
      [game.awayId]: summary.box[game.awayId].didNotPlay.map((row) => row.athleteId),
    };
    const roster = new Map<string, string>();
    for (const teamId of [game.homeId, game.awayId]) {
      for (const line of box[teamId]) roster.set(line.athleteId, teamId);
      for (const athleteId of inactive[teamId]) roster.set(athleteId, teamId);
    }
    let events;
    try {
      events = parsePlays(payload, game.id, game.homeId, game.awayId, roster);
    } catch (error) {
      return rejected(`plays: ${error instanceof Error ? error.message : String(error)}`);
    }
    const rebuild = rebuildGame({ homeId: game.homeId, awayId: game.awayId, homeScore, awayScore, box, inactive, events });
    if (rebuild.stints === null || rebuild.audit.rejected !== null) {
      return { ...base, audit: { ...rebuild.audit, rejected: rebuild.audit.rejected ?? "unknown" }, stints: null };
    }
    const stored: StoredStintGame = { ...base, audit: rebuild.audit, stints: rebuild.stints.map(storeStint) };
    // The stored form must pass the store's own checks, or the game is recorded as rejected.
    const problems = stintDayProblems({ ...emptyStintDay(game.etDate), games: { [game.id]: stored } }, game.etDate);
    return problems.length === 0 ? stored : rejected(`store: ${problems[0]}`);
  } catch (error) {
    return rejected(`error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Adds a game's stints to its day (created when missing) and returns the day's ET date. */
export function addStintGame(days: Map<string, StintDay>, stored: StoredStintGame): string {
  const day = days.get(stored.etDate) ?? emptyStintDay(stored.etDate);
  day.games[stored.gameId] = stored;
  days.set(stored.etDate, day);
  return stored.etDate;
}

export function hasStints(days: ReadonlyMap<string, StintDay>, etDate: string, gameId: string): boolean {
  return days.get(etDate)?.games[gameId] !== undefined;
}

export type StintRun = {
  /** Games recorded this run (accepted or rejected), newest first. */
  added: string[];
  rejected: Array<{ gameId: string; reason: string }>;
  /** Summary requests that failed (the game stays without stints and is tried again later). */
  failed: Array<{ gameId: string; problem: string }>;
  changedDates: Set<string>;
  /** Summary requests this backfill made. */
  requests: number;
  /** Games with stored player lines and no stints, after this run. */
  waiting: number;
};

/**
 * Backfills stints for games whose player lines are stored without them, newest first:
 * at most `maxRequests` summary requests, none started after `deadline` (a `now()` value).
 * A failed request leaves the game for a later run. Never throws.
 */
export async function backfillStints(input: {
  stintDays: Map<string, StintDay>;
  playerDays: ReadonlyMap<string, PlayerGamesDay>;
  games: readonly SeasonGame[];
  fetchJson: FetchJson;
  maxRequests: number;
  deadline: number;
  now?: () => number;
}): Promise<StintRun> {
  const now = input.now ?? Date.now;
  const run: StintRun = { added: [], rejected: [], failed: [], changedDates: new Set(), requests: 0, waiting: 0 };
  const byId = new Map(input.games.map((game) => [game.id, game]));
  const queue: SeasonGame[] = [];
  for (const day of input.playerDays.values()) {
    for (const gameId of Object.keys(day.games)) {
      const game = byId.get(gameId);
      if (game && game.status === "final" && !hasStints(input.stintDays, day.etDate, gameId)) queue.push(game);
    }
  }
  queue.sort((a, b) => b.tipUtc.localeCompare(a.tipUtc) || b.id.localeCompare(a.id));
  for (const game of queue) {
    if (run.requests >= Math.max(0, input.maxRequests) || now() > input.deadline) break;
    run.requests += 1;
    try {
      const stored = stintGameFromSummary(await fetchGameSummary(input.fetchJson, game.id), game);
      run.changedDates.add(addStintGame(input.stintDays, stored));
      run.added.push(game.id);
      if (stored.stints === null) run.rejected.push({ gameId: game.id, reason: stored.audit.rejected ?? "unknown" });
    } catch (error) {
      run.failed.push({ gameId: game.id, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  run.waiting = queue.length - run.added.length;
  return run;
}
