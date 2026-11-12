// Regularised adjusted plus-minus (RAPM) from rebuilt stints, with a dense Cholesky
// solver written here (no dependency). Pure: no fetch, no file access, no clock; the only
// randomness is the seeded fold assignment.
//
// Model, one row per stint and side with possessions on offence:
//
//   100 × points / possessions = intercept[season] + h × [home on offence]
//                                + Σ offence five o_p − Σ defence five d_q
//
// weighted by possessions. `d` positive means good defence. Ridge on the player terms
// only, toward a prior mean per player (zero by default, the Stage 1 rating in Stage 2):
//
//   λO Σ (o_p − priorO_p)² + λD Σ (d_q − priorD_q)²
//
// The season intercepts and `h` are not penalised. XᵀWX and XᵀWy are accumulated stint by
// stint into a dense lower triangle; the design matrix is never built.

import { createSeededRandom } from "@/lib/model/random";
import type { ScoreGame } from "@/lib/score/types";

// ---------------------------------------------------------------------------
// Dense linear algebra
// ---------------------------------------------------------------------------

/**
 * In-place Cholesky factorisation of a symmetric positive definite matrix stored row-major
 * in `matrix` (n × n). Only the lower triangle is read; on return it holds L with
 * A = L Lᵀ. The upper triangle is left as it was. Throws if A is not positive definite.
 */
export function choleskyInPlace(matrix: Float64Array, n: number): void {
  for (let j = 0; j < n; j += 1) {
    const rowJ = j * n;
    let diagonal = matrix[rowJ + j];
    for (let k = 0; k < j; k += 1) {
      const value = matrix[rowJ + k];
      diagonal -= value * value;
    }
    if (!(diagonal > 0)) throw new Error(`Cholesky: matrix is not positive definite at column ${j}.`);
    const pivot = Math.sqrt(diagonal);
    matrix[rowJ + j] = pivot;
    const inverse = 1 / pivot;
    for (let i = j + 1; i < n; i += 1) {
      const rowI = i * n;
      // Four partial sums: about a third faster in V8 than one.
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      let k = 0;
      for (; k + 3 < j; k += 4) {
        s0 += matrix[rowI + k] * matrix[rowJ + k];
        s1 += matrix[rowI + k + 1] * matrix[rowJ + k + 1];
        s2 += matrix[rowI + k + 2] * matrix[rowJ + k + 2];
        s3 += matrix[rowI + k + 3] * matrix[rowJ + k + 3];
      }
      for (; k < j; k += 1) s0 += matrix[rowI + k] * matrix[rowJ + k];
      matrix[rowI + j] = (matrix[rowI + j] - (s0 + s1 + s2 + s3)) * inverse;
    }
  }
}

/** Solves L Lᵀ x = b given the factor from `choleskyInPlace`. Returns a new vector. */
export function choleskyBackSolve(factor: Float64Array, n: number, rhs: ArrayLike<number>): Float64Array {
  const x = Float64Array.from(rhs);
  for (let i = 0; i < n; i += 1) {
    const row = i * n;
    let sum = x[i];
    for (let k = 0; k < i; k += 1) sum -= factor[row + k] * x[k];
    x[i] = sum / factor[row + i];
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = x[i];
    for (let k = i + 1; k < n; k += 1) sum -= factor[k * n + i] * x[k];
    x[i] = sum / factor[i * n + i];
  }
  return x;
}

