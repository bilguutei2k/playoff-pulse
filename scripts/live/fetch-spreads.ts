// Collects ESPN's stored pregame spreads for the market row of the injury evaluation.
// Comparison only: spreads are never a model input. Their timing is not known, and
// coverage has gaps, both of which the report states. Restartable.
//
// Run: corepack pnpm exec tsx scripts/live/fetch-spreads.ts 2022 2023 ...

import * as fs from "node:fs";
import * as path from "node:path";
import { createFetchJson } from "../../src/lib/live-data/espn-season";
import { loadSeasonGames } from "./game-store";

const DIRECTORY = path.join(process.cwd(), "data", "season", "spreads");
const SITE_API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const CONCURRENCY = 4;
const fetchJson = createFetchJson({ headers: { "user-agent": "playoff-pulse-backfill" } });

type Store = Record<string, number | null>;

async function spreadFor(gameId: string): Promise<number | null> {
  const payload = (await fetchJson(`${SITE_API}/summary?event=${gameId}`)) as {
    pickcenter?: Array<{ spread?: unknown }>;
  };
  for (const row of payload.pickcenter ?? []) {
    if (typeof row.spread === "number" && Number.isFinite(row.spread)) return row.spread;
  }
  return null;
}

async function collect(season: number): Promise<void> {
  const file = path.join(DIRECTORY, `${season}.json`);
  const store: Store = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as Store) : {};
  const games = loadSeasonGames(season).filter(
    (game) => game.status === "final" && game.kind === "regular" && !(game.id in store),
  );
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < games.length) {
      const game = games[cursor];
      cursor += 1;
      for (let attempt = 1; ; attempt += 1) {
        try {
          store[game.id] = await spreadFor(game.id);
          break;
        } catch (error) {
          if (attempt >= 4) {
            console.log(`[spreads] ${game.id}: ${String(error)}`);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.mkdirSync(DIRECTORY, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store)}\n`, "utf-8");
  const values = Object.values(store);
  console.log(
    `[spreads] ${season}: ${values.filter((value) => value !== null).length} of ${values.length} games have a spread`,
  );
}

async function main(): Promise<void> {
  for (const season of process.argv.slice(2).map(Number)) await collect(season);
  console.log("[spreads] done");
}

main().catch((error) => {
  console.error(`[spreads] FAILED: ${String(error)}`);
  process.exit(1);
});
