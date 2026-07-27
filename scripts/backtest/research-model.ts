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
import { SEASONS } from "./scrape-bbref";
import { ratingGapPlayerMultiplier } from "../../src/lib/backtest/research-candidates";

const EVALUATION_SEASONS = SEASONS.slice(3);
const LAMBDAS = [0.01, 0.1, 1, 10, 100];
const OUTPUT = path.join(process.cwd(), "docs", "backtest", "research.json");

type FeatureName =
  | "srsDiff"
  | "netDiff"
  | "playerDiff"
  | "shrunkPlayerDiff"
  | "offenseDiff"
  | "defenseDiff"
  | "homeCourt";
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

const RATING_GAP_SHRINKAGE_CANDIDATE = {
  id: "rating_gap_player_shrinkage_v1",
  frozenAt: "2026-07-26",
  firstPromotionEligibleSeason: 2027,
  decayScaleSrsPoints: 5,
  formula:
    "shrunkPlayerDiff = playerDiff × exp(-abs(srsDiff) / 5); fit with SRS difference and home court.",
  primaryMetric: "season-clustered rolling-origin game Brier versus srs_home",
  secondaryMetric: "season-clustered rolling-origin series Brier versus srs_home",
  promotionRule:
    "Research-only on all history through 2025; promotion requires a lower primary metric on a genuinely future archived season without changing the formula.",
} as const;

const SHRINKAGE_SPEC: FeatureSpec = {
  id: RATING_GAP_SHRINKAGE_CANDIDATE.id,
  features: ["srsDiff", "shrunkPlayerDiff", "homeCourt"],
};

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
          shrunkPlayerDiff:
            (playerImpact(home) - playerImpact(away)) *
            ratingGapPlayerMultiplier(
              home.srs - away.srs,
              RATING_GAP_SHRINKAGE_CANDIDATE.decayScaleSrsPoints,
            ),
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

type ProbabilityRow = { id?: string; season: number; p: number; y: number };

function quantileGroups(rows: ProbabilityRow[], bins = 10) {
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  return Array.from({ length: Math.min(bins, sorted.length) }, (_, index) => {
    const start = Math.floor((index * sorted.length) / Math.min(bins, sorted.length));
    const end = Math.floor(((index + 1) * sorted.length) / Math.min(bins, sorted.length));
    return sorted.slice(start, end);
  }).filter((group) => group.length > 0);
}

function brierDecomposition(rows: ProbabilityRow[], bins = 10) {
  const baseRate = mean(rows.map((row) => row.y));
  const uncertainty = baseRate * (1 - baseRate);
  const groups = quantileGroups(rows, bins);
  const reliability = groups.reduce((total, group) => {
    const predicted = mean(group.map((row) => row.p));
    const observed = mean(group.map((row) => row.y));
    return total + (group.length / rows.length) * (predicted - observed) ** 2;
  }, 0);
  const resolution = groups.reduce((total, group) => {
    const observed = mean(group.map((row) => row.y));
    return total + (group.length / rows.length) * (observed - baseRate) ** 2;
  }, 0);
  const brier = probabilityMetrics(rows).brier;
  const groupedEstimate = uncertainty - resolution + reliability;
  return {
    n: rows.length,
    bins: groups.length,
    baseRate,
    brier,
    uncertainty,
    resolution,
    reliability,
    groupedEstimate,
    residual: brier - groupedEstimate,
    note:
      "Murphy decomposition using equal-count probability groups. The residual records within-group forecast variation, so components should be read as a grouped diagnostic.",
  };
}

function seasonClusteredInterval(
  rows: ProbabilityRow[],
  statistic: (sample: ProbabilityRow[]) => number,
  iterations = 10000,
) {
  let state = 0x7630ab1;
  const random = () =>
    ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const seasons = [...new Set(rows.map((row) => row.season))];
  const draws: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = Array.from(
      { length: seasons.length },
      () => seasons[Math.floor(random() * seasons.length)],
    ).flatMap((season) => rows.filter((row) => row.season === season));
    draws.push(statistic(sample));
  }
  draws.sort((a, b) => a - b);
  return [draws[Math.floor(iterations * 0.025)], draws[Math.floor(iterations * 0.975)]] as const;
}

