import * as fs from "node:fs";
import * as path from "node:path";
import type { HistoricalPregameArchive } from "../../src/lib/backtest/point-in-time-types";

const DOCS = path.join(process.cwd(), "docs");

type RollingPrediction = {
  id: string;
  season: number;
  p: number;
  y: number;
  marginError?: number;
};

type ResearchResult = {
  id: string;
  features: string[];
  game: Record<string, unknown> & { n: number; brier: number; logLoss: number };
  series: Record<string, unknown> & { n: number; brier: number; logLoss: number };
  rollingPredictions: {
    game: RollingPrediction[];
    series: RollingPrediction[];
  };
};

type ResearchArtifact = {
  results: ResearchResult[];
  nestedCalibration: {
    game: CalibrationArtifact;
    series: CalibrationArtifact;
  };
  strongSeriesBaselines: Array<{ id: string; n: number; brier: number; logLoss: number }>;
  preregisteredDynamicRatingCandidate: {
    registration: unknown;
    status: string;
    metrics: unknown;
  };
};

type CalibrationArtifact = {
  protocol: string;
  raw: unknown;
  calibrated: unknown;
  retained: boolean;
};

type ProductionArchive = {
  issuedAt?: string;
  issuedForDataSnapshot: string;
  model: { modelVersion: string; researchProtocolVersion: string };
  seriesForecasts: Array<{ seriesId: string; teamASeriesWinProbability: number }>;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function forecastLoss(probability: number, outcome: number): number {
  return (probability - outcome) ** 2;
}

export function buildEvidenceArtifact() {
  const research = readJson<ResearchArtifact>(path.join(DOCS, "backtest", "research.json"));
  const pregame = readJson<HistoricalPregameArchive>(
    path.join(DOCS, "backtest", "pregame-archive.json"),
  );
  const baseline = research.results.find((result) => result.id === "srs_home");
  if (!baseline) throw new Error("Missing srs_home research baseline.");
  const archiveDirectory = path.join(DOCS, "forecast-archive");
  const versions = fs.readdirSync(archiveDirectory)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const archive = readJson<ProductionArchive>(path.join(archiveDirectory, file));
      return {
        file,
        issuedAt: archive.issuedAt ?? archive.issuedForDataSnapshot,
        issuedForDataSnapshot: archive.issuedForDataSnapshot,
        modelVersion: archive.model.modelVersion,
        researchProtocolVersion: archive.model.researchProtocolVersion,
        series: archive.seriesForecasts.map((row) => ({
          seriesId: row.seriesId,
          probabilityA: row.teamASeriesWinProbability,
        })),
      };
    })
    .sort((a, b) => a.modelVersion.localeCompare(b.modelVersion));
  const seriesIndex = Array.from(
    new Map(
      pregame.records.map((record) => [record.seriesId, {
        seriesId: record.seriesId,
        season: record.season,
        round: record.round,
        conference: record.conference,
        teamA: record.teamA,
        teamB: record.teamB,
      }]),
    ).values(),
  );
  const timeline = pregame.records.map((record) => ({
    id: record.id,
    seriesId: record.seriesId,
    season: record.season,
    gameNumber: record.gameNumber,
    forecastAsOf: record.forecastAsOf,
    winsA: record.winsA,
    winsB: record.winsB,
    homeTeam: record.homeTeam,
    teamAGameWinProbability: record.teamAGameWinProbability,
    teamASeriesWinProbability: record.teamASeriesWinProbability,
    lower: record.uncertainty.lower,
    upper: record.uncertainty.upper,
    finalScoreProbabilities: record.finalScoreProbabilities,
    actualGameWinner: record.actualGameWinner,
    actualSeriesWinner: record.actualSeriesWinner,
  }));
  const worstGames = [...baseline.rollingPredictions.game]
    .map((row) => ({
      id: row.id,
      season: row.season,
      probability: row.p,
      outcome: row.y,
      brierLoss: forecastLoss(row.p, row.y),
      marginError: row.marginError,
    }))
    .sort((a, b) => b.brierLoss - a.brierLoss)
    .slice(0, 12);
  const worstSeries = [...baseline.rollingPredictions.series]
    .map((row) => ({
      id: row.id,
      season: row.season,
      probability: row.p,
      outcome: row.y,
      brierLoss: forecastLoss(row.p, row.y),
    }))
    .sort((a, b) => b.brierLoss - a.brierLoss)
    .slice(0, 12);
  return {
    generatedAt: new Date().toISOString(),
    productionLabel: "Manual production forecast",
    researchLabel: "Historical rolling-origin research",
    seriesIndex,
    timeline,
    versions,
    calibration: {
      game: {
        protocol: research.nestedCalibration.game.protocol,
        raw: research.nestedCalibration.game.raw,
        calibrated: research.nestedCalibration.game.calibrated,
        retained: research.nestedCalibration.game.retained,
      },
      series: {
        protocol: research.nestedCalibration.series.protocol,
        raw: research.nestedCalibration.series.raw,
        calibrated: research.nestedCalibration.series.calibrated,
        retained: research.nestedCalibration.series.retained,
      },
    },
    modelComparison: research.results.map((result) => ({
      id: result.id,
      features: result.features,
      game: result.game,
      series: result.series,
    })),
    strongSeriesBaselines: research.strongSeriesBaselines.map((row) => ({
      id: row.id,
      n: row.n,
      brier: row.brier,
      logLoss: row.logLoss,
    })),
    dynamicCandidate: {
      registration: research.preregisteredDynamicRatingCandidate.registration,
      status: research.preregisteredDynamicRatingCandidate.status,
      metrics: research.preregisteredDynamicRatingCandidate.metrics,
    },
    worstForecasts: { game: worstGames, series: worstSeries },
  };
}

if (typeof require !== "undefined" && require.main === module) {
  const output = path.join(DOCS, "backtest", "evidence.json");
  fs.writeFileSync(output, JSON.stringify(buildEvidenceArtifact(), null, 2), "utf-8");
  console.log("Wrote compact product evidence artifact.");
}
