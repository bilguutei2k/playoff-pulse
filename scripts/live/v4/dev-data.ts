// The only data access of every v4 fit, diagnostic and gate script. Every loader refuses a
// season after 2023-24: 2024-25 and 2025-26 are closed (v4 plan, section 0), and only
// `warm-state.ts` may pass through them, returning a state and nothing else.
// tests/roster-state-isolation.test.ts asserts the refusal and that no other file under
// scripts/live/v4 imports a season loader directly.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  addToNameIndex,
  createNameIndex,
  resolvePlayer,
  type NameIndex,
  type StoredReports,
} from "../../../src/lib/season/availability";
import type { StoredBoxScores, StoredLine } from "../../../src/lib/season/box-scores";
import type { GameAvailability, ReportPoint } from "../../../src/lib/season/injury-model";
import type { V4GameLines } from "../../../src/lib/season/roster-state";
import type { SeasonGame } from "../../../src/lib/season/types";
import { readPlayerGames, readReports, readSeasonGames, readSpreads, seasonFilePaths, type StoredSpreads } from "./season-files";

export const LAST_OPEN_SEASON = 2024;
export const FIRST_LINES_SEASON = 2011;
export const FIRST_REPORT_SEASON = 2022;
/** v2's identity seasons, minus the closed ones. */
export const NAME_SEASONS = [2021, 2022, 2023, 2024] as const;

export function assertOpen(season: number): void {
  if (!Number.isInteger(season) || season > LAST_OPEN_SEASON) {
    throw new Error(`v4 dev-data: season ${season} is closed (2024-25 and 2025-26 are never read here).`);
  }
}

const read: string[] = [];
const note = (season: number) => {
  for (const file of seasonFilePaths(season)) if (!read.includes(file)) read.push(file);
};
/** Every data file the loaders have read, for provenance. */
export function filesRead(): string[] {
  return [...read].sort();
}

/** Chronological, with the ESPN ID as a stable tie-break. */
export function compareGames(a: SeasonGame, b: SeasonGame): number {
  const byTip = Date.parse(a.tipUtc) - Date.parse(b.tipUtc);
  return byTip !== 0 ? byTip : a.id.localeCompare(b.id);
}

export function devSeasonGames(season: number): SeasonGame[] {
  assertOpen(season);
  note(season);
  return readSeasonGames(season);
}

/** Games of seasons first..last, chronological. */
export function devGames(first: number, last: number): SeasonGame[] {
  assertOpen(last);
  const games: SeasonGame[] = [];
  for (let season = first; season <= last; season += 1) games.push(...devSeasonGames(season));
  return games.sort(compareGames);
}

const linesCache = new Map<number, Map<string, V4GameLines>>();
export function devLines(season: number): Map<string, V4GameLines> {
  assertOpen(season);
  let lines = linesCache.get(season);
  if (!lines) {
    note(season);
    const file = readPlayerGames(season);
    lines = new Map(Object.entries(file.games) as Array<[string, V4GameLines]>);
    linesCache.set(season, lines);
  }
  return lines;
}

/** One lookup over several seasons' lines. */
export function devLinesLookup(first: number, last: number): (gameId: string) => V4GameLines | undefined {
  const all = new Map<string, V4GameLines>();
  for (let season = Math.max(first, FIRST_LINES_SEASON); season <= last; season += 1) {
    for (const [id, lines] of devLines(season)) all.set(id, lines);
  }
  return (gameId) => all.get(gameId);
}

/**
 * History's opening rosters (disclosed): the players with minutes in each team's first five
 * regular-season games of the season. Membership only; no result enters.
 */
export function devOpeningRosters(season: number): Map<string, string[]> {
  assertOpen(season);
  const rosters = new Map<string, Set<string>>();
  if (season < FIRST_LINES_SEASON) return new Map();
  const lines = devLines(season);
  const counts = new Map<string, number>();
  for (const game of devSeasonGames(season).filter((row) => row.kind === "regular" && row.status === "final").sort(compareGames)) {
    for (const teamId of [game.homeId, game.awayId]) {
      const seen = counts.get(teamId) ?? 0;
      if (seen >= 5) continue;
      counts.set(teamId, seen + 1);
      const set = rosters.get(teamId) ?? new Set<string>();
      for (const line of lines.get(game.id)?.[teamId] ?? []) if (line[1] > 0) set.add(line[0]);
      rosters.set(teamId, set);
    }
  }
  return new Map([...rosters].map(([teamId, set]) => [teamId, [...set].sort()]));
}

const boxDirectory = () => path.join(process.cwd(), "data/season/boxscores");
export function devStoredBoxScores(season: number): StoredBoxScores {
  assertOpen(season);
  const file = path.join(boxDirectory(), `${season}.json`);
  const relative = path.join("data/season/boxscores", `${season}.json`);
  if (!read.includes(relative)) read.push(relative);
  return JSON.parse(fs.readFileSync(file, "utf-8")) as StoredBoxScores;
}

let nameIndex: NameIndex | null = null;
/** v2's resolver (roster first, then a unique name) over the open identity seasons 2020-21 to 2023-24. */
export function devNameIndex(): NameIndex {
  if (nameIndex) return nameIndex;
  const index = createNameIndex();
  for (const season of NAME_SEASONS) {
    const store = devStoredBoxScores(season);
    for (const game of Object.values(store.games)) {
      for (const [teamId, lines] of Object.entries(game)) {
        for (const line of lines) addToNameIndex(index, store.season, teamId, line[0], store.names[line[0]]);
      }
    }
  }
  nameIndex = index;
  return index;
}

export function devRawReports(season: number): StoredReports | null {
  assertOpen(season);
  note(season);
  return readReports(season);
}

/** Resolved report points per game for the given seasons (2021-22 to 2023-24 hold reports). */
export function devAvailability(seasons: readonly number[]): (gameId: string) => GameAvailability | null {
  const index = devNameIndex();
  const points = new Map<string, GameAvailability>();
  for (const season of seasons) {
    const reports = devRawReports(season);
    if (!reports) throw new Error(`No stored reports for ${season}.`);
    const toPoint = (point: StoredReports["games"][string]["final"]): ReportPoint | null =>
      point && {
        at: point.at,
        notSubmitted: point.notSubmitted,
        rows: point.rows.map(([teamId, player, status, reason]) => ({
          teamId,
          athleteId: resolvePlayer(index, season, teamId, player),
          status,
          reason: reports.reasons[reason],
        })),
      };
    for (const [gameId, game] of Object.entries(reports.games)) {
      points.set(gameId, { morning: toPoint(game.morning), final: toPoint(game.final) });
    }
  }
  return (gameId) => points.get(gameId) ?? null;
}

/** Stored (minutes and Game Score) box scores for v2's replay, 2020-21 to the given season. */
export function devStoredBoxLookup(seasons: readonly number[]): (gameId: string) => Record<string, StoredLine[]> | undefined {
  const box = new Map<string, Record<string, StoredLine[]>>();
  for (const season of seasons) {
    for (const [gameId, game] of Object.entries(devStoredBoxScores(season).games)) box.set(gameId, game);
  }
  return (gameId) => box.get(gameId);
}

export function devSpreads(season: number): StoredSpreads | null {
  assertOpen(season);
  return readSpreads(season);
}
