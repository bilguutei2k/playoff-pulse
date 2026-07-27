import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import type {
  HistoricalGame,
  HistoricalSeries,
  TeamSeasonSnapshot,
} from "../../src/lib/backtest/types";
import type { RawPlayInGame } from "../backtest/scrape-bbref";
import { HOLDOUT_SEASON, SEASONS } from "../backtest/scrape-bbref";
import {
  loadGames,
  loadSeries,
  loadSnapshots,
} from "../backtest/build-snapshots";

const EXPECTED_SERIES_COUNT = 15;
const EXPECTED_GAME_COUNT = 85;
const EXPECTED_PLAY_IN_COUNT = 6;
const RANGE_FIELDS = [
  "srs",
  "netRating",
  "ortg",
  "drtg",
  "wins",
  "losses",
  "seed",
  "eloRating",
] as const satisfies readonly (keyof TeamSeasonSnapshot)[];

function expectedHomePattern(series: HistoricalSeries): string[] {
  const firstHost = series.homePattern[0];
  assert(
    firstHost === series.teamA || firstHost === series.teamB,
    `${series.id} Game 1 host must be one of the series teams.`,
  );
  const other = firstHost === series.teamA ? series.teamB : series.teamA;
  return [firstHost, firstHost, other, other, firstHost, other, firstHost];
}

export function historicalExtremeFlags(
  holdoutSnapshots: TeamSeasonSnapshot[],
): string[] {
  const archivedSnapshots = SEASONS.flatMap((season) => loadSnapshots(season));
  return RANGE_FIELDS.flatMap((field) => {
    const archivedValues = archivedSnapshots.map((snapshot) => snapshot[field]);
    const minimum = Math.min(...archivedValues);
    const maximum = Math.max(...archivedValues);
    return holdoutSnapshots.flatMap((snapshot) => {
      const value = snapshot[field];
      return value < minimum || value > maximum
        ? [
            `${snapshot.teamId}.${field}=${value} is outside the validated ` +
              `2003–2025 range [${minimum}, ${maximum}]`,
          ]
        : [];
    });
  });
}

export function runHoldoutDataChecks(): void {
  const series = loadSeries(HOLDOUT_SEASON);
  const games = loadGames(HOLDOUT_SEASON);
  const snapshots = loadSnapshots(HOLDOUT_SEASON);
  const playIn = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "data",
        "historical",
        "play-in",
        `${HOLDOUT_SEASON}.json`,
      ),
      "utf-8",
    ),
  ) as RawPlayInGame[];

  assert.equal(
    series.length,
    EXPECTED_SERIES_COUNT,
    "2026 series count must match the completed NBA bracket.",
  );
  assert.equal(
    games.length,
    EXPECTED_GAME_COUNT,
    "2026 game count must match the completed NBA bracket.",
  );
  assert.equal(
    playIn.length,
    EXPECTED_PLAY_IN_COUNT,
    "2026 play-in results must remain separate from the playoff bracket.",
  );

  const gamesBySeries = new Map<string, HistoricalGame[]>();
  for (const game of games) {
    const existing = gamesBySeries.get(game.seriesId) ?? [];
    existing.push(game);
    gamesBySeries.set(game.seriesId, existing);
  }

  for (const row of series) {
    const seriesGames = gamesBySeries.get(row.id) ?? [];
    assert.equal(seriesGames.length, row.gamesPlayed, `${row.id} game count mismatch.`);
    assert.equal(
      row.winsA + row.winsB,
      row.gamesPlayed,
      `${row.id} wins must reconcile to games played.`,
    );
    assert(
      row.winsA === 4 || row.winsB === 4,
      `${row.id} must terminate when one team reaches four wins.`,
    );
    assert.equal(
      row.winner,
      row.winsA === 4 ? row.teamA : row.teamB,
      `${row.id} winner must be the four-win team.`,
    );
    assert.deepEqual(
      row.homePattern,
      expectedHomePattern(row).slice(0, row.gamesPlayed),
      `${row.id} must follow 2-2-1-1-1, including the Finals.`,
    );
    for (const game of seriesGames) {
      assert(
        game.date >= row.seriesStartDate,
        `${row.id} contains ${game.date} before its ${row.seriesStartDate} start.`,
      );
    }
  }

  const playoffSeeds = new Map(
    snapshots.map((snapshot) => [snapshot.teamId, snapshot.seed]),
  );
  for (const game of playIn) {
    if (game.playoffSeedAwarded !== null) {
      assert.equal(
        playoffSeeds.get(game.winner),
        game.playoffSeedAwarded,
        `${game.winner} play-in award must match its final playoff seed.`,
      );
    }
  }

  const rangeFlags = historicalExtremeFlags(snapshots);
  assert.deepEqual(
    rangeFlags,
    [],
    `2026 snapshot values outside historical extremes:\n${rangeFlags.join("\n")}`,
  );
}

if (typeof require !== "undefined" && require.main === module) {
  runHoldoutDataChecks();
  console.log(
    `2026 holdout data checks passed: ${EXPECTED_SERIES_COUNT} series, ` +
      `${EXPECTED_GAME_COUNT} playoff games, no historical-range flags.`,
  );
}
