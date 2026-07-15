import * as fs from "node:fs";
import * as path from "node:path";
import { loadGames, loadSeries, loadSnapshots } from "./build-snapshots";
import { fullHomePattern } from "./baselines";
import type { HistoricalGame, TeamSeasonSnapshot } from "./types";
import {
  fitRidgeModel,
  fitLogisticModel,
  logisticProbability,
  predictRidge,
  predictLogistic,
  tuneLogisticScale,
  type RidgeModel,
} from "../../src/lib/backtest/regression";
import { solveSeriesExactly } from "../../src/lib/model/series-solver";

const SEASONS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const EVALUATION_SEASONS = SEASONS.slice(3);
const LAMBDAS = [0.01, 0.1, 1, 10, 100];
const OUTPUT = path.join(process.cwd(), "docs", "backtest", "research.json");

type FeatureName = "srsDiff" | "netDiff" | "playerDiff" | "offenseDiff" | "defenseDiff" | "homeCourt";
type FeatureSpec = { id: string; features: FeatureName[] };
type GameRow = {
  season: number;
  seriesId: string;
  gameNumber: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  margin: number;
  homeWon: number;
  features: Record<FeatureName, number>;
};
type FittedGameModel = { regression: RidgeModel; logisticScale: number; spec: FeatureSpec };

const SPECS: FeatureSpec[] = [
  { id: "srs_home", features: ["srsDiff", "homeCourt"] },
  { id: "net_home", features: ["netDiff", "homeCourt"] },
  { id: "srs_player_home", features: ["srsDiff", "playerDiff", "homeCourt"] },
  { id: "collinear_full", features: ["srsDiff", "netDiff", "playerDiff", "homeCourt"] },
  { id: "offense_defense_player", features: ["offenseDiff", "defenseDiff", "playerDiff", "homeCourt"] },
];

function playerImpact(snapshot: TeamSeasonSnapshot): number {
  return snapshot.players.reduce(
    (sum, player) => sum + player.impact * player.projectedMinutes,
    0,
  ) / 240;
}

function gameRows(): GameRow[] {
  return SEASONS.flatMap((season) => {
    const snapshots = Object.fromEntries(loadSnapshots(season).map((row) => [row.teamId, row]));
    const series = Object.fromEntries(loadSeries(season).map((row) => [row.id, row]));
    return loadGames(season).map((game: HistoricalGame) => {
      const home = snapshots[game.homeTeam];
      const away = snapshots[game.awayTeam];
      const seriesRow = series[game.seriesId];
      if (!home || !away || !seriesRow) throw new Error(`Missing research inputs for ${game.seriesId}.`);
      return {
        season,
        seriesId: game.seriesId,
        gameNumber: game.gameNumber,
        date: game.date,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        margin: game.homeScore - game.awayScore,
        homeWon: game.homeScore > game.awayScore ? 1 : 0,
        features: {
          srsDiff: home.srs - away.srs,
          netDiff: home.netRating - away.netRating,
          playerDiff: playerImpact(home) - playerImpact(away),
          offenseDiff: home.ortg - away.ortg,
          defenseDiff: away.drtg - home.drtg,
          homeCourt: seriesRow.bubble ? 0 : 1,
        },
      };
    });
  });
}

function vector(row: GameRow, spec: FeatureSpec): number[] {
  return spec.features.map((feature) => row.features[feature]);
}

function chooseLambda(rows: GameRow[], spec: FeatureSpec): number {
  const seasons = [...new Set(rows.map((row) => row.season))];
  let best = LAMBDAS[0];
  let bestError = Number.POSITIVE_INFINITY;
  for (const lambda of LAMBDAS) {
    let squaredError = 0;
    let count = 0;
    for (const season of seasons) {
      const train = rows.filter((row) => row.season !== season);
      const validation = rows.filter((row) => row.season === season);
      if (!train.length || !validation.length) continue;
      const model = fitRidgeModel(train.map((row) => vector(row, spec)), train.map((row) => row.margin), spec.features, lambda);
      for (const row of validation) {
        squaredError += (predictRidge(model, vector(row, spec)) - row.margin) ** 2;
        count += 1;
      }
    }
    const error = squaredError / Math.max(1, count);
    if (error < bestError) { bestError = error; best = lambda; }
  }
  return best;
}

