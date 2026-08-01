// Isolated, resumable 1984-2002 ingestion entry point. Evaluation consumes
// the normalized outputs only after every season has passed this contract.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  historicalSeriesFormat,
  homePatternForHistoricalFormat,
} from "../../src/lib/backtest/series-formats";
import type { HistoricalSeries, TeamSeasonSnapshot } from "./types";
import {
  buildSnapshots,
  normalizeGames,
  normalizeSeries,
  validateSeries,
  validateSnapshots,
  writeGamesJson,
  writeSeriesJson,
  writeSnapshotsJson,
} from "./build-snapshots";
import {
  fetchSeasonData,
  LEGACY_INGESTION_SEASONS,
  type LegacyIngestionSeason,
  type RawGameResult,
  type RawSeriesResult,
} from "./scrape-bbref";

type HistoricalExtremes = {
  srs: { min: number; max: number };
  netRating: { min: number; max: number };
};

export type LegacyValidationFlag = {
  season: number;
  entityId: string;
  field: "srs" | "netRating";
  value: number;
  historicalMinimum: number;
  historicalMaximum: number;
};

const DATA_DIR = path.join(process.cwd(), "data", "historical");

function normalizedRoundLabel(series: HistoricalSeries): string {
  return series.round;
}

function sameTeams(
  game: RawGameResult,
  series: Pick<HistoricalSeries, "teamA" | "teamB">,
): boolean {
  return (
    (game.homeTeam === series.teamA && game.awayTeam === series.teamB) ||
    (game.homeTeam === series.teamB && game.awayTeam === series.teamA)
  );
}

