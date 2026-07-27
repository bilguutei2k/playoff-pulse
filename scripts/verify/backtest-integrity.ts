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
import { SEASONS } from "../backtest/scrape-bbref";
import { assertValidForecastIssuance } from "../../src/lib/model/forecast-issuance";
import { fullHomePattern } from "../backtest/baselines";
import { ratingGapPlayerMultiplier } from "../../src/lib/backtest/research-candidates";
import {
  auditAvailabilityObservations,
  type HistoricalAvailabilityObservation,
} from "../../src/lib/backtest/availability";
import {
  auditExternalBenchmarks,
  auditLaggedRotations,
  type ExternalSeriesBenchmark,
  type LaggedRotationObservation,
} from "../../src/lib/backtest/input-observations";
import { seriesProbabilityChallenger } from "../../src/lib/backtest/prospective-challenger";
import type { LogisticModel } from "../../src/lib/backtest/regression";
import {
  assertFitRowsPrecedeHoldout,
  fitLogisticBeforeHoldout,
  fitRidgeBeforeHoldout,
  tuneScaleBeforeHoldout,
} from "../backtest/fit-isolation";

export function runBacktestIntegrityChecks(): void {
  assert.doesNotThrow(() =>
    assertFitRowsPrecedeHoldout(
      [{ season: 2003 }, { season: 2025 }],
      "verification clean fit",
    ),
  );
  assert.throws(
    () =>
      assertFitRowsPrecedeHoldout(
        [{ season: 2025 }, { season: 2026 }],
        "verification contaminated fit",
      ),
    /received held-out row.*2026/,
    "Any fitting path that receives a 2026 row must fail loudly.",
  );
  const contaminatedFitRows = [
    { season: 2025, x: 0, y: 0 },
    { season: 2026, x: 1, y: 1 },
  ];
  assert.throws(
    () =>
      fitRidgeBeforeHoldout(
        contaminatedFitRows,
        (row) => [row.x],
        (row) => row.y,
        ["x"],
        1,
        "verification ridge fit",
      ),
    /received held-out row.*2026/,
  );
  assert.throws(
    () =>
      fitLogisticBeforeHoldout(
        contaminatedFitRows,
        (row) => [row.x],
        (row) => row.y,
        ["x"],
        1,
        "verification logistic fit",
      ),
    /received held-out row.*2026/,
  );
  assert.throws(
    () =>
      tuneScaleBeforeHoldout(
        contaminatedFitRows,
        (row) => row.x,
        (row) => row.y,
        "verification scale fit",
      ),
    /received held-out row.*2026/,
  );
  const holdoutEvaluatorSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "scripts",
      "backtest",
      "evaluate-2026-holdout.ts",
    ),
    "utf-8",
  );
  for (const forbiddenDirectFit of [
    "fitRidge" + "Model",
    "fitLogistic" + "Model",
    "tuneLogistic" + "Scale",
  ]) {
    assert(
      !holdoutEvaluatorSource.includes(forbiddenDirectFit),
      `Holdout evaluator must not bypass guarded fitting with ${forbiddenDirectFit}.`,
    );
  }

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
  const finals2003 = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data", "historical", "series", "2003.json"),
      "utf-8",
    ),
  ).find((series: { round: string }) => series.round === "NBA Finals");
  assert.deepEqual(
    fullHomePattern(finals2003),
    ["SAS", "SAS", "NJN", "NJN", "NJN", "SAS", "SAS"],
    "Pre-2014 Finals must use the historical 2-3-2 home pattern.",
  );
  assert.equal(ratingGapPlayerMultiplier(0, 5), 1);
  assert(
    ratingGapPlayerMultiplier(10, 5) < ratingGapPlayerMultiplier(5, 5),
    "Player-impact multiplier must shrink smoothly as the rating gap grows.",
  );
  assert.equal(
    ratingGapPlayerMultiplier(-5, 5),
    ratingGapPlayerMultiplier(5, 5),
    "Rating-gap shrinkage must be symmetric.",
  );

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

  assert.doesNotThrow(() =>
    assertValidForecastIssuance({
      type: "prospective_before_game",
      dataSnapshotAt: "2027-04-18T12:00:00Z",
      issuedAt: "2027-04-18T15:00:00Z",
      target: {
        seriesId: "2027-east-r1-example",
        gameId: "game-1",
        scheduledStart: "2027-04-18T23:00:00Z",
      },
    }),
  );
  assert.throws(
    () =>
      assertValidForecastIssuance({
        type: "prospective_before_game",
        dataSnapshotAt: "2027-04-18T12:00:00Z",
        issuedAt: "2027-04-18T23:00:00Z",
        target: {
          seriesId: "2027-east-r1-example",
          gameId: "game-1",
          scheduledStart: "2027-04-18T23:00:00Z",
        },
      }),
    /strictly before/,
  );

  const availabilityObservations = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "data",
        "historical",
        "availability-observations.json",
      ),
      "utf-8",
    ),
  ) as HistoricalAvailabilityObservation[];
  assert.deepEqual(
    auditAvailabilityObservations(
      availabilityObservations,
      SEASONS.flatMap((season) =>
        JSON.parse(
          fs.readFileSync(
            path.join(
              process.cwd(),
              "data",
              "historical",
              "series",
              `${season}.json`,
            ),
            "utf-8",
          ),
        ),
      ),
      SEASONS.flatMap((season) => loadSnapshots(season)),
    ),
    [],
  );
  const allHistoricalSeries = SEASONS.flatMap((season) =>
    JSON.parse(
      fs.readFileSync(
        path.join(
          process.cwd(),
          "data",
          "historical",
          "series",
          `${season}.json`,
        ),
        "utf-8",
      ),
    ),
  );
  const laggedRotations = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "data",
        "historical",
        "lagged-rotation-observations.json",
      ),
      "utf-8",
    ),
  ) as LaggedRotationObservation[];
  const externalBenchmarks = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "data",
        "historical",
        "external-series-benchmarks.json",
      ),
      "utf-8",
    ),
  ) as ExternalSeriesBenchmark[];
  assert.deepEqual(
    auditLaggedRotations(
      laggedRotations,
      allHistoricalSeries,
      SEASONS.flatMap((season) => loadSnapshots(season)),
    ),
    [],
  );
  assert.deepEqual(
    auditExternalBenchmarks(externalBenchmarks, allHistoricalSeries),
    [],
  );

  const pregameArchive = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "docs", "backtest", "pregame-archive.json"), "utf-8"),
  ) as HistoricalPregameArchive;
  assert.equal(findPregameLeakageViolations(pregameArchive).length, 0);
  const expectedPregameRecords = SEASONS.reduce(
    (total, season) =>
      total +
      JSON.parse(
        fs.readFileSync(
          path.join(process.cwd(), "data", "historical", "games", `${season}.json`),
          "utf-8",
        ),
      ).length,
    0,
  );
  assert.equal(pregameArchive.records.length, expectedPregameRecords);
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

  const research = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "docs", "backtest", "research.json"),
      "utf-8",
    ),
  );
  for (const target of ["game", "series"] as const) {
    for (const model of ["reference", "climatology"] as const) {
      const decomposition = research.brierDecomposition[target][model];
      assert(decomposition.uncertainty >= 0);
      assert(decomposition.resolution >= 0);
      assert(decomposition.reliability >= 0);
      assert(
        Math.abs(
          decomposition.brier -
            (decomposition.groupedEstimate + decomposition.residual),
        ) < 1e-10,
        `${target}/${model} Brier decomposition must reconcile exactly with its residual.`,
      );
    }
  }
  assert.equal(
    research.preregisteredRatingGapShrinkageCandidate.registration
      .firstPromotionEligibleSeason,
    2027,
  );
  assert(
    research.preregisteredRatingGapShrinkageCandidate.comparisonToSrsHome.game
      .ci95[0] <= 0 &&
      research.preregisteredRatingGapShrinkageCandidate.comparisonToSrsHome.game
        .ci95[1] >= 0,
    "Shrinkage candidate must remain unpromoted while its game interval spans zero.",
  );
  assert.equal(
    research.primarySeriesChallenger.registration.firstPromotionEligibleSeason,
    2027,
  );
  assert.equal(
    research.modelSelectionGate.promotionChecks
      .genuinelyFutureArchivedSeasonAvailable,
    true,
  );
  assert.equal(
    research.modelSelectionGate.promotionChecks
      .prospectiveRegistrationBeforeEvaluatedSeason,
    false,
  );
  assert.equal(
    research.modelSelectionGate.decision,
    "not_eligible_contaminated_2026_registration_and_no_production_equivalent_inputs",
  );
  assert.equal(
    research.modelSelectionGate.registrationClassification
      .exact_srs_logit_plus_seed_v1,
    "CONTAMINATED_2026",
  );
  assert(
    research.nestedCalibration.gamePropagatedThroughExactSeries.predictions.every(
      (row: { p: number; rawP: number }) =>
        row.p >= 0 && row.p <= 1 && row.rawP >= 0 && row.rawP <= 1,
    ),
    "Game-calibrated exact series probabilities must remain bounded.",
  );
  assert.equal(
    research.preregisteredTemporalWindowCandidate.registration
      .trainingWindowSeasons,
    10,
  );
  const identityModel: LogisticModel = {
    featureNames: ["exactSrsLogit", "seedDiff"],
    means: [0, 0],
    scales: [1, 1],
    intercept: 0,
    coefficients: [1, 0],
    lambda: 1,
  };
  assert(
    Math.abs(seriesProbabilityChallenger(0.73, 4, identityModel) - 0.73) <
      1e-10,
    "An identity challenger must preserve its raw probability.",
  );
  assert.throws(
    () => seriesProbabilityChallenger(1.1, 0, identityModel),
    /within \[0, 1\]/,
  );
}

if (typeof require !== "undefined" && require.main === module) {
  runBacktestIntegrityChecks();
  console.log("Backtest integrity checks passed.");
}
