// Where the 548 score's research data lives on disk, and how it is read and written.
//
// Everything here sits under data/historical/raw/, which Git ignores: raw ESPN game
// summaries and the per-season game files built from them. Only fitted results and
// audits (docs/score/) and the frozen coefficients are committed.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { ScoreGame } from "../../src/lib/score/types";

export const SCORE_RAW_DIRECTORY = path.join(process.cwd(), "data", "historical", "raw", "score");

/** One gzipped ESPN game summary, trimmed to the keys the score reads. */
export function summaryPath(season: number, gameId: string): string {
  return path.join(SCORE_RAW_DIRECTORY, "summaries", String(season), `${gameId}.json.gz`);
}

/** One season's built games (`ScoreGame[]`, chronological), gzipped. */
export function gamesPath(season: number): string {
  return path.join(SCORE_RAW_DIRECTORY, "games", `${season}.json.gz`);
}

export function writeGzipJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const scratch = `${file}.tmp`;
  fs.writeFileSync(scratch, zlib.gzipSync(Buffer.from(JSON.stringify(value), "utf-8")));
  fs.renameSync(scratch, file);
}

export function readGzipJson(file: string): unknown {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8"));
}

/** The stored summary of a game, or null when it has not been fetched. */
export function loadSummary(season: number, gameId: string): unknown | null {
  const file = summaryPath(season, gameId);
  return fs.existsSync(file) ? readGzipJson(file) : null;
}

export function saveScoreGames(season: number, games: readonly ScoreGame[]): void {
  writeGzipJson(gamesPath(season), games);
}

/** A season's built games, or an empty list when the season has not been built. */
export function loadScoreGames(season: number): ScoreGame[] {
  const file = gamesPath(season);
  return fs.existsSync(file) ? (readGzipJson(file) as ScoreGame[]) : [];
}
