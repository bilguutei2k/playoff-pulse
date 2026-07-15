// Main backtest runner.
// For each historical series across all seasons, runs the Playoff Pulse model
// and five baselines with pre-series team snapshots.
//
// Critical: this file uses historical TeamSeasonSnapshot inputs only. It does
// not import the current playoff-config.ts manual forecast config.

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  BacktestPrediction,
  HistoricalSeries,
  ModelName,
  TeamSeasonSnapshot,
} from "./types";
import { SEASONS } from "./scrape-bbref";
import { loadSeries, loadSnapshots } from "./build-snapshots";
import {
  clampBaseline,
  historicalSeriesToModelSeries,
  predict,
  settingsForSeries,
  snapshotToTeam,
} from "./baselines";
import { assertNoLeakage } from "../../src/lib/backtest/leakage-check";
import { defaultModelSettings } from "../../src/lib/data/model-settings";
import { estimateSeriesProbability } from "../../src/lib/model/simulator";

const MODEL_NAMES: ModelName[] = [
  "playoff_pulse",
  "coinflip",
  "home_team",
  "higher_seed",
  "srs_proxy_only",
  "net_rating_only",
];

const PREDICTIONS_PATH = path.join(
  process.cwd(),
  "docs",
  "backtest",
  "predictions.json",
);

export function playoffPulsePrediction(
  series: HistoricalSeries,
  teamASnapshot: TeamSeasonSnapshot,
  teamBSnapshot: TeamSeasonSnapshot,
): number {
  const teamA = snapshotToTeam(teamASnapshot, series.id);
  const teamB = snapshotToTeam(teamBSnapshot, series.id);
  const forecast = estimateSeriesProbability(
    historicalSeriesToModelSeries(series),
    {
      [teamA.id]: teamA,
      [teamB.id]: teamB,
    },
    settingsForSeries(series, defaultModelSettings),
  );

  return clampBaseline(forecast.teamASeriesWinProbability);
}

export function predictSeries(
  series: HistoricalSeries,
  snapshotsByTeam: Record<string, TeamSeasonSnapshot>,
): BacktestPrediction[] {
  const teamASnapshot = snapshotsByTeam[series.teamA];
  const teamBSnapshot = snapshotsByTeam[series.teamB];

  if (!teamASnapshot || !teamBSnapshot) {
    throw new Error(`Missing snapshots for ${series.id}.`);
  }

  if (teamASnapshot.snapshot_as_of !== teamBSnapshot.snapshot_as_of) {
    throw new Error(`Snapshot dates do not match for ${series.id}.`);
  }

  const actualOutcome = series.winner === series.teamA ? 1 : 0;

  return MODEL_NAMES.map((modelName) => {
    const predictedProbabilityA =
      modelName === "playoff_pulse"
        ? playoffPulsePrediction(series, teamASnapshot, teamBSnapshot)
        : predict(modelName, series, teamASnapshot, teamBSnapshot);

    return {
      seriesId: series.id,
      season: series.season,
      round: series.round,
      conference: series.conference,
      teamA: series.teamA,
      teamB: series.teamB,
      modelName,
      predictedProbabilityA: clampBaseline(predictedProbabilityA),
      actualOutcome,
      bubble: series.bubble,
      snapshotAsOf: teamASnapshot.snapshot_as_of,
      seriesStartDate: series.seriesStartDate,
    };
  });
}

export function predictSeason(season: number): BacktestPrediction[] {
  const series = loadSeries(season);
  const snapshots = loadSnapshots(season);
  const snapshotsByTeam = Object.fromEntries(
    snapshots.map((snapshot) => [snapshot.teamId, snapshot]),
  );

  return series.flatMap((row) => predictSeries(row, snapshotsByTeam));
}

export async function runBacktest(): Promise<BacktestPrediction[]> {
  const predictions = SEASONS.flatMap((season) => predictSeason(season));
  const snapshots = SEASONS.flatMap((season) => loadSnapshots(season));

  assertNoLeakage(predictions, snapshots);

  fs.mkdirSync(path.dirname(PREDICTIONS_PATH), { recursive: true });
  fs.writeFileSync(PREDICTIONS_PATH, JSON.stringify(predictions, null, 2), "utf-8");

  return predictions;
}

if (typeof require !== "undefined" && require.main === module) {
  runBacktest()
    .then((predictions) => {
      console.log(`Backtest complete. Total predictions: ${predictions.length}`);
    })
    .catch((error: unknown) => {
      console.error("Backtest failed:", error);
      process.exit(1);
    });
}
