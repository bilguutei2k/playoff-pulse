import type { HistoricalSeries, TeamSeasonSnapshot } from "./types";

export type HistoricalAvailabilityStatus =
  | "available"
  | "limited"
  | "questionable"
  | "out";

export type HistoricalAvailabilityObservation = {
  season: number;
  seriesId: string;
  teamId: string;
  playerName: string;
  status: HistoricalAvailabilityStatus;
  observedAt: string;
  sourceUrl: string;
  sourceLabel: string;
};

export type AvailabilityAuditIssue = {
  observation: string;
  issue: string;
};

export function auditAvailabilityObservations(
  observations: HistoricalAvailabilityObservation[],
  series: HistoricalSeries[],
  snapshots: TeamSeasonSnapshot[],
): AvailabilityAuditIssue[] {
  const seriesById = new Map(series.map((row) => [row.id, row]));
  const snapshotsByTeamSeason = new Map(
    snapshots.map((row) => [`${row.season}:${row.teamId}`, row]),
  );
  const seen = new Set<string>();
  const issues: AvailabilityAuditIssue[] = [];

  for (const observation of observations) {
    const identity = [
      observation.seriesId,
      observation.teamId,
      observation.playerName,
      observation.observedAt,
    ].join(":");
    const label = `${observation.seriesId}/${observation.teamId}/${observation.playerName}`;
    if (seen.has(identity)) {
      issues.push({ observation: label, issue: "Duplicate observation." });
    }
    seen.add(identity);

    const seriesRow = seriesById.get(observation.seriesId);
    if (!seriesRow) {
      issues.push({ observation: label, issue: "Unknown series." });
      continue;
    }
    if (seriesRow.season !== observation.season) {
      issues.push({ observation: label, issue: "Season does not match series." });
    }
    if (
      observation.teamId !== seriesRow.teamA &&
      observation.teamId !== seriesRow.teamB
    ) {
      issues.push({ observation: label, issue: "Team is not in the series." });
    }
    if (observation.observedAt >= seriesRow.seriesStartDate) {
      issues.push({
        observation: label,
        issue: "Observation is not strictly before the series start.",
      });
    }
    if (!/^https:\/\//.test(observation.sourceUrl)) {
      issues.push({
        observation: label,
        issue: "Source URL must be an HTTPS point-in-time citation.",
      });
    }
    const snapshot = snapshotsByTeamSeason.get(
      `${observation.season}:${observation.teamId}`,
    );
    if (
      !snapshot?.players.some(
        (player) => player.name.toLowerCase() === observation.playerName.toLowerCase(),
      )
    ) {
      issues.push({
        observation: label,
        issue: "Player is not present in the regular-season snapshot.",
      });
    }
  }

  return issues;
}

