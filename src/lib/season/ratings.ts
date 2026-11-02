// State-space team ratings: a Kalman filter over 30 team strengths plus a
// home-court state that drifts slowly. Deterministic and replayable from the
// game store, with no hidden state between runs.

import { daysBetween } from "@/lib/season/dates";
import { clampProbability, fingerprint, normalCdf } from "@/lib/season/math";
import { HCA_INDEX, SEASON_TEAMS, STATE_SIZE, teamIndex } from "@/lib/season/teams";
import type {
  GameContext,
  GamePrediction,
  ModelParams,
  RatingState,
  SeasonGame,
} from "@/lib/season/types";

const N = STATE_SIZE;

/** Mutable working state; `RatingState` is its serialized form. */
export type FilterState = {
  mean: Float64Array;
  cov: Float64Array;
};

export function createFilterState(params: ModelParams): FilterState {
  const mean = new Float64Array(N);
  const cov = new Float64Array(N * N);
  for (let index = 0; index < HCA_INDEX; index += 1) {
    cov[index * N + index] = params.tau * params.tau;
  }
  mean[HCA_INDEX] = params.hca0;
  cov[HCA_INDEX * N + HCA_INDEX] = params.hcaVar0;
  return { mean, cov };
}

export function toRatingState(state: FilterState): RatingState {
  return { mean: Array.from(state.mean), cov: Array.from(state.cov) };
}

export function fromRatingState(state: RatingState): FilterState {
  if (state.mean.length !== N || state.cov.length !== N * N) {
    throw new Error("Rating state has the wrong dimensions.");
  }
  return { mean: Float64Array.from(state.mean), cov: Float64Array.from(state.cov) };
}

export function ratingsHash(state: RatingState): string {
  return fingerprint(
    JSON.stringify({
      mean: state.mean.map((value) => Number(value.toFixed(6))),
      cov: state.cov.map((value) => Number(value.toFixed(6))),
    }),
  );
}

export function paramsHash(params: ModelParams): string {
  return fingerprint(JSON.stringify(params));
}

/** Off-season: ratings shrink toward average and uncertainty widens. */
export function rollSeason(state: FilterState, params: ModelParams): void {
  const { mean, cov } = state;
  const rho = params.rho;
  for (let index = 0; index < HCA_INDEX; index += 1) mean[index] *= rho;
  for (let row = 0; row < N; row += 1) {
    for (let column = 0; column < N; column += 1) {
      if (row < HCA_INDEX) cov[row * N + column] *= rho;
      if (column < HCA_INDEX) cov[row * N + column] *= rho;
    }
  }
  const added = (1 - rho * rho) * params.tau * params.tau;
  for (let index = 0; index < HCA_INDEX; index += 1) {
    cov[index * N + index] += added;
  }
}

export function advanceDays(state: FilterState, days: number, params: ModelParams): void {
  if (days <= 0) return;
  const { cov } = state;
  const teamVariance = params.q * days;
  for (let index = 0; index < HCA_INDEX; index += 1) {
    cov[index * N + index] += teamVariance;
  }
  cov[HCA_INDEX * N + HCA_INDEX] += params.qHca * days;
}

function observationVector(
  context: GameContext,
  params: ModelParams,
  output: Float64Array,
): { homeIndex: number; awayIndex: number; offset: number } {
  const homeIndex = teamIndex(context.homeId);
  const awayIndex = teamIndex(context.awayId);
  const spread = context.playoff ? params.playoffSpread : 1;
  output.fill(0);
  output[homeIndex] = spread;
  output[awayIndex] = -spread;
  let offset = 0;
  if (!context.neutral) {
    output[HCA_INDEX] = 1;
    if (context.playoff) offset += params.hcaPlayoffDelta;
  }
  if (context.awayOnBackToBack) offset += params.b2b;
  if (context.homeOnBackToBack) offset -= params.b2b;
  return { homeIndex, awayIndex, offset };
}

const SCRATCH_H = new Float64Array(N);
const SCRATCH_PH = new Float64Array(N);

function predictInto(
  state: { mean: ArrayLike<number>; cov: ArrayLike<number> },
  context: GameContext,
  params: ModelParams,
): { expectedMargin: number; ratingVariance: number } {
  const { offset } = observationVector(context, params, SCRATCH_H);
  let expectedMargin = offset;
  for (let index = 0; index < N; index += 1) {
    if (SCRATCH_H[index] !== 0) expectedMargin += SCRATCH_H[index] * state.mean[index];
  }
  let ratingVariance = 0;
  for (let row = 0; row < N; row += 1) {
    let sum = 0;
    for (let column = 0; column < N; column += 1) {
      if (SCRATCH_H[column] !== 0) {
        sum += state.cov[row * N + column] * SCRATCH_H[column];
      }
    }
    SCRATCH_PH[row] = sum;
    if (SCRATCH_H[row] !== 0) ratingVariance += SCRATCH_H[row] * sum;
  }
  return { expectedMargin, ratingVariance: Math.max(0, ratingVariance) };
}

/**
 * Pregame forecast: `Phi(mu / sqrt(sigma^2 + Var(mu)))`. Rating uncertainty
 * pulls the probability toward even, which matters most early in a season.
 */
