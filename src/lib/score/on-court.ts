// Stage 2 of the 548 score: the on-court layer. Stage 1 (the book) gives every player a
// box-score value b_i on any date. Stage 2's rating is r_i = b_i + δ_i, where δ_i is what
// the lineup data adds or takes away. Pure: no fetch, no file access, no clock.
//
// For a season and a date D, from that season's stints in games before D whose lineup
// audit passed (`stints !== null`), one row per stint with possessions:
//
//   y = 100 × (home points − away points) / w,   w = mean of the two sides' possessions,
//   X = +1 for each home player on the floor, −1 for each away player.
//
//   minimise  Σ w (y − h − X(b + δ))² + λ Σ_i (δ_i − ρ δ_i,prev)²
//
// b is the Stage 1 book value on D (the book's replacement value for a player on the
// floor without one), δ_prev each player's final δ of the previous season (0 if he has
// none), h an unpenalised home term. Written in r = b + δ:
//
//   (XᵀWX + λI) r + XᵀW1 h = XᵀWy + λ (b + ρ δ_prev)
//   1ᵀWX r     + 1ᵀW1 h   = 1ᵀWy
//
// so only running sums of XᵀWX, XᵀWy, XᵀW1, 1ᵀW1 and 1ᵀWy are kept as a season advances
// (`OnCourtSystem`). A player with no stints keeps δ = ρ δ_prev (his r equals his prior).
//
// In season, δ is re-solved at checkpoints: every 21 days from the season's first game
// (games before that date), and at the season's end (every game). Between checkpoints a
// player's rating is his current Stage 1 value plus his δ from the latest checkpoint;
// before the season's first checkpoint, ρ δ_prev. Seasons are walked in order, each
// season's final δ feeding the next.
//
// The tuning criterion (`forwardStints`) predicts each stint from the ratings held at the
// latest checkpoint before its game, r = b(checkpoint) + δ(checkpoint), so a checkpoint
// only ever predicts stints of games it did not see.

import { buildRatingHistory, chronological, combinePieces, type BookParams, type RatingHistory } from "@/lib/score/book";
import {
  addGameToTotals,
  createSeasonTotals,
  seasonPieceRatings,
  type BoxCoefficients,
  type PieceRating,
  type SeasonTotals,
} from "@/lib/score/box-model";
import { choleskyBackSolve, choleskyInPlace } from "@/lib/score/rapm";
import type { ScoreGame, Stint } from "@/lib/score/types";

export type OnCourtParams = {
  /** λ: penalty on δ's distance from ρ δ_prev, in possessions (the weight unit). */
  lambda: number;
  /** ρ: share of last season's final δ carried into this season's prior. */
  rho: number;
};

/** Days between in-season checkpoints, counted from the season's first game date. */
export const CHECKPOINT_DAYS = 21;

// ---------------------------------------------------------------------------
// Rows and running normal equations
// ---------------------------------------------------------------------------

export type StintRow = { y: number; w: number; home: readonly string[]; away: readonly string[] };

/** A stint's row, or null when it has no possessions. */
export function stintRow(stint: Stint): StintRow | null {
  const w = (stint.homePossessions + stint.awayPossessions) / 2;
  if (!(w > 0)) return null;
  return { y: (100 * (stint.homePoints - stint.awayPoints)) / w, w, home: stint.home, away: stint.away };
}

/**
 * Running normal equations of one season's stints. Player columns are numbered in order
 * of first appearance; `xtx` holds the lower triangle of XᵀWX row-major with stride
 * `capacity` (players only), `xt1` is XᵀW1, `xty` XᵀWy, `oneW` 1ᵀW1 and `oneY` 1ᵀWy.
 */
export type OnCourtSystem = {
  ids: string[];
  index: Map<string, number>;
  capacity: number;
  xtx: Float64Array;
  xty: Float64Array;
  xt1: Float64Array;
  oneW: number;
  oneY: number;
  rows: number;
  /** Σ w over the rows each player was on the floor for. */
  possessions: Float64Array;
};

