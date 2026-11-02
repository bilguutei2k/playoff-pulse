// The live job's availability inputs: box scores for newly final games and the NBA
// injury report for the slate, both stored under data/live. Reading and fetching only;
// the pipeline decides when anything is written.
//
// The report host refuses bursts, so requests go one at a time with pauses, and a file
// already downloaded for a slate is never downloaded again.

import * as fs from "node:fs";
import * as path from "node:path";
import { fetchBoxScore, type FetchJson } from "../../src/lib/live-data/espn-season";
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
async function fetchReportPdf(name: string): Promise<Uint8Array | null> {
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

/**
 * Looks for the newest usable report at or before now: quarter-hour names from now
 * backward, stopping at the first usable one, already stored or freshly downloaded and
 * validated against the slate. Unreadable and unusable files are remembered too, so no
 * run downloads a file twice; refusals are not, because a file may appear later.
 */
export async function refreshReports(input: {
  nowIso: string;
  slate: string;
  /** The slate's games that are not postponed or canceled. */
  slateGames: readonly SeasonGame[];
  day: LiveReportDay | null;
  parse: (data: Uint8Array) => Promise<ParsedReport>;
}): Promise<ReportRefresh> {
  const day: LiveReportDay = input.day
    ? { ...input.day, files: { ...input.day.files }, reports: { ...input.day.reports } }
    : emptyReportDay(input.slate);
  const nowEt = etWallClockOf(input.nowIso);
  const log: string[] = [];
  let downloads = 0;
  let changed = false;
  for (const name of quarterReportNames(nowEt, REPORT_CANDIDATES)) {
    const seen = day.files[name];
    if (seen) {
      if (seen.usable && seen.at !== null && seen.at <= nowEt) {
        log.push(`report ${name} already stored (${seen.at})`);
        return { day, succeeded: true, changed, downloads, log };
      }
      continue;
    }
    if (downloads >= REPORT_DOWNLOADS) break;
    if (downloads > 0) await wait(REPORT_GAP_MS);
    downloads += 1;
    const data = await fetchReportPdf(name);
    if (!data) {
      log.push(`report ${name} refused or not published yet`);
      continue;
    }
    let parsed;
    try {
      parsed = await input.parse(data);
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      day.files[name] = { at: null, usable: false, problem };
      changed = true;
      log.push(`report ${name} unreadable: ${problem}`);
      continue;
    }
    if (parsed.issuedEt > nowEt) {
      // Only possible when the clock is overridden into the past; nothing is kept.
      log.push(`report ${name} is stamped ${parsed.issuedEt}, after now`);
      continue;
    }
    const cut = reportForSlate(parsed, name, input.slate, input.slateGames);
    if (!cut.ok) {
      day.files[name] = { at: parsed.issuedEt, usable: false, problem: cut.problem };
      changed = true;
      log.push(`report ${name} unusable: ${cut.problem}`);
      continue;
    }
    day.files[name] = { at: parsed.issuedEt, usable: true };
    day.reports[parsed.issuedEt] = cut.report;
    changed = true;
    const unlisted = cut.unlisted.length > 0 ? `, nobody listed for team(s) ${cut.unlisted.join(", ")}` : "";
    log.push(`report ${name} stored (${parsed.issuedEt}, ${cut.report.rows.length} rows${unlisted})`);
    return { day, succeeded: true, changed, downloads, log };
  }
  return { day, succeeded: false, changed, downloads, log };
}
