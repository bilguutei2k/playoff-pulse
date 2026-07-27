import {
  fitLogisticModel,
  fitRidgeModel,
  tuneLogisticScale,
  type LogisticModel,
  type RidgeModel,
} from "../../src/lib/backtest/regression";

export const HOLDOUT_SEASON = 2026;

export type SeasonTagged = {
  season: number;
};

export function assertFitRowsPrecedeHoldout(
  rows: readonly SeasonTagged[],
  fitLabel: string,
): void {
  const contaminated = rows.filter((row) => row.season >= HOLDOUT_SEASON);
  if (contaminated.length > 0) {
    const seasons = [...new Set(contaminated.map((row) => row.season))].sort();
    throw new Error(
      `${fitLabel} received held-out row(s) from ${seasons.join(", ")}. ` +
        `All fitting inputs must precede ${HOLDOUT_SEASON}.`,
    );
  }
}

export function fitRidgeBeforeHoldout<T extends SeasonTagged>(
  rows: readonly T[],
  vector: (row: T) => number[],
  outcome: (row: T) => number,
  featureNames: string[],
  lambda: number,
  fitLabel: string,
): RidgeModel {
  assertFitRowsPrecedeHoldout(rows, fitLabel);
  return fitRidgeModel(
    rows.map(vector),
    rows.map(outcome),
    featureNames,
    lambda,
  );
}

export function fitLogisticBeforeHoldout<T extends SeasonTagged>(
  rows: readonly T[],
  vector: (row: T) => number[],
  outcome: (row: T) => number,
  featureNames: string[],
  lambda: number,
  fitLabel: string,
): LogisticModel {
  assertFitRowsPrecedeHoldout(rows, fitLabel);
  return fitLogisticModel(
    rows.map(vector),
    rows.map(outcome),
    featureNames,
    lambda,
  );
}

export function tuneScaleBeforeHoldout<T extends SeasonTagged>(
  rows: readonly T[],
  margin: (row: T) => number,
  outcome: (row: T) => number,
  fitLabel: string,
): number {
  assertFitRowsPrecedeHoldout(rows, fitLabel);
  return tuneLogisticScale(rows.map(margin), rows.map(outcome));
}
