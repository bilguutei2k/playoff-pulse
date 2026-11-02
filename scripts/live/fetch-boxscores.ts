// Backfills compact box scores for finished seasons. Restartable: finished games are
// kept, and a run only fetches what is missing. ESPN's sheets are occasionally off by a
// few points and are empty for some 2020-21 play-in games. A small gap is noted and kept;
// a large one, or too many games without a box score, fails the run.
//
// Run: corepack pnpm exec tsx scripts/live/fetch-boxscores.ts 2021 2022 ...

import * as fs from "node:fs";
import * as path from "node:path";
import { createFetchJson, fetchBoxScore } from "../../src/lib/live-data/espn-season";
import { gameScore, type StoredBoxScores } from "../../src/lib/season/box-scores";
import type { SeasonGame } from "../../src/lib/season/types";
import { loadSeasonGames } from "./game-store";

const CONCURRENCY = 4;
const SAVE_EVERY = 100;
const MAX_MISSING_SHARE = 0.01;
const MAX_POINT_GAP = 5;
const DIRECTORY = path.join(process.cwd(), "data", "season", "boxscores");

const fetchJson = createFetchJson({ headers: { "user-agent": "playoff-pulse-backfill" } });

function load(season: number): StoredBoxScores {
  const file = path.join(DIRECTORY, `${season}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")) as StoredBoxScores;
  return { season, names: {}, games: {} };
}

function save(store: StoredBoxScores): void {
  fs.mkdirSync(DIRECTORY, { recursive: true });
  const file = path.join(DIRECTORY, `${store.season}.json`);
  const scratch = `${file}.tmp`;
  fs.writeFileSync(scratch, `${JSON.stringify(store)}\n`, "utf-8");
  fs.renameSync(scratch, file);
}

async function fetchGame(game: SeasonGame, store: StoredBoxScores): Promise<string | null> {
  let box;
  for (let attempt = 1; ; attempt += 1) {
    try {
      box = await fetchBoxScore(fetchJson, game.id);
      break;
    } catch (error) {
      if (attempt >= 4) return `${game.id} (${game.etDate}): ${String(error)}`;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  for (const [teamId, score] of [
    [game.homeId, game.homeScore],
    [game.awayId, game.awayScore],
  ] as const) {
    const lines = box[teamId];
    if (!lines) return `${game.id} (${game.etDate}): team ${teamId} is not in the box score.`;
    const points = lines.reduce((total, line) => total + line.points, 0);
    if (Math.abs(points - (score as number)) > MAX_POINT_GAP) {
      return `${game.id} (${game.etDate}): team ${teamId} box points ${points}, final score ${score}.`;
    }
    if (points !== score) {
      console.log(`[box]   note ${game.id}: team ${teamId} box points ${points}, final score ${score}`);
    }
  }
  store.games[game.id] = Object.fromEntries(
    Object.entries(box).map(([teamId, lines]) => [
      teamId,
      lines.map((line) => {
        store.names[line.athleteId] = line.name;
        return [line.athleteId, Math.round(line.minutes), Number(gameScore(line).toFixed(1))];
      }),
    ]),
  ) as StoredBoxScores["games"][string];
  return null;
}

async function collectSeason(season: number): Promise<void> {
  const store = load(season);
  const games = loadSeasonGames(season).filter((game) => game.status === "final");
  const queue = games.filter((game) => !store.games[game.id]);
  console.log(`[box] ${season}: ${games.length} final games, ${queue.length} to fetch`);
  const problems: string[] = [];
  let cursor = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const game = queue[cursor];
      cursor += 1;
      const problem = await fetchGame(game, store);
      if (problem) problems.push(problem);
      done += 1;
      if (done % SAVE_EVERY === 0) {
        save(store);
        console.log(`[box] ${season}: ${done}/${queue.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save(store);
  console.log(`[box] ${season}: stored ${Object.keys(store.games).length}/${games.length}`);
  for (const problem of problems.slice(0, 20)) console.log(`[box]   ${problem}`);
  if (problems.length > games.length * MAX_MISSING_SHARE) {
    throw new Error(`${season}: ${problems.length} games failed, above the allowance.`);
  }
}

async function main(): Promise<void> {
  const seasons = process.argv.slice(2).map(Number);
  if (seasons.length === 0 || seasons.some((season) => !Number.isInteger(season))) {
    throw new Error("Pass the seasons to collect, by ending year.");
  }
  for (const season of seasons) await collectSeason(season);
  console.log("[box] done");
}

main().catch((error) => {
  console.error(`[box] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