/** Solves A x = b for symmetric positive definite A (lower triangle read). A is not changed. */
export function solveSymmetric(matrix: ArrayLike<number>, n: number, rhs: ArrayLike<number>): Float64Array {
  const factor = Float64Array.from(matrix);
  choleskyInPlace(factor, n);
  return choleskyBackSolve(factor, n, rhs);
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

/** Ten player columns per row: five on offence, then five on defence. */
const PLAYERS_PER_ROW = 10;

/** The rows of a RAPM fit in compact typed arrays, plus the index of every column. */
export type RapmDesign = {
  /** Seasons present, ascending; column s is season s's intercept. */
  seasons: number[];
  /** Players present, sorted as strings; their columns follow the intercepts and `h`. */
  athleteIds: string[];
  /** Game IDs in input order; `rowGame` indexes this. */
  gameIds: string[];
  rowCount: number;
  rowSeason: Int32Array;
  rowHome: Uint8Array;
  /** Player indices, offence five then defence five, `PLAYERS_PER_ROW` per row. */
  rowPlayers: Int32Array;
  rowY: Float64Array;
  rowWeight: Float64Array;
  rowGame: Int32Array;
  offencePossessions: Float64Array;
  defencePossessions: Float64Array;
};

/** Columns: season intercepts, then h, then each player's offence, then each defence. */
export function rapmDimension(design: RapmDesign): number {
  return design.seasons.length + 1 + 2 * design.athleteIds.length;
}

/** Rows from every stint of every game with stints, in input order. */
export function buildRapmDesign(games: readonly ScoreGame[]): RapmDesign {
  const seasons = [...new Set(games.filter((game) => game.stints !== null).map((game) => game.season))].sort(
    (a, b) => a - b,
  );
  const seasonIndex = new Map(seasons.map((season, index) => [season, index]));
  const ids = new Set<string>();
  let rowCount = 0;
  for (const game of games) {
    if (game.stints === null) continue;
    for (const stint of game.stints) {
      if (stint.homePossessions > 0) rowCount += 1;
      if (stint.awayPossessions > 0) rowCount += 1;
      if (stint.homePossessions > 0 || stint.awayPossessions > 0) {
        for (const id of stint.home) ids.add(id);
        for (const id of stint.away) ids.add(id);
      }
    }
  }
  const athleteIds = [...ids].sort();
  const playerIndex = new Map(athleteIds.map((id, index) => [id, index]));
  const design: RapmDesign = {
    seasons,
    athleteIds,
    gameIds: games.map((game) => game.gameId),
    rowCount,
    rowSeason: new Int32Array(rowCount),
    rowHome: new Uint8Array(rowCount),
    rowPlayers: new Int32Array(rowCount * PLAYERS_PER_ROW),
    rowY: new Float64Array(rowCount),
    rowWeight: new Float64Array(rowCount),
    rowGame: new Int32Array(rowCount),
    offencePossessions: new Float64Array(athleteIds.length),
    defencePossessions: new Float64Array(athleteIds.length),
  };
  let row = 0;
  const addRow = (
    gameIndex: number,
    season: number,
    home: boolean,
    offence: readonly string[],
    defence: readonly string[],
    points: number,
    possessions: number,
  ) => {
    design.rowSeason[row] = seasonIndex.get(season) as number;
    design.rowHome[row] = home ? 1 : 0;
    design.rowY[row] = (100 * points) / possessions;
    design.rowWeight[row] = possessions;
    design.rowGame[row] = gameIndex;
    const base = row * PLAYERS_PER_ROW;
    for (let slot = 0; slot < 5; slot += 1) {
      const o = playerIndex.get(offence[slot]) as number;
      const d = playerIndex.get(defence[slot]) as number;
      design.rowPlayers[base + slot] = o;
      design.rowPlayers[base + 5 + slot] = d;
      design.offencePossessions[o] += possessions;
      design.defencePossessions[d] += possessions;
    }
    row += 1;
  };
  games.forEach((game, gameIndex) => {
    if (game.stints === null) return;
    for (const stint of game.stints) {
      if (stint.homePossessions > 0) {
        addRow(gameIndex, game.season, true, stint.home, stint.away, stint.homePoints, stint.homePossessions);
      }
      if (stint.awayPossessions > 0) {
        addRow(gameIndex, game.season, false, stint.away, stint.home, stint.awayPoints, stint.awayPossessions);
      }
    }
  });
  return design;
}

/** Column indices and signs of one row: intercept, h (home rows), +offence, −defence. */
function rowColumns(design: RapmDesign, row: number, columns: Int32Array, signs: Float64Array): number {
  const seasonCount = design.seasons.length;
  const playerCount = design.athleteIds.length;
  let count = 0;
  columns[count] = design.rowSeason[row];
  signs[count] = 1;
  count += 1;
  if (design.rowHome[row] === 1) {
    columns[count] = seasonCount;
    signs[count] = 1;
    count += 1;
  }
  const base = row * PLAYERS_PER_ROW;
  for (let slot = 0; slot < 5; slot += 1) {
    columns[count] = seasonCount + 1 + design.rowPlayers[base + slot];
    signs[count] = 1;
    count += 1;
  }
  for (let slot = 5; slot < 10; slot += 1) {
    columns[count] = seasonCount + 1 + playerCount + design.rowPlayers[base + slot];
    signs[count] = -1;
    count += 1;
  }
  return count;
}

/** Normal equations of the chosen rows: lower triangle of XᵀWX (row-major) and XᵀWy. */
export type NormalEquations = { n: number; matrix: Float64Array; rhs: Float64Array };

export function accumulateNormalEquations(
  design: RapmDesign,
  include: (row: number) => boolean = () => true,
): NormalEquations {
  const n = rapmDimension(design);
  const matrix = new Float64Array(n * n);
  const rhs = new Float64Array(n);
  const columns = new Int32Array(PLAYERS_PER_ROW + 2);
  const signs = new Float64Array(PLAYERS_PER_ROW + 2);
  for (let row = 0; row < design.rowCount; row += 1) {
    if (!include(row)) continue;
    const count = rowColumns(design, row, columns, signs);
    const weight = design.rowWeight[row];
    const y = design.rowY[row];
    for (let a = 0; a < count; a += 1) {
      const ca = columns[a];
      const wa = weight * signs[a];
      rhs[ca] += wa * y;
      for (let b = 0; b < count; b += 1) {
        const cb = columns[b];
        // Each unordered pair once, into the lower triangle.
        if (cb <= ca) matrix[ca * n + cb] += wa * signs[b];
      }
    }
  }
  return { n, matrix, rhs };
}

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

export type RapmPrior = { offence: number; defence: number };

export type RapmPenalties = { offence: number; defence: number };

export type RapmPlayer = {
  athleteId: string;
  offence: number;
  defence: number;
  /** offence + defence: effect on margin per 100 possessions against an average player. */
  total: number;
  offencePossessions: number;
  defencePossessions: number;
};

export type RapmFit = {
  penalties: RapmPenalties;
  seasonIntercepts: Record<string, number>;
  homeOffence: number;
  rows: number;
  /** Sorted by athlete ID. */
  players: RapmPlayer[];
};

/** Solves the penalised system for a given XᵀWX and XᵀWy. Returns the coefficient vector. */
function solvePenalised(
  design: RapmDesign,
  equations: NormalEquations,
  penalties: RapmPenalties,
  prior: ReadonlyMap<string, RapmPrior> | undefined,
): Float64Array {
  if (!(penalties.offence > 0) || !(penalties.defence > 0)) {
    throw new Error("RAPM penalties must be positive.");
  }
  const { n } = equations;
  const seasonCount = design.seasons.length;
  const playerCount = design.athleteIds.length;
  const matrix = Float64Array.from(equations.matrix);
  const rhs = Float64Array.from(equations.rhs);
  for (let p = 0; p < playerCount; p += 1) {
    const o = seasonCount + 1 + p;
    const d = o + playerCount;
    matrix[o * n + o] += penalties.offence;
    matrix[d * n + d] += penalties.defence;
    const mean = prior?.get(design.athleteIds[p]);
    if (mean) {
      rhs[o] += penalties.offence * mean.offence;
      rhs[d] += penalties.defence * mean.defence;
    }
  }
  // A season with no rows cannot occur (seasons come from the rows), but a fold's training
  // part can lack a season or home rows entirely; a unit diagonal keeps those columns at 0.
  for (let c = 0; c <= seasonCount; c += 1) if (matrix[c * n + c] === 0) matrix[c * n + c] = 1;
  choleskyInPlace(matrix, n);
  return choleskyBackSolve(matrix, n, rhs);
}

function readFit(design: RapmDesign, theta: Float64Array, penalties: RapmPenalties): RapmFit {
  const seasonCount = design.seasons.length;
  const playerCount = design.athleteIds.length;
  const seasonIntercepts: Record<string, number> = {};
  design.seasons.forEach((season, index) => {
    seasonIntercepts[String(season)] = theta[index];
  });
  const players = design.athleteIds.map((athleteId, p) => {
    const offence = theta[seasonCount + 1 + p];
    const defence = theta[seasonCount + 1 + playerCount + p];
    return {
      athleteId,
      offence,
      defence,
      total: offence + defence,
      offencePossessions: design.offencePossessions[p],
      defencePossessions: design.defencePossessions[p],
    };
  });
  return { penalties, seasonIntercepts, homeOffence: theta[seasonCount], rows: design.rowCount, players };
}

/** Fits RAPM on every row of the design. */
export function fitRapm(
  design: RapmDesign,
  penalties: RapmPenalties,
  prior?: ReadonlyMap<string, RapmPrior>,
): RapmFit {
  const theta = solvePenalised(design, accumulateNormalEquations(design), penalties, prior);
  return readFit(design, theta, penalties);
}

/** Predicted points per 100 possessions of one row. */
function predictRow(design: RapmDesign, theta: Float64Array, row: number): number {
  const seasonCount = design.seasons.length;
  const playerCount = design.athleteIds.length;
  let value = theta[design.rowSeason[row]];
  if (design.rowHome[row] === 1) value += theta[seasonCount];
  const base = row * PLAYERS_PER_ROW;
  for (let slot = 0; slot < 5; slot += 1) {
    value += theta[seasonCount + 1 + design.rowPlayers[base + slot]];
    value -= theta[seasonCount + 1 + playerCount + design.rowPlayers[base + 5 + slot]];
  }
  return value;
}

// ---------------------------------------------------------------------------
// Cross-validation by game
// ---------------------------------------------------------------------------

/** Fold of each game (index into `design.gameIds`): a seeded shuffle dealt round-robin. */
export function gameFolds(gameIds: readonly string[], folds: number, seed: string): Int32Array {
  if (!Number.isInteger(folds) || folds < 2) throw new Error("Need at least two folds.");
  const random = createSeededRandom(seed);
  // Shuffle a sorted copy so the assignment depends on the set of IDs, not input order.
  const order = gameIds.map((id, index) => ({ id, index })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.index - b.index));
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const fold = new Int32Array(gameIds.length);
  order.forEach((entry, position) => {
    fold[entry.index] = position % folds;
  });
  return fold;
}

