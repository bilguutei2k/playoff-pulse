// The live season's stints as the job stores them (data/live/stints/{seasonLabel}/{etDate}.json),
// written by scripts/live/pipeline.ts from the same ESPN summary that gives a game's player
// lines (scripts/live/stint-collect.ts). Pure: the compact form, its decoding and its checks.
// No fetch, no file access, no clock.
//
// A game whose plays could not be read, or whose rebuilt lineups failed the audit
// (src/lib/score/lineups.ts, the registered rule), is kept with `stints: null` and the
// reason in `audit.rejected`, so it is recorded once and never fetched again for stints.
// Stints feed only the 548 score's on-court part; they are never a forecast input.

import type { Five, LineupAudit, Stint } from "@/lib/score/types";

/** One stint: [period, seconds, home five, away five, home poss., away poss., home pts, away pts, start margin]. */
export type StoredStint = [
  period: number,
  seconds: number,
  home: Five,
  away: Five,
  homePossessions: number,
  awayPossessions: number,
  homePoints: number,
  awayPoints: number,
  startMargin: number,
];

export const STINT_COLUMNS = [
  "period",
  "seconds",
  "home",
  "away",
  "homePossessions",
  "awayPossessions",
  "homePoints",
  "awayPoints",
  "startMargin",
] as const;

/** The game kinds the store records, as the schedule gives them (`GameKind`). */
export type StintGameKind = "regular" | "cup-final" | "play-in" | "playoff";

export type StoredStintGame = {
  gameId: string;
  etDate: string;
  kind: StintGameKind;
  homeId: string;
  awayId: string;
  /** The final score the stints were audited against. */
  homeScore: number;
  awayScore: number;
  audit: LineupAudit;
  /** In order; null when the game was rejected (`audit.rejected` says why). */
  stints: StoredStint[] | null;
};

export type StintDay = {
  version: 1;
  etDate: string;
  columns: typeof STINT_COLUMNS;
  games: Record<string, StoredStintGame>;
};

export function emptyStintDay(etDate: string): StintDay {
  return { version: 1, etDate, columns: STINT_COLUMNS, games: {} };
}

/** Seconds to a tenth (ESPN's clock resolution), everything else as it is (whole numbers). */
export function storeStint(stint: Stint): StoredStint {
  return [
    stint.period,
    Number(stint.seconds.toFixed(1)),
    [...stint.home] as Five,
    [...stint.away] as Five,
    stint.homePossessions,
    stint.awayPossessions,
    stint.homePoints,
    stint.awayPoints,
    stint.startMargin,
  ];
}

export function readStint(stored: StoredStint): Stint {
  const [period, seconds, home, away, homePossessions, awayPossessions, homePoints, awayPoints, startMargin] = stored;
  return { period, seconds, home, away, homePossessions, awayPossessions, homePoints, awayPoints, startMargin };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isWhole = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isInteger(value) && value >= min;
const isFive = (value: unknown): value is Five =>
  Array.isArray(value) && value.length === 5 && value.every((id) => typeof id === "string" && /^\d+$/.test(id)) && new Set(value).size === 5;
const KINDS: readonly string[] = ["regular", "cup-final", "play-in", "playoff"];

/**
 * Every way a stored stint day is malformed, empty when it is well formed: the header,
 * each game's fields, five distinct players a side and none on both, whole non-negative
 * counts, a rejected game with no stints and a reason, and an accepted game whose stints
 * add up to its final score on both sides.
 */
export function stintDayProblems(raw: unknown, etDate?: string): string[] {
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.etDate !== "string" || !isRecord(raw.games)) return ["stint day is malformed"];
  if (etDate !== undefined && raw.etDate !== etDate) return [`stint day ${String(raw.etDate)} is filed under ${etDate}`];
  if (JSON.stringify(raw.columns) !== JSON.stringify(STINT_COLUMNS)) return [`stint day ${raw.etDate} has other columns`];
  const problems: string[] = [];
  for (const [gameId, rawGame] of Object.entries(raw.games)) {
    const label = `stints of game ${gameId} (${raw.etDate})`;
    if (!isRecord(rawGame) || rawGame.gameId !== gameId || rawGame.etDate !== raw.etDate) {
      problems.push(`${label} are malformed`);
      continue;
    }
    const game = rawGame as unknown as StoredStintGame;
    if (
      !KINDS.includes(game.kind) ||
      typeof game.homeId !== "string" ||
      typeof game.awayId !== "string" ||
      game.homeId === game.awayId ||
      !isWhole(game.homeScore) ||
      !isWhole(game.awayScore) ||
      !isRecord(game.audit) ||
      !(game.audit.rejected === null || typeof game.audit.rejected === "string")
    ) {
      problems.push(`${label} have a malformed header`);
      continue;
    }
    if (game.stints === null) {
      if (typeof game.audit.rejected !== "string" || game.audit.rejected.length === 0) problems.push(`${label}: a game without stints must say why`);
      continue;
    }
    if (!Array.isArray(game.stints) || game.stints.length === 0 || game.audit.rejected !== null) {
      problems.push(`${label}: an accepted game must have stints and no rejection`);
      continue;
    }
    let home = 0;
    let away = 0;
    let broken = false;
    for (const [index, stint] of game.stints.entries()) {
      if (!Array.isArray(stint) || stint.length !== STINT_COLUMNS.length) {
        problems.push(`${label}: stint ${index} is malformed`);
        broken = true;
        break;
      }
      const [period, seconds, homeFive, awayFive, homePossessions, awayPossessions, homePoints, awayPoints, startMargin] = stint;
      if (!isFive(homeFive) || !isFive(awayFive) || homeFive.some((id) => awayFive.includes(id))) {
        problems.push(`${label}: stint ${index} does not have five distinct players a side`);
        broken = true;
        break;
      }
      if (
        !isWhole(period, 1) ||
        !(typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 && seconds <= 720) ||
        ![homePossessions, awayPossessions, homePoints, awayPoints].every((value) => isWhole(value)) ||
        !(typeof startMargin === "number" && Number.isInteger(startMargin))
      ) {
        problems.push(`${label}: stint ${index} has a malformed count`);
        broken = true;
        break;
      }
      home += homePoints;
      away += awayPoints;
    }
    if (!broken && (home !== game.homeScore || away !== game.awayScore)) {
      problems.push(`${label} add up to ${home}-${away}, not the final ${game.homeScore}-${game.awayScore}`);
    }
  }
  return problems;
}
