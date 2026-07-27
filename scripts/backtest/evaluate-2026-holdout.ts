import fs from "node:fs";
import path from "node:path";
import {
  logisticProbability,
  predictLogistic,
  predictRidge,
  type LogisticModel,
  type RidgeModel,
} from "../../src/lib/backtest/regression";
import type {
  HistoricalGame,
  HistoricalSeries,
  TeamSeasonSnapshot,
} from "../../src/lib/backtest/types";
import { defaultModelSettings } from "../../src/lib/data/model-settings";
import { gameWinProbability } from "../../src/lib/model/probability";
import { solveSeriesExactly } from "../../src/lib/model/series-solver";
import {
  NET_RATING_ONLY_SETTINGS,
  SRS_PROXY_ONLY_SETTINGS,
  fullHomePattern,
  predict,
  snapshotToTeam,
} from "./baselines";
import {
  loadGames,
  loadSeries,
  loadSnapshots,
} from "./build-snapshots";
import { playoffPulsePrediction } from "./run-backtest";
import {
  HOLDOUT_SEASON,
  assertFitRowsPrecedeHoldout,
  fitRidgeBeforeHoldout,
  tuneScaleBeforeHoldout,
} from "./fit-isolation";
import { verifyFrozenArtifacts } from "./verify-frozen";

const OUTPUT_PATH = path.join(
  process.cwd(),
  "docs",
  "backtest",
  "holdout-2026.json",
);
const FROZEN_RESEARCH_PATH = path.join(
  process.cwd(),
  "docs",
  "backtest",
  "frozen-2003-2025",
  "research.json",
);
const FIT_SEASONS = Array.from({ length: 23 }, (_, index) => 2003 + index);
const TEN_SEASON_WINDOW = FIT_SEASONS.filter((season) => season >= 2016);
const LAMBDAS = [0.01, 0.1, 1, 10, 100];
const ITERATIONS = 10_000;
const DIRECTIONAL_PRIOR = 0.65;

type Prediction = {
  id: string;
  p: number;
  y: number;
};

type FitGameRow = {
  season: number;
  srsDiff: number;
  homeCourt: number;
  margin: number;
  homeWon: number;
};

type FittedSrsGameModel = {
  regression: RidgeModel;
  logisticScale: number;
};

type FrozenResearch = {
  results: Array<{
    id: string;
    finalModel: FittedSrsGameModel;
  }>;
  primarySeriesChallenger: {
    registration: Record<string, unknown>;
    finalModel: LogisticModel;
  };
  preregisteredTemporalWindowCandidate: {
    registration: Record<string, unknown>;
  };
  modelSelectionGate: {
    minimumMeaningfulImprovement: number;
    primaryChallenger: string;
    primaryEndpoint: string;
  };
};

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function boundProbability(probability: number, label: string): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(`${label} produced probability ${probability}, outside [0, 1].`);
  }
  return Math.min(1 - 1e-7, Math.max(1e-7, probability));
}

function logit(probability: number): number {
  const p = Math.min(1 - 1e-6, Math.max(1e-6, probability));
  return Math.log(p / (1 - p));
}

// Evaluation-only diagnostic. This estimates slope/intercept from held-out
// predictions after every forecast is fixed; its result is never used to
// generate or recalibrate a 2026 prediction.
function calibrationDiagnostic(rows: Prediction[]) {
  const logits = rows.map((row) => logit(row.p));
  if (Math.max(...logits) - Math.min(...logits) < 1e-12) {
    const rate = Math.min(
      1 - 1e-6,
      Math.max(1e-6, mean(rows.map((row) => row.y))),
    );
    return {
      intercept: logit(rate),
      slope: 0,
      status: "slope_not_identifiable_constant_predictions",
    };
  }

  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const fitted =
        1 / (1 + Math.exp(-(intercept + slope * logits[index])));
      const weight = Math.max(1e-8, fitted * (1 - fitted));
      g0 += rows[index].y - fitted;
      g1 += (rows[index].y - fitted) * logits[index];
      h00 += weight;
      h01 += weight * logits[index];
      h11 += weight * logits[index] * logits[index];
    }
    const determinant = h00 * h11 - h01 * h01;
    if (Math.abs(determinant) < 1e-10) {
      return {
        intercept,
        slope,
        status: "numerically_unstable_single_season_fit",
      };
    }
    const delta0 = (g0 * h11 - g1 * h01) / determinant;
    const delta1 = (g1 * h00 - g0 * h01) / determinant;
    intercept += delta0;
    slope += delta1;
    if (Math.abs(delta0) + Math.abs(delta1) < 1e-8) {
      break;
    }
  }
  return { intercept, slope, status: "estimated" };
}

