// Runs the v4 engine over the open seasons for the fits, the diagnostic and the gate. All
// data comes through dev-data.ts (seasons after 2023-24 are refused there).

import { STATUS_CODES, type StatusCode } from "../../../src/lib/season/availability";
import { etWallClockOf } from "../../../src/lib/season/dates";
import type { ReportPoint } from "../../../src/lib/season/injury-model";
import {
  replayRosterState,
  type RosterState,
  type SideListing,
  type StatusWeights,
  type V4ForecastRow,
  type V4RatingParams,
} from "../../../src/lib/season/roster-state";
import type { SeasonGame } from "../../../src/lib/season/types";
import {
  devAvailability,
  devGames,
  devLinesLookup,
  devOpeningRosters,
  devStoredBoxLookup,
  FIRST_LINES_SEASON,
  FIRST_REPORT_SEASON,
  LAST_OPEN_SEASON,
} from "./dev-data";

export const REPORT_SEASONS = [2022, 2023, 2024] as const;
/** First season scored by the rating fits (2010-11 and 2011-12 warm the filter). */
export const FIRST_SCORED_SEASON = 2013;
export const FINAL_WINDOW_MS = 3 * 3_600_000;

let cached: {
  games: SeasonGame[];
  lines: ReturnType<typeof devLinesLookup>;
  availability: ReturnType<typeof devAvailability>;
} | null = null;

export function openData() {
  if (!cached) {
    cached = {
      games: devGames(FIRST_LINES_SEASON, LAST_OPEN_SEASON),
      lines: devLinesLookup(FIRST_LINES_SEASON, LAST_OPEN_SEASON),
      availability: devAvailability(REPORT_SEASONS),
    };
  }
  return cached;
}

/** The report a history game was played under: its final point, from 2021-22 on (information set "report"). */
export function finalPoint(game: SeasonGame): ReportPoint | null {
  if (game.season < FIRST_REPORT_SEASON) return null;
  return openData().availability(game.id)?.final ?? null;
}

const STATUS_ORDER: StatusCode[] = [
  STATUS_CODES.Out,
  STATUS_CODES.Doubtful,
  STATUS_CODES.Questionable,
  STATUS_CODES.Probable,
  STATUS_CODES.Available,
];

export function isQualifying(game: SeasonGame, availability = openData().availability): boolean {
  if (game.kind !== "regular") return false;
  const final = availability(game.id)?.final;
  if (!final || final.notSubmitted.length > 0) return false;
  const tip = Date.parse(`${etWallClockOf(game.tipUtc)}:00Z`);
  return tip - Date.parse(`${final.at}:00Z`) <= FINAL_WINDOW_MS;
}

/**
 * M3: v2's status rule refitted. The share of players listed at each status on the final
 * point of qualifying regular-season games who did not play, adjacent statuses pooled until
 * absence never rises as the status improves.
 */
export function fitStatusTable(seasons: readonly number[]): { table: StatusWeights; counts: Record<StatusCode, number> } {
  if (seasons.length === 0) throw new Error("Status table: no seasons.");
  const { games, availability } = openData();
  const box = devStoredBoxLookup(seasons);
  const set = new Set(seasons);
  const absent = Object.fromEntries(STATUS_ORDER.map((code) => [code, 0])) as Record<StatusCode, number>;
  const counts = Object.fromEntries(STATUS_ORDER.map((code) => [code, 0])) as Record<StatusCode, number>;
  for (const game of games) {
    if (!set.has(game.season) || game.status !== "final" || !isQualifying(game, availability)) continue;
    const lines = box(game.id);
    const final = availability(game.id)?.final;
    if (!lines || !final) continue;
    for (const row of final.rows) {
      if (row.athleteId === null || !lines[row.teamId]) continue;
      counts[row.status] += 1;
      if (!lines[row.teamId].some((line) => line[0] === row.athleteId)) absent[row.status] += 1;
    }
  }
  const groups = STATUS_ORDER.map((code) => ({ codes: [code], absent: absent[code], count: counts[code] }));
  for (let index = 1; index < groups.length; ) {
    const before = groups[index - 1];
    const after = groups[index];
    if (after.absent / after.count > before.absent / before.count) {
      before.codes.push(...after.codes);
      before.absent += after.absent;
      before.count += after.count;
      groups.splice(index, 1);
      index = Math.max(1, index - 1);
    } else {
      index += 1;
    }
  }
  const table = {} as Record<StatusCode, number>;
  for (const group of groups) for (const code of group.codes) table[code] = group.absent / group.count;
  return { table, counts };
}

export type RunOptions = {
  lastSeason: number;
  ratings: V4RatingParams;
  statusFor: (season: number) => StatusWeights;
  /** Seasons whose final-point reports are read (default: all report seasons up to lastSeason). */
  reportSeasons?: readonly number[];
  throughEtDate?: string;
  /** Resume from this state: only games of later seasons are replayed. */
  state?: RosterState;
  onForecast?: (row: V4ForecastRow, state: RosterState, listing: { home: SideListing; away: SideListing }) => void;
  onDate?: (etDate: string, state: RosterState) => void;
};

