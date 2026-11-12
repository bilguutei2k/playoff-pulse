// Shared by fit-stage2.ts, evaluate-stage2.ts and freeze-stage2.ts: the constants and
// paths of the Stage 2 test (docs/score/registration-stage2.md), the frozen Stage 1 inputs,
// one walk that prices every game and every season's end for any number of (λ, ρ)
// settings, the tuning, and the reported statistics. Files are read only through the
// loaders here and in score-data.ts; test seasons only through evaluate-stage2.ts --era
// test after its freeze check.

import * as fs from "node:fs";
import * as path from "node:path";
import { createSeededRandom } from "../../src/lib/model/random";
import { fitTeamLine, minutesShares, predictTeam, teamFeature, type BookParams, type TeamLine } from "../../src/lib/score/book";
import type { BoxCoefficients } from "../../src/lib/score/box-model";
import { forwardStints, walkOnCourt, CHECKPOINT_DAYS, type OnCourtParams } from "../../src/lib/score/on-court";
import type { ScoreGame } from "../../src/lib/score/types";
import { bookParamsFromFit, coefficientsFromFit, type ScoreFit } from "./fit-score";
import {
  DEFAULT_FREEZE_PATHS,
  FIT_PATH,
  SCORE_DOCS,
  assertFrozen,
  leaveSeasonOutRmse,
  qualifyingValues,
  quantile,
  rmseOf,
  sha256File,
  targetRows,
  type FreezePaths,
  type FreezeRecord,
  type GameRow,
  type SeasonFacts,
  type TeamTarget,
  type ValuesBySeason,
} from "./score-data";

// ---------------------------------------------------------------------------
// Constants and paths
// ---------------------------------------------------------------------------

export const FIT_STAGE2_PATH = path.join(SCORE_DOCS, "fit-stage2.json");
export const FREEZE_STAGE2_PATH = path.join(SCORE_DOCS, "freeze-stage2.json");
export const REGISTRATION_STAGE2_PATH = path.join(SCORE_DOCS, "registration-stage2.md");
export const EVALUATION_STAGE2_PATH = path.join(SCORE_DOCS, "evaluation-stage2.json");
export const TRAINING_EVALUATION_STAGE2_PATH = path.join(SCORE_DOCS, "evaluation-stage2-training.json");

export const STAGE2_FREEZE_PATHS: FreezePaths = {
  registration: REGISTRATION_STAGE2_PATH,
  fit: FIT_STAGE2_PATH,
  freeze: FREEZE_STAGE2_PATH,
};

/** The registered grid. λ is extended by doubling or halving while the optimum sits on its edge. */
export const STAGE2_GRID = {
  lambda: [500, 1000, 2000, 4000, 8000, 16000, 32000],
  rho: [0, 0.25, 0.5, 0.75, 1],
} as const;
/** At most this many λ extensions on each side. */
export const MAX_LAMBDA_EXTENSIONS = 4;

/** Player-seasons with at least this many minutes for the size of δ and its correlation with RAPM. */
export const DELTA_MIN_MINUTES = 1000;
/** Face-validity lists at the end of a training season. */
export const FACE_MIN_MINUTES = 1500;
export const FACE_SEASON = 2020;
export const LIST_LENGTH = 15;
export const TOP_RATING_LENGTH = 20;
/** For the record lists at the end of each test season. */
export const RECORD_MIN_MINUTES = 1000;

// ---------------------------------------------------------------------------
// Stage 1, frozen
// ---------------------------------------------------------------------------

export type Stage1Inputs = {
  fit: ScoreFit;
  fitSha256: string;
  coefficients: BoxCoefficients;
  book: BookParams;
  /** Stage 1's frozen home term per 100 possessions (`fit.json → primary.home`), fixed in the forward stint prediction. */
  home: number;
};

function stage1Of(fit: ScoreFit, fitSha256: string): Stage1Inputs {
  const home = fit.primary.home;
  if (!Number.isFinite(home)) throw new Error("Stage 1's fit has no primary home term.");
  return { fit, fitSha256, coefficients: coefficientsFromFit(fit).score, book: bookParamsFromFit(fit), home };
}