function metrics(rows: Prediction[]) {
  rows.forEach((row) => boundProbability(row.p, row.id));
  return {
    n: rows.length,
    brier: mean(rows.map((row) => (row.p - row.y) ** 2)),
    logLoss: mean(
      rows.map(
        (row) =>
          -(
            row.y * Math.log(row.p) +
            (1 - row.y) * Math.log(1 - row.p)
          ),
      ),
    ),
    calibration: calibrationDiagnostic(rows),
  };
}

function pairedBootstrap(
  challenger: Prediction[],
  production: Prediction[],
  seed: number,
) {
  const productionById = new Map(production.map((row) => [row.id, row]));
  const matched = challenger.map((row) => {
    const baseline = productionById.get(row.id);
    if (!baseline || baseline.y !== row.y) {
      throw new Error(`Unmatched production comparison for ${row.id}.`);
    }
    return {
      challengerLoss: (row.p - row.y) ** 2,
      productionLoss: (baseline.p - baseline.y) ** 2,
    };
  });
  let state = seed >>> 0;
  const random = () =>
    ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const draws: number[] = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const sample = Array.from(
      { length: matched.length },
      () => matched[Math.floor(random() * matched.length)],
    );
    draws.push(
      mean(
        sample.map(
          (row) => row.challengerLoss - row.productionLoss,
        ),
      ),
    );
  }
  draws.sort((a, b) => a - b);
  return {
    direction: "challenger_minus_production_brier",
    pointEstimate: mean(
      matched.map((row) => row.challengerLoss - row.productionLoss),
    ),
    pairedObservationBootstrapCi95: [
      draws[Math.floor(ITERATIONS * 0.025)],
      draws[Math.ceil(ITERATIONS * 0.975) - 1],
    ],
    iterations: ITERATIONS,
    powerWarning:
      "Single-season observation bootstrap; low-powered and not a substitute for a season-clustered interval.",
  };
}

function loadFitGameRows(seasons: readonly number[]): FitGameRow[] {
  return seasons.flatMap((season) => {
    const loadedSnapshots = loadSnapshots(season);
    const loadedSeries = loadSeries(season);
    if (
      loadedSnapshots.some((snapshot) => snapshot.season !== season) ||
      loadedSeries.some((row) => row.season !== season)
    ) {
      throw new Error(
        `Historical fit source-file provenance mismatch for ${season}.`,
      );
    }
    const snapshots = new Map(
      loadedSnapshots.map((snapshot) => [snapshot.teamId, snapshot]),
    );
    const series = new Map(loadedSeries.map((row) => [row.id, row]));
    return loadGames(season).map((game) => {
      const home = snapshots.get(game.homeTeam);
      const away = snapshots.get(game.awayTeam);
      const seriesRow = series.get(game.seriesId);
      if (!home || !away || !seriesRow) {
        throw new Error(`Missing fit inputs for ${game.seriesId}.`);
      }
      return {
        season,
        srsDiff: home.srs - away.srs,
        homeCourt: seriesRow.bubble ? 0 : 1,
        margin: game.homeScore - game.awayScore,
        homeWon: game.homeScore > game.awayScore ? 1 : 0,
      };
    });
  });
}