function decompositionWithIntervals(rows: ProbabilityRow[]) {
  const decomposition = brierDecomposition(rows);
  return {
    ...decomposition,
    seasonClusteredCi95: {
      uncertainty: seasonClusteredInterval(
        rows,
        (sample) => brierDecomposition(sample).uncertainty,
      ),
      resolution: seasonClusteredInterval(
        rows,
        (sample) => brierDecomposition(sample).resolution,
      ),
      reliability: seasonClusteredInterval(
        rows,
        (sample) => brierDecomposition(sample).reliability,
      ),
    },
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
    shrunkPlayerDiff:
      (playerImpact(home) - playerImpact(away)) *
      ratingGapPlayerMultiplier(
        home.srs - away.srs,
        RATING_GAP_SHRINKAGE_CANDIDATE.decayScaleSrsPoints,
      ),
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
    protocol: `For each season ${EVALUATION_SEASONS[2]}-${EVALUATION_SEASONS.at(-1)}, fit logistic calibration only on earlier rolling-origin predictions.`,
    raw: { ...probabilityMetrics(raw), calibrationFit: calibrationFit(raw), calibration: equalCountCalibration(raw) },
    calibrated: { ...probabilityMetrics(calibrated), calibrationFit: calibrationFit(calibrated), calibration: equalCountCalibration(calibrated) },
    predictions: calibrated,
    retained: probabilityMetrics(calibrated).brier < probabilityMetrics(raw).brier && probabilityMetrics(calibrated).logLoss < probabilityMetrics(raw).logLoss,
  };
}

function nestedGameCalibrationThroughSeries(
  allGames: GameRow[],
  baseline: ReturnType<typeof evaluateSpec>,
) {
  const predictions: Array<{
    id: string;
    season: number;
    rawP: number;
    p: number;
    y: number;
  }> = [];
  for (const season of EVALUATION_SEASONS.slice(2)) {
    const calibrationTraining = baseline.rollingPredictions.game.filter(
      (row) => row.season < season,
    );
    if (calibrationTraining.length < 30) continue;
    const calibrator = fitLogisticModel(
      calibrationTraining.map((row) => [logit(row.p)]),
      calibrationTraining.map((row) => row.y),
      ["rawGameLogit"],
      1,
    );
    const gameModel = fitGameModel(
      allGames.filter((row) => row.season < season),
      { id: "srs_home", features: ["srsDiff", "homeCourt"] },
    );
    const snapshots = Object.fromEntries(
      loadSnapshots(season).map((row) => [row.teamId, row]),
    );
    for (const series of loadSeries(season)) {
      const pattern = fullHomePattern(series);
      const raw = solveSeriesExactly(0, 0, (gameNumber) =>
        probabilityA(
          gameModel,
          series.teamA,
          series.teamB,
          pattern[gameNumber - 1],
          snapshots,
          series.bubble,
        ),
      ).teamAWinProbability;
      const calibrated = solveSeriesExactly(0, 0, (gameNumber) => {
        const homeId = pattern[gameNumber - 1];
        const rawTeamA = probabilityA(
          gameModel,
          series.teamA,
          series.teamB,
          homeId,
          snapshots,
          series.bubble,
        );
        const rawHome = homeId === series.teamA ? rawTeamA : 1 - rawTeamA;
        const calibratedHome = predictLogistic(calibrator, [logit(rawHome)]);
        return homeId === series.teamA ? calibratedHome : 1 - calibratedHome;
      }).teamAWinProbability;
      predictions.push({
        id: series.id,
        season,
        rawP: raw,
        p: calibrated,
        y: series.winner === series.teamA ? 1 : 0,
      });
    }
  }
  const raw = predictions.map((row) => ({ ...row, p: row.rawP }));
  const rawMetrics = probabilityMetrics(raw);
  const calibratedMetrics = probabilityMetrics(predictions);
  return {
    protocol:
      "For each eligible season, fit the game calibrator only on earlier rolling-origin game predictions, calibrate each possible future game's home-win probability, then recompute the pre-series probability with the exact series solver.",
    raw: {
      ...rawMetrics,
      calibrationFit: calibrationFit(raw),
      calibration: equalCountCalibration(raw, 7),
    },
    calibrated: {
      ...calibratedMetrics,
      calibrationFit: calibrationFit(predictions),
      calibration: equalCountCalibration(predictions, 7),
    },
    predictions,
    retained:
      calibratedMetrics.brier < rawMetrics.brier &&
      calibratedMetrics.logLoss < rawMetrics.logLoss,
  };
}

