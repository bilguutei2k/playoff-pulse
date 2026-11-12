// The live job's availability inputs: box scores for newly final games and the NBA
// injury report for the slate, both stored under data/live. Reading and fetching only;
// the pipeline decides when anything is written.
//
// The report host refuses bursts, so requests go one at a time with pauses, and a file
// already downloaded for a slate is never downloaded again.

import * as fs from "node:fs";
import * as path from "node:path";
import { fetchBoxScore, fetchGameSummary, parsePlayerBoxScore, type FetchJson } from "../../src/lib/live-data/espn-season";
import {
  quarterReportNames,
  reportForSlate,
  reportUrl,
  type ParsedReport,
} from "../../src/lib/live-data/nba-reports";
import { addToNameIndex, resolvePlayer, type NameIndex } from "../../src/lib/season/availability";
import { gameScore, type StoredBoxScores, type StoredLine } from "../../src/lib/season/box-scores";
import { etWallClockOf } from "../../src/lib/season/dates";
import type { GameAvailability, ReportPoint } from "../../src/lib/season/injury-model";
import type { AvailabilitySource } from "../../src/lib/season/live-injury";
import {
  emptyReportDay,
  gameAvailabilityFromDay,
  type LiveReportDay,
} from "../../src/lib/season/live-reports";
import { NAME_INDEX_SEASONS } from "../../src/lib/season/params";
import {
  addPlayerGame,
  emptyPlayerGamesDay,
  storePlayerGame,
  type PlayerGamesDay,
} from "../../src/lib/season/player-stats";
import type { SeasonGame } from "../../src/lib/season/types";
import { buildNameIndex, loadBoxScores, loadReports } from "./availability-store";
import { LIVE_DIRECTORY } from "./game-store";

/** Box scores fetched per run at most; a backlog drains over a few runs. */
export const BOX_SCORES_PER_RUN = 12;
/** A box score whose points miss the final by more than this is not stored. */
const MAX_POINT_GAP = 5;
/** Report names tried per run, newest first, 15 minutes apart. */
const REPORT_CANDIDATES = 8;
/** Report downloads per run at most, each with one retry. */
const REPORT_DOWNLOADS = 4;
const REPORT_GAP_MS = 1000;
const REPORT_RETRY_MS = 2000;
const USER_AGENT = { "user-agent": "playoff-pulse-live" };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readJson<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as T) : null;
}

// ---------------------------------------------------------------------------
// Box scores
// ---------------------------------------------------------------------------

export function liveBoxScorePath(season: number): string {
  return path.join(LIVE_DIRECTORY, "boxscores", `${season}.json`);
}

export function loadLiveBoxScores(season: number): StoredBoxScores {
  return readJson<StoredBoxScores>(liveBoxScorePath(season)) ?? { season, names: {}, games: {} };
}

/**
 * Fetches box scores for final games that lack one, newest first, at most `limit`.
 * A game that fails stays missing and is retried next run; until then its margin
 * updates ratings unadjusted, which the engine does for any game without a box score.
 */