export function predictGame(
  state: { mean: ArrayLike<number>; cov: ArrayLike<number> },
  context: GameContext,
  params: ModelParams,
  /** Points added to the home margin, such as for expected absences. */
  marginAdjustment = 0,
): GamePrediction {
  const predicted = predictInto(state, context, params);
  const expectedMargin = predicted.expectedMargin + marginAdjustment;
  const { ratingVariance } = predicted;
  const total = params.sigma * params.sigma + ratingVariance;
  return {
    expectedMargin,
    ratingVariance,
    homeWinProbability: clampProbability(normalCdf(expectedMargin / Math.sqrt(total))),
  };
}

/** Measurement update from a final score. Margins are capped first. */
export function updateWithResult(
  state: FilterState,
  context: GameContext,
  homeMargin: number,
  params: ModelParams,
): GamePrediction {
  const prediction = predictInto(state, context, params);
  const total = params.sigma * params.sigma + prediction.ratingVariance;
  const capped = Math.max(-params.marginCap, Math.min(params.marginCap, homeMargin));
  const residual = capped - prediction.expectedMargin;
  const { mean, cov } = state;
  // SCRATCH_PH holds P*H from predictInto.
  for (let index = 0; index < N; index += 1) {
    mean[index] += (SCRATCH_PH[index] / total) * residual;
  }
  for (let row = 0; row < N; row += 1) {
    const gain = SCRATCH_PH[row] / total;
    if (gain === 0) continue;
    for (let column = 0; column < N; column += 1) {
      cov[row * N + column] -= gain * SCRATCH_PH[column];
    }
  }
  return {
    expectedMargin: prediction.expectedMargin,
    ratingVariance: prediction.ratingVariance,
    homeWinProbability: clampProbability(
      normalCdf(prediction.expectedMargin / Math.sqrt(total)),
    ),
  };
}

/** Whether a game counts toward ratings at all. */
export function isRatable(game: SeasonGame): boolean {
  return game.status === "final" && game.homeScore !== null && game.awayScore !== null;
}

export type ReplayPrediction = {
  game: SeasonGame;
  prediction: GamePrediction;
  ratingVarianceBefore: number;
  homeWon: boolean;
};

export type ReplayResult = {
  state: FilterState;
  /** ET date of each team's most recent counted game, keyed by team ID. */
  lastGameEtDate: Record<string, string | null>;
  ratingsThroughUtc: string | null;
  predictions: ReplayPrediction[];
};

export function isBackToBack(lastEtDate: string | null, etDate: string): boolean {
  return lastEtDate !== null && daysBetween(lastEtDate, etDate) === 1;
}

/**
 * Replay ratings over final games in chronological order. Every prediction uses
 * only games before it. `isIncluded` limits which games enter, which is how a
 * seal excludes same-day results.
 *
 * Input must already be sorted chronologically.
 */
export function replayRatings(
  games: readonly SeasonGame[],
  params: ModelParams,
  options: {
    isIncluded?: (game: SeasonGame) => boolean;
    collectPredictions?: boolean;
    /** Advance time to this ET date after the last game. */
    asOfEtDate?: string;
    /** Sees the state a game would be forecast from, before its result. */
    onBeforeGame?: (game: SeasonGame, state: FilterState) => void;
  } = {},
): ReplayResult {
  const state = createFilterState(params);
  const lastGameEtDate: Record<string, string | null> = {};
  for (const team of SEASON_TEAMS) lastGameEtDate[team.id] = null;
  const predictions: ReplayPrediction[] = [];
  let currentSeason: number | null = null;
  let lastEtDate: string | null = null;
  let ratingsThroughUtc: string | null = null;

  for (const game of games) {
    if (!isRatable(game)) continue;
    if (options.isIncluded && !options.isIncluded(game)) continue;
    if (game.season !== currentSeason) {
      if (currentSeason !== null) rollSeason(state, params);
      currentSeason = game.season;
      lastEtDate = null;
      for (const team of SEASON_TEAMS) lastGameEtDate[team.id] = null;
    }
    if (lastEtDate !== null) {
      advanceDays(state, daysBetween(lastEtDate, game.etDate), params);
    }
    lastEtDate = game.etDate;
    const context: GameContext = {
      homeId: game.homeId,
      awayId: game.awayId,
      neutral: game.neutral,
      playoff: game.kind === "playoff",
      homeOnBackToBack: isBackToBack(lastGameEtDate[game.homeId], game.etDate),
      awayOnBackToBack: isBackToBack(lastGameEtDate[game.awayId], game.etDate),
    };
    options.onBeforeGame?.(game, state);
    const homeMargin = (game.homeScore as number) - (game.awayScore as number);
    const prediction = updateWithResult(state, context, homeMargin, params);
    if (options.collectPredictions) {
      predictions.push({
        game,
        prediction,
        ratingVarianceBefore: prediction.ratingVariance,
        homeWon: homeMargin > 0,
      });
    }
    lastGameEtDate[game.homeId] = game.etDate;
    lastGameEtDate[game.awayId] = game.etDate;
    ratingsThroughUtc = game.tipUtc;
  }

  if (options.asOfEtDate && lastEtDate !== null) {
    advanceDays(state, daysBetween(lastEtDate, options.asOfEtDate), params);
  }

  return { state, lastGameEtDate, ratingsThroughUtc, predictions };
}
