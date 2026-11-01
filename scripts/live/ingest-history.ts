// Backfills completed seasons from ESPN team schedules into data/season/games.
// One-off and idempotent; the live pipeline maintains the current season.
//
// Run: corepack pnpm exec tsx scripts/live/ingest-history.ts [firstSeason] [lastSeason]

import * as fs from "node:fs";
import * as path from "node:path";
import {
  createFetchJson,
  fetchTeamSchedule,
  parseEvents,
} from "../../src/lib/live-data/espn-season";
import { SEASON_TEAMS } from "../../src/lib/season/teams";
import { compareGames, gamesPath } from "./game-store";
import type { SeasonGame } from "../../src/lib/season/types";

const CONCURRENCY = 4;
const fetchJson = createFetchJson({ headers: { "user-agent": "playoff-pulse-backfill" } });

async function withRetry<T>(work: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`${label}: ${String(lastError)}`);
}

async function ingestSeason(season: number): Promise<void> {
  const jobs = SEASON_TEAMS.flatMap((team) =>
    ([2, 3, 5] as const).map((seasonType) => ({ teamId: team.id, seasonType })),
  );
  const byId = new Map<string, SeasonGame>();
  const skipped = new Set<string>();
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      const events = await withRetry(
        () => fetchTeamSchedule(fetchJson, job.teamId, season, job.seasonType),
        `${season} team ${job.teamId} type ${job.seasonType}`,
      );
      const { games, skipped: reasons } = parseEvents(events, season);
      for (const reason of reasons) skipped.add(reason);
      for (const game of games) byId.set(game.id, game);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const games = [...byId.values()].sort(compareGames);
  const output = gamesPath(season);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(games)}\n`, "utf-8");
  console.log(
    `${season}: ${games.length} games, ${games.filter((game) => game.status === "final").length} final` +
      (skipped.size ? `, skipped: ${[...skipped].join("; ")}` : ""),
  );
}

async function main(): Promise<void> {
  const first = Number(process.argv[2] ?? 2005);
  const last = Number(process.argv[3] ?? 2026);
  for (let season = first; season <= last; season += 1) {
    await ingestSeason(season);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
