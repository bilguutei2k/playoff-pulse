// Fits model parameters on development seasons 2005-2015 ONLY. It never loads a
// later season, so validation seasons cannot influence the fit.
//
// Season 2005 is warm-up: it trains the filter but is not scored. Regular-season
// and play-in parameters are chosen by regular-season log loss, then the playoff
// layer is chosen by playoff log loss with the others held fixed.
//
// Run: corepack pnpm exec tsx scripts/live/fit-params.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { replayRatings } from "../../src/lib/season/ratings";
import type { ModelParams, SeasonGame } from "../../src/lib/season/types";
import { eloPredictions, homeRatePredictions, srsToDatePredictions } from "./comparators";
import { logLoss, round, summarize, type ScoredGame } from "./eval-metrics";
import { compareGames, loadSeasonGames } from "./game-store";

const FIRST_DEV = 2005;
const LAST_DEV = 2015;

function loadDevelopment(): SeasonGame[] {
  const games: SeasonGame[] = [];
  for (let season = FIRST_DEV; season <= LAST_DEV; season += 1) {
    games.push(...loadSeasonGames(season));
  }
  return games.filter((game) => game.kind !== "cup-final").sort(compareGames);
}

function kalmanRows(games: readonly SeasonGame[], params: ModelParams): ScoredGame[] {
  return replayRatings(games, params, { collectPredictions: true }).predictions.map(
    ({ game, prediction, homeWon }) => ({
      id: game.id,
      season: game.season,
      p: prediction.homeWinProbability,
      y: homeWon ? 1 : 0,
    }),
  );
}

const games = loadDevelopment();
const scoredIds = {
  regular: new Set(
    games
      .filter((game) => game.season > FIRST_DEV && game.kind === "regular")
      .map((game) => game.id),
  ),
  playoff: new Set(
    games
      .filter((game) => game.season > FIRST_DEV && game.kind === "playoff")
      .map((game) => game.id),
  ),
};

function objective(params: ModelParams, subset: "regular" | "playoff"): number {
  const rows = kalmanRows(games, params).filter((row) => scoredIds[subset].has(row.id));
  return logLoss(rows);
}

type Key = keyof ModelParams;

const REGULAR_GRID: Array<[Key, number[]]> = [
  ["sigma", [8, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15]],
  ["q", [0, 0.005, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.1, 0.12, 0.15, 0.2]],
  ["rho", [0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.875, 0.9, 0.925, 0.95, 1]],
  ["tau", [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9]],
  ["hca0", [1, 1.5, 2, 2.5, 3, 3.5, 4]],
  ["b2b", [0, 0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]],
  ["marginCap", [15, 20, 25, 30, 35, 40, 50, 80]],
];

const PLAYOFF_GRID: Array<[Key, number[]]> = [
  ["hcaPlayoffDelta", [-1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3]],
  ["playoffSpread", [0.9, 1, 1.1, 1.2, 1.3, 1.4]],
];

function coordinateDescent(
  start: ModelParams,
  grid: Array<[Key, number[]]>,
  subset: "regular" | "playoff",
): ModelParams {
  let best = { ...start };
  let bestScore = objective(best, subset);
  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    for (const [key, values] of grid) {
      for (const value of values) {
        if (best[key] === value) continue;
        const trial = { ...best, [key]: value };
        const score = objective(trial, subset);
        if (score < bestScore - 1e-7) {
          best = trial;
          bestScore = score;
          improved = true;
        }
      }
    }
    console.log(`${subset} pass ${pass}: log loss ${bestScore.toFixed(5)}`, JSON.stringify(best));
    if (!improved) break;
  }
  return best;
}

// qHca is set, not fitted. Development seasons have too little home-court drift
// to identify it (the fit picks 0, which would freeze the state), while the model
// must be able to track a slow change over later seasons. 0.0002 per day is about
// 0.2 points of drift per season. Its development cost is reported below.
const FIXED_Q_HCA = 0.0002;

const start: ModelParams = {
  sigma: 13,
  q: 0.015,
  qHca: FIXED_Q_HCA,
  rho: 0.7,
  tau: 4.5,
  hca0: 3,
  hcaVar0: 1,
  b2b: 1.5,
  marginCap: 30,
  hcaPlayoffDelta: 0,
  playoffSpread: 1,
};

const regular = coordinateDescent(start, REGULAR_GRID, "regular");
const withoutSpread = coordinateDescent(
  regular,
  PLAYOFF_GRID.filter(([key]) => key !== "playoffSpread"),
  "playoff",
);
const withSpread = coordinateDescent(withoutSpread, PLAYOFF_GRID, "playoff");
// A spread multiplier is kept only if it improves development playoff log loss.
const keepSpread =
  objective(withSpread, "playoff") < objective(withoutSpread, "playoff") - 1e-7;
const fitted = keepSpread ? withSpread : withoutSpread;

function bestComparator<T>(
  grid: T[],
  predict: (params: T) => ScoredGame[],
): { params: T; rows: ScoredGame[] } {
  let best: { params: T; rows: ScoredGame[]; score: number } | null = null;
  for (const params of grid) {
    const rows = predict(params).filter((row) => scoredIds.regular.has(row.id));
    const score = logLoss(rows);
    if (!best || score < best.score) best = { params, rows, score };
  }
  if (!best) throw new Error("Empty comparator grid.");
  return { params: best.params, rows: best.rows };
}

const eloGrid = [10, 15, 20, 25, 30].flatMap((k) =>
  [60, 80, 100, 120].flatMap((hca) => [0.6, 0.7, 0.75, 0.8, 0.9].map((carry) => ({ k, hca, carry }))),
);
const srsGrid = [4, 6, 8, 10, 14].flatMap((ridge) =>
  [2.5, 3, 3.5].flatMap((hca) => [6.5, 7, 7.5, 8].map((scale) => ({ ridge, hca, scale }))),
);

const elo = bestComparator(eloGrid, (params) => eloPredictions(games, params));
const srs = bestComparator(srsGrid, (params) => srsToDatePredictions(games, params));
const homeRate = homeRatePredictions(games).filter((row) => scoredIds.regular.has(row.id));
const kalmanRegular = kalmanRows(games, fitted).filter((row) => scoredIds.regular.has(row.id));
const kalmanPlayoff = kalmanRows(games, fitted).filter((row) => scoredIds.playoff.has(row.id));

function rounded(rows: ScoredGame[]) {
  const summary = summarize(rows);
  return {
    n: summary.n,
    brier: round(summary.brier),
    logLoss: round(summary.logLoss),
    accuracy: round(summary.accuracy),
  };
}

const qHcaSensitivity = [0, 0.0001, 0.0002, 0.0005, 0.001, 0.002].map((value) => ({
  qHca: value,
  regularLogLoss: round(objective({ ...fitted, qHca: value }, "regular")),
}));

const report = {
  fixedQHca: FIXED_Q_HCA,
  qHcaSensitivity,
  developmentSeasons: `${FIRST_DEV}-${LAST_DEV} (${FIRST_DEV} is warm-up, not scored)`,
  params: fitted,
  spreadMultiplierKept: keepSpread,
  comparatorParams: { elo: elo.params, srs: srs.params },
  developmentScores: {
    kalmanRegular: rounded(kalmanRegular),
    kalmanPlayoff: rounded(kalmanPlayoff),
    eloRegular: rounded(elo.rows),
    srsRegular: rounded(srs.rows),
    homeRateRegular: rounded(homeRate),
  },
};

const output = path.join(process.cwd(), "docs", "live", "development-fit.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
console.log(JSON.stringify(report, null, 2));