const DYNAMIC_RATING_CANDIDATE = {
  id: "dynamic_margin_update_v1",
  frozenAt: "2026-07-15",
  firstPromotionEligibleSeason: 2027,
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
    status: `research_only_not_promotion_eligible_on_${SEASONS[0]}_${SEASONS.at(-1)}`,
    metrics: { ...probabilityMetrics(predictions), calibrationFit: calibrationFit(predictions), calibration: equalCountCalibration(predictions) },
    predictions,
  };
}

function bootstrapDifference(
  candidate: Array<{ id?: string; season: number; p: number; y: number }>,
  baseline: Array<{ id?: string; season: number; p: number; y: number }>,
  iterations = 10000,
) {
  let state = 0x51f15e; const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const identity = (
    row: { id?: string; season: number },
    index: number,
  ) => row.id ?? `${row.season}:row-${index}`;
  const baselineByIdentity = new Map(
    baseline.map((row, index) => [identity(row, index), row]),
  );
  const matched = candidate.flatMap((row, index) => {
    const baselineRow = baselineByIdentity.get(identity(row, index));
    if (!baselineRow) return [];
    if (baselineRow.y !== row.y) {
      throw new Error(`Outcome mismatch for ${identity(row, index)}.`);
    }
    return [{ ...row, baselineP: baselineRow.p }];
  });
  if (!matched.length || matched.length !== candidate.length) {
    throw new Error("Candidate and baseline predictions are not fully matched.");
  }
  const seasons = [...new Set(matched.map((row) => row.season))];
  const differences: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const selected = Array.from({ length: seasons.length }, () => seasons[Math.floor(random() * seasons.length)]);
    const losses = selected.flatMap((season) => {
      return matched
        .filter((row) => row.season === season)
        .map(
          (row) =>
            (row.p - row.y) ** 2 - (row.baselineP - row.y) ** 2,
        );
    });
    differences.push(mean(losses));
  }
  differences.sort((a, b) => a - b);
  return { candidateMinusBaselineBrier: mean(differences), ci95: [differences[249], differences[9749]], probabilityCandidateBetter: differences.filter((value) => value < 0).length / iterations };
}

