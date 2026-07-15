import * as fs from "node:fs";
import * as path from "node:path";
import { defaultModelSettings } from "../../src/lib/data/model-settings";
import type {
  HistoricalPregameArchive,
  HistoricalPregameForecast,
} from "../../src/lib/backtest/point-in-time-types";
import { assertPregameArchiveHasNoLeakage } from "../../src/lib/backtest/point-in-time-types";
import { estimateSeriesProbability } from "../../src/lib/model/simulator";
import { MODEL_VERSION, RESEARCH_PROTOCOL_VERSION } from "../../src/lib/model/version";
import {
  historicalSeriesToModelSeries,
  settingsForSeries,
  snapshotToTeam,
} from "./baselines";
import { loadGames, loadSeries, loadSnapshots } from "./build-snapshots";

const SEASONS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const OUTPUT = path.join(process.cwd(), "docs", "backtest", "pregame-archive.json");

export function buildPregameArchive(): HistoricalPregameArchive {
  const records: HistoricalPregameForecast[] = [];
  for (const season of SEASONS) {
    const snapshots = Object.fromEntries(
      loadSnapshots(season).map((snapshot) => [snapshot.teamId, snapshot]),
    );
    const games = loadGames(season);
    for (const historicalSeries of loadSeries(season)) {
      const seriesGames = games
        .filter((game) => game.seriesId === historicalSeries.id)
        .sort((a, b) => a.gameNumber - b.gameNumber);
      const teamA = snapshotToTeam(snapshots[historicalSeries.teamA], historicalSeries.id);
      const teamB = snapshotToTeam(snapshots[historicalSeries.teamB], historicalSeries.id);
      let winsA = 0;
      let winsB = 0;
      for (const game of seriesGames) {
        const series = {
          ...historicalSeriesToModelSeries(historicalSeries),
          winsA,
          winsB,
        };
        const forecast = estimateSeriesProbability(
          series,
          { [teamA.id]: teamA, [teamB.id]: teamB },
          settingsForSeries(historicalSeries, defaultModelSettings),
        );
        if (!forecast.nextGame) {
          throw new Error(`Missing pregame forecast for ${historicalSeries.id} Game ${game.gameNumber}.`);
        }
        records.push({
          id: `${historicalSeries.id}:pregame-${game.gameNumber}`,
          seriesId: historicalSeries.id,
          season,
          round: historicalSeries.round,
          conference: historicalSeries.conference,
          gameNumber: game.gameNumber,
          forecastAsOf: game.date,
          snapshotAsOf: snapshots[historicalSeries.teamA].snapshot_as_of,
          lastIncludedGameNumber: game.gameNumber - 1,
          teamA: historicalSeries.teamA,
          teamB: historicalSeries.teamB,
          winsA,
          winsB,
          homeTeam: game.homeTeam,
          teamAGameWinProbability: forecast.nextGame.teamAWinProbability,
          teamASeriesWinProbability: forecast.teamASeriesWinProbability,
          expectedMarginForTeamA: forecast.nextGame.expectedMarginForTeamA,
          uncertainty: forecast.uncertainty,
          finalScoreProbabilities: forecast.finalScoreProbabilities,
          drivers: forecast.nextGame.drivers,
          actualGameWinner: game.winner,
          actualSeriesWinner: historicalSeries.winner,
          provenance: {
            impactScale: "bpm_proxy",
            ratingScale: "srs_point_proxy",
            rotationSource: "normalized_regular_season_mpg",
            availabilitySource: "unknown_assumed_available",
          },
          modelVersion: MODEL_VERSION,
        });
        if (game.winner === historicalSeries.teamA) winsA += 1;
        else winsB += 1;
      }
    }
  }
  const archive = {
    generatedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    researchProtocolVersion: RESEARCH_PROTOCOL_VERSION,
    seasons: SEASONS,
    records,
  };
  assertPregameArchiveHasNoLeakage(archive);
  return archive;
}

export function writePregameArchive(archive: HistoricalPregameArchive): void {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(archive, null, 2), "utf-8");
}

if (typeof require !== "undefined" && require.main === module) {
  const archive = buildPregameArchive();
  writePregameArchive(archive);
  console.log(`Wrote ${archive.records.length} leakage-safe pregame forecasts.`);
}