export type RapmCvCell = RapmPenalties & {
  /** Possession-weighted mean squared error on held-out rows, (points per 100)². */
  loss: number;
};

export type RapmCvResult = {
  folds: number;
  seed: string;
  /** Every penalty pair evaluated, in evaluation order. */
  cells: RapmCvCell[];
  best: RapmCvCell;
};

/** Per-fold normal equations, so a fold's training system is the others' sum. */
export type RapmFoldSystems = {
  design: RapmDesign;
  fold: Int32Array;
  folds: number;
  seed: string;
  systems: NormalEquations[];
};

export function prepareRapmFolds(design: RapmDesign, folds: number, seed: string): RapmFoldSystems {
  const fold = gameFolds(design.gameIds, folds, seed);
  const systems: NormalEquations[] = [];
  for (let f = 0; f < folds; f += 1) {
    systems.push(accumulateNormalEquations(design, (row) => fold[design.rowGame[row]] === f));
  }
  return { design, fold, folds, seed, systems };
}

/** Cross-validated loss of one penalty pair. */
export function rapmFoldLoss(
  prepared: RapmFoldSystems,
  penalties: RapmPenalties,
  prior?: ReadonlyMap<string, RapmPrior>,
): number {
  const { design, fold, folds, systems } = prepared;
  const n = rapmDimension(design);
  let squared = 0;
  let weight = 0;
  for (let f = 0; f < folds; f += 1) {
    const matrix = new Float64Array(n * n);
    const rhs = new Float64Array(n);
    for (let g = 0; g < folds; g += 1) {
      if (g === f) continue;
      const system = systems[g];
      for (let i = 0; i < matrix.length; i += 1) matrix[i] += system.matrix[i];
      for (let i = 0; i < n; i += 1) rhs[i] += system.rhs[i];
    }
    const theta = solvePenalised(design, { n, matrix, rhs }, penalties, prior);
    for (let row = 0; row < design.rowCount; row += 1) {
      if (fold[design.rowGame[row]] !== f) continue;
      const error = design.rowY[row] - predictRow(design, theta, row);
      squared += design.rowWeight[row] * error * error;
      weight += design.rowWeight[row];
    }
  }
  return weight > 0 ? squared / weight : Number.NaN;
}