function rollingSeriesBaselines(
  referenceSeriesPredictions: Array<{
    id: string;
    season: number;
    p: number;
    y: number;
  }>,
) {
  const referenceById = new Map(
    referenceSeriesPredictions.map((row) => [row.id, row.p]),
  );
  const rows = SEASONS.flatMap((season) => {
    const snapshots = Object.fromEntries(loadSnapshots(season).map((row) => [row.teamId, row]));
    return loadSeries(season).map((series) => ({
      id: series.id,
      season,
      y: series.winner === series.teamA ? 1 : 0,
      seed: series.seedB - series.seedA,
      srs: snapshots[series.teamA].srs - snapshots[series.teamB].srs,
      exactSrsLogit: referenceById.has(series.id)
        ? logit(referenceById.get(series.id)!)
        : null,
    }));
  });
  const fitted = [
    { id: "fitted_seed", features: ["seed"] as const },
    { id: "fitted_seed_srs", features: ["seed", "srs"] as const },
  ].map((spec) => {
    const predictions: Array<{ season: number; p: number; y: number }> = [];
    for (const season of EVALUATION_SEASONS) {
      const training = rows.filter((row) => row.season < season);
      const test = rows.filter((row) => row.season === season);
      const vectors = (row: (typeof rows)[number]) => spec.features.map((feature) => row[feature]);
      const model = fitLogisticModel(training.map(vectors), training.map((row) => row.y), [...spec.features], 1);
      predictions.push(...test.map((row) => ({ id: row.id, season, p: predictLogistic(model, vectors(row)), y: row.y })));
    }
    return { id: spec.id, ...probabilityMetrics(predictions), calibrationFit: calibrationFit(predictions), predictions };
  });
  const climatologyPredictions: ProbabilityRow[] = [];
  for (const season of EVALUATION_SEASONS) {
    const training = rows.filter((row) => row.season < season);
    const test = rows.filter((row) => row.season === season);
    const priorRate = mean(training.map((row) => row.y));
    climatologyPredictions.push(
      ...test.map((row) => ({ id: row.id, season, p: priorRate, y: row.y })),
    );
  }
  return [
    {
      id: "rolling_team_a_rate",
      ...probabilityMetrics(climatologyPredictions),
      calibrationFit: calibrationFit(climatologyPredictions),
      predictions: climatologyPredictions,
      protocol:
        "For each season, predict the prior-season empirical team-A series win rate using only earlier seasons.",
    },
    ...fitted,
  ];
}

const PRIMARY_SERIES_CHALLENGER = {
  id: "exact_srs_logit_plus_seed_v1",
  frozenAt: "2026-07-26",
  firstPromotionEligibleSeason: 2027,
  primaryMetric: "season-clustered rolling-origin series Brier",
  minimumMeaningfulImprovement: 0.005,
  formula:
    "logit(P(team A wins series)) = intercept + beta1 × exact SRS-series logit + beta2 × seed difference",
} as const;

function evaluatePrimarySeriesChallenger(
  baseline: ReturnType<typeof evaluateSpec>,
) {
  const rows = baseline.rollingPredictions.series.map((prediction) => {
    const series = loadSeries(prediction.season).find(
      (row) => row.id === prediction.id,
    );
    if (!series) throw new Error(`Missing series ${prediction.id}.`);
    return {
      ...prediction,
      exactSrsLogit: logit(prediction.p),
      seedDiff: series.seedB - series.seedA,
    };
  });
  const predictions: Array<{
    id: string;
    season: number;
    p: number;
    y: number;
  }> = [];
  for (const season of EVALUATION_SEASONS.slice(2)) {
    const training = rows.filter((row) => row.season < season);
    const test = rows.filter((row) => row.season === season);
    const model = fitLogisticModel(
      training.map((row) => [row.exactSrsLogit, row.seedDiff]),
      training.map((row) => row.y),
      ["exactSrsLogit", "seedDiff"],
      1,
    );
    predictions.push(
      ...test.map((row) => ({
        id: row.id,
        season,
        p: predictLogistic(model, [row.exactSrsLogit, row.seedDiff]),
        y: row.y,
      })),
    );
  }
  const matchedBaseline = baseline.rollingPredictions.series.filter((row) =>
    predictions.some((prediction) => prediction.id === row.id),
  );
  const comparison = bootstrapDifference(predictions, matchedBaseline);
  const finalModel = fitLogisticModel(
    rows.map((row) => [row.exactSrsLogit, row.seedDiff]),
    rows.map((row) => row.y),
    ["exactSrsLogit", "seedDiff"],
    1,
  );
  return {
    registration: PRIMARY_SERIES_CHALLENGER,
    status: "research_only_first_prospective_promotion_check_2027",
    metrics: {
      ...probabilityMetrics(predictions),
      calibrationFit: calibrationFit(predictions),
      calibration: equalCountCalibration(predictions, 7),
    },
    baselineMetrics: probabilityMetrics(matchedBaseline),
    comparisonToSrsHome: comparison,
    finalModel,
    predictions,
  };
}

