// Reads and writes the compact game store under data/season/games.

import * as fs from "node:fs";
import * as path from "node:path";
import { FIRST_SEASON } from "../../src/lib/season/formats";
import type { SeasonGame } from "../../src/lib/season/types";

export const GAMES_DIRECTORY = path.join(process.cwd(), "data", "season", "games");

export function gamesPath(season: number): string {
  return path.join(GAMES_DIRECTORY, `${season}.json`);
}

/** Chronological, with the ESPN ID as a stable tie-break. */
export function compareGames(a: SeasonGame, b: SeasonGame): number {
  const byTip = Date.parse(a.tipUtc) - Date.parse(b.tipUtc);
  return byTip !== 0 ? byTip : a.id.localeCompare(b.id);
}

export function loadSeasonGames(season: number): SeasonGame[] {
  const file = gamesPath(season);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf-8")) as SeasonGame[];
}

export function loadHistory(lastSeason: number): SeasonGame[] {
  const games: SeasonGame[] = [];
  for (let season = FIRST_SEASON; season <= lastSeason; season += 1) {
    games.push(...loadSeasonGames(season));
  }
  return games;
}
