// Saves ESPN's final standings for completed seasons, for the S4 seeding check.
// Run: corepack pnpm exec tsx scripts/live/fetch-final-seeds.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { createFetchJson, fetchStandings } from "../../src/lib/live-data/espn-season";

const fetchJson = createFetchJson({ headers: { "user-agent": "playoff-pulse-backfill" } });

async function main(): Promise<void> {
  const output: Record<string, unknown> = {};
  for (let season = 2022; season <= 2026; season += 1) {
    output[season] = await fetchStandings(fetchJson, season);
  }
  fs.writeFileSync(
    path.join(process.cwd(), "data", "season", "final-standings.json"),
    `${JSON.stringify(output)}\n`,
    "utf-8",
  );
  console.log("Saved final standings for 2022-2026.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
