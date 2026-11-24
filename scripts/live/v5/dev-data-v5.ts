// v5's only data access beyond v4's dev-data.ts (which every v5 script uses for games,
// lines and reports): the plus/minus files of step 1. Every loader refuses a season after
// 2023-24, exactly as dev-data.ts does; tests/roster-state-v5-isolation.test.ts asserts it
// and that no other file under scripts/live/v5 reads a season file directly.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { assertOpen } from "../v4/dev-data";

export { assertOpen, LAST_OPEN_SEASON } from "../v4/dev-data";

type PlayerPmFile = { season: number; games: Record<string, Record<string, Array<[string, number]>>> };

const cache = new Map<number, Map<string, Map<string, Map<string, number>>>>();
const read: string[] = [];

/** One season's plus/minus: game id -> team id -> athlete id -> plus/minus. */
export function devPlusMinus(season: number): Map<string, Map<string, Map<string, number>>> {
  assertOpen(season);
  let games = cache.get(season);
  if (!games) {
    const relative = path.join("data/season/player-pm", `${season}.json.gz`);
    const file = path.join(process.cwd(), relative);
    games = new Map();
    if (fs.existsSync(file)) {
      if (!read.includes(relative)) read.push(relative);
      const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8")) as PlayerPmFile;
      for (const [gameId, teams] of Object.entries(parsed.games)) {
        games.set(gameId, new Map(Object.entries(teams).map(([teamId, rows]) => [teamId, new Map(rows)])));
      }
    }
    cache.set(season, games);
  }
  return games;
}

/** One lookup over seasons first..last (each refused if closed). */
export function devPlusMinusLookup(first: number, last: number): (gameId: string, teamId: string) => ReadonlyMap<string, number> | null {
  assertOpen(last);
  const all = new Map<string, Map<string, Map<string, number>>>();
  for (let season = first; season <= last; season += 1) for (const [id, game] of devPlusMinus(season)) all.set(id, game);
  return (gameId, teamId) => all.get(gameId)?.get(teamId) ?? null;
}

/** The plus/minus files the loader has read, for provenance. */
export function plusMinusFilesRead(): string[] {
  return [...read].sort();
}