export function createOnCourtSystem(capacity = 64): OnCourtSystem {
  const size = Math.max(1, Math.floor(capacity));
  return {
    ids: [],
    index: new Map(),
    capacity: size,
    xtx: new Float64Array(size * size),
    xty: new Float64Array(size),
    xt1: new Float64Array(size),
    oneW: 0,
    oneY: 0,
    rows: 0,
    possessions: new Float64Array(size),
  };
}

function grow(system: OnCourtSystem, needed: number): void {
  if (needed <= system.capacity) return;
  let capacity = system.capacity;
  while (capacity < needed) capacity *= 2;
  const xtx = new Float64Array(capacity * capacity);
  const n = system.ids.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) xtx[i * capacity + j] = system.xtx[i * system.capacity + j];
  }
  const widen = (from: Float64Array) => {
    const to = new Float64Array(capacity);
    to.set(from.subarray(0, n));
    return to;
  };
  system.xtx = xtx;
  system.xty = widen(system.xty);
  system.xt1 = widen(system.xt1);
  system.possessions = widen(system.possessions);
  system.capacity = capacity;
}

function columnOf(system: OnCourtSystem, athleteId: string): number {
  const known = system.index.get(athleteId);
  if (known !== undefined) return known;
  const column = system.ids.length;
  grow(system, column + 1);
  system.ids.push(athleteId);
  system.index.set(athleteId, column);
  return column;
}

/** Adds one row to the running sums. */
export function addRow(system: OnCourtSystem, row: StintRow): void {
  const players = [...row.home, ...row.away];
  if (new Set(players).size !== players.length) throw new Error(`A stint lists a player twice: ${players.join(", ")}.`);
  const columns = players.map((id) => columnOf(system, id));
  const signs = players.map((_, slot) => (slot < row.home.length ? 1 : -1));
  const { w, y } = row;
  const stride = system.capacity;
  for (let a = 0; a < columns.length; a += 1) {
    const ca = columns[a];
    const wa = w * signs[a];
    system.xty[ca] += wa * y;
    system.xt1[ca] += wa;
    system.possessions[ca] += w;
    for (let b = 0; b < columns.length; b += 1) {
      const cb = columns[b];
      if (cb <= ca) system.xtx[ca * stride + cb] += wa * signs[b];
    }
  }
  system.oneW += w;
  system.oneY += w * y;
  system.rows += 1;
}

/** Adds every stint of a game whose lineup audit passed; a game without stints adds nothing. */
export function addGameStints(system: OnCourtSystem, game: ScoreGame): void {
  if (game.stints === null) return;
  for (const stint of game.stints) {
    const row = stintRow(stint);
    if (row) addRow(system, row);
  }
}

/** The Cholesky factor of the penalised system for one λ: players, then h last. */
export type OnCourtFactor = { lambda: number; n: number; factor: Float64Array };

export function factorOnCourt(system: OnCourtSystem, lambda: number): OnCourtFactor {
  if (!(lambda > 0)) throw new Error("λ must be positive.");
  const players = system.ids.length;
  const n = players + 1;
  const factor = new Float64Array(n * n);
  const stride = system.capacity;
  for (let i = 0; i < players; i += 1) {
    for (let j = 0; j <= i; j += 1) factor[i * n + j] = system.xtx[i * stride + j];
    factor[i * n + i] += lambda;
    factor[players * n + i] = system.xt1[i];
  }
  // No rows: h has no data, and a unit diagonal keeps it at zero.
  factor[players * n + players] = system.oneW > 0 ? system.oneW : 1;
  choleskyInPlace(factor, n);
  return { lambda, n, factor };
}

export type OnCourtSolution = {
  /** r = b + δ for each column of the system, in `system.ids` order. */
  rating: Float64Array;
  home: number;
};