function fitGameModel(rows: GameRow[], spec: FeatureSpec): FittedGameModel {
  const lambda = chooseLambda(rows, spec);
  const regression = fitRidgeModel(rows.map((row) => vector(row, spec)), rows.map((row) => row.margin), spec.features, lambda);
  const margins = rows.map((row) => predictRidge(regression, vector(row, spec)));
  return { regression, logisticScale: tuneLogisticScale(margins, rows.map((row) => row.homeWon)), spec };
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function probabilityMetrics(rows: Array<{ p: number; y: number }>) {
  return {
    n: rows.length,
    brier: mean(rows.map(({ p, y }) => (p - y) ** 2)),
    logLoss: mean(rows.map(({ p, y }) => -(y * Math.log(Math.max(1e-7, p)) + (1 - y) * Math.log(Math.max(1e-7, 1 - p))))),
  };
}

function equalCountCalibration(rows: Array<{ p: number; y: number }>, bins = 8) {
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  return Array.from({ length: bins }, (_, index) => {
    const start = Math.floor(index * sorted.length / bins);
    const end = Math.floor((index + 1) * sorted.length / bins);
    const bucket = sorted.slice(start, end);
    return { n: bucket.length, predicted: mean(bucket.map((row) => row.p)), observed: mean(bucket.map((row) => row.y)) };
  });
}

function calibrationFit(rows: Array<{ p: number; y: number }>) {
  let intercept = 0; let slope = 1;
  for (let iteration = 0; iteration < 30; iteration += 1) {
    let g0 = 0; let g1 = 0; let h00 = 0; let h01 = 0; let h11 = 0;
    for (const row of rows) {
      const p = Math.min(1 - 1e-6, Math.max(1e-6, row.p));
      const x = Math.log(p / (1 - p));
      const fitted = 1 / (1 + Math.exp(-(intercept + slope * x)));
      const weight = fitted * (1 - fitted);
      g0 += row.y - fitted; g1 += (row.y - fitted) * x;
      h00 += weight; h01 += weight * x; h11 += weight * x * x;
    }
    const determinant = h00 * h11 - h01 * h01;
    if (Math.abs(determinant) < 1e-10) break;
    const delta0 = (g0 * h11 - g1 * h01) / determinant;
    const delta1 = (g1 * h00 - g0 * h01) / determinant;
    intercept += delta0; slope += delta1;
    if (Math.abs(delta0) + Math.abs(delta1) < 1e-8) break;
  }
  return { intercept, slope };
}

function featuresForMatchup(
  homeId: string,
  awayId: string,
  snapshots: Record<string, TeamSeasonSnapshot>,
  bubble: boolean,
): GameRow["features"] {
  const home = snapshots[homeId]; const away = snapshots[awayId];
  return {
    srsDiff: home.srs - away.srs,
    netDiff: home.netRating - away.netRating,
    playerDiff: playerImpact(home) - playerImpact(away),
    offenseDiff: home.ortg - away.ortg,
    defenseDiff: away.drtg - home.drtg,
    homeCourt: bubble ? 0 : 1,
  };
}

function probabilityA(
  model: FittedGameModel,
  teamA: string,
  teamB: string,
  homeId: string,
  snapshots: Record<string, TeamSeasonSnapshot>,
  bubble: boolean,
): number {
  const awayId = homeId === teamA ? teamB : teamA;
  const features = featuresForMatchup(homeId, awayId, snapshots, bubble);
  const predictedHomeMargin = predictRidge(model.regression, model.spec.features.map((name) => features[name]));
  const homeProbability = logisticProbability(predictedHomeMargin, model.logisticScale);
  return homeId === teamA ? homeProbability : 1 - homeProbability;
}

function evaluateSpec(allGames: GameRow[], spec: FeatureSpec) {
  const gamePredictions: Array<{ id: string; seriesId: string; gameNumber: number; season: number; p: number; y: number; marginError: number }> = [];
  const seriesPredictions: Array<{ id: string; season: number; p: number; y: number }> = [];
  for (const season of EVALUATION_SEASONS) {
    const training = allGames.filter((row) => row.season < season);
    const test = allGames.filter((row) => row.season === season);
    const model = fitGameModel(training, spec);
    for (const row of test) {
      const margin = predictRidge(model.regression, vector(row, spec));
      gamePredictions.push({ id: `${row.seriesId}:game-${row.gameNumber}`, seriesId: row.seriesId, gameNumber: row.gameNumber, season, p: logisticProbability(margin, model.logisticScale), y: row.homeWon, marginError: Math.abs(margin - row.margin) });
    }
    const snapshots = Object.fromEntries(loadSnapshots(season).map((row) => [row.teamId, row]));
    for (const series of loadSeries(season)) {
      const pattern = fullHomePattern(series);
      const solution = solveSeriesExactly(0, 0, (gameNumber) =>
        probabilityA(model, series.teamA, series.teamB, pattern[gameNumber - 1], snapshots, series.bubble),
      );
      seriesPredictions.push({ id: series.id, season, p: solution.teamAWinProbability, y: series.winner === series.teamA ? 1 : 0 });
    }
  }
  const finalModel = fitGameModel(allGames, spec);
  return {
    id: spec.id,
    features: spec.features,
    game: { ...probabilityMetrics(gamePredictions), marginMae: mean(gamePredictions.map((row) => row.marginError)), calibrationFit: calibrationFit(gamePredictions), calibration: equalCountCalibration(gamePredictions) },
    series: { ...probabilityMetrics(seriesPredictions), calibrationFit: calibrationFit(seriesPredictions), calibration: equalCountCalibration(seriesPredictions, 7) },
    finalModel,
    rollingPredictions: { game: gamePredictions, series: seriesPredictions },
  };
}

function logit(probability: number): number {
  const p = Math.min(1 - 1e-6, Math.max(1e-6, probability));
  return Math.log(p / (1 - p));
}

function nestedCalibration<T extends { season: number; p: number; y: number }>(
  predictions: T[],
) {
  const calibrated: Array<T & { rawP: number }> = [];
  for (const season of EVALUATION_SEASONS.slice(2)) {
    const training = predictions.filter((row) => row.season < season);
    const test = predictions.filter((row) => row.season === season);
    if (training.length < 30 || !test.length) continue;
    const model = fitLogisticModel(
      training.map((row) => [logit(row.p)]),
      training.map((row) => row.y),
      ["rawLogit"],
      1,
    );
    calibrated.push(...test.map((row) => ({
      ...row,
      rawP: row.p,
      p: predictLogistic(model, [logit(row.p)]),
    })));
  }
  const raw = calibrated.map((row) => ({ ...row, p: row.rawP }));
  return {
    protocol: "For each season 2021-2025, fit logistic calibration only on earlier rolling-origin predictions.",
    raw: { ...probabilityMetrics(raw), calibrationFit: calibrationFit(raw), calibration: equalCountCalibration(raw) },
    calibrated: { ...probabilityMetrics(calibrated), calibrationFit: calibrationFit(calibrated), calibration: equalCountCalibration(calibrated) },
    predictions: calibrated,
    retained: probabilityMetrics(calibrated).brier < probabilityMetrics(raw).brier && probabilityMetrics(calibrated).logLoss < probabilityMetrics(raw).logLoss,
  };
}

const DYNAMIC_RATING_CANDIDATE = {
  id: "dynamic_margin_update_v1",
  frozenAt: "2026-07-15",
  firstPromotionEligibleSeason: 2026,
  updateRate: 0.12,
  maximumAdjustment: 4,
  rule: "After prediction, split 12% of margin residual between opponents; carry adjustment through that postseason and cap at ±4 points.",
} as const;

function evaluateDynamicRatingCandidate(allGames: GameRow[], spec: FeatureSpec) {
  const predictions: Array<{ id: string; seriesId: string; gameNumber: number; season: number; p: number; y: number }> = [];
  for (const season of EVALUATION_SEASONS) {
    const model = fitGameModel(allGames.filter((row) => row.season < season), spec);
    const adjustments: Record<string, number> = {};
    const games = allGames
      .filter((row) => row.season === season)
      .sort((a, b) => a.date.localeCompare(b.date) || a.seriesId.localeCompare(b.seriesId) || a.gameNumber - b.gameNumber);
    for (const row of games) {
      const baseMargin = predictRidge(model.regression, vector(row, spec));
      const margin = baseMargin + (adjustments[row.homeTeam] ?? 0) - (adjustments[row.awayTeam] ?? 0);
      predictions.push({ id: `${row.seriesId}:game-${row.gameNumber}`, seriesId: row.seriesId, gameNumber: row.gameNumber, season, p: logisticProbability(margin, model.logisticScale), y: row.homeWon });
      const residualShare = DYNAMIC_RATING_CANDIDATE.updateRate * (row.margin - margin) / 2;
      adjustments[row.homeTeam] = Math.max(-DYNAMIC_RATING_CANDIDATE.maximumAdjustment, Math.min(DYNAMIC_RATING_CANDIDATE.maximumAdjustment, (adjustments[row.homeTeam] ?? 0) + residualShare));
      adjustments[row.awayTeam] = Math.max(-DYNAMIC_RATING_CANDIDATE.maximumAdjustment, Math.min(DYNAMIC_RATING_CANDIDATE.maximumAdjustment, (adjustments[row.awayTeam] ?? 0) - residualShare));
    }
  }
  return {
    registration: DYNAMIC_RATING_CANDIDATE,
    status: "research_only_not_promotion_eligible_on_2016_2025",
    metrics: { ...probabilityMetrics(predictions), calibrationFit: calibrationFit(predictions), calibration: equalCountCalibration(predictions) },
    predictions,
  };
}

function bootstrapDifference(
  candidate: Array<{ season: number; p: number; y: number }>,
  baseline: Array<{ season: number; p: number; y: number }>,
  iterations = 10000,
) {
  let state = 0x51f15e; const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const seasons = EVALUATION_SEASONS; const differences: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const selected = Array.from({ length: seasons.length }, () => seasons[Math.floor(random() * seasons.length)]);
    const losses = selected.flatMap((season) => {
      const a = candidate.filter((row) => row.season === season); const b = baseline.filter((row) => row.season === season);
      return a.map((row, index) => (row.p - row.y) ** 2 - (b[index].p - b[index].y) ** 2);
    });
    differences.push(mean(losses));
  }
  differences.sort((a, b) => a - b);
  return { candidateMinusBaselineBrier: mean(differences), ci95: [differences[249], differences[9749]], probabilityCandidateBetter: differences.filter((value) => value < 0).length / iterations };
}