const TEMPORAL_WINDOW_CANDIDATE = {
  id: "ten_season_training_window_v1",
  frozenAt: "2026-07-26",
  firstPromotionEligibleSeason: 2027,
  trainingWindowSeasons: 10,
  primaryMetric: "season-clustered rolling-origin game Brier",
  rule:
    "Fit the unchanged SRS + home expected-margin model using at most the ten completed seasons immediately before each target season.",
} as const;

function evaluateTemporalWindowCandidate(allGames: GameRow[]) {
  const spec: FeatureSpec = {
    id: TEMPORAL_WINDOW_CANDIDATE.id,
    features: ["srsDiff", "homeCourt"],
  };
  const gamePredictions: Array<{
    id: string;
    seriesId: string;
    gameNumber: number;
    season: number;
    p: number;
    y: number;
  }> = [];
  const seriesPredictions: Array<{
    id: string;
    season: number;
    p: number;
    y: number;
  }> = [];
  for (const season of EVALUATION_SEASONS) {
    const training = allGames.filter(
      (row) =>
        row.season < season &&
        row.season >= season - TEMPORAL_WINDOW_CANDIDATE.trainingWindowSeasons,
    );
    const model = fitGameModel(training, spec);
    for (const row of allGames.filter((row) => row.season === season)) {
      const margin = predictRidge(model.regression, vector(row, spec));
      gamePredictions.push({
        id: `${row.seriesId}:game-${row.gameNumber}`,
        seriesId: row.seriesId,
        gameNumber: row.gameNumber,
        season,
        p: logisticProbability(margin, model.logisticScale),
        y: row.homeWon,
      });
    }
    const snapshots = Object.fromEntries(
      loadSnapshots(season).map((row) => [row.teamId, row]),
    );
    for (const series of loadSeries(season)) {
      const pattern = fullHomePattern(series);
      const solution = solveSeriesExactly(0, 0, (gameNumber) =>
        probabilityA(
          model,
          series.teamA,
          series.teamB,
          pattern[gameNumber - 1],
          snapshots,
          series.bubble,
        ),
      );
      seriesPredictions.push({
        id: series.id,
        season,
        p: solution.teamAWinProbability,
        y: series.winner === series.teamA ? 1 : 0,
      });
    }
  }
  return {
    registration: TEMPORAL_WINDOW_CANDIDATE,
    status: "research_only_first_prospective_promotion_check_2027",
    metrics: {
      game: {
        ...probabilityMetrics(gamePredictions),
        calibrationFit: calibrationFit(gamePredictions),
      },
      series: {
        ...probabilityMetrics(seriesPredictions),
        calibrationFit: calibrationFit(seriesPredictions),
      },
    },
    predictions: { game: gamePredictions, series: seriesPredictions },
  };
}

function rollingGameClimatology(allGames: GameRow[]) {
  const predictions: ProbabilityRow[] = [];
  for (const season of EVALUATION_SEASONS) {
    const training = allGames.filter((row) => row.season < season);
    const test = allGames.filter((row) => row.season === season);
    const homeWinRate = mean(training.map((row) => row.homeWon));
    predictions.push(
      ...test.map((row) => ({ season, p: homeWinRate, y: row.homeWon })),
    );
  }
  return {
    id: "rolling_home_win_rate",
    ...probabilityMetrics(predictions),
    predictions,
    protocol:
      "For each season, predict the prior-season empirical home-team win rate using only earlier seasons.",
  };
}

