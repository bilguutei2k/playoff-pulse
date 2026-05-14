// Report generator:
//   docs/backtest/results.json
//   docs/backtest/methodology.md

import * as fs from "node:fs";
import * as path from "node:path";
import type { BacktestPrediction, BacktestReport, EvaluationResult } from "./types";
import { evaluate, loadPredictions, MODEL_NAMES } from "./evaluate";

const DOCS_DIR = path.join(process.cwd(), "docs", "backtest");
const RESULTS_PATH = path.join(DOCS_DIR, "results.json");
const METHODOLOGY_PATH = path.join(DOCS_DIR, "methodology.md");

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueSeriesCount(predictions: BacktestPrediction[]): number {
  return new Set(predictions.map((prediction) => prediction.seriesId)).size;
}

function fixed(value: number, digits = 4): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  return value.toFixed(digits);
}

function percent(value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  return `${(value * 100).toFixed(1)}%`;
}

export function buildReport(
  predictions: BacktestPrediction[],
  results: EvaluationResult[],
): BacktestReport {
  return {
    generatedAt: new Date().toISOString(),
    seasons: uniqueSortedNumbers(predictions.map((prediction) => prediction.season)),
    totalSeries: uniqueSeriesCount(predictions),
    models: MODEL_NAMES,
    results,
    predictions,
  };
}

export function writeResultsJson(report: BacktestReport): void {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(report, null, 2), "utf-8");
}

function renderResultsTable(results: EvaluationResult[]): string {
  const rows = [...results]
    .sort((a, b) => a.brierScore - b.brierScore)
    .map(
      (result) =>
        `| ${result.modelName} | ${result.n} | ${fixed(result.brierScore)} | ${fixed(result.logLoss)} | ${percent(result.accuracy)} |`,
    );

  return [
    "| Model | N | Brier Score | Log Loss | Accuracy |",
    "|---|---:|---:|---:|---:|",
    ...rows,
  ].join("\n");
}

function renderCalibrationTable(result: EvaluationResult): string {
  const rows = result.calibrationBuckets
    .filter((bucket) => bucket.count > 0)
    .map(
      (bucket) =>
        `| ${bucket.bucketMin.toFixed(1)}-${bucket.bucketMax.toFixed(1)} | ${bucket.count} | ${percent(bucket.predictedMean)} | ${percent(bucket.actualWinRate)} |`,
    );

  return [
    `### ${result.modelName}`,
    "",
    "| Bucket | Count | Mean Prediction | Actual Win Rate |",
    "|---|---:|---:|---:|",
    ...rows,
  ].join("\n");
}

export function renderMethodologyMarkdown(report: BacktestReport): string {
  const date = report.generatedAt;
  const seasons = `${report.seasons[0]}-${report.seasons[report.seasons.length - 1]}`;
  const predictionCount = report.predictions.length;

  return [
    "# Playoff Pulse Backtest Methodology",
    "",
    `Generated: ${date}`,
    "",
    "## Scope",
    "",
    `This report evaluates Playoff Pulse on NBA playoff series from ${seasons}. It includes ${report.totalSeries} historical series and ${predictionCount} model-series predictions across six model variants.`,
    "",
    "## Data Sources",
    "",
    "- Basketball-Reference playoff summary pages: series matchups, winners, and series game counts.",
    "- Basketball-Reference playoff schedule pages: game dates, home/away designation, and scores.",
    "- Basketball-Reference team ratings pages: regular-season ORtg, DRtg, net rating, adjusted margin proxy, wins, and losses.",
    "- Basketball-Reference advanced player pages: regular-season BPM, games played, and minutes.",
    "",
    "Raw HTML is cached under `data/historical/raw/` and normalized JSON is written under `data/historical/series/`, `data/historical/games/`, and `data/historical/team-snapshots/`.",
    "",
    "## Hybrid Input Methodology",
    "",
    "- `netRating` is calculated as ORtg minus DRtg from regular-season team ratings.",
    "- `eloRating` is approximated as `1500 + adjustedMargin * 35`; the ratings table exposes adjusted margin (`MOV/A`), not a literal SRS column.",
    "- Player impact is proxied with regular-season BPM.",
    "- Projected minutes use regular-season minutes per game capped at 40.",
    "- Historical manual adjustments are fixed at 0.",
    "- All historical players are treated as healthy because injury timelines are not yet modeled.",
    "",
    "## Leakage Controls",
    "",
    "- Every team snapshot uses the configured regular-season end date for that season.",
    "- The runner asserts `snapshot_as_of < seriesStartDate` for both teams before writing predictions.",
    "- Team ratings and player inputs come from regular-season BBRef pages only.",
    "- The backtest runner consumes historical snapshots and does not import the current manual forecast config.",
    "",
    "## Known Limitations",
    "",
    "- Elo is an adjusted-margin proxy, not a true possession-by-possession Elo history.",
    "- BPM is a player impact proxy and is not the same scale as the current manual player-impact inputs.",
    "- Historical injuries, absences, and minute changes are not modeled.",
    "- 2020 bubble series are tagged and model home-court advantage is set to zero, but BBRef still supplies nominal home/away designations.",
    "- This is an evaluation harness, not a calibrated production forecast or betting model.",
    "",
    "## Results",
    "",
    "Accuracy gives half credit to exact 50/50 predictions because those predictions do not favor either team.",
    "",
    renderResultsTable(report.results),
    "",
    "## Calibration Data",
    "",
    ...report.results.flatMap((result) => [renderCalibrationTable(result), ""]),
  ].join("\n");
}

export function writeMethodologyMarkdown(report: BacktestReport): void {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(METHODOLOGY_PATH, renderMethodologyMarkdown(report), "utf-8");
}

export async function generateReport(): Promise<void> {
  const predictions = loadPredictions();
  const results = evaluate(predictions);
  const report = buildReport(predictions, results);

  writeResultsJson(report);
  writeMethodologyMarkdown(report);
}

if (typeof require !== "undefined" && require.main === module) {
  generateReport()
    .then(() => {
      console.log("Report written to docs/backtest/");
    })
    .catch((error: unknown) => {
      console.error("Report generation failed:", error);
      process.exit(1);
    });
}
