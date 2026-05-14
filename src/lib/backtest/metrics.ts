// Pure evaluation functions. No I/O, no side effects.

import type {
  BacktestPrediction,
  BreakdownStats,
  CalibrationBucket,
  EvaluationResult,
  HistoricalRound,
  ModelName,
} from "./types";

const CALIBRATION_BUCKETS = 10;
const PROBABILITY_EPSILON = 1e-7;
const HISTORICAL_ROUNDS: HistoricalRound[] = [
  "First Round",
  "Conference Semifinal",
  "Conference Final",
  "NBA Finals",
];

function clampProbability(probability: number): number {
  return Math.min(
    1 - PROBABILITY_EPSILON,
    Math.max(PROBABILITY_EPSILON, probability),
  );
}

function actualProbability(prediction: BacktestPrediction): number {
  const p = clampProbability(prediction.predictedProbabilityA);
  return prediction.actualOutcome === 1 ? p : 1 - p;
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Number(value.toFixed(6));
}

export function brierScore(predictions: BacktestPrediction[]): number {
  if (predictions.length === 0) {
    return NaN;
  }

  const total = predictions.reduce((sum, prediction) => {
    const error = prediction.predictedProbabilityA - prediction.actualOutcome;
    return sum + error * error;
  }, 0);

  return roundMetric(total / predictions.length);
}

export function logLoss(predictions: BacktestPrediction[]): number {
  if (predictions.length === 0) {
    return NaN;
  }

  const total = predictions.reduce(
    (sum, prediction) => sum - Math.log(actualProbability(prediction)),
    0,
  );

  return roundMetric(total / predictions.length);
}

export function accuracy(predictions: BacktestPrediction[]): number {
  if (predictions.length === 0) {
    return NaN;
  }

  const correct = predictions.reduce((sum, prediction) => {
    if (prediction.predictedProbabilityA === 0.5) {
      return sum + 0.5;
    }

    const predictedOutcome = prediction.predictedProbabilityA > 0.5 ? 1 : 0;
    return sum + (predictedOutcome === prediction.actualOutcome ? 1 : 0);
  }, 0);

  return roundMetric(correct / predictions.length);
}

export function calibrationBuckets(
  predictions: BacktestPrediction[],
): CalibrationBucket[] {
  return Array.from({ length: CALIBRATION_BUCKETS }, (_, index) => {
    const bucketMin = index / CALIBRATION_BUCKETS;
    const bucketMax = (index + 1) / CALIBRATION_BUCKETS;
    const bucketPredictions = predictions.filter((prediction) => {
      const p = prediction.predictedProbabilityA;
      if (index === CALIBRATION_BUCKETS - 1) {
        return p >= bucketMin && p <= bucketMax;
      }

      return p >= bucketMin && p < bucketMax;
    });

    if (bucketPredictions.length === 0) {
      return {
        bucketMin,
        bucketMax,
        predictedMean: 0,
        actualWinRate: 0,
        count: 0,
      };
    }

    const predictedMean =
      bucketPredictions.reduce(
        (sum, prediction) => sum + prediction.predictedProbabilityA,
        0,
      ) / bucketPredictions.length;
    const actualWinRate =
      bucketPredictions.reduce(
        (sum, prediction) => sum + prediction.actualOutcome,
        0,
      ) / bucketPredictions.length;

    return {
      bucketMin,
      bucketMax,
      predictedMean: roundMetric(predictedMean),
      actualWinRate: roundMetric(actualWinRate),
      count: bucketPredictions.length,
    };
  });
}

export function breakdownStats(predictions: BacktestPrediction[]): BreakdownStats {
  return {
    brierScore: brierScore(predictions),
    logLoss: logLoss(predictions),
    n: predictions.length,
  };
}

export function evaluateModel(
  modelName: ModelName,
  predictions: BacktestPrediction[],
): EvaluationResult {
  const modelPredictions = predictions.filter(
    (prediction) => prediction.modelName === modelName,
  );
  const bySeasonGroups = groupBy(modelPredictions, (prediction) =>
    String(prediction.season),
  );
  const bySeason = Object.fromEntries(
    Object.entries(bySeasonGroups).map(([season, rows]) => [
      Number(season),
      breakdownStats(rows),
    ]),
  ) as Record<number, BreakdownStats>;

  return {
    modelName,
    n: modelPredictions.length,
    brierScore: brierScore(modelPredictions),
    logLoss: logLoss(modelPredictions),
    accuracy: accuracy(modelPredictions),
    calibrationBuckets: calibrationBuckets(modelPredictions),
    breakdown: {
      bySeason,
      byRound: byRoundBreakdown(modelPredictions),
      bubble: breakdownStats(
        modelPredictions.filter((prediction) => prediction.bubble),
      ),
      nonBubble: breakdownStats(
        modelPredictions.filter((prediction) => !prediction.bubble),
      ),
    },
  };
}

export function groupBy<K extends string>(
  predictions: BacktestPrediction[],
  key: (p: BacktestPrediction) => K,
): Record<string, BacktestPrediction[]> {
  const groups: Record<string, BacktestPrediction[]> = {};
  for (const p of predictions) {
    const k = key(p);
    (groups[k] ??= []).push(p);
  }
  return groups;
}

export function byRoundBreakdown(
  predictions: BacktestPrediction[],
): Partial<Record<HistoricalRound, BreakdownStats>> {
  const groups = groupBy(predictions, (prediction) => prediction.round);
  return Object.fromEntries(
    HISTORICAL_ROUNDS.filter((round) => groups[round]).map((round) => [
      round,
      breakdownStats(groups[round]),
    ]),
  ) as Partial<Record<HistoricalRound, BreakdownStats>>;
}
