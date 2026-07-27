// Builds the 2026 season artifacts through the same isolated ingestion entry
// point used before 2026 was admitted to the pooled evaluation.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildSnapshots,
  normalizeGames,
  normalizeSeries,
  writeGamesJson,
  writeSeriesJson,
  writeSnapshotsJson,
} from "./build-snapshots";
import {
  fetchSeasonData,
  HOLDOUT_SEASON,
  type RawPlayInGame,
} from "./scrape-bbref";

const PLAY_IN_PATH = path.join(
  process.cwd(),
  "data",
  "historical",
  "play-in",
  `${HOLDOUT_SEASON}.json`,
);

function writePlayInJson(games: RawPlayInGame[]): void {
  fs.mkdirSync(path.dirname(PLAY_IN_PATH), { recursive: true });
  fs.writeFileSync(PLAY_IN_PATH, JSON.stringify(games, null, 2), "utf-8");
}

async function ingest2026(): Promise<void> {
  const raw = await fetchSeasonData(HOLDOUT_SEASON);
  const series = normalizeSeries(raw.series, raw.games, HOLDOUT_SEASON);
  const games = normalizeGames(raw.games, series, HOLDOUT_SEASON);
  const snapshots = buildSnapshots(
    raw.teamRatings,
    raw.playerAdvanced,
    series,
    HOLDOUT_SEASON,
  );

  writeSeriesJson(HOLDOUT_SEASON, series);
  writeGamesJson(HOLDOUT_SEASON, games);
  writeSnapshotsJson(HOLDOUT_SEASON, snapshots);
  writePlayInJson(raw.playInGames);

  console.log(
    `Ingested ${HOLDOUT_SEASON}: ${series.length} series, ${games.length} playoff games, ` +
      `${raw.playInGames.length} play-in games, ${snapshots.length} team snapshots.`,
  );
}

ingest2026().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