/** Stage 1's frozen fit: read, never refitted. */
export function loadStage1(file: string = FIT_PATH): Stage1Inputs {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: Stage 1's frozen fit is required.`);
  return stage1Of(JSON.parse(fs.readFileSync(file, "utf-8")) as ScoreFit, sha256File(file));
}

/** Stage 1 inputs from an in-memory fit (tests). */
export function stage1FromFit(fit: ScoreFit): Stage1Inputs {
  return stage1Of(fit, "in memory");
}

/**
 * Throws unless both freezes hold: Stage 1's (its registration and fit.json) and Stage 2's
 * (registration-stage2.md and fit-stage2.json). Checked before any test season is read.
 */
export function assertStage2Frozen(
  stage2: FreezePaths = STAGE2_FREEZE_PATHS,
  stage1: FreezePaths = DEFAULT_FREEZE_PATHS,
): { stage1: FreezeRecord; stage2: FreezeRecord } {
  const first = assertFrozen(stage1);
  if (!fs.existsSync(stage2.freeze)) {
    throw new Error(`No freeze at ${stage2.freeze}: run scripts/score/freeze-stage2.ts before the test era.`);
  }
  return { stage1: first, stage2: assertFrozen(stage2) };
}

// ---------------------------------------------------------------------------
// One walk, every setting
// ---------------------------------------------------------------------------

export type SeasonEnd = {
  /** Stage 1 value at the season's end of every player with one. */
  box: Map<string, number>;
  /** Per setting: δ at the season's end. */
  delta: Array<Map<string, number>>;
  /** Σ w in the season's stints per player. */
  possessions: Map<string, number>;
  rows: number;
};

/**
 * One game's stints in the forward stint prediction: Σ w, and Σ w (y − prediction)² for
 * Stage 1 and per setting. Games are the bootstrap's units.
 */
export type ForwardGame = {
  gameId: string;
  season: number;
  stints: number;
  weight: number;
  stage1: number;
  stage2: Float64Array;
};

/** Running sums for the unpenalised slope γ of `y − h = γ x` (x a home-minus-away rating sum). */
export type SlopeSums = { sw: number; sxy: number; sxx: number; syy: number };

export type ForwardCollection = {
  /** Stage 1's fixed home term used in every prediction. */
  home: number;
  games: ForwardGame[];
  /** x = Σ home b − Σ away b (Stage 1). */
  slopeStage1: SlopeSums;
  /** Per setting, x = Σ home r − Σ away r. */
  slopeStage2: SlopeSums[];
};

export type OnCourtCollection = {
  settings: OnCourtParams[];
  /** Forward stint prediction over the stints of `gameSeasons`. */
  forward: ForwardCollection;
  /** Per setting: one row per game of `gameSeasons`, ratings held before the game. */
  gameRows: GameRow[][];
  /** Stage 1 (δ = 0) rows of the same games. */
  stage1GameRows: GameRow[];
  ends: Map<number, SeasonEnd>;
  checkpoints: Array<{ season: number; before: string | null; rows: number }>;
};

const emptySlope = (): SlopeSums => ({ sw: 0, sxy: 0, sxx: 0, syy: 0 });

function addSlope(sums: SlopeSums, w: number, x: number, y: number): void {
  sums.sw += w;
  sums.sxy += w * x * y;
  sums.sxx += w * x * x;
  sums.syy += w * y * y;
}

/**
 * Walks every season in `games` once. For `gameSeasons` only it keeps:
 *
 * - game rows: home minus away of Σ share × v and of u (share of players without a Stage 1
 *   value), with v = b + δ held before the date for each setting, and v = b for Stage 1;
 * - the forward stint prediction of every stint of an audit-accepted game, from the
 *   ratings held at the latest checkpoint before it (`forwardStints`), with h fixed at
 *   Stage 1's frozen home term.
 */
