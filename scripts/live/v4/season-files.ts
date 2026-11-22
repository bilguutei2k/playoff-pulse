// Raw season loaders for v4. Only two modules may import this file (tests/roster-state-
// isolation.test.ts): `dev-data.ts`, whose loaders refuse every season after 2023-24, and
// `warm-state.ts`, which passes through the closed seasons to reach today's state and
// returns a state and nothing else. The builder of the player-game files
// (`build-player-games.ts`) imports only the format below.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { StoredReports } from "../../../src/lib/season/availability";
import type { SeasonGame } from "../../../src/lib/season/types";

export const PLAYER_GAMES_DIRECTORY = "data/season/player-games";
export const USABLE_TEAM_MINUTES = 200;

/**
 * One season's lines. A full line is [athleteId, minutes, ...stats in `stats` order]; a
 * minutes-only line (play-in and playoffs from data/season/boxscores) is [athleteId, minutes].
 */
export type PlayerGameLine = [string, number, ...number[]];
export type PlayerGamesFile = {
  season: number;
  stats: string[];
  names: Record<string, string>;
  /** Game ID to team ID to the lines with positive minutes (empty when none were stored). */
  games: Record<string, Record<string, PlayerGameLine[]>>;
};

const root = () => process.cwd();

export function readSeasonGames(season: number): SeasonGame[] {
  const file = path.join(root(), "data/season/games", `${season}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf-8")) as SeasonGame[];
}

export function readPlayerGames(season: number): PlayerGamesFile {
  const file = path.join(root(), PLAYER_GAMES_DIRECTORY, `${season}.json.gz`);
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8")) as PlayerGamesFile;
}

export function readReports(season: number): StoredReports | null {
  const file = path.join(root(), "data/season/reports", `${season}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as StoredReports;
}

export type StoredSpreads = Record<string, unknown>;
export function readSpreads(season: number): StoredSpreads | null {
  const file = path.join(root(), "data/season/spreads", `${season}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as StoredSpreads;
}

/** The files a loader reads, for provenance. */
export function seasonFilePaths(season: number): string[] {
  return [
    path.join("data/season/games", `${season}.json`),
    path.join(PLAYER_GAMES_DIRECTORY, `${season}.json.gz`),
    path.join("data/season/reports", `${season}.json`),
  ].filter((file) => fs.existsSync(path.join(root(), file)));
}