function evaluateSensitivityReliability(
  records: Array<{
    season: number;
    teamASeriesWinProbability: number;
    uncertainty: { lower: number; upper: number };
    actualSeriesWinner: string;
    teamA: string;
    gameNumber: number;
  }>,
) {
  const preSeries = records
    .filter((record) => record.gameNumber === 1)
    .map((record) => ({
      season: record.season,
      p: record.teamASeriesWinProbability,
      lower: record.uncertainty.lower,
      upper: record.uncertainty.upper,
      y: record.actualSeriesWinner === record.teamA ? 1 : 0,
    }));
  const sorted = [...preSeries].sort((a, b) => a.p - b.p);
  const groupCount = Math.min(10, sorted.length);
  const groups = Array.from({ length: groupCount }, (_, index) => {
    const start = Math.floor((index * sorted.length) / groupCount);
    const end = Math.floor(((index + 1) * sorted.length) / groupCount);
    const group = sorted.slice(start, end);
    const lowerMean = mean(group.map((row) => row.lower));
    const upperMean = mean(group.map((row) => row.upper));
    const observed = mean(group.map((row) => row.y));
    return {
      bin: index + 1,
      n: group.length,
      centralMean: mean(group.map((row) => row.p)),
      lowerMean,
      upperMean,
      observed,
      observedWithinMeanSensitivityBand:
        observed >= lowerMean && observed <= upperMean,
    };
  });
  return {
    target: "pre-series reconstructed forecasts",
    n: preSeries.length,
    groups,
    groupsWithinBand: groups.filter((group) => group.observedWithinMeanSensitivityBand).length,
    totalGroups: groups.length,
    interpretation:
      "Grouped reliability diagnostic only. A binary outcome cannot validate an individual probability interval, and these sensitivity bands are not prediction-interval coverage guarantees.",
  };
}