function assertLegacySeasonContract(
  season: LegacyIngestionSeason,
  rawSeries: RawSeriesResult[],
  rawGames: RawGameResult[],
  series: HistoricalSeries[],
  snapshots: TeamSeasonSnapshot[],
): void {
  const errors: string[] = [];

  if (series.length !== 15) {
    errors.push(`expected 15 series, found ${series.length}`);
  }
  const gameCountFromSeries = series.reduce((sum, row) => sum + row.gamesPlayed, 0);
  if (rawGames.length !== gameCountFromSeries) {
    errors.push(
      `raw playoff game count ${rawGames.length} does not equal series total ${gameCountFromSeries}`,
    );
  }
  if (snapshots.length !== 16) {
    errors.push(`expected 16 playoff-team snapshots, found ${snapshots.length}`);
  }

  for (const row of series) {
    const format = historicalSeriesFormat(season, row.round);
    const homeCourtTeam = row.homePattern[0];
    if (homeCourtTeam !== row.teamA && homeCourtTeam !== row.teamB) {
      errors.push(`${row.id} Game 1 host ${homeCourtTeam ?? "none"} is not a matchup team`);
      continue;
    }
    const opponent = homeCourtTeam === row.teamA ? row.teamB : row.teamA;
    const expectedPattern = homePatternForHistoricalFormat(
      format,
      homeCourtTeam,
      opponent,
    ).slice(0, row.gamesPlayed);
    if (row.homePattern.join(",") !== expectedPattern.join(",")) {
      errors.push(
        `${row.id} venue sequence does not match ${format.label}: ` +
          `${row.homePattern.join("-")} vs ${expectedPattern.join("-")}`,
      );
    }

    const matchupGames = rawGames.filter((game) => sameTeams(game, row));
    if (matchupGames.some((game) => game.date < row.seriesStartDate)) {
      errors.push(`${row.id} contains a game before its series start`);
    }
  }

  const normalizedAnomalies = [
    ...validateSeries(series),
    ...validateSnapshots(snapshots, series),
  ];
  errors.push(
    ...normalizedAnomalies.map(
      (anomaly) => `${anomaly.entityId}: ${anomaly.issue}`,
    ),
  );

  for (const row of rawSeries) {
    const normalized = series.find(
      (candidate) =>
        candidate.season === row.season &&
        candidate.teamA !== candidate.teamB &&
        [candidate.teamA, candidate.teamB].includes(row.teamA) &&
        [candidate.teamA, candidate.teamB].includes(row.teamB),
    );
    if (!normalized) {
      errors.push(
        `raw series ${row.teamA}-${row.teamB} (${row.round}) has no normalized counterpart`,
      );
    } else if (!normalizedRoundLabel(normalized)) {
      errors.push(`normalized series ${normalized.id} has no round label`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Legacy ${season} ingestion contract failed:\n${errors.join("\n")}`,
    );
  }
}

export function loadValidated2003To2025Extremes(): HistoricalExtremes {
  const snapshots = Array.from({ length: 23 }, (_, index) => 2003 + index)
    .flatMap((season) => {
      const file = path.join(DATA_DIR, "team-snapshots", `${season}.json`);
      return JSON.parse(fs.readFileSync(file, "utf-8")) as TeamSeasonSnapshot[];
    });
  return {
    srs: {
      min: Math.min(...snapshots.map((row) => row.srs)),
      max: Math.max(...snapshots.map((row) => row.srs)),
    },
    netRating: {
      min: Math.min(...snapshots.map((row) => row.netRating)),
      max: Math.max(...snapshots.map((row) => row.netRating)),
    },
  };
}

export function flagSnapshotExtremes(
  snapshots: TeamSeasonSnapshot[],
  extremes: HistoricalExtremes,
): LegacyValidationFlag[] {
  return snapshots.flatMap((snapshot) => {
    const flags: LegacyValidationFlag[] = [];
    for (const field of ["srs", "netRating"] as const) {
      const range = extremes[field];
      if (snapshot[field] < range.min || snapshot[field] > range.max) {
        flags.push({
          season: snapshot.season,
          entityId: snapshot.teamId,
          field,
          value: snapshot[field],
          historicalMinimum: range.min,
          historicalMaximum: range.max,
        });
      }
    }
    return flags;
  });
}

function selectedSeasons(): readonly LegacyIngestionSeason[] {
  const requested = process.argv.slice(2).map(Number);
  if (requested.length === 0) {
    return LEGACY_INGESTION_SEASONS;
  }
  for (const season of requested) {
    if (!LEGACY_INGESTION_SEASONS.includes(season as LegacyIngestionSeason)) {
      throw new Error(`Legacy ingestion season must be between 1984 and 2002; got ${season}.`);
    }
  }
  return requested as LegacyIngestionSeason[];
}

async function ingestLegacySeasons(): Promise<void> {
  const extremes = loadValidated2003To2025Extremes();
  const allFlags: LegacyValidationFlag[] = [];

  for (const season of selectedSeasons()) {
    const raw = await fetchSeasonData(season);
    const series = normalizeSeries(raw.series, raw.games, season);
    const games = normalizeGames(raw.games, series, season);
    const snapshots = buildSnapshots(
      raw.teamRatings,
      raw.playerAdvanced,
      series,
      season,
    );
    assertLegacySeasonContract(
      season,
      raw.series,
      raw.games,
      series,
      snapshots,
    );
    const flags = flagSnapshotExtremes(snapshots, extremes);
    allFlags.push(...flags);

    writeSeriesJson(season, series);
    writeGamesJson(season, games);
    writeSnapshotsJson(season, snapshots);
    console.log(
      `Ingested ${season}: ${series.length} series, ${games.length} games, ` +
        `${snapshots.length} snapshots, ${flags.length} historical-extreme flags.`,
    );
  }

  if (allFlags.length > 0) {
    console.warn("Legacy snapshot values outside the validated 2003-2025 range (not clamped):");
    for (const flag of allFlags) {
      console.warn(
        `${flag.season} ${flag.entityId} ${flag.field}=${flag.value}; ` +
          `range=[${flag.historicalMinimum}, ${flag.historicalMaximum}]`,
      );
    }
  }
}

if (typeof require !== "undefined" && require.main === module) {
  ingestLegacySeasons().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
