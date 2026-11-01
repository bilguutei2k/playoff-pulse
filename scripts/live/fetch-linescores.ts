// Collects quarter scores for in-game validation from day scoreboards, because
// team schedules do not carry them. Regular seasons 2025 and 2026 only.
//
// Run: corepack pnpm exec tsx scripts/live/fetch-linescores.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { createFetchJson, fetchScoreboardRows } from "../../src/lib/live-data/espn-season";
import { addDays } from "../../src/lib/season/dates";
import { loadSeasonGames } from "./game-store";

const fetchJson = createFetchJson({ headers: { "user-agent": "playoff-pulse-backfill" } });
const CONCURRENCY = 4;

type LinescoreRow = {
  id: string;
  home: number[];
  away: number[];
};

async function collectSeason(season: number): Promise<void> {
  const games = loadSeasonGames(season).filter(
    (game) => game.kind === "regular" && game.status === "final",
  );
  const wanted = new Set(games.map((game) => game.id));
  // ESPN's date bucket can differ from the ET date, so include the next day.
  const dates = new Set<string>();
  for (const game of games) {
    dates.add(game.etDate);
    dates.add(addDays(game.etDate, 1));
  }
  const queue = [...dates].sort();
  const rows = new Map<string, LinescoreRow>();
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const date = queue[cursor];
      cursor += 1;
      let attempts = 0;
      for (;;) {
        try {
          const dayRows = await fetchScoreboardRows(fetchJson, date, season);
          for (const row of dayRows) {
            if (!wanted.has(row.game.id)) continue;
            if (row.homeLinescores.length >= 4 && row.awayLinescores.length >= 4) {
              rows.set(row.game.id, {
                id: row.game.id,
                home: row.homeLinescores,
                away: row.awayLinescores,
              });
            }
          }
          break;
        } catch (error) {
          attempts += 1;
          if (attempts >= 4) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const output = path.join(process.cwd(), "data", "season", "linescores", `${season}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    `${JSON.stringify([...rows.values()].sort((a, b) => a.id.localeCompare(b.id)))}\n`,
    "utf-8",
  );
  console.log(`${season}: ${rows.size} of ${wanted.size} games have quarter scores`);
}

async function main(): Promise<void> {
  await collectSeason(2025);
  await collectSeason(2026);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