export async function collectBoxScores(
  store: StoredBoxScores,
  games: readonly SeasonGame[],
  fetchJson: FetchJson,
  limit = BOX_SCORES_PER_RUN,
): Promise<{ added: string[]; failed: Array<{ gameId: string; problem: string }>; waiting: number }> {
  const queue = games
    .filter(
      (game) =>
        game.status === "final" &&
        game.homeScore !== null &&
        game.awayScore !== null &&
        !store.games[game.id],
    )
    .sort((a, b) => b.tipUtc.localeCompare(a.tipUtc) || b.id.localeCompare(a.id));
  const added: string[] = [];
  const failed: Array<{ gameId: string; problem: string }> = [];
  for (const game of queue.slice(0, limit)) {
    try {
      const box = await fetchBoxScore(fetchJson, game.id);
      for (const [teamId, score] of [
        [game.homeId, game.homeScore],
        [game.awayId, game.awayScore],
      ] as const) {
        const lines = box[teamId];
        if (!lines) throw new Error(`team ${teamId} is not in the box score`);
        const points = lines.reduce((total, line) => total + line.points, 0);
        if (Math.abs(points - (score as number)) > MAX_POINT_GAP) {
          throw new Error(`team ${teamId} box points ${points}, final score ${score}`);
        }
      }
      const stored: Record<string, StoredLine[]> = {};
      for (const [teamId, lines] of Object.entries(box)) {
        stored[teamId] = lines.map((line) => {
          store.names[line.athleteId] = line.name;
          return [line.athleteId, Math.round(line.minutes), Number(gameScore(line).toFixed(1))];
        });
      }
      store.games[game.id] = stored;
      added.push(game.id);
    } catch (error) {
      failed.push({ gameId: game.id, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  return { added, failed, waiting: queue.length - added.length };
}

// ---------------------------------------------------------------------------
// Name resolution and the availability source for the replay
// ---------------------------------------------------------------------------

export type LiveAvailability = {
  index: NameIndex;
  source: AvailabilitySource;
  resolve: (season: number, teamId: string, printed: string) => string | null;
  nameOf: (athleteId: string) => string | undefined;
};

/**
 * Box scores from 2020-21 on plus the live season's, reports from 2021-22 on plus the
 * live report days, and one name index over the registered box-score seasons and the
 * live season's own box scores.
 */
export function loadLiveAvailability(
  liveSeason: number,
  liveBox: StoredBoxScores,
  liveGames: readonly SeasonGame[],
  reportDays: (etDate: string) => LiveReportDay | null,
): LiveAvailability {
  const stores = NAME_INDEX_SEASONS.map((season) => loadBoxScores(season));
  const index = buildNameIndex(stores);
  for (const [, game] of Object.entries(liveBox.games)) {
    for (const [teamId, lines] of Object.entries(game)) {
      for (const [athleteId] of lines) {
        addToNameIndex(index, liveSeason, teamId, athleteId, liveBox.names[athleteId]);
      }
    }
  }
  const names = new Map<string, string>();
  for (const store of [...stores, liveBox]) {
    for (const [athleteId, name] of Object.entries(store.names)) names.set(athleteId, name);
  }
  const box = new Map<string, Record<string, StoredLine[]>>();
  for (const store of [...stores, liveBox]) {
    for (const [gameId, game] of Object.entries(store.games)) box.set(gameId, game);
  }
  const resolve = (season: number, teamId: string, printed: string) =>
    resolvePlayer(index, season, teamId, printed);

  const past = new Map<string, GameAvailability>();
  for (const season of NAME_INDEX_SEASONS) {
    const reports = loadReports(season);
    if (!reports) continue;
    const toPoint = (point: (typeof reports.games)[string]["final"]): ReportPoint | null =>
      point && {
        at: point.at,
        notSubmitted: point.notSubmitted,
        rows: point.rows.map(([teamId, player, status, reason]) => ({
          teamId,
          athleteId: resolve(season, teamId, player),
          status,
          reason: reports.reasons[reason],
        })),
      };
    for (const [gameId, game] of Object.entries(reports.games)) {
      past.set(gameId, { morning: toPoint(game.morning), final: toPoint(game.final) });
    }
  }
  const liveById = new Map(liveGames.map((game) => [game.id, game]));
  const liveCache = new Map<string, GameAvailability | null>();
  const availability = (gameId: string): GameAvailability | null => {
    const stored = past.get(gameId);
    if (stored) return stored;
    const game = liveById.get(gameId);
    if (!game) return null;
    if (!liveCache.has(gameId)) {
      liveCache.set(
        gameId,
        gameAvailabilityFromDay(reportDays(game.etDate), game, (teamId, printed) =>
          resolve(liveSeason, teamId, printed),
        ),
      );
    }
    return liveCache.get(gameId) ?? null;
  };
  return {
    index,
    source: { boxScores: (gameId) => box.get(gameId), availability },
    resolve,
    nameOf: (athleteId) => names.get(athleteId),
  };
}

// ---------------------------------------------------------------------------
// Injury reports
// ---------------------------------------------------------------------------

export function reportDayPath(seasonLabel: string, etDate: string): string {
  return path.join(LIVE_DIRECTORY, "reports", seasonLabel, `${etDate}.json`);
}

export function loadReportDay(seasonLabel: string, etDate: string): LiveReportDay | null {
  return readJson<LiveReportDay>(reportDayPath(seasonLabel, etDate));
}

/** One request and one retry. Null when the host refuses, which is also how it says "not yet". */
export async function fetchReportPdf(name: string): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await wait(REPORT_RETRY_MS);
    try {
      const response = await fetch(reportUrl(name), { headers: USER_AGENT });
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
    } catch {
      // A network error is treated like a refusal: try once more, then move on.
    }
  }
  return null;
}

export type ReportRefresh = {
  day: LiveReportDay;
  /** A usable report at or before now was confirmed this run, downloaded or already stored. */
  succeeded: boolean;
  changed: boolean;
  downloads: number;
  log: string[];
};

/** One slate the run wants a report for: its ET date, its games, and what is stored. */
export type SlateRefreshInput = {
  etDate: string;
  /** The slate's games that are not postponed or canceled. */
  games: readonly SeasonGame[];
  day: LiveReportDay | null;
};

export type SlateRefresh = { etDate: string; day: LiveReportDay; succeeded: boolean; changed: boolean };

type Downloaded = { parsed: ParsedReport } | { problem: string } | null;

/**
 * Looks for the newest usable report at or before now for each slate: quarter-hour names
 * from now backward, already stored or freshly downloaded and validated against that
 * slate's games with `reportForSlate`. Unreadable and unusable files are remembered per
 * slate, so no run downloads a file twice for a slate; refusals are not, because a file
 * may appear later.
 *
 * The first slate leads, exactly as a single slate always did: the same names, the same
 * stopping rule and the same download budget. Every file it downloads is also cut for the
 * other slates and recorded in their day files, so one download serves all. Only then may
 * a slate still without a usable report try the names it has not seen, with whatever is
 * left of the same per-run budget, one file at a time with the same pauses. Nothing is
 * recorded in the lead's day after it is settled, so its outcome never depends on the
 * other slates.
 */
export async function refreshReportSlates(input: {
  nowIso: string;
  slates: readonly SlateRefreshInput[];
  parse: (data: Uint8Array) => Promise<ParsedReport>;
  /** Defaults to the report host, one request and one retry. */
  fetchPdf?: (name: string) => Promise<Uint8Array | null>;
  pause?: (ms: number) => Promise<void>;
}): Promise<{ slates: SlateRefresh[]; downloads: number; log: string[] }> {
  const fetchPdf = input.fetchPdf ?? fetchReportPdf;
  const pause = input.pause ?? wait;
  const nowEt = etWallClockOf(input.nowIso);
  const log: string[] = [];
  const states = input.slates.map((slate) => ({
    etDate: slate.etDate,
    games: slate.games,
    day: slate.day
      ? { ...slate.day, files: { ...slate.day.files }, reports: { ...slate.day.reports } }
      : emptyReportDay(slate.etDate),
    succeeded: false,
    changed: false,
    settled: false,
  }));
  type State = (typeof states)[number];
  const names = quarterReportNames(nowEt, REPORT_CANDIDATES);
  const downloaded = new Map<string, Downloaded>();
  let downloads = 0;

  const download = async (name: string): Promise<Downloaded> => {
    if (downloads > 0) await pause(REPORT_GAP_MS);
    downloads += 1;
    const data = await fetchPdf(name);
    let result: Downloaded;
    if (!data) result = null;
    else {
      try {
        result = { parsed: await input.parse(data) };
      } catch (error) {
        result = { problem: error instanceof Error ? error.message : String(error) };
      }
    }
    downloaded.set(name, result);
    return result;
  };

  /** Records a downloaded file in one slate's day; true when it is usable there. */
  const record = (state: State, name: string, result: Exclude<Downloaded, null>, lead: boolean): boolean => {
    const prefix = lead ? "" : `${state.etDate}: `;
    if ("problem" in result) {
      state.day.files[name] = { at: null, usable: false, problem: result.problem };
      state.changed = true;
      log.push(`${prefix}report ${name} unreadable: ${result.problem}`);
      return false;
    }
    const { parsed } = result;
    if (parsed.issuedEt > nowEt) {
      // Only possible when the clock is overridden into the past; nothing is kept.
      log.push(`${prefix}report ${name} is stamped ${parsed.issuedEt}, after now`);
      return false;
    }
    const cut = reportForSlate(parsed, name, state.etDate, state.games);
    if (!cut.ok) {
      state.day.files[name] = { at: parsed.issuedEt, usable: false, problem: cut.problem };
      state.changed = true;
      log.push(`${prefix}report ${name} unusable: ${cut.problem}`);
      return false;
    }
    state.day.files[name] = { at: parsed.issuedEt, usable: true };
    state.day.reports[parsed.issuedEt] = cut.report;
    state.changed = true;
    const unlisted = cut.unlisted.length > 0 ? `, nobody listed for team(s) ${cut.unlisted.join(", ")}` : "";
    log.push(`${prefix}report ${name} stored (${parsed.issuedEt}, ${cut.report.rows.length} rows${unlisted})`);
    return true;
  };

  /** Whether a slate already holds this name: settled if usable at or before now. */
  const alreadySeen = (state: State, name: string, lead: boolean): boolean => {
    const seen = state.day.files[name];
    if (!seen) return false;
    if (seen.usable && seen.at !== null && seen.at <= nowEt) {
      log.push(`${lead ? "" : `${state.etDate}: `}report ${name} already stored (${seen.at})`);
      state.succeeded = true;
      state.settled = true;
    }
    return true;
  };

  const [lead, ...others] = states;
  if (lead) {
    for (const name of names) {
      if (alreadySeen(lead, name, true)) {
        if (lead.settled) break;
        continue;
      }
      if (downloads >= REPORT_DOWNLOADS) break;
      const result = await download(name);
      if (!result) {
        log.push(`report ${name} refused or not published yet`);
        continue;
      }
      for (const other of others) {
        if (!other.settled && !alreadySeen(other, name, false) && record(other, name, result, false)) {
          other.succeeded = true;
          other.settled = true;
        }
      }
      if (record(lead, name, result, true)) {
        lead.succeeded = true;
        lead.settled = true;
        break;
      }
    }
    lead.settled = true;
  }
  for (const other of others) {
    for (const name of names) {
      if (other.settled) break;
      if (alreadySeen(other, name, false)) continue;
      let result = downloaded.get(name);
      if (result === undefined) {
        if (downloads >= REPORT_DOWNLOADS) break;
        result = await download(name);
        if (!result) log.push(`${other.etDate}: report ${name} refused or not published yet`);
      }
      if (result && record(other, name, result, false)) {
        other.succeeded = true;
        other.settled = true;
      }
    }
  }
  return {
    slates: states.map(({ etDate, day, succeeded, changed }) => ({ etDate, day, succeeded, changed })),
    downloads,
    log,
  };
}

/**
 * Looks for the newest usable report at or before now for one slate (see
 * `refreshReportSlates`, of which this is the one-slate case).
 */
export async function refreshReports(input: {
  nowIso: string;
  slate: string;
  /** The slate's games that are not postponed or canceled. */
  slateGames: readonly SeasonGame[];
  day: LiveReportDay | null;
  parse: (data: Uint8Array) => Promise<ParsedReport>;
}): Promise<ReportRefresh> {
  const refresh = await refreshReportSlates({
    nowIso: input.nowIso,
    slates: [{ etDate: input.slate, games: input.slateGames, day: input.day }],
    parse: input.parse,
  });
  const [only] = refresh.slates;
  return { day: only.day, succeeded: only.succeeded, changed: only.changed, downloads: refresh.downloads, log: refresh.log };
}

/**
 * The first ET date after `slate` with a game that is not postponed or canceled, and
 * those games; null when the schedule has none.
 */
export function nextGameDate(
  games: readonly SeasonGame[],
  slate: string,
): { etDate: string; games: SeasonGame[] } | null {
  let etDate: string | null = null;
  for (const game of games) {
    if (game.etDate <= slate || game.status === "postponed" || game.status === "canceled") continue;
    if (etDate === null || game.etDate < etDate) etDate = game.etDate;
  }
  if (etDate === null) return null;
  const date = etDate;
  return {
    etDate: date,
    games: games.filter((game) => game.etDate === date && game.status !== "postponed" && game.status !== "canceled"),
  };
}

// ---------------------------------------------------------------------------
// Player games: full box-score lines (never a model input)
// ---------------------------------------------------------------------------

/** Player summaries fetched per run at most, newest first; a backlog drains over a few runs. */
export const PLAYER_GAMES_PER_RUN = 40;
/** Fetching stops starting new requests after this long in one run. */
export const PLAYER_GAMES_BUDGET_MS = 120_000;
const PLAYER_FETCH_TIMEOUT_MS = 20_000;

export function playerDayPath(seasonLabel: string, etDate: string): string {
  return path.join(LIVE_DIRECTORY, "players", seasonLabel, `${etDate}.json`);
}

/** Every stored player day for the season, by ET date. */
export function loadPlayerDays(seasonLabel: string): Map<string, PlayerGamesDay> {
  const directory = path.join(LIVE_DIRECTORY, "players", seasonLabel);
  const days = new Map<string, PlayerGamesDay>();
  if (!fs.existsSync(directory)) return days;
  for (const file of fs.readdirSync(directory).sort()) {
    if (!file.endsWith(".json")) continue;
    const day = readJson<PlayerGamesDay>(path.join(directory, file));
    if (day) days.set(day.etDate, day);
  }
  return days;
}

/** ESPN JSON with a per-request timeout, so one stuck request cannot hold the job. */
export function timedFetchJson(timeoutMs = PLAYER_FETCH_TIMEOUT_MS): FetchJson {
  return async (url: string) => {
    const response = await fetch(url, {
      headers: { accept: "application/json", ...USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`ESPN request failed with HTTP ${response.status}: ${url}`);
    return response.json();
  };
}

/**
 * Stores full lines for final games that lack them, newest first, at most `limit` and
 * within `budgetMs`. A game that fails stays missing and is retried next run. Writes
 * nothing: the changed dates are returned for the job to write.
 *
 * `onSummary` sees each stored game's summary payload (the 548 score builds its stints from
 * it, so a game is requested once). It runs only after the lines are stored, and anything
 * it throws is caught and returned in `summaryProblems`: it never costs a game its lines.
 * `requests` counts every summary request made, failed ones included.
 */
export async function collectPlayerGames(
  days: Map<string, PlayerGamesDay>,
  games: readonly SeasonGame[],
  fetchJson: FetchJson,
  options: {
    limit?: number;
    budgetMs?: number;
    now?: () => number;
    onSummary?: (game: SeasonGame, payload: unknown) => void;
  } = {},
): Promise<{
  added: string[];
  changedDates: string[];
  failed: Array<{ gameId: string; problem: string }>;
  waiting: number;
  requests: number;
  summaryProblems: Array<{ gameId: string; problem: string }>;
}> {
  const limit = options.limit ?? PLAYER_GAMES_PER_RUN;
  const budgetMs = options.budgetMs ?? PLAYER_GAMES_BUDGET_MS;
  const now = options.now ?? Date.now;
  const started = now();
  const queue = games
    .filter(
      (game) =>
        game.status === "final" &&
        game.homeScore !== null &&
        game.awayScore !== null &&
        !days.get(game.etDate)?.games[game.id],
    )
    .sort((a, b) => b.tipUtc.localeCompare(a.tipUtc) || b.id.localeCompare(a.id));
  const added: string[] = [];
  const changed = new Set<string>();
  const failed: Array<{ gameId: string; problem: string }> = [];
  const summaryProblems: Array<{ gameId: string; problem: string }> = [];
  let requests = 0;
  for (const game of queue.slice(0, limit)) {
    if (now() - started > budgetMs) break;
    let payload: unknown;
    try {
      requests += 1;
      payload = await fetchGameSummary(fetchJson, game.id);
      const box = parsePlayerBoxScore(payload, game.id);
      const stored = storePlayerGame(game, box);
      const day = days.get(game.etDate) ?? emptyPlayerGamesDay(game.etDate);
      addPlayerGame(day, stored, box);
      days.set(game.etDate, day);
      changed.add(game.etDate);
      added.push(game.id);
    } catch (error) {
      failed.push({ gameId: game.id, problem: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (options.onSummary) {
      try {
        options.onSummary(game, payload);
      } catch (error) {
        summaryProblems.push({ gameId: game.id, problem: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { added, changedDates: [...changed].sort(), failed, waiting: queue.length - added.length, requests, summaryProblems };
}