export function collectOnCourt(
  games: readonly ScoreGame[],
  stage1: Pick<Stage1Inputs, "coefficients" | "book" | "home">,
  settings: readonly OnCourtParams[],
  gameSeasons: readonly number[],
): OnCourtCollection {
  const wanted = new Set(gameSeasons);
  const gameRows: GameRow[][] = settings.map(() => []);
  const stage1GameRows: GameRow[] = [];
  const ends = new Map<number, SeasonEnd>();
  const checkpoints: OnCourtCollection["checkpoints"] = [];
  const forward: ForwardCollection = {
    home: stage1.home,
    games: [],
    slopeStage1: emptySlope(),
    slopeStage2: settings.map(emptySlope),
  };
  const forwardByGame = new Map<string, ForwardGame>();
  walkOnCourt(games, stage1.coefficients, stage1.book, settings, {
    date: (event) => {
      const { season, day, boxOf, deltaOf } = event;
      if (!wanted.has(season)) return;
      forwardStints(event, settings.length, stage1.home, stage1.book.replacement, (stint) => {
        let unit = forwardByGame.get(stint.gameId);
        if (!unit) {
          unit = { gameId: stint.gameId, season, stints: 0, weight: 0, stage1: 0, stage2: new Float64Array(settings.length) };
          forwardByGame.set(stint.gameId, unit);
          forward.games.push(unit);
        }
        unit.stints += 1;
        unit.weight += stint.w;
        unit.stage1 += stint.w * (stint.y - stint.stage1) ** 2;
        const target = stint.y - stage1.home;
        addSlope(forward.slopeStage1, stint.w, stint.boxDifference, target);
        for (let s = 0; s < settings.length; s += 1) {
          unit.stage2[s] += stint.w * (stint.y - stint.stage2[s]) ** 2;
          addSlope(forward.slopeStage2[s], stint.w, stint.stage2[s] - stage1.home, target);
        }
      });
      for (const game of day) {
        const shares = (teamId: string) =>
          minutesShares(new Map((game.box[teamId] ?? []).filter((l) => l.minutes > 0).map((l) => [l.athleteId, l.minutes])));
        const home = shares(game.homeId);
        const away = shares(game.awayId);
        const row = (valueOf: (id: string) => number | null): GameRow => {
          const h = teamFeature(home, valueOf);
          const a = teamFeature(away, valueOf);
          return {
            gameId: game.gameId,
            season: game.season,
            actual: game.homeScore - game.awayScore,
            weighted: h.weighted - a.weighted,
            unknown: h.unknown - a.unknown,
          };
        };
        stage1GameRows.push(row(boxOf));
        settings.forEach((_, s) => {
          gameRows[s].push(
            row((id) => {
              const b = boxOf(id);
              return b === null ? null : b + deltaOf(s, id);
            }),
          );
        });
      }
    },
    checkpoint: (event) => {
      checkpoints.push({ season: event.season, before: event.before, rows: event.rows });
      if (event.before !== null) return;
      ends.set(event.season, {
        box: new Map(event.box),
        delta: event.delta.map((map) => new Map(map)),
        possessions: new Map(event.possessions),
        rows: event.rows,
      });
    },
  });
  return { settings: [...settings], forward, gameRows, stage1GameRows, ends, checkpoints };
}

/** Stage 2 ratings (b + δ) at the end of each season for one setting, every player with a Stage 1 value. */
export function endRatings(collection: OnCourtCollection, setting: number, seasons: readonly number[]): ValuesBySeason {
  const output: ValuesBySeason = new Map();
  for (const season of seasons) {
    const end = collection.ends.get(season);
    if (!end) throw new Error(`No end of season ${season} in the walk.`);
    const delta = end.delta[setting];
    output.set(season, new Map([...end.box].map(([id, b]) => [id, b + (delta.get(id) ?? 0)])));
  }
  return output;
}

/** Stage 1 values at the end of each season (the walk's own; equal to Stage 1's book). */
export function endBoxValues(collection: OnCourtCollection, seasons: readonly number[]): ValuesBySeason {
  const output: ValuesBySeason = new Map();
  for (const season of seasons) {
    const end = collection.ends.get(season);
    if (!end) throw new Error(`No end of season ${season} in the walk.`);
    output.set(season, new Map(end.box));
  }
  return output;
}