function fitTenSeasonModel(): FittedSrsGameModel {
  const rows = loadFitGameRows(TEN_SEASON_WINDOW);
  assertFitRowsPrecedeHoldout(rows, "ten-season challenger input");
  let bestLambda = LAMBDAS[0];
  let bestError = Number.POSITIVE_INFINITY;
  for (const lambda of LAMBDAS) {
    let squaredError = 0;
    let count = 0;
    for (const validationSeason of TEN_SEASON_WINDOW) {
      const training = rows.filter((row) => row.season !== validationSeason);
      const validation = rows.filter((row) => row.season === validationSeason);
      const model = fitRidgeBeforeHoldout(
        training,
        (row) => [row.srsDiff, row.homeCourt],
        (row) => row.margin,
        ["srsDiff", "homeCourt"],
        lambda,
        `ten-season lambda ${lambda}`,
      );
      for (const row of validation) {
        const predicted = predictRidge(model, [row.srsDiff, row.homeCourt]);
        squaredError += (predicted - row.margin) ** 2;
        count += 1;
      }
    }
    const error = squaredError / count;
    if (error < bestError) {
      bestError = error;
      bestLambda = lambda;
    }
  }
  const regression = fitRidgeBeforeHoldout(
    rows,
    (row) => [row.srsDiff, row.homeCourt],
    (row) => row.margin,
    ["srsDiff", "homeCourt"],
    bestLambda,
    "ten-season final ridge fit",
  );
  const logisticScale = tuneScaleBeforeHoldout(
    rows,
    (row) => predictRidge(regression, [row.srsDiff, row.homeCourt]),
    (row) => row.homeWon,
    "ten-season logistic-scale fit",
  );
  return { regression, logisticScale };
}

function fittedHomeProbability(
  model: FittedSrsGameModel,
  home: TeamSeasonSnapshot,
  away: TeamSeasonSnapshot,
): number {
  return boundProbability(
    logisticProbability(
      predictRidge(model.regression, [home.srs - away.srs, 1]),
      model.logisticScale,
    ),
    "fitted SRS+home game model",
  );
}

function fittedSeriesProbability(
  model: FittedSrsGameModel,
  series: HistoricalSeries,
  snapshots: Map<string, TeamSeasonSnapshot>,
): number {
  const pattern = fullHomePattern(series);
  return boundProbability(
    solveSeriesExactly(0, 0, (gameNumber) => {
      const homeId = pattern[gameNumber - 1];
      const awayId = homeId === series.teamA ? series.teamB : series.teamA;
      const home = snapshots.get(homeId);
      const away = snapshots.get(awayId);
      if (!home || !away) {
        throw new Error(`Missing series snapshot for ${series.id}.`);
      }
      const homeProbability = fittedHomeProbability(model, home, away);
      return homeId === series.teamA
        ? homeProbability
        : 1 - homeProbability;
    }).teamAWinProbability,
    `${series.id} fitted series model`,
  );
}

function fixedGameProbability(
  game: HistoricalGame,
  snapshots: Map<string, TeamSeasonSnapshot>,
  settings: typeof defaultModelSettings,
): number {
  const homeSnapshot = snapshots.get(game.homeTeam);
  const awaySnapshot = snapshots.get(game.awayTeam);
  if (!homeSnapshot || !awaySnapshot) {
    throw new Error(`Missing game snapshot for ${game.seriesId}.`);
  }
  const home = snapshotToTeam(homeSnapshot, game.seriesId);
  const away = snapshotToTeam(awaySnapshot, game.seriesId);
  return boundProbability(
    gameWinProbability(home, away, home.id, settings),
    `${game.seriesId}:game-${game.gameNumber}`,
  );
}