function rollingSeriesBaselines() {
  const rows = SEASONS.flatMap((season) => {
    const snapshots = Object.fromEntries(loadSnapshots(season).map((row) => [row.teamId, row]));
    return loadSeries(season).map((series) => ({
      season,
      y: series.winner === series.teamA ? 1 : 0,
      seed: series.seedB - series.seedA,
      srs: snapshots[series.teamA].srs - snapshots[series.teamB].srs,
    }));
  });
  return [
    { id: "fitted_seed", features: ["seed"] as const },
    { id: "fitted_seed_srs", features: ["seed", "srs"] as const },
  ].map((spec) => {
    const predictions: Array<{ season: number; p: number; y: number }> = [];
    for (const season of EVALUATION_SEASONS) {
      const training = rows.filter((row) => row.season < season);
      const test = rows.filter((row) => row.season === season);
      const vectors = (row: (typeof rows)[number]) => spec.features.map((feature) => row[feature]);
      const model = fitLogisticModel(training.map(vectors), training.map((row) => row.y), [...spec.features], 1);
      predictions.push(...test.map((row) => ({ season, p: predictLogistic(model, vectors(row)), y: row.y })));
    }
    return { id: spec.id, ...probabilityMetrics(predictions), calibrationFit: calibrationFit(predictions), predictions };
  });
}