export function restrictToQualifying(values: ValuesBySeason, facts: ReadonlyMap<number, SeasonFacts>): ValuesBySeason {
  return new Map(
    [...values].map(([season, map]) => {
      const seasonFacts = facts.get(season);
      if (!seasonFacts) throw new Error(`No facts for season ${season}.`);
      return [season, qualifyingValues(map, seasonFacts.minutes)];
    }),
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Leave-one-season-out RMSE of the game line. */
export function leaveSeasonOutGameRmse(rows: readonly GameRow[]): number {
  const seasons = [...new Set(rows.map((row) => row.season))].sort((a, b) => a - b);
  const errors: number[] = [];
  for (const season of seasons) {
    const line = fitTeamLine(rows.filter((row) => row.season !== season));
    for (const row of rows) if (row.season === season) errors.push(row.actual - predictTeam(line, row));
  }
  return rmseOf(errors);
}

export type Residual = { key: string; season: number; error: number };

export function residuals(rows: ReadonlyArray<{ season: number; actual: number; weighted: number; unknown: number; teamId?: string; gameId?: string }>, line: TeamLine): Residual[] {
  return rows.map((row) => ({ key: row.gameId ?? row.teamId ?? "", season: row.season, error: row.actual - predictTeam(line, row) }));
}

export function rmseOfResiduals(list: readonly Residual[]): number {
  return rmseOf(list.map((r) => r.error));
}

export function maeOfResiduals(list: readonly Residual[]): number {
  return list.reduce((sum, r) => sum + Math.abs(r.error), 0) / list.length;
}

export const BOOTSTRAP_DRAWS = 2000;

export type RmseRatioInterval = {
  draws: number;
  seed: string;
  cluster: "unit" | "season";
  low: number;
  median: number;
  high: number;
  /** Share of draws with RMSE(Stage 2) / RMSE(Stage 1) below one. */
  shareBelowOne: number;
};

/** Paired bootstrap of RMSE(Stage 2) / RMSE(Stage 1), resampling units or whole seasons. */
export function bootstrapRmseRatio(
  stage2: readonly Residual[],
  stage1: readonly Residual[],
  cluster: "unit" | "season",
  seed: string,
): RmseRatioInterval {
  if (stage2.length !== stage1.length) throw new Error("Paired bootstrap needs the same units.");
  stage2.forEach((r, i) => {
    if (r.key !== stage1[i].key || r.season !== stage1[i].season) throw new Error(`Unit ${i} is not paired.`);
  });
  const random = createSeededRandom(seed);
  const n = stage2.length;
  const seasons = [...new Set(stage2.map((r) => r.season))].sort((a, b) => a - b);
  const bySeason = new Map(seasons.map((season) => [season, stage2.map((r, i) => (r.season === season ? i : -1)).filter((i) => i >= 0)]));
  const ratios: number[] = [];
  for (let draw = 0; draw < BOOTSTRAP_DRAWS; draw += 1) {
    const picks: number[] = [];
    if (cluster === "unit") {
      for (let i = 0; i < n; i += 1) picks.push(Math.floor(random() * n));
    } else {
      for (let i = 0; i < seasons.length; i += 1) picks.push(...(bySeason.get(seasons[Math.floor(random() * seasons.length)]) as number[]));
    }
    const a = rmseOf(picks.map((i) => stage2[i].error));
    const b = rmseOf(picks.map((i) => stage1[i].error));
    ratios.push(a / b);
  }
  ratios.sort((x, y) => x - y);
  return {
    draws: BOOTSTRAP_DRAWS,
    seed,
    cluster,
    low: quantile(ratios, 0.025),
    median: quantile(ratios, 0.5),
    high: quantile(ratios, 0.975),
    shareBelowOne: ratios.filter((r) => r < 1).length / ratios.length,
  };
}

/** Possession-weighted mean squared error of the forward stint prediction: Stage 1, or one setting. */
export function forwardLoss(forward: ForwardCollection, which: "stage1" | number, games: readonly ForwardGame[] = forward.games): number {
  let weight = 0;
  let sse = 0;
  for (const game of games) {
    weight += game.weight;
    sse += which === "stage1" ? game.stage1 : game.stage2[which];
  }
  return sse / weight;
}

export type ForwardSummary = { stints: number; games: number; possessions: number; stage1: number; stage2: number; ratio: number; improvement: number };

/** Forward loss of one setting beside Stage 1's; improvement = 1 − ratio. */
export function forwardSummary(forward: ForwardCollection, setting: number, games: readonly ForwardGame[] = forward.games): ForwardSummary {
  const stage1 = forwardLoss(forward, "stage1", games);
  const stage2 = forwardLoss(forward, setting, games);
  return {
    stints: games.reduce((sum, game) => sum + game.stints, 0),
    games: games.length,
    possessions: games.reduce((sum, game) => sum + game.weight, 0),
    stage1,
    stage2,
    ratio: stage2 / stage1,
    improvement: 1 - stage2 / stage1,
  };
}

export type ForwardSeason = { season: number } & ForwardSummary;

export function forwardBySeason(forward: ForwardCollection, setting: number): ForwardSeason[] {
  const seasons = [...new Set(forward.games.map((game) => game.season))].sort((a, b) => a - b);
  return seasons.map((season) => ({ season, ...forwardSummary(forward, setting, forward.games.filter((game) => game.season === season)) }));
}

export type Slope = {
  /** The weighted least-squares slope of y − h on x, no intercept, no penalty. */
  gamma: number;
  /** Forward loss with the prediction h + γ x. */
  loss: number;
  /** Forward loss with γ = 1 (the rating as it is). */
  lossAtOne: number;
  /** Forward loss with γ = 0 (h alone): the scale against which a rating's gain is read. */
  lossAtZero: number;
};

export function slopeOf(sums: SlopeSums): Slope {
  const gamma = sums.sxy / sums.sxx;
  return {
    gamma,
    loss: (sums.syy - (sums.sxy * sums.sxy) / sums.sxx) / sums.sw,
    lossAtOne: (sums.syy - 2 * sums.sxy + sums.sxx) / sums.sw,
    lossAtZero: sums.syy / sums.sw,
  };
}

export type LossRatioInterval = {
  draws: number;
  seed: string;
  cluster: "game" | "season";
  low: number;
  median: number;
  high: number;
  /** Share of draws with forward loss(Stage 2) / forward loss(Stage 1) below one. */
  shareBelowOne: number;
};

/**
 * Paired bootstrap of forward loss(Stage 2) / forward loss(Stage 1) for one setting,
 * resampling games or whole seasons (every game of a drawn season). The weights are the
 * same for both, so the ratio is a ratio of summed squared errors.
 */
export function bootstrapForwardRatio(
  forward: ForwardCollection,
  setting: number,
  cluster: "game" | "season",
  seed: string,
): LossRatioInterval {
  const games = forward.games;
  const random = createSeededRandom(seed);
  const n = games.length;
  const seasons = [...new Set(games.map((game) => game.season))].sort((a, b) => a - b);
  // Per-season sums, so a season draw costs one addition.
  const bySeason = new Map(seasons.map((season) => [season, { stage1: 0, stage2: 0 }]));
  for (const game of games) {
    const sums = bySeason.get(game.season) as { stage1: number; stage2: number };
    sums.stage1 += game.stage1;
    sums.stage2 += game.stage2[setting];
  }
  const ratios: number[] = [];
  for (let draw = 0; draw < BOOTSTRAP_DRAWS; draw += 1) {
    let a = 0;
    let b = 0;
    if (cluster === "game") {
      for (let i = 0; i < n; i += 1) {
        const game = games[Math.floor(random() * n)];
        a += game.stage2[setting];
        b += game.stage1;
      }
    } else {
      for (let i = 0; i < seasons.length; i += 1) {
        const sums = bySeason.get(seasons[Math.floor(random() * seasons.length)]) as { stage1: number; stage2: number };
        a += sums.stage2;
        b += sums.stage1;
      }
    }
    ratios.push(a / b);
  }
  ratios.sort((x, y) => x - y);
  return {
    draws: BOOTSTRAP_DRAWS,
    seed,
    cluster,
    low: quantile(ratios, 0.025),
    median: quantile(ratios, 0.5),
    high: quantile(ratios, 0.975),
    shareBelowOne: ratios.filter((r) => r < 1).length / ratios.length,
  };
}

// ---------------------------------------------------------------------------
// Tuning (training era only)
// ---------------------------------------------------------------------------

export type TuningCell = OnCourtParams & {
  /** The criterion: possession-weighted forward stint loss, ratings from the latest checkpoint before each game. */
  forwardLoss: number;
  /** For comparison: leave-one-season-out RMSE of game margins, ratings held before each game (the old criterion). */
  gameRmse: number;
  /** For comparison: leave-one-season-out RMSE of the season-to-season team prediction. */
  endpointRmse: number;
};

export type TuningKey = "forwardLoss" | "gameRmse" | "endpointRmse";

/** Every (λ, ρ) cell of one walk: the criterion and the two compared ones. */
export function tuningCells(
  games: readonly ScoreGame[],
  stage1: Pick<Stage1Inputs, "coefficients" | "book" | "home">,
  settings: readonly OnCourtParams[],
  gameSeasons: readonly number[],
  targets: readonly TeamTarget[],
  facts: ReadonlyMap<number, SeasonFacts>,
): { cells: TuningCell[]; collection: OnCourtCollection } {
  const collection = collectOnCourt(games, stage1, settings, gameSeasons);
  const seasonsN = [...new Set(targets.map((t) => t.season - 1))].sort((a, b) => a - b);
  const cells = settings.map((setting, s) => {
    const values = restrictToQualifying(endRatings(collection, s, seasonsN), facts);
    return {
      ...setting,
      forwardLoss: forwardLoss(collection.forward, s),
      gameRmse: leaveSeasonOutGameRmse(collection.gameRows[s]),
      endpointRmse: leaveSeasonOutRmse(targetRows(targets, values)),
    };
  });
  return { cells, collection };
}

/** Grid order: λ ascending, then ρ ascending. Ties keep the earlier cell. */
export function sortCells(cells: readonly TuningCell[]): TuningCell[] {
  return [...cells].sort((a, b) => (a.lambda !== b.lambda ? a.lambda - b.lambda : a.rho - b.rho));
}

/** The best cell by `key` (default: the criterion, the forward stint loss). */
export function bestCell(cells: readonly TuningCell[], key: TuningKey = "forwardLoss"): TuningCell {
  const sorted = sortCells(cells);
  let best = sorted[0];
  for (const cell of sorted) if (cell[key] < best[key] - 1e-12) best = cell;
  return best;
}

export { CHECKPOINT_DAYS };

// ---------------------------------------------------------------------------
// Reported statistics
// ---------------------------------------------------------------------------

export function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function standardDeviation(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

export function covariance(a: readonly number[], b: readonly number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - ma) * (b[i] - mb);
  return sum / (a.length - 1);
}

export function correlation(a: readonly number[], b: readonly number[]): number {
  return covariance(a, b) / Math.sqrt(covariance(a, a) * covariance(b, b));
}

export type DeltaSize = {
  minMinutes: number;
  playerSeasons: number;
  /** Standard deviation of δ. */
  sdDelta: number;
  sdBox: number;
  sdRating: number;
  meanDelta: number;
  /** Cov(δ, rating) / Var(rating): δ's share of the rating's variance (the shares of b and δ add to one). */
  shareOfVariance: number;
  /** Var(δ) / Var(rating), for reference. */
  varianceRatio: number;
  correlationBoxDelta: number;
  perSeason: Array<{ season: number; playerSeasons: number; sdDelta: number }>;
};

/** δ among player-seasons with at least `minMinutes` that season, end-of-season values. */
export function deltaSize(
  collection: OnCourtCollection,
  setting: number,
  seasons: readonly number[],
  facts: ReadonlyMap<number, SeasonFacts>,
  minMinutes: number = DELTA_MIN_MINUTES,
): DeltaSize {
  const deltas: number[] = [];
  const boxes: number[] = [];
  const perSeason: DeltaSize["perSeason"] = [];
  for (const season of seasons) {
    const end = collection.ends.get(season);
    const minutes = facts.get(season)?.minutes;
    if (!end || !minutes) throw new Error(`Season ${season} is missing.`);
    const list: number[] = [];
    for (const [id, played] of [...minutes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (played < minMinutes) continue;
      const b = end.box.get(id);
      if (b === undefined) continue;
      const d = end.delta[setting].get(id) ?? 0;
      deltas.push(d);
      boxes.push(b);
      list.push(d);
    }
    perSeason.push({ season, playerSeasons: list.length, sdDelta: list.length > 1 ? standardDeviation(list) : Number.NaN });
  }
  const ratings = deltas.map((d, i) => d + boxes[i]);
  const varRating = covariance(ratings, ratings);
  return {
    minMinutes,
    playerSeasons: deltas.length,
    sdDelta: standardDeviation(deltas),
    sdBox: standardDeviation(boxes),
    sdRating: standardDeviation(ratings),
    meanDelta: mean(deltas),
    shareOfVariance: covariance(deltas, ratings) / varRating,
    varianceRatio: covariance(deltas, deltas) / varRating,
    correlationBoxDelta: correlation(boxes, deltas),
    perSeason,
  };
}

export type PlayerLine = { athleteId: string; name: string; minutes: number; box: number; delta: number; rating: number };

/** Each athlete's most frequent name in the games (ties: the later spelling alphabetically). */
export function athleteNames(games: readonly ScoreGame[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const game of games) {
    for (const lines of Object.values(game.box)) {
      for (const line of lines) {
        const byName = counts.get(line.athleteId) ?? new Map<string, number>();
        byName.set(line.name, (byName.get(line.name) ?? 0) + 1);
        counts.set(line.athleteId, byName);
      }
    }
  }
  const names = new Map<string, string>();
  for (const [id, byName] of counts) {
    const [name] = [...byName].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0];
    names.set(id, name);
  }
  return names;
}

/** End-of-season lines of players with at least `minMinutes` that season. */
export function seasonLines(
  collection: OnCourtCollection,
  setting: number,
  season: number,
  facts: ReadonlyMap<number, SeasonFacts>,
  names: ReadonlyMap<string, string>,
  minMinutes: number,
): PlayerLine[] {
  const end = collection.ends.get(season);
  const minutes = facts.get(season)?.minutes;
  if (!end || !minutes) throw new Error(`Season ${season} is missing.`);
  const lines: PlayerLine[] = [];
  for (const [id, played] of minutes) {
    if (played < minMinutes) continue;
    const box = end.box.get(id);
    if (box === undefined) continue;
    const delta = end.delta[setting].get(id) ?? 0;
    lines.push({ athleteId: id, name: names.get(id) ?? id, minutes: Math.round(played), box, delta, rating: box + delta });
  }
  return lines.sort((a, b) => (a.athleteId < b.athleteId ? -1 : 1));
}

export function extremes(lines: readonly PlayerLine[], length: number = LIST_LENGTH): { positive: PlayerLine[]; negative: PlayerLine[] } {
  const byDelta = [...lines].sort((a, b) => b.delta - a.delta || (a.athleteId < b.athleteId ? -1 : 1));
  return { positive: byDelta.slice(0, length), negative: byDelta.slice(-length).reverse() };
}

export function topByRating(lines: readonly PlayerLine[], length: number = TOP_RATING_LENGTH): PlayerLine[] {
  return [...lines].sort((a, b) => b.rating - a.rating || (a.athleteId < b.athleteId ? -1 : 1)).slice(0, length);
}

/** Pass rule of Stage 2: (1) season-to-season team RMSE, (2) forward stint loss; both strict. */
export type Stage2Pass = {
  team: { rmseStage2: number; rmseStage1: number; ratio: number; passed: boolean };
  forward: { lossStage2: number; lossStage1: number; ratio: number; passed: boolean };
  passed: boolean;
};

export function stage2PassConditions(team: { stage2: number; stage1: number }, forward: { stage2: number; stage1: number }): Stage2Pass {
  const teamResult = { rmseStage2: team.stage2, rmseStage1: team.stage1, ratio: team.stage2 / team.stage1, passed: team.stage2 < team.stage1 };
  const forwardResult = {
    lossStage2: forward.stage2,
    lossStage1: forward.stage1,
    ratio: forward.stage2 / forward.stage1,
    passed: forward.stage2 < forward.stage1,
  };
  return { team: teamResult, forward: forwardResult, passed: teamResult.passed && forwardResult.passed };
}
