import type {
  HistoricalSeries,
  TeamSeasonSnapshot,
} from "./types";

export type LaggedRotationPlayer = {
  playerName: string;
  projectedMinutes: number;
  gamesInLookback: number;
};

export type LaggedRotationObservation = {
  season: number;
  seriesId: string;
  teamId: string;
  observedAt: string;
  method: "last_10_team_games_before_deadline";
  sourceUrl: string;
  sourceLabel: string;
  players: LaggedRotationPlayer[];
};

export type ExternalSeriesBenchmark = {
  season: number;
  seriesId: string;
  observedAt: string;
  sourceUrl: string;
  sourceLabel: string;
  method: "no_vig_two_sided_series_price" | "public_probability";
  teamAWinProbability: number;
};

export type ObservationAuditIssue = {
  observation: string;
  issue: string;
};

export const LAGGED_ROTATION_CLAUSES = [
  "duplicateTeamSeries",
  "knownSeries",
  "seasonMatchesSeries",
  "teamBelongsToSeries",
  "timestampStrictlyBeforeDeadline",
  "httpsSource",
  "atLeastSixPlayers",
  "projectedMinutesTotal240",
  "playersOnSnapshotRoster",
  "uniquePlayerNames",
  "playerMinutesWithinBounds",
  "gamesInLookbackWithinBounds",
] as const;

export type LaggedRotationClause = (typeof LAGGED_ROTATION_CLAUSES)[number];

export type LaggedRotationRejectionDiagnostics = {
  candidateObservations: number;
  rejectionCounts: Record<LaggedRotationClause, number>;
  largestEliminator: LaggedRotationClause | null;
  largestEliminationCount: number;
};

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.includes("T");
}

function strictlyBeforeSeries(
  observedAt: string,
  seriesStartDate: string,
): boolean {
  // Historical game files currently retain dates rather than tip times.
  // Midnight UTC is therefore the conservative eligibility deadline.
  return Date.parse(observedAt) < Date.parse(`${seriesStartDate}T00:00:00Z`);
}

export function diagnoseLaggedRotationRejections(
  observations: LaggedRotationObservation[],
  series: HistoricalSeries[],
  snapshots: TeamSeasonSnapshot[],
): LaggedRotationRejectionDiagnostics {
  const seriesById = new Map(series.map((row) => [row.id, row]));
  const snapshotByTeamSeason = new Map(
    snapshots.map((row) => [`${row.season}:${row.teamId}`, row]),
  );
  const seen = new Set<string>();
  const rejectionCounts = Object.fromEntries(
    LAGGED_ROTATION_CLAUSES.map((clause) => [clause, 0]),
  ) as Record<LaggedRotationClause, number>;

  for (const observation of observations) {
    const identity = `${observation.seriesId}/${observation.teamId}`;
    const seriesRow = seriesById.get(observation.seriesId);
    const snapshot = snapshotByTeamSeason.get(
      `${observation.season}:${observation.teamId}`,
    );
    const roster = new Set(
      snapshot?.players.map((player) => player.name.toLowerCase()) ?? [],
    );
    const normalizedNames = observation.players.map((player) =>
      player.playerName.toLowerCase(),
    );

    if (seen.has(identity)) rejectionCounts.duplicateTeamSeries += 1;
    seen.add(identity);
    if (!seriesRow) rejectionCounts.knownSeries += 1;
    if (seriesRow && observation.season !== seriesRow.season) {
      rejectionCounts.seasonMatchesSeries += 1;
    }
    if (seriesRow && ![seriesRow.teamA, seriesRow.teamB].includes(observation.teamId)) {
      rejectionCounts.teamBelongsToSeries += 1;
    }
    if (
      !seriesRow ||
      !validTimestamp(observation.observedAt) ||
      !strictlyBeforeSeries(observation.observedAt, seriesRow.seriesStartDate)
    ) {
      rejectionCounts.timestampStrictlyBeforeDeadline += 1;
    }
    if (!/^https:\/\//.test(observation.sourceUrl)) rejectionCounts.httpsSource += 1;
    if (observation.players.length < 6) rejectionCounts.atLeastSixPlayers += 1;
    const totalMinutes = observation.players.reduce(
      (sum, player) => sum + player.projectedMinutes,
      0,
    );
    if (Math.abs(totalMinutes - 240) > 1e-6) {
      rejectionCounts.projectedMinutesTotal240 += 1;
    }
    if (normalizedNames.some((name) => !roster.has(name))) {
      rejectionCounts.playersOnSnapshotRoster += 1;
    }
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      rejectionCounts.uniquePlayerNames += 1;
    }
    if (
      observation.players.some(
        (player) =>
          !Number.isFinite(player.projectedMinutes) ||
          player.projectedMinutes < 0 ||
          player.projectedMinutes > 48,
      )
    ) {
      rejectionCounts.playerMinutesWithinBounds += 1;
    }
    if (
      observation.players.some(
        (player) =>
          !Number.isInteger(player.gamesInLookback) ||
          player.gamesInLookback < 0 ||
          player.gamesInLookback > 10,
      )
    ) {
      rejectionCounts.gamesInLookbackWithinBounds += 1;
    }
  }

  const largest = LAGGED_ROTATION_CLAUSES.reduce<{
    clause: LaggedRotationClause | null;
    count: number;
  }>(
    (current, clause) =>
      rejectionCounts[clause] > current.count
        ? { clause, count: rejectionCounts[clause] }
        : current,
    { clause: null, count: 0 },
  );

  return {
    candidateObservations: observations.length,
    rejectionCounts,
    largestEliminator: largest.clause,
    largestEliminationCount: largest.count,
  };
}