export function runResearchModel() {
  const games = gameRows();
  const results = SPECS.map((spec) => evaluateSpec(games, spec));
  const baseline = results.find((result) => result.id === "srs_home");
  if (!baseline) throw new Error("Research baseline is missing.");
  const report = {
    generatedAt: new Date().toISOString(),
    protocol: "Rolling origin: train only on seasons before each evaluation season; 2019-2025 evaluated.",
    totalGames: games.length,
    evaluationSeasons: EVALUATION_SEASONS,
    results,
    comparisonsToSrsHome: results
      .filter((result) => result.id !== baseline.id)
      .map((result) => ({
        id: result.id,
        series: bootstrapDifference(result.rollingPredictions.series, baseline.rollingPredictions.series),
        game: bootstrapDifference(result.rollingPredictions.game, baseline.rollingPredictions.game),
      })),
    strongSeriesBaselines: rollingSeriesBaselines(),
    nestedCalibration: {
      game: nestedCalibration(baseline.rollingPredictions.game),
      series: nestedCalibration(baseline.rollingPredictions.series),
    },
    preregisteredDynamicRatingCandidate: evaluateDynamicRatingCandidate(games, {
      id: "srs_home",
      features: ["srsDiff", "homeCourt"],
    }),
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2), "utf-8");
  return report;
}

if (typeof require !== "undefined" && require.main === module) {
  const report = runResearchModel();
  console.log(report.results.map(({ id, game, series, finalModel }) => ({ id, gameBrier: game.brier, seriesBrier: series.brier, scale: finalModel.logisticScale, lambda: finalModel.regression.lambda })));
}
