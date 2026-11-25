// The one v5 module that passes through the closed seasons (2024-25 and 2025-26): it runs v5's
// filter (src/lib/season/roster-state-v5.ts, observation 3 on with the frozen s3 throughout) to
// the state after 2025-26 for the live job, and returns a state and nothing else, exactly as
// scripts/live/v4/warm-state.ts does for v4. It prints, logs and stores nothing about those
// seasons, and computes no score. The closed seasons' plus/minus is read only here, by this
// module's own reader; the development loader (scripts/live/v5/dev-data-v5.ts) refuses them
// and keeps refusing (tests/roster-state-v5-isolation.test.ts, tests/v5-shadow-isolation.test.ts).

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { addToNameIndex, createNameIndex, resolvePlayer, type StoredReports } from "../../../src/lib/season/availability";
import type { StoredBoxScores } from "../../../src/lib/season/box-scores";
import type { ReportPoint } from "../../../src/lib/season/injury-model";
import { V4_FROZEN } from "../../../src/lib/season/params-v4";
import { V5_FROZEN, withOnCourt } from "../../../src/lib/season/params-v5";
import { warmState, type RosterState, type V4GameLines } from "../../../src/lib/season/roster-state-v5";
import type { SeasonGame } from "../../../src/lib/season/types";
import { readPlayerGames, readReports, readSeasonGames } from "../v4/season-files";

const FIRST = 2011;
const REPORTS_FROM = 2022;
const PLAYER_PM_DIRECTORY = "data/season/player-pm";

type PlayerPmFile = { season: number; games: Record<string, Record<string, Array<[string, number]>>> };

function compareGames(a: SeasonGame, b: SeasonGame): number {
  const byTip = Date.parse(a.tipUtc) - Date.parse(b.tipUtc);
  return byTip !== 0 ? byTip : a.id.localeCompare(b.id);
}

/** This module's own plus/minus reader: game id -> team id -> athlete id -> plus/minus, seasons first..last. */
function storedPlusMinus(first: number, last: number): Map<string, Map<string, Map<string, number>>> {
  const all = new Map<string, Map<string, Map<string, number>>>();
  for (let season = first; season <= last; season += 1) {
    const file = path.join(process.cwd(), PLAYER_PM_DIRECTORY, `${season}.json.gz`);
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8")) as PlayerPmFile;
    for (const [gameId, teams] of Object.entries(parsed.games)) {
      all.set(gameId, new Map(Object.entries(teams).map(([teamId, rows]) => [teamId, new Map(rows)])));
    }
  }
  return all;
}

/**
 * v5's state after every ET date before `throughEtDate`, through the stored seasons (last stored
 * season inclusive), with v4's frozen parameters, its status weights and the frozen s3.
 */
export function warmStateV5Through(options: { lastStoredSeason: number; throughEtDate: string }): RosterState {
  const games: SeasonGame[] = [];
  const lines = new Map<string, V4GameLines>();
  const names = createNameIndex();
  const reports = new Map<number, StoredReports>();
  for (let season = FIRST; season <= options.lastStoredSeason; season += 1) {
    games.push(...readSeasonGames(season));
    for (const [id, game] of Object.entries(readPlayerGames(season).games)) lines.set(id, game as V4GameLines);
    const box = path.join(process.cwd(), "data/season/boxscores", `${season}.json`);
    if (fs.existsSync(box)) {
      const store = JSON.parse(fs.readFileSync(box, "utf-8")) as StoredBoxScores;
      for (const game of Object.values(store.games)) {
        for (const [teamId, rows] of Object.entries(game)) for (const row of rows) addToNameIndex(names, season, teamId, row[0], store.names[row[0]]);
      }
    }
    if (season >= REPORTS_FROM) {
      const stored = readReports(season);
      if (stored) reports.set(season, stored);
    }
  }
  games.sort(compareGames);
  const opening = new Map<number, Map<string, string[]>>();
  const openingRosters = (season: number) => {
    let rosters = opening.get(season);
    if (!rosters) {
      const counts = new Map<string, number>();
      const sets = new Map<string, Set<string>>();
      for (const game of games.filter((row) => row.season === season && row.kind === "regular" && row.status === "final")) {
        for (const teamId of [game.homeId, game.awayId]) {
          if ((counts.get(teamId) ?? 0) >= 5) continue;
          counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
          const set = sets.get(teamId) ?? new Set<string>();
          for (const line of lines.get(game.id)?.[teamId] ?? []) if (line[1] > 0) set.add(line[0]);
          sets.set(teamId, set);
        }
      }
      rosters = new Map([...sets].map(([teamId, set]) => [teamId, [...set].sort()]));
      opening.set(season, rosters);
    }
    return rosters;
  };
  const reportFor = (game: SeasonGame): ReportPoint | null => {
    const stored = reports.get(game.season);
    const point = stored?.games[game.id]?.final;
    if (!stored || !point) return null;
    return {
      at: point.at,
      notSubmitted: point.notSubmitted,
      rows: point.rows.map(([teamId, player, status, reason]) => ({
        teamId,
        athleteId: resolvePlayer(names, game.season, teamId, player),
        status,
        reason: stored.reasons[reason],
      })),
    };
  };
  const plusMinus = storedPlusMinus(FIRST, options.lastStoredSeason);
  return warmState({
    games,
    linesFor: (id) => lines.get(id),
    reportFor,
    openingRosters,
    params: withOnCourt(V4_FROZEN.ratings, { s3: V5_FROZEN.s3, plusMinus: (gameId, teamId) => plusMinus.get(gameId)?.get(teamId) ?? null }),
    statusTable: () => V4_FROZEN.statusTable,
    throughEtDate: options.throughEtDate,
  });
}
