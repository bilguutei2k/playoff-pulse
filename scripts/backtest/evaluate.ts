// Evaluation harness for Brier score, log loss, accuracy, and calibration.

import * as fs from "node:fs";
import * as path from "node:path";
import type { BacktestPrediction, EvaluationResult, ModelName } from "./types";
import { evaluateModel } from "../../src/lib/backtest/metrics";

export const MODEL_NAMES: ModelName[] = [
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

export function loadPredictions(): BacktestPrediction[] {
  const raw = fs.readFileSync(PREDICTIONS_PATH, "utf-8");
  return JSON.parse(raw) as BacktestPrediction[];
}

export function evaluate(predictions: BacktestPrediction[]): EvaluationResult[] {
  return MODEL_NAMES.map((modelName) => evaluateModel(modelName, predictions));
}

if (typeof require !== "undefined" && require.main === module) {
  const predictions = loadPredictions();
  const results = evaluate(predictions);
  console.log(JSON.stringify(results, null, 2));
}
