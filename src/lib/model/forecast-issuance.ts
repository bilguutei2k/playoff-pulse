export type ForecastIssuanceType =
  | "prospective_before_game"
  | "retrospective_snapshot";

export type ForecastIssuanceTarget = {
  seriesId: string;
  gameId: string;
  scheduledStart: string;
};

export type ForecastIssuanceMetadata = {
  type: ForecastIssuanceType;
  issuedAt: string;
  dataSnapshotAt: string;
  target?: ForecastIssuanceTarget;
};

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  return parsed;
}

export function assertValidForecastIssuance(
  metadata: ForecastIssuanceMetadata,
): void {
  const issuedAt = timestamp(metadata.issuedAt, "issuedAt");
  const dataSnapshotAt = timestamp(metadata.dataSnapshotAt, "dataSnapshotAt");
  if (issuedAt < dataSnapshotAt) {
    throw new Error("A forecast cannot be issued before its data snapshot exists.");
  }

  if (metadata.type === "prospective_before_game") {
    if (!metadata.target) {
      throw new Error("Prospective issuance requires an explicit target game.");
    }
    if (!metadata.target.seriesId.trim() || !metadata.target.gameId.trim()) {
      throw new Error("Prospective issuance requires non-empty series and game IDs.");
    }
    const scheduledStart = timestamp(
      metadata.target.scheduledStart,
      "target.scheduledStart",
    );
    if (issuedAt >= scheduledStart) {
      throw new Error(
        "Prospective forecasts must be issued strictly before the target game starts.",
      );
    }
  } else if (metadata.target) {
    throw new Error("Retrospective snapshots must not declare a target game.");
  }
}

