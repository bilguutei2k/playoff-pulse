import { describe, expect, it } from "vitest";

import {
  HOLDOUT_SEASON,
  assertFitRowsPrecedeHoldout,
  fitLogisticBeforeHoldout,
  fitRidgeBeforeHoldout,
  tuneScaleBeforeHoldout,
} from "../scripts/backtest/fit-isolation";

type FitRow = {
  season: number;
  x: number;
  y: number;
};

const contaminatedRows = (season: number): FitRow[] => [
  { season: HOLDOUT_SEASON - 1, x: -1, y: 0 },
  { season, x: 1, y: 1 },
];

describe.each([HOLDOUT_SEASON, HOLDOUT_SEASON + 1])(
  "fit isolation for season %i",
  (contaminatedSeason) => {
    it("rejects raw fitting rows at or after the target season", () => {
      expect(() =>
        assertFitRowsPrecedeHoldout(
          contaminatedRows(contaminatedSeason),
          "raw fit",
        ),
      ).toThrow(/received held-out row/);
    });

    it("rejects ridge fitting rows at or after the target season", () => {
      expect(() =>
        fitRidgeBeforeHoldout(
          contaminatedRows(contaminatedSeason),
          (row) => [row.x],
          (row) => row.y,
          ["x"],
          1,
          "ridge fit",
        ),
      ).toThrow(/received held-out row/);
    });

    it("rejects logistic fitting rows at or after the target season", () => {
      expect(() =>
        fitLogisticBeforeHoldout(
          contaminatedRows(contaminatedSeason),
          (row) => [row.x],
          (row) => row.y,
          ["x"],
          1,
          "logistic fit",
        ),
      ).toThrow(/received held-out row/);
    });

    it("rejects scale tuning rows at or after the target season", () => {
      expect(() =>
        tuneScaleBeforeHoldout(
          contaminatedRows(contaminatedSeason),
          (row) => row.x,
          (row) => row.y,
          "scale fit",
        ),
      ).toThrow(/received held-out row/);
    });
  },
);
