import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  allocatePlayoffRotation,
  loadSnapshots,
  PLAYER_MINUTE_CAP,
  PLAYOFF_ROTATION_MINUTES,
} from "../backtest/build-snapshots";
import type { HistoricalPregameArchive } from "../../src/lib/backtest/point-in-time-types";
import { findPregameLeakageViolations } from "../../src/lib/backtest/point-in-time-types";
import { assertCompatibleImpactScales } from "../../src/lib/model/point-in-time";
import { allocateScenarioRotation } from "../../src/lib/model/rotation";
import type { Team } from "../../src/lib/model/types";

const SEASONS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

export function runBacktestIntegrityChecks(): void {
  const sample = [{ mpg: 38 }, { mpg: 34 }, { mpg: 30 }, { mpg: 26 }, { mpg: 22 }, { mpg: 18 }];
  const first = allocatePlayoffRotation(sample);
  const second = allocatePlayoffRotation(sample);
  assert.deepEqual(first, second, "Historical rotation allocation must be deterministic.");
  assert(
    Math.abs(first.reduce((sum, value) => sum + value, 0) - PLAYOFF_ROTATION_MINUTES) < 1e-4,
    "Historical rotation allocation must total 240 minutes.",
  );
  assert(
    first.every((minutes) => minutes >= 0 && minutes <= PLAYER_MINUTE_CAP),
    "Historical rotation minutes must remain within player bounds.",
  );

  for (const season of SEASONS) {
    for (const snapshot of loadSnapshots(season)) {
      const total = snapshot.players.reduce(
        (sum, player) => sum + player.projectedMinutes,
        0,
      );
      assert(
        Math.abs(total - PLAYOFF_ROTATION_MINUTES) < 1e-4,
        `${season} ${snapshot.teamId} rotation totals ${total}, expected 240.`,
      );
      assert.equal(snapshot.ratingSource, "srs_point_proxy");
      assert.equal(snapshot.rotationSource, "normalized_regular_season_mpg");
      assert(
        snapshot.players.every(
          (player) => player.availabilityStatus === "unknown_assumed_available",
        ),
        `${season} ${snapshot.teamId} must disclose unknown historical availability.`,
      );
    }
  }

  const scenarioTeam: Team = {
    id: "rotation-test",
    name: "Rotation Test",
    abbreviation: "ROT",
    conference: "East",
    seed: 1,
    eloRating: 1500,
    netRating: 0,
    manualAdjustment: 0,
    players: [
      { id: "star", name: "Star", teamId: "rotation-test", impact: 8, projectedMinutes: 40, injuryStatus: "healthy" },
      { id: "two", name: "Two", teamId: "rotation-test", impact: 3, projectedMinutes: 35, injuryStatus: "healthy" },
      { id: "three", name: "Three", teamId: "rotation-test", impact: 2, projectedMinutes: 30, injuryStatus: "healthy" },
      { id: "four", name: "Four", teamId: "rotation-test", impact: 1, projectedMinutes: 25, injuryStatus: "healthy" },
      { id: "five", name: "Five", teamId: "rotation-test", impact: 0, projectedMinutes: 20, injuryStatus: "healthy" },
    ],
  };
  const baseAllocation = allocateScenarioRotation(scenarioTeam);
  const outAllocation = allocateScenarioRotation(scenarioTeam, {
    overrides: { star: { injuryStatus: "out" } },
  });
  for (const allocation of [baseAllocation, outAllocation]) {
    assert(
      Math.abs(
        allocation.team.players.reduce((sum, player) => sum + player.projectedMinutes, 0) - 240,
      ) < 1e-4,
      "Scenario rotation must conserve 240 minutes.",
    );
  }
  assert.equal(outAllocation.playerMinutes.star, 0, "Out player must receive zero minutes.");
  assert(
    outAllocation.replacementMinutes > baseAllocation.replacementMinutes,
    "Out-player minutes must flow to disclosed replacement minutes.",
  );
  assert.deepEqual(
    allocateScenarioRotation(scenarioTeam),
    baseAllocation,
    "Scenario rotation must be deterministic.",
  );

  assert.throws(
    () => assertCompatibleImpactScales(
      { impactScale: "manual_point_estimate", ratingScale: "manual_rating_ensemble", rotationSource: "manual_projected_minutes", availabilitySource: "manual_status" },
      { impactScale: "bpm_proxy", ratingScale: "srs_point_proxy", rotationSource: "normalized_regular_season_mpg", availabilitySource: "unknown_assumed_available" },
    ),
    /Incompatible impact scales/,
  );

  const pregameArchive = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "docs", "backtest", "pregame-archive.json"), "utf-8"),
  ) as HistoricalPregameArchive;
  assert.equal(findPregameLeakageViolations(pregameArchive).length, 0);
  assert.equal(pregameArchive.records.length, 834);
  assert(
    pregameArchive.records.every(
      (record) =>
        record.teamAGameWinProbability >= 0 &&
        record.teamAGameWinProbability <= 1 &&
        record.teamASeriesWinProbability >= 0 &&
        record.teamASeriesWinProbability <= 1,
    ),
    "Pregame archive probabilities must remain bounded.",
  );
}

if (typeof require !== "undefined" && require.main === module) {
  runBacktestIntegrityChecks();
  console.log("Backtest integrity checks passed.");
}