export function runResearchModel() {
  const games = gameRows();
  const results = SPECS.map((spec) => evaluateSpec(games, spec));
  const shrinkageResult = evaluateSpec(games, SHRINKAGE_SPEC);
  const baseline = results.find((result) => result.id === "srs_home");
  if (!baseline) throw new Error("Research baseline is missing.");
  const seriesBaselines = rollingSeriesBaselines(
    baseline.rollingPredictions.series,
  );
  const gameClimatology = rollingGameClimatology(games);
  const calibratedSeries = nestedGameCalibrationThroughSeries(games, baseline);
  const primarySeriesChallenger = evaluatePrimarySeriesChallenger(baseline);
  const temporalWindowCandidate = evaluateTemporalWindowCandidate(games);
  const archive = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "docs", "backtest", "pregame-archive.json"),
      "utf-8",
    ),
  ) as {
    records: Parameters<typeof evaluateSensitivityReliability>[0];
  };
  const report = {
    generatedAt: new Date().toISOString(),
    protocol: `Rolling origin: train only on seasons before each evaluation season; ${EVALUATION_SEASONS[0]}-${EVALUATION_SEASONS.at(-1)} evaluated after a three-season initialization window.`,
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
    strongSeriesBaselines: seriesBaselines,
    strongSeriesBaselineComparisons: seriesBaselines.map((seriesBaseline) => ({
      id: seriesBaseline.id,
      series: bootstrapDifference(
        seriesBaseline.predictions,
        baseline.rollingPredictions.series,
      ),
    })),
    climatologyBaselines: {
      game: gameClimatology,
      series: seriesBaselines.find((row) => row.id === "rolling_team_a_rate"),
    },
    brierDecomposition: {
      game: {
        reference: decompositionWithIntervals(baseline.rollingPredictions.game),
        climatology: decompositionWithIntervals(gameClimatology.predictions),
      },
      series: {
        reference: decompositionWithIntervals(baseline.rollingPredictions.series),
        climatology: decompositionWithIntervals(
          seriesBaselines.find((row) => row.id === "rolling_team_a_rate")!.predictions,
        ),
      },
    },
    nestedCalibration: {
      game: nestedCalibration(baseline.rollingPredictions.game),
      series: nestedCalibration(baseline.rollingPredictions.series),
      gamePropagatedThroughExactSeries: {
        ...calibratedSeries,
        comparisonToRaw: bootstrapDifference(
          calibratedSeries.predictions,
          calibratedSeries.predictions.map((row) => ({
            id: row.id,
            season: row.season,
            p: row.rawP,
            y: row.y,
          })),
        ),
      },
    },
    primarySeriesChallenger,
    preregisteredTemporalWindowCandidate: {
      ...temporalWindowCandidate,
      comparisonToSrsHome: {
        game: bootstrapDifference(
          temporalWindowCandidate.predictions.game,
          baseline.rollingPredictions.game,
        ),
        series: bootstrapDifference(
          temporalWindowCandidate.predictions.series,
          baseline.rollingPredictions.series,
        ),
      },
    },
    modelSelectionGate: {
      frozenAt: "2026-07-26",
      primaryChallenger: PRIMARY_SERIES_CHALLENGER.id,
      primaryEndpoint: PRIMARY_SERIES_CHALLENGER.primaryMetric,
      minimumMeaningfulImprovement:
        PRIMARY_SERIES_CHALLENGER.minimumMeaningfulImprovement,
      uncertaintyMethod:
        "Paired season-clustered bootstrap with 10,000 deterministic resamples.",
      multiplicityPolicy:
        "Exactly one primary challenger is promotion-eligible; all other candidates are exploratory and cannot be promoted from the same evaluation.",
      promotionChecks: {
        genuinelyFutureArchivedSeasonAvailable: false,
        candidateMinusBaselinePointEstimateAtMostNegativeThreshold:
          primarySeriesChallenger.comparisonToSrsHome
            .candidateMinusBaselineBrier <=
          -PRIMARY_SERIES_CHALLENGER.minimumMeaningfulImprovement,
        brierIntervalUpperBoundBelowZero:
          primarySeriesChallenger.comparisonToSrsHome.ci95[1] < 0,
        logLossNoWorse:
          primarySeriesChallenger.metrics.logLoss <=
          primarySeriesChallenger.baselineMetrics.logLoss,
        calibrationSlopeNotFartherFromOne:
          Math.abs(primarySeriesChallenger.metrics.calibrationFit.slope - 1) <=
          Math.abs(
            calibrationFit(
              baseline.rollingPredictions.series.filter((row) =>
                primarySeriesChallenger.predictions.some(
                  (prediction) => prediction.id === row.id,
                ),
              ),
            ).slope - 1,
          ),
        productionEquivalentInputDefinitions: false,
      },
      decision:
        "not_eligible_requires_future_archived_season_and_production_equivalent_inputs",
    },
    preregisteredDynamicRatingCandidate: (() => {
      const candidate = evaluateDynamicRatingCandidate(games, {
        id: "srs_home",
        features: ["srsDiff", "homeCourt"],
      });
      return {
        ...candidate,
        comparisonToSrsHome: bootstrapDifference(
          candidate.predictions,
          baseline.rollingPredictions.game,
        ),
      };
    })(),
    preregisteredRatingGapShrinkageCandidate: {
      registration: RATING_GAP_SHRINKAGE_CANDIDATE,
      status: "research_only_not_promotion_eligible_on_history_through_2025",
      result: shrinkageResult,
      comparisonToSrsHome: {
        game: bootstrapDifference(
          shrinkageResult.rollingPredictions.game,
          baseline.rollingPredictions.game,
        ),
        series: bootstrapDifference(
          shrinkageResult.rollingPredictions.series,
          baseline.rollingPredictions.series,
        ),
      },
    },
    sensitivityReliability: evaluateSensitivityReliability(archive.records),
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2), "utf-8");
  return report;
}

if (typeof require !== "undefined" && require.main === module) {
  const report = runResearchModel();
  console.log(report.results.map(({ id, game, series, finalModel }) => ({ id, gameBrier: game.brier, seriesBrier: series.brier, scale: finalModel.logisticScale, lambda: finalModel.regression.lambda })));
}