export function runV4(options: RunOptions): RosterState {
  if (options.lastSeason > LAST_OPEN_SEASON) throw new Error("v4 runs here stop at 2023-24.");
  const { games, lines } = openData();
  const reportSet = new Set(options.reportSeasons ?? REPORT_SEASONS);
  return replayRosterState({
    games: games.filter(
      (game) => game.season <= options.lastSeason && (options.state?.season == null || game.season > options.state.season),
    ),
    state: options.state,
    linesFor: lines,
    reportFor: (game) => (reportSet.has(game.season) ? finalPoint(game) : null),
    openingRosters: devOpeningRosters,
    params: options.ratings,
    statusTable: options.statusFor,
    throughEtDate: options.throughEtDate,
    onForecast: options.onForecast,
    onDate: options.onDate,
  });
}

/** Regular-season log loss and Brier by season, from one run. */
export function seasonScores(options: Omit<RunOptions, "onForecast">, onState?: (state: RosterState) => void): Record<number, { n: number; logLoss: number; brier: number }> {
  const sums: Record<number, { n: number; logLoss: number; brier: number }> = {};
  const state = runV4({
    ...options,
    onForecast: ({ game, forecast, y }) => {
      if (game.kind !== "regular" || game.season < FIRST_SCORED_SEASON) return;
      const p = forecast.homeWinProbability;
      const row = (sums[game.season] ??= { n: 0, logLoss: 0, brier: 0 });
      row.n += 1;
      row.logLoss -= y ? Math.log(p) : Math.log(1 - p);
      row.brier += (p - y) ** 2;
    },
  });
  onState?.(state);
  return sums;
}

// ---------------------------------------------------------------------------
// Checkpoints (exact): Float64 arrays in binary, everything else in JSON.
// ---------------------------------------------------------------------------

export function serializeRosterState(state: RosterState): Buffer {
  const n = state.n;
  const mean = Buffer.from(Float64Array.from(state.mean.subarray(0, n)).buffer);
  const covRows = new Float64Array(n * n);
  for (let row = 0; row < n; row += 1) covRows.set(state.cov.subarray(row * state.capacity, row * state.capacity + n), row * n);
  const cov = Buffer.from(covRows.buffer);
  const meta = Buffer.from(
    JSON.stringify({
      season: state.season,
      lastEtDate: state.lastEtDate,
      n,
      capacity: state.capacity,
      keys: state.keys,
      lastSeason: [...state.lastSeason],
      teamLastDate: [...state.teamLastDate],
      minutes: {
        players: [...state.minutes.players].map(([id, player]) => [id, { ...player, participation: [...player.participation] }]),
        members: [...state.minutes.members].map(([team, set]) => [team, [...set]]),
        filedRows: [...state.minutes.filedRows],
      },
      scaleWindow: state.scaleWindow,
      scale: state.scale,
    }),
  );
  const header = Buffer.alloc(8);
  header.writeUInt32LE(meta.length, 0);
  header.writeUInt32LE(n, 4);
  return Buffer.concat([header, meta, mean, cov]);
}

export function deserializeRosterState(buffer: Buffer): RosterState {
  const metaLength = buffer.readUInt32LE(0);
  const n = buffer.readUInt32LE(4);
  const meta = JSON.parse(buffer.subarray(8, 8 + metaLength).toString("utf-8"));
  const capacity = meta.capacity as number;
  const start = 8 + metaLength;
  const meanRaw = new Float64Array(buffer.buffer.slice(buffer.byteOffset + start, buffer.byteOffset + start + 8 * n));
  const covRaw = new Float64Array(buffer.buffer.slice(buffer.byteOffset + start + 8 * n, buffer.byteOffset + start + 8 * n + 8 * n * n));
  const mean = new Float64Array(capacity);
  mean.set(meanRaw);
  const cov = new Float64Array(capacity * capacity);
  for (let row = 0; row < n; row += 1) cov.set(covRaw.subarray(row * n, row * n + n), row * capacity);
  return {
    season: meta.season,
    lastEtDate: meta.lastEtDate,
    n,
    capacity,
    keys: meta.keys,
    slots: new Map((meta.keys as string[]).map((key, index) => [key, index])),
    mean,
    cov,
    lastSeason: new Map(meta.lastSeason),
    teamLastDate: new Map(meta.teamLastDate),
    minutes: {
      players: new Map(
        (meta.minutes.players as Array<[string, Record<string, unknown>]>).map(([id, player]) => [
          id,
          { ...(player as object), participation: new Map(player.participation as Array<[number, { games: number; played: number }]>) } as never,
        ]),
      ),
      members: new Map((meta.minutes.members as Array<[string, string[]]>).map(([team, ids]) => [team, new Set(ids)])),
      filedRows: new Map(meta.minutes.filedRows),
    },
    scaleWindow: meta.scaleWindow,
    scale: meta.scale,
  };
}
