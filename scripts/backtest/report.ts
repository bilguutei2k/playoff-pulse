// Report generator:
//   docs/backtest/results.json
//   docs/backtest/methodology.md
//   docs/backtest/summary.json   (small headline file imported by the UI —
//   BacktestSummaryCard and the methodology sidebar read it at build time,
//   so regenerating the backtest updates the displayed numbers automatically)

import * as fs from "node:fs";
import * as path from "node:path";
import type { BacktestPrediction, BacktestReport, EvaluationResult, ModelName } from "./types";
import { evaluate, loadPredictions, MODEL_NAMES } from "./evaluate";

const DOCS_DIR = path.join(process.cwd(), "docs", "backtest");
const RESULTS_PATH = path.join(DOCS_DIR, "results.json");
const METHODOLOGY_PATH = path.join(DOCS_DIR, "methodology.md");
const SUMMARY_PATH = path.join(DOCS_DIR, "summary.json");

type ModelHeadline = {
  brierScore: number;
  logLoss: number;
  accuracy: number;
  n: number;
};

export type BacktestSummary = {
  generatedAt: string;
  firstSeason: number;
  lastSeason: number;
  totalSeries: number;
  models: Record<ModelName, ModelHeadline>;
};

export function buildSummary(report: BacktestReport): BacktestSummary {
  const models = Object.fromEntries(
    report.results.map((result) => [
      result.modelName,
      {
        brierScore: result.brierScore,
        logLoss: result.logLoss,
        accuracy: result.accuracy,
        n: result.n,
      },
    ]),
  ) as Record<ModelName, ModelHeadline>;

  return {
    generatedAt: report.generatedAt,
    firstSeason: report.seasons[0],
    lastSeason: report.seasons[report.seasons.length - 1],
    totalSeries: report.totalSeries,
    models,
  };
}

export function writeSummaryJson(report: BacktestReport): void {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(
    SUMMARY_PATH,
    JSON.stringify(buildSummary(report), null, 2),
    "utf-8",
  );
}

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
    "- Basketball-Reference advanced player pages: regular-season BPM, games played, and minutes retained for research candidates, not the published baseline.",
    "",
    "Raw HTML is cached under `data/historical/raw/` and normalized JSON is written under `data/historical/series/`, `data/historical/games/`, and `data/historical/team-snapshots/`.",
    "",
    "## Evidenced Baseline and Scenario Overlay",
    "",
    "- `netRating` is calculated as ORtg minus DRtg from regular-season team ratings.",
    "- The historical point-scale rating stored in the legacy-compatible `eloRating` field is `1500 + SRS × 35`; it is an SRS point proxy, not Elo.",
    "- The published Playoff Pulse baseline uses only the fixed net-rating term, SRS point-proxy term, home-court term, and logistic scale. Its existing coefficients were not refit when the baseline/overlay boundary was introduced.",
    "- Player impact, projected minutes, injuries, and manual adjustments are excluded from every published baseline prediction and from this backtest path.",
    "- Those manual inputs are available only through a visibly separate scenario overlay. The overlay defaults to zero, is always shown beside the baseline with a delta, and has no point-in-time historical validation.",
    "- Player BPM and normalized regular-season MPG remain in the archive for explicitly labeled research candidates. They do not enter the published baseline Brier.",
    "- Simulated series reconstruct the full seven-game home pattern from the actual Game 1 host: 2-3-2 for NBA Finals through 2013 and 2-2-1-1-1 otherwise. Games beyond the realized series length therefore keep the era-correct home court instead of defaulting to neutral.",
    "",
    "## Leakage Controls",
    "",
    "- Every team snapshot uses the configured regular-season end date for that season.",
    "- The runner asserts `snapshot_as_of < seriesStartDate` for both teams before writing predictions.",
    "- Baseline team ratings come from regular-season BBRef pages only.",
    "- The backtest runner consumes historical snapshots and does not import the current manual forecast config.",
    "",
    "## Known Limitations",
    "",
    "- The SRS point proxy is not a possession-by-possession Elo history; its legacy storage field is retained only for model compatibility.",
    "- The baseline/overlay split was defined after historical results existed. Its Brier is descriptive, not prospective evidence for that design decision.",
    "- Historical injuries, absences, and minute changes are not modeled; therefore the scenario overlay is unvalidated.",
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
  writeSummaryJson(report);
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