/** Solves for one prior (b + ρ δ_prev per column, `system.ids` order) with a factor of the same system. */
export function solveWithFactor(system: OnCourtSystem, factored: OnCourtFactor, prior: ArrayLike<number>): OnCourtSolution {
  const players = system.ids.length;
  if (factored.n !== players + 1) throw new Error("The factor belongs to another system.");
  if (prior.length !== players) throw new Error(`Prior has ${prior.length} entries for ${players} players.`);
  const rhs = new Float64Array(players + 1);
  for (let i = 0; i < players; i += 1) rhs[i] = system.xty[i] + factored.lambda * prior[i];
  rhs[players] = system.oneY;
  const theta = choleskyBackSolve(factored.factor, players + 1, rhs);
  return { rating: theta.subarray(0, players), home: theta[players] };
}

/** Factor and solve in one call. */
export function solveOnCourt(system: OnCourtSystem, lambda: number, prior: ArrayLike<number>): OnCourtSolution {
  return solveWithFactor(system, factorOnCourt(system, lambda), prior);
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/** The ISO date `days` after `date` (calendar arithmetic only, no clock). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * In-season checkpoint dates first + 21k (k ≥ 1) up to and including `last`. A checkpoint
 * on date D uses the season's games before D. The season's end is a further checkpoint,
 * not listed here.
 */
export function checkpointDates(first: string, last: string, every: number = CHECKPOINT_DAYS): string[] {
  const dates: string[] = [];
  for (let k = 1; ; k += 1) {
    const date = addDays(first, every * k);
    if (date > last) break;
    dates.push(date);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// The season walk
// ---------------------------------------------------------------------------

export type OnCourtCheckpoint = {
  season: number;
  /** Games before this ET date were used; null at the season's end (every game). */
  before: string | null;
  /** Stage 1 value on the date of every player with one (pieces in this or an earlier season). */
  box: ReadonlyMap<string, number>;
  /**
   * Per setting, δ of every player in this season's solve or carrying a δ from earlier
   * seasons (ρ δ_prev). A player in neither has δ = 0.
   */
  delta: ReadonlyArray<ReadonlyMap<string, number>>;
  /** Per setting, the fitted home term (0 when the season has no rows yet). */
  home: readonly number[];
  /** Stint rows in the solve. */
  rows: number;
  /** Σ w of each player in the solve. */
  possessions: ReadonlyMap<string, number>;
};

export type OnCourtDate = {
  season: number;
  etDate: string;
  /** The date's games, not yet added to anything. */
  day: readonly ScoreGame[];
  /** Stage 1 value from games before the date, or null for a player with no piece yet. */
  boxOf: (athleteId: string) => number | null;
  /** δ held before the date under setting `setting`: latest checkpoint's, else ρ δ_prev. */
  deltaOf: (setting: number, athleteId: string) => number;
  /**
   * The latest checkpoint on or before the date (its ET date), or null before the season's
   * first checkpoint. It used only games before its own date, so never a game of this date.
   */
  checkpoint: string | null;
  /**
   * Stage 1 values on that checkpoint's date (before the first checkpoint: at the season's
   * start, from earlier seasons' pieces only), every player with one.
   */
  checkpointBox: ReadonlyMap<string, number>;
};

export type OnCourtVisitor = {
  date?: (event: OnCourtDate) => void;
  checkpoint?: (event: OnCourtCheckpoint) => void;
};

export type OnCourtWalkOptions = {
  /**
   * Stop the last season at this ET date instead of its end: checkpoints on or before it
   * are solved, no end-of-season checkpoint is, and the result is what is held on it.
   * Games on or after it must not be in the input.
   */
  stopBefore?: string;
};

/** What is held at the end of the walk: the last season's end (or `stopBefore`). */
export type OnCourtHeld = {
  season: number;
  before: string | null;
  box: ReadonlyMap<string, number>;
  /** Per setting: δ of every player with one (latest checkpoint's, else ρ δ_prev). */
  delta: ReadonlyArray<ReadonlyMap<string, number>>;
};

function indexByAthlete(ratings: readonly PieceRating[]): Map<string, PieceRating[]> {
  const index = new Map<string, PieceRating[]>();
  for (const rating of ratings) {
    const list = index.get(rating.athleteId) ?? [];
    list.push(rating);
    index.set(rating.athleteId, list);
  }
  return index;
}

/** Every athlete's pieces from completed seasons before `season`, oldest first. */
function pastPieceIndex(history: RatingHistory, season: number): Map<string, PieceRating[]> {
  const index = new Map<string, PieceRating[]>();
  for (const [pieceSeason, bySeason] of [...history.bySeason].sort((a, b) => a[0] - b[0])) {
    if (pieceSeason >= season) continue;
    for (const [athleteId, pieces] of bySeason) {
      const list = index.get(athleteId) ?? [];
      list.push(...pieces);
      index.set(athleteId, list);
    }
  }
  return index;
}

/** Stage 1 values of every athlete with a piece: past seasons' pieces plus the season to date. */
function boxValues(
  past: ReadonlyMap<string, PieceRating[]>,
  totals: SeasonTotals,
  season: number,
  coefficients: BoxCoefficients,
  book: BookParams,
): Map<string, number> {
  const current = indexByAthlete(seasonPieceRatings(totals, coefficients));
  const athletes = [...new Set([...past.keys(), ...current.keys()])].sort();
  const values = new Map<string, number>();
  for (const athleteId of athletes) {
    const pieces = [...(past.get(athleteId) ?? []), ...(current.get(athleteId) ?? [])];
    values.set(athleteId, combinePieces(pieces, season, book).value);
  }
  return values;
}

/**
 * Walks every season in `games` in order, date by date, for any number of (λ, ρ)
 * settings at once (they share the running sums, and settings with the same λ share a
 * factorisation). `visitor.date` sees each date before its games are added;
 * `visitor.checkpoint` sees each solve. Returns what is held at the end.
 */
export function walkOnCourt(
  games: readonly ScoreGame[],
  coefficients: BoxCoefficients,
  book: BookParams,
  settings: readonly OnCourtParams[],
  visitor: OnCourtVisitor = {},
  options: OnCourtWalkOptions = {},
): OnCourtHeld {
  if (settings.length === 0) throw new Error("No on-court settings.");
  for (const setting of settings) {
    if (!(setting.lambda > 0) || !Number.isFinite(setting.lambda)) throw new Error(`λ ${setting.lambda} must be positive and finite.`);
    if (!(setting.rho >= 0) || !Number.isFinite(setting.rho)) throw new Error(`ρ ${setting.rho} must be non-negative and finite.`);
  }
  const ordered = chronological(games);
  if (ordered.length === 0) throw new Error("No games to walk.");
  if (options.stopBefore !== undefined && ordered.some((game) => game.etDate >= (options.stopBefore as string))) {
    throw new Error(`A game on or after ${options.stopBefore} was passed to a walk that stops before it.`);
  }
  const history = buildRatingHistory(ordered, coefficients);
  const seasons = [...new Set(ordered.map((game) => game.season))].sort((a, b) => a - b);
  const lambdas = [...new Set(settings.map((s) => s.lambda))];

  let previous: Array<Map<string, number>> = settings.map(() => new Map());
  let held: OnCourtHeld | null = null;

  for (const season of seasons) {
    const isLast = season === seasons[seasons.length - 1];
    const stopBefore = isLast ? (options.stopBefore ?? null) : null;
    const seasonGames = ordered.filter((game) => game.season === season);
    const first = seasonGames[0].etDate;
    const last = seasonGames[seasonGames.length - 1].etDate;
    const schedule = checkpointDates(first, stopBefore ?? last);
    const past = pastPieceIndex(history, season);
    const totals = createSeasonTotals(season);
    const system = createOnCourtSystem(512);
    const carried = previous;
    let current: Array<Map<string, number>> | null = null;
    // Stage 1 values held with δ: at the season's start, then each checkpoint's.
    let heldBox: ReadonlyMap<string, number> | null = null;
    let heldCheckpoint: string | null = null;

    const solve = (before: string | null): OnCourtCheckpoint => {
      const box = boxValues(past, totals, season, coefficients, book);
      const players = system.ids.length;
      const base = new Float64Array(players);
      system.ids.forEach((id, i) => {
        base[i] = box.get(id) ?? book.replacement;
      });
      const delta: Array<Map<string, number>> = [];
      const home: number[] = [];
      const factors = new Map<number, OnCourtFactor>();
      if (system.rows > 0) for (const lambda of lambdas) factors.set(lambda, factorOnCourt(system, lambda));
      settings.forEach((setting, s) => {
        const map = new Map<string, number>();
        // Carried players first; those in the solve are overwritten below.
        for (const [id, value] of carried[s]) map.set(id, setting.rho * value);
        if (system.rows > 0) {
          const prior = new Float64Array(players);
          system.ids.forEach((id, i) => {
            prior[i] = base[i] + setting.rho * (carried[s].get(id) ?? 0);
          });
          const solution = solveWithFactor(system, factors.get(setting.lambda) as OnCourtFactor, prior);
          system.ids.forEach((id, i) => map.set(id, solution.rating[i] - base[i]));
          home.push(solution.home);
        } else {
          home.push(0);
        }
        delta.push(map);
      });
      const possessions = new Map(system.ids.map((id, i) => [id, system.possessions[i]]));
      const event: OnCourtCheckpoint = { season, before, box, delta, home, rows: system.rows, possessions };
      visitor.checkpoint?.(event);
      current = delta;
      heldBox = box;
      heldCheckpoint = before;
      return event;
    };

    let next = 0;
    let cursor = 0;
    while (cursor < seasonGames.length) {
      const etDate = seasonGames[cursor].etDate;
      let end = cursor;
      while (end < seasonGames.length && seasonGames[end].etDate === etDate) end += 1;
      const day = seasonGames.slice(cursor, end);
      cursor = end;
      // Every game added so far is before this date and before any checkpoint up to it.
      while (next < schedule.length && schedule[next] <= etDate) solve(schedule[next++]);
      if (visitor.date) {
        const pieces = indexByAthlete(seasonPieceRatings(totals, coefficients));
        const cache = new Map<string, number | null>();
        const boxOf = (athleteId: string): number | null => {
          if (cache.has(athleteId)) return cache.get(athleteId) as number | null;
          const list = [...(past.get(athleteId) ?? []), ...(pieces.get(athleteId) ?? [])];
          const value = list.length > 0 ? combinePieces(list, season, book).value : null;
          cache.set(athleteId, value);
          return value;
        };
        const heldNow = current as Array<Map<string, number>> | null;
        const deltaOf = (setting: number, athleteId: string): number =>
          heldNow ? (heldNow[setting].get(athleteId) ?? 0) : settings[setting].rho * (carried[setting].get(athleteId) ?? 0);
        // Before the first checkpoint: no game of the season has been added yet, so the
        // season's totals are empty and these are the values at the season's start.
        heldBox ??= boxValues(past, createSeasonTotals(season), season, coefficients, book);
        visitor.date({ season, etDate, day, boxOf, deltaOf, checkpoint: heldCheckpoint, checkpointBox: heldBox });
      }
      for (const game of day) {
        addGameToTotals(totals, game);
        addGameStints(system, game);
      }
    }

    if (stopBefore !== null) {
      while (next < schedule.length) solve(schedule[next++]);
      const box = boxValues(past, totals, season, coefficients, book);
      const heldNow = current as Array<Map<string, number>> | null;
      const delta = settings.map((setting, s) => {
        if (heldNow) return heldNow[s];
        return new Map([...carried[s]].map(([id, value]) => [id, setting.rho * value]));
      });
      held = { season, before: stopBefore, box, delta };
    } else {
      const end = solve(null);
      previous = end.delta.map((map) => new Map(map));
      held = { season, before: null, box: end.box, delta: end.delta };
    }
  }
  return held as OnCourtHeld;
}

// ---------------------------------------------------------------------------
// Forward stint prediction (Stage 2's tuning criterion and its second pass condition)
// ---------------------------------------------------------------------------

/**
 * One stint predicted from the ratings held at the latest checkpoint before its game:
 * `h + Σ home five r − Σ away five r` with r = b(checkpoint) + δ(checkpoint), b the book's
 * replacement value for a player without a Stage 1 value. Stage 1 is the same with δ = 0.
 */
export type ForwardStint = {
  season: number;
  gameId: string;
  etDate: string;
  /** The checkpoint the ratings come from (its ET date), or null: the season's start. */
  checkpoint: string | null;
  y: number;
  w: number;
  /** Σ home b − Σ away b. */
  boxDifference: number;
  /** Stage 1's prediction, h + boxDifference. */
  stage1: number;
  /** Per setting, h + Σ home r − Σ away r. */
  stage2: Float64Array;
};

/**
 * Predicts every stint with possessions of the date's audit-accepted games, for `settings`
 * settings of a walk, with the home term `home` fixed (nothing is fitted here). Pass it the
 * walk's date event: the ratings it reads were solved from games before the checkpoint's
 * date, which is on or before this date, so no stint is predicted from its own game.
 */
export function forwardStints(
  event: OnCourtDate,
  settings: number,
  home: number,
  replacement: number,
  visit: (stint: ForwardStint) => void,
): void {
  for (const game of event.day) {
    if (game.stints === null) continue;
    // Each player's b and δ per setting, once per game.
    const cache = new Map<string, { b: number; d: Float64Array }>();
    const valuesOf = (id: string) => {
      const known = cache.get(id);
      if (known) return known;
      const d = new Float64Array(settings);
      for (let s = 0; s < settings; s += 1) d[s] = event.deltaOf(s, id);
      const entry = { b: event.checkpointBox.get(id) ?? replacement, d };
      cache.set(id, entry);
      return entry;
    };
    for (const stint of game.stints) {
      const row = stintRow(stint);
      if (!row) continue;
      let boxDifference = 0;
      const stage2 = new Float64Array(settings);
      for (const [ids, sign] of [
        [row.home, 1],
        [row.away, -1],
      ] as const) {
        for (const id of ids) {
          const { b, d } = valuesOf(id);
          boxDifference += sign * b;
          for (let s = 0; s < settings; s += 1) stage2[s] += sign * d[s];
        }
      }
      for (let s = 0; s < settings; s += 1) stage2[s] += home + boxDifference;
      visit({
        season: event.season,
        gameId: game.gameId,
        etDate: event.etDate,
        checkpoint: event.checkpoint,
        y: row.y,
        w: row.w,
        boxDifference,
        stage1: home + boxDifference,
        stage2,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Ratings on a date
// ---------------------------------------------------------------------------

export type OnCourtRating = {
  /** Stage 2 rating: box + δ. */
  rating: number;
  /** Stage 1 value on the date. */
  box: number;
  delta: number;
};

/**
 * Every player's Stage 2 rating, Stage 1 value and δ in `season`, from games before ET
 * date `before` (null: the season's end). Only players with a Stage 1 value are listed.
 * Games on or after the date, and every later season, are never read.
 */
export function onCourtRatingsOnDate(
  games: readonly ScoreGame[],
  season: number,
  before: string | null,
  coefficients: BoxCoefficients,
  book: BookParams,
  params: OnCourtParams,
): Map<string, OnCourtRating> {
  const usable = games.filter(
    (game) => game.season < season || (game.season === season && (before === null || game.etDate < before)),
  );
  const output = new Map<string, OnCourtRating>();
  if (usable.length === 0) return output;
  const lastSeason = Math.max(...usable.map((game) => game.season));
  // With no game of `season` before the date, the season has not started: hold ρ δ_prev.
  const held = walkOnCourt(usable, coefficients, book, [params], {}, lastSeason === season && before !== null ? { stopBefore: before } : {});
  let box = held.box;
  let delta = held.delta[0];
  if (held.season !== season) {
    // The season's first game is on or after the date: Stage 1 values carry from earlier
    // seasons, and δ is ρ times the last final δ.
    const history = buildRatingHistory(usable, coefficients);
    const past = pastPieceIndex(history, season);
    box = boxValues(past, createSeasonTotals(season), season, coefficients, book);
    delta = new Map([...held.delta[0]].map(([id, value]) => [id, params.rho ** (season - held.season) * value]));
  }
  for (const [athleteId, value] of box) {
    const d = delta.get(athleteId) ?? 0;
    output.set(athleteId, { rating: value + d, box: value, delta: d });
  }
  return output;
}
