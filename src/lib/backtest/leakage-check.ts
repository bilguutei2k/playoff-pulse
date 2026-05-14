// Leakage guard for historical backtests.
// Every team snapshot used for a prediction must be dated strictly before the
// series start date. Violations are fatal.

import type { BacktestPrediction, TeamSeasonSnapshot } from "./types";

export type LeakageViolation = {
  seriesId: string;
  season: number;
  teamId: string;
  snapshotAsOf: string;
  seriesStartDate: string;
};

function snapshotKey(season: number, teamId: string): string {
  return `${season}:${teamId}`;
}

export function findLeakageViolations(
  predictions: BacktestPrediction[],
  snapshots: TeamSeasonSnapshot[],
): LeakageViolation[] {
  const snapshotsBySeasonTeam = new Map(
    snapshots.map((snapshot) => [
      snapshotKey(snapshot.season, snapshot.teamId),
      snapshot,
    ]),
  );
  const violations: LeakageViolation[] = [];

  for (const prediction of predictions) {
    if (prediction.snapshotAsOf >= prediction.seriesStartDate) {
      violations.push({
        seriesId: prediction.seriesId,
        season: prediction.season,
        teamId: "prediction",
        snapshotAsOf: prediction.snapshotAsOf,
        seriesStartDate: prediction.seriesStartDate,
      });
    }

    for (const teamId of [prediction.teamA, prediction.teamB]) {
      const snapshot = snapshotsBySeasonTeam.get(snapshotKey(prediction.season, teamId));
      if (!snapshot) {
        violations.push({
          seriesId: prediction.seriesId,
          season: prediction.season,
          teamId,
          snapshotAsOf: "missing",
          seriesStartDate: prediction.seriesStartDate,
        });
        continue;
      }

      if (!isSnapshotSafe(snapshot, prediction.seriesStartDate)) {
        violations.push({
          seriesId: prediction.seriesId,
          season: prediction.season,
          teamId,
          snapshotAsOf: snapshot.snapshot_as_of,
          seriesStartDate: prediction.seriesStartDate,
        });
      }
    }
  }

  return violations;
}

export function assertNoLeakage(
  predictions: BacktestPrediction[],
  snapshots: TeamSeasonSnapshot[],
): void {
  const violations = findLeakageViolations(predictions, snapshots);
  if (violations.length === 0) {
    return;
  }

  const details = violations
    .map(
      (violation) =>
        `${violation.season} ${violation.seriesId} ${violation.teamId}: ${violation.snapshotAsOf} >= ${violation.seriesStartDate}`,
    )
    .join("\n");

  throw new Error(`Backtest leakage check failed:\n${details}`);
}

export function isSnapshotSafe(
  snapshot: TeamSeasonSnapshot,
  seriesStartDate: string,
): boolean {
  return snapshot.snapshot_as_of < seriesStartDate;
}
