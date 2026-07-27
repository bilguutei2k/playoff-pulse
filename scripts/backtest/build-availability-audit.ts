import * as fs from "node:fs";
import * as path from "node:path";
import {
  auditAvailabilityObservations,
  type HistoricalAvailabilityObservation,
} from "../../src/lib/backtest/availability";
import { loadSeries, loadSnapshots } from "./build-snapshots";
import { SEASONS } from "./scrape-bbref";

const ROOT = process.cwd();
const INPUT = path.join(
  ROOT,
  "data",
  "historical",
  "availability-observations.json",
);
const OUTPUT = path.join(ROOT, "docs", "backtest", "availability.json");

export function buildAvailabilityAudit() {
  const observations = JSON.parse(
    fs.readFileSync(INPUT, "utf-8"),
  ) as HistoricalAvailabilityObservation[];
  const series = SEASONS.flatMap((season) => loadSeries(season));
  const snapshots = SEASONS.flatMap((season) => loadSnapshots(season));
  const issues = auditAvailabilityObservations(observations, series, snapshots);
  if (issues.length > 0) {
    throw new Error(
      `Historical availability audit failed:\n${issues
        .map((issue) => `${issue.observation}: ${issue.issue}`)
        .join("\n")}`,
    );
  }

  const playerSeriesOpportunities = series.reduce((total, seriesRow) => {
    const teams = snapshots.filter(
      (snapshot) =>
        snapshot.season === seriesRow.season &&
        (snapshot.teamId === seriesRow.teamA || snapshot.teamId === seriesRow.teamB),
    );
    return (
      total +
      teams.reduce((sum, snapshot) => sum + snapshot.players.length, 0)
    );
  }, 0);
  const coveredSeries = new Set(
    observations.map((observation) => observation.seriesId),
  ).size;

  return {
    generatedAt: new Date().toISOString(),
    protocol:
      "Only sourced observations timestamped strictly before a series begins are eligible. No status is inferred from game outcomes or retrospective participation.",
    seasons: [...SEASONS],
    observations: observations.length,
    coveredSeries,
    totalSeries: series.length,
    playerSeriesOpportunities,
    observationCoverage:
      playerSeriesOpportunities === 0
        ? 0
        : observations.length / playerSeriesOpportunities,
    defaultAssumption: "unknown_assumed_available",
    effectEvaluationStatus:
      observations.length === 0
        ? "not_estimable_no_point_in_time_observations"
        : "eligible_for_separately_preregistered_evaluation",
    limitations: [
      "Game participation is not used as a proxy because it is only known after the forecast deadline.",
      "The absence of a sourced report is not evidence that a player was healthy.",
      "Until coverage is material, injury and replacement-minute effects remain unvalidated historically.",
    ],
  };
}

if (typeof require !== "undefined" && require.main === module) {
  fs.writeFileSync(OUTPUT, JSON.stringify(buildAvailabilityAudit(), null, 2));
  console.log("Wrote historical availability completeness audit.");
}