export function auditLaggedRotations(
  observations: LaggedRotationObservation[],
  series: HistoricalSeries[],
  snapshots: TeamSeasonSnapshot[],
): ObservationAuditIssue[] {
  const seriesById = new Map(series.map((row) => [row.id, row]));
  const snapshotByTeamSeason = new Map(
    snapshots.map((row) => [`${row.season}:${row.teamId}`, row]),
  );
  const seen = new Set<string>();
  const issues: ObservationAuditIssue[] = [];

  for (const observation of observations) {
    const label = `${observation.seriesId}/${observation.teamId}`;
    const seriesRow = seriesById.get(observation.seriesId);
    if (seen.has(label)) {
      issues.push({ observation: label, issue: "Duplicate team-series rotation." });
    }
    seen.add(label);
    if (!seriesRow) {
      issues.push({ observation: label, issue: "Unknown series." });
      continue;
    }
    if (observation.season !== seriesRow.season) {
      issues.push({ observation: label, issue: "Season does not match series." });
    }
    if (![seriesRow.teamA, seriesRow.teamB].includes(observation.teamId)) {
      issues.push({ observation: label, issue: "Team is not in the series." });
    }
    if (
      !validTimestamp(observation.observedAt) ||
      !strictlyBeforeSeries(observation.observedAt, seriesRow.seriesStartDate)
    ) {
      issues.push({
        observation: label,
        issue: "observedAt must be an ISO timestamp strictly before the conservative series deadline.",
      });
    }
    if (!/^https:\/\//.test(observation.sourceUrl)) {
      issues.push({ observation: label, issue: "Source URL must use HTTPS." });
    }
    if (observation.players.length < 6) {
      issues.push({
        observation: label,
        issue: "A rotation needs at least six named players.",
      });
    }
    const totalMinutes = observation.players.reduce(
      (sum, player) => sum + player.projectedMinutes,
      0,
    );
    if (Math.abs(totalMinutes - 240) > 1e-6) {
      issues.push({
        observation: label,
        issue: `Projected minutes total ${totalMinutes}, expected 240.`,
      });
    }
    const snapshot = snapshotByTeamSeason.get(
      `${observation.season}:${observation.teamId}`,
    );
    const roster = new Set(
      snapshot?.players.map((player) => player.name.toLowerCase()) ?? [],
    );
    const playerNames = new Set<string>();
    for (const player of observation.players) {
      const playerLabel = `${label}/${player.playerName}`;
      const normalizedName = player.playerName.toLowerCase();
      if (playerNames.has(normalizedName)) {
        issues.push({ observation: playerLabel, issue: "Duplicate player." });
      }
      playerNames.add(normalizedName);
      if (!roster.has(normalizedName)) {
        issues.push({
          observation: playerLabel,
          issue: "Player is absent from the pre-series roster snapshot.",
        });
      }
      if (
        !Number.isFinite(player.projectedMinutes) ||
        player.projectedMinutes < 0 ||
        player.projectedMinutes > 48
      ) {
        issues.push({
          observation: playerLabel,
          issue: "Projected minutes must be finite and within [0, 48].",
        });
      }
      if (
        !Number.isInteger(player.gamesInLookback) ||
        player.gamesInLookback < 0 ||
        player.gamesInLookback > 10
      ) {
        issues.push({
          observation: playerLabel,
          issue: "gamesInLookback must be an integer within [0, 10].",
        });
      }
    }
  }
  return issues;
}

export function auditExternalBenchmarks(
  observations: ExternalSeriesBenchmark[],
  series: HistoricalSeries[],
): ObservationAuditIssue[] {
  const seriesById = new Map(series.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const issues: ObservationAuditIssue[] = [];
  for (const observation of observations) {
    const label = `${observation.seriesId}/${observation.sourceLabel}`;
    const identity = `${observation.seriesId}:${observation.sourceUrl}`;
    if (seen.has(identity)) {
      issues.push({ observation: label, issue: "Duplicate source-series benchmark." });
    }
    seen.add(identity);
    const seriesRow = seriesById.get(observation.seriesId);
    if (!seriesRow) {
      issues.push({ observation: label, issue: "Unknown series." });
      continue;
    }
    if (observation.season !== seriesRow.season) {
      issues.push({ observation: label, issue: "Season does not match series." });
    }
    if (
      !validTimestamp(observation.observedAt) ||
      !strictlyBeforeSeries(observation.observedAt, seriesRow.seriesStartDate)
    ) {
      issues.push({
        observation: label,
        issue: "observedAt must be an ISO timestamp strictly before the conservative series deadline.",
      });
    }
    if (!/^https:\/\//.test(observation.sourceUrl)) {
      issues.push({ observation: label, issue: "Source URL must use HTTPS." });
    }
    if (
      !Number.isFinite(observation.teamAWinProbability) ||
      observation.teamAWinProbability <= 0 ||
      observation.teamAWinProbability >= 1
    ) {
      issues.push({
        observation: label,
        issue: "Probability must be finite and strictly within (0, 1).",
      });
    }
  }
  return issues;
}