function main() {
  verifyFrozenArtifacts();
  const frozen = JSON.parse(
    fs.readFileSync(FROZEN_RESEARCH_PATH, "utf-8"),
  ) as FrozenResearch;
  const exactSrsModel = frozen.results.find(
    (result) => result.id === "srs_home",
  )?.finalModel;
  if (!exactSrsModel) {
    throw new Error("Frozen SRS+home final model is missing.");
  }
  const primaryModel = frozen.primarySeriesChallenger.finalModel;
  const tenSeasonModel = fitTenSeasonModel();
  const snapshots = new Map(
    loadSnapshots(HOLDOUT_SEASON).map((snapshot) => [
      snapshot.teamId,
      snapshot,
    ]),
  );
  const series = loadSeries(HOLDOUT_SEASON);
  const games = loadGames(HOLDOUT_SEASON);

  const gamePredictions: Record<string, Prediction[]> = {
    production: [],
    exact_srs_logit_plus_seed_v1: [],
    ten_season_training_window_v1: [],
    srs_only: [],
    net_rating_only: [],
    higher_seed: [],
    home_team: [],
    coin_flip: [],
  };

  for (const game of games) {
    const id = `${game.seriesId}:game-${game.gameNumber}`;
    const y = game.winner === game.homeTeam ? 1 : 0;
    const home = snapshots.get(game.homeTeam);
    const away = snapshots.get(game.awayTeam);
    const seriesRow = series.find((row) => row.id === game.seriesId);
    if (!home || !away || !seriesRow) {
      throw new Error(`Missing 2026 inputs for ${id}.`);
    }
    const directional =
      home.seed === away.seed
        ? 0.5
        : home.seed < away.seed
          ? DIRECTIONAL_PRIOR
          : 1 - DIRECTIONAL_PRIOR;
    gamePredictions.production.push({
      id,
      p: fixedGameProbability(game, snapshots, defaultModelSettings),
      y,
    });
    gamePredictions.exact_srs_logit_plus_seed_v1.push({
      id,
      p: fittedHomeProbability(exactSrsModel, home, away),
      y,
    });
    gamePredictions.ten_season_training_window_v1.push({
      id,
      p: fittedHomeProbability(tenSeasonModel, home, away),
      y,
    });
    gamePredictions.srs_only.push({
      id,
      p: fixedGameProbability(game, snapshots, SRS_PROXY_ONLY_SETTINGS),
      y,
    });
    gamePredictions.net_rating_only.push({
      id,
      p: fixedGameProbability(game, snapshots, NET_RATING_ONLY_SETTINGS),
      y,
    });
    gamePredictions.higher_seed.push({ id, p: directional, y });
    gamePredictions.home_team.push({ id, p: DIRECTIONAL_PRIOR, y });
    gamePredictions.coin_flip.push({ id, p: 0.5, y });
  }

  const rawExactSeries: Prediction[] = [];
  const seriesPredictions: Record<string, Prediction[]> = Object.fromEntries(
    Object.keys(gamePredictions).map((modelId) => [modelId, []]),
  );
  for (const row of series) {
    const teamA = snapshots.get(row.teamA);
    const teamB = snapshots.get(row.teamB);
    if (!teamA || !teamB) {
      throw new Error(`Missing 2026 series snapshots for ${row.id}.`);
    }
    const y = row.winner === row.teamA ? 1 : 0;
    const rawExact = fittedSeriesProbability(exactSrsModel, row, snapshots);
    rawExactSeries.push({ id: row.id, p: rawExact, y });
    seriesPredictions.production.push({
      id: row.id,
      p: playoffPulsePrediction(row, teamA, teamB),
      y,
    });
    seriesPredictions.exact_srs_logit_plus_seed_v1.push({
      id: row.id,
      p: boundProbability(
        predictLogistic(primaryModel, [
          logit(rawExact),
          row.seedB - row.seedA,
        ]),
        `${row.id} primary challenger`,
      ),
      y,
    });
    seriesPredictions.ten_season_training_window_v1.push({
      id: row.id,
      p: fittedSeriesProbability(tenSeasonModel, row, snapshots),
      y,
    });
    seriesPredictions.srs_only.push({
      id: row.id,
      p: predict("srs_proxy_only", row, teamA, teamB),
      y,
    });
    seriesPredictions.net_rating_only.push({
      id: row.id,
      p: predict("net_rating_only", row, teamA, teamB),
      y,
    });
    seriesPredictions.higher_seed.push({
      id: row.id,
      p: predict("higher_seed", row, teamA, teamB),
      y,
    });
    seriesPredictions.home_team.push({
      id: row.id,
      p: predict("home_team", row, teamA, teamB),
      y,
    });
    seriesPredictions.coin_flip.push({
      id: row.id,
      p: predict("coinflip", row, teamA, teamB),
      y,
    });
  }

  const modelMetrics = Object.fromEntries(
    Object.keys(gamePredictions).map((modelId) => [
      modelId,
      {
        game: metrics(gamePredictions[modelId]),
        series: metrics(seriesPredictions[modelId]),
      },
    ]),
  );
  const primaryMetrics = modelMetrics.exact_srs_logit_plus_seed_v1;
  const rawExactMetrics = metrics(rawExactSeries);
  const primaryMinusRegisteredBaseline =
    primaryMetrics.series.brier - rawExactMetrics.brier;
  const registrationClassification = {
    exact_srs_logit_plus_seed_v1: "CONTAMINATED_2026",
    ten_season_training_window_v1: "CONTAMINATED_2026",
    provenance:
      "First durable main-branch registration was 2026-07-27, after the 2026 playoffs began on 2026-04-18.",
  };
  const gate = {
    primaryChallenger: frozen.modelSelectionGate.primaryChallenger,
    primaryEndpoint: frozen.modelSelectionGate.primaryEndpoint,
    minimumMeaningfulImprovement:
      frozen.modelSelectionGate.minimumMeaningfulImprovement,
    registrationClassification,
    singleSeasonRegisteredBaseline: {
      id: "exact_srs_home_component",
      metrics: rawExactMetrics,
      candidateMinusBaselineBrier: primaryMinusRegisteredBaseline,
    },
    promotionChecks: {
      genuinelyFutureArchivedSeasonAvailable: true,
      prospectiveRegistrationBeforeSeason: false,
      candidateMinusBaselinePointEstimateAtMostNegativeThreshold:
        primaryMinusRegisteredBaseline <=
        -frozen.modelSelectionGate.minimumMeaningfulImprovement,
      brierSeasonClusteredIntervalUpperBoundBelowZero: false,
      logLossNoWorse:
        primaryMetrics.series.logLoss <= rawExactMetrics.logLoss,
      calibrationSlopeNotFartherFromOne:
        Math.abs(primaryMetrics.series.calibration.slope - 1) <=
        Math.abs(rawExactMetrics.calibration.slope - 1),
      productionEquivalentInputDefinitions: false,
    },
    seasonClusteredInterval: {
      ci95: null,
      status: "not_estimable_from_one_season",
    },
    decision: "not_promoted",
    decisionReasons: [
      "The primary challenger was registered after the 2026 playoffs began.",
      "A season-clustered confidence interval cannot be estimated from one held-out season.",
      "Historical proxy inputs are not production-equivalent manual inputs.",
    ],
    requiredInterpretation:
      "A single season satisfies the gate's genuinely future archived season condition, but cannot on its own produce a confidence interval below zero. It is necessary, not sufficient.",
  };

  const report = {
    generatedAt: new Date().toISOString(),
    season: HOLDOUT_SEASON,
    scope: {
      games: games.length,
      series: series.length,
      trainingSeasons: FIT_SEASONS,
      tenSeasonTrainingWindow: TEN_SEASON_WINDOW,
      holdoutRowsUsedForPredictiveModelFitting: 0,
    },
    fitIsolation: {
      assertion:
        "Every fitting wrapper fails if any input row has season >= 2026.",
      frozenModelsLoadedWithoutRefit: [
        "exact SRS + home game model",
        "exact_srs_logit_plus_seed_v1 series mapping",
      ],
      fittedForTarget: {
        ten_season_training_window_v1: "2016–2025 only",
      },
      productionAndFixedBaselines: "No fitting functions used.",
      calibrationDiagnostics:
        "Slope/intercept are estimated after forecasts are fixed using 2026 outcomes; diagnostics never feed a prediction.",
    },
    modelDefinitions: {
      production: "Fixed Playoff Pulse configuration.",
      exact_srs_logit_plus_seed_v1: {
        game:
          "Frozen underlying exact SRS + home game model; the registered seed adjustment is series-only.",
        series:
          "Frozen exact SRS-series logit plus seed-difference mapping.",
      },
      ten_season_training_window_v1:
        "Unchanged SRS + home model fitted only on 2016–2025.",
      srs_only: "Fixed SRS-proxy-only production engine.",
      net_rating_only: "Fixed net-rating-only production engine.",
      higher_seed: "Directional 65% prior for the better playoff seed.",
      home_team: "Directional 65% home-team prior.",
      coin_flip: "Constant 50% probability.",
    },
    metrics: modelMetrics,
    pairedProductionComparisons: {
      exact_srs_logit_plus_seed_v1: {
        game: pairedBootstrap(
          gamePredictions.exact_srs_logit_plus_seed_v1,
          gamePredictions.production,
          0x20260001,
        ),
        series: pairedBootstrap(
          seriesPredictions.exact_srs_logit_plus_seed_v1,
          seriesPredictions.production,
          0x20260002,
        ),
      },
      ten_season_training_window_v1: {
        game: pairedBootstrap(
          gamePredictions.ten_season_training_window_v1,
          gamePredictions.production,
          0x20260003,
        ),
        series: pairedBootstrap(
          seriesPredictions.ten_season_training_window_v1,
          seriesPredictions.production,
          0x20260004,
        ),
      },
    },
    selectionGate: gate,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.log(
    JSON.stringify(
      {
        season: report.season,
        counts: report.scope,
        metrics: report.metrics,
        gateDecision: report.selectionGate.decision,
      },
      null,
      2,
    ),
  );
}

main();