/** Evaluates every pair given. Ties keep the earlier pair. */
export function crossValidateRapm(
  prepared: RapmFoldSystems,
  grid: readonly RapmPenalties[],
  prior?: ReadonlyMap<string, RapmPrior>,
): RapmCvResult {
  if (grid.length === 0) throw new Error("Empty penalty grid.");
  const cells = grid.map((penalties) => ({ ...penalties, loss: rapmFoldLoss(prepared, penalties, prior) }));
  let best = cells[0];
  for (const cell of cells) if (cell.loss < best.loss) best = cell;
  return { folds: prepared.folds, seed: prepared.seed, cells, best };
}

/**
 * Coarse-to-fine search on a log grid: first λO = λD over `ladder`, then the 3 × 3 grid of
 * (best ÷ step, best, best × step) for each penalty around the best common value. The full 2D grid
 * costs folds × ladder² Cholesky solves (about a second each at three seasons), which is
 * too slow to run per window.
 */
export function searchRapmPenalties(
  prepared: RapmFoldSystems,
  ladder: readonly number[],
  step: number,
  prior?: ReadonlyMap<string, RapmPrior>,
): RapmCvResult & { atLadderEdge: boolean } {
  const seen = new Map<string, RapmCvCell>();
  const cells: RapmCvCell[] = [];
  const evaluate = (penalties: RapmPenalties): RapmCvCell => {
    const key = `${penalties.offence}:${penalties.defence}`;
    const known = seen.get(key);
    if (known) return known;
    const cell = { ...penalties, loss: rapmFoldLoss(prepared, penalties, prior) };
    seen.set(key, cell);
    cells.push(cell);
    return cell;
  };
  let best = evaluate({ offence: ladder[0], defence: ladder[0] });
  for (const lambda of ladder.slice(1)) {
    const cell = evaluate({ offence: lambda, defence: lambda });
    if (cell.loss < best.loss) best = cell;
  }
  const centre = best.offence;
  const atLadderEdge = centre === ladder[0] || centre === ladder[ladder.length - 1];
  for (const offence of [centre / step, centre, centre * step]) {
    for (const defence of [centre / step, centre, centre * step]) {
      const cell = evaluate({ offence, defence });
      if (cell.loss < best.loss) best = cell;
    }
  }
  return { folds: prepared.folds, seed: prepared.seed, cells, best, atLadderEdge };
}

/** Raw on-court plus-minus per 100 possessions (offence and defence pooled). For tests and reports. */
export function rawPlusMinus(design: RapmDesign): Map<string, number> {
  const margin = new Float64Array(design.athleteIds.length);
  const possessions = new Float64Array(design.athleteIds.length);
  for (let row = 0; row < design.rowCount; row += 1) {
    const points = (design.rowY[row] * design.rowWeight[row]) / 100;
    const base = row * PLAYERS_PER_ROW;
    for (let slot = 0; slot < 5; slot += 1) {
      const o = design.rowPlayers[base + slot];
      const d = design.rowPlayers[base + 5 + slot];
      margin[o] += points;
      margin[d] -= points;
      possessions[o] += design.rowWeight[row];
      possessions[d] += design.rowWeight[row];
    }
  }
  // Each possession counted once per side: margin per 100 of the player's on-court possessions,
  // with possessions counted per side, times two to put it on a per-100-each-way scale.
  return new Map(
    design.athleteIds.map((id, p) => [id, possessions[p] > 0 ? (200 * margin[p]) / possessions[p] : 0]),
  );
}
