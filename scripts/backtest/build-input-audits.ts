import * as fs from "node:fs";
import * as path from "node:path";
import {
  auditExternalBenchmarks,
  auditLaggedRotations,
  type ExternalSeriesBenchmark,
  type LaggedRotationObservation,
} from "../../src/lib/backtest/input-observations";
import { loadSeries, loadSnapshots } from "./build-snapshots";
import { SEASONS } from "./scrape-bbref";

const ROOT = process.cwd();

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

export function buildInputAudit() {
  const rotations = readJson<LaggedRotationObservation[]>(
    path.join(ROOT, "data", "historical", "lagged-rotation-observations.json"),
  );
  const benchmarks = readJson<ExternalSeriesBenchmark[]>(
    path.join(ROOT, "data", "historical", "external-series-benchmarks.json"),
  );
  const series = SEASONS.flatMap((season) => loadSeries(season));
  const snapshots = SEASONS.flatMap((season) => loadSnapshots(season));
  const issues = [
    ...auditLaggedRotations(rotations, series, snapshots),
    ...auditExternalBenchmarks(benchmarks, series),
  ];
  if (issues.length) {
    throw new Error(
      `Input audit failed:\n${issues
        .map((issue) => `${issue.observation}: ${issue.issue}`)
        .join("\n")}`,
    );
  }

  const coveredRotationSeries = new Set(
    rotations.map((row) => row.seriesId),
  ).size;
  const benchmarkSeries = new Set(benchmarks.map((row) => row.seriesId)).size;
  return {
    generatedAt: new Date().toISOString(),
    conservativeDeadline:
      "Inputs must be timestamped before 00:00 UTC on seriesStartDate because historical tip times are not retained.",
    laggedRotations: {
      method: "last_10_team_games_before_deadline",
      observations: rotations.length,
      coveredSeries: coveredRotationSeries,
      totalSeries: series.length,
      completePairedSeries: series.filter((row) => {
        const teams = rotations.filter((rotation) => rotation.seriesId === row.id);
        return (
          teams.some((rotation) => rotation.teamId === row.teamA) &&
          teams.some((rotation) => rotation.teamId === row.teamB)
        );
      }).length,
      status:
        rotations.length === 0
          ? "not_estimable_no_timestamped_player_game_log_inputs"
          : "eligible_after_complete-pair-coverage-review",
      rule:
        "Do not infer a pre-series rotation from games played after the deadline. Only named, sourced, lagged observations totaling 240 minutes are eligible.",
    },
    externalBenchmarks: {
      observations: benchmarks.length,
      coveredSeries: benchmarkSeries,
      totalSeries: series.length,
      status:
        benchmarks.length === 0
          ? "not_estimable_no_timestamped_external_probabilities"
          : "eligible_for_matched-series-comparison",
      rule:
        "Only timestamped public probabilities or explicitly no-vig two-sided series prices are eligible. Closing prices observed after the deadline are excluded.",
    },
  };
}

if (typeof require !== "undefined" && require.main === module) {
  const output = path.join(ROOT, "docs", "backtest", "input-audit.json");
  fs.writeFileSync(output, JSON.stringify(buildInputAudit(), null, 2), "utf-8");
  console.log("Wrote lagged-rotation and external-benchmark input audit.");
}
