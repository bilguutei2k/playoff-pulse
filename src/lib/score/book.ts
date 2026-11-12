// A player's 548 score on a date, from his box-score pieces to that date, and the
// comparator: the rating part of today's "548 impact" (Game Score per minute above
// replacement, decayed and shrunk exactly as production's injury model does). Pure: no
// fetch, no file access, no clock.
//
// The score on a date needs only box lines and final scores, so the live site can compute
// it: earlier seasons' pieces are rated with their full-season team rates and adjusted net;
// the current season's piece is season-to-date, with team rates and team net to date.
//
//   value = (Σ_p w_p rating_p + k r) / (Σ_p w_p + k),   w_p = possessions_p × φ^(seasons ago)
//
// φ (decay), k (pseudo-possessions) and r (replacement rating) are tuned in the training
// era only.

import type { StoredLine } from "@/lib/season/box-scores";
import { gameScore } from "@/lib/season/box-scores";
import { recordPlayerGame, type InjuryParams, type PlayerBook } from "@/lib/season/injury-model";
import { INJURY_PARAMS } from "@/lib/season/params";
import {
  addGameToTotals,
  buildSeasonTotals,
  createSeasonTotals,
  seasonPieceRatings,
  type BoxCoefficients,
  type PieceRating,
} from "@/lib/score/box-model";
import { solveSymmetric } from "@/lib/score/rapm";
import type { ScoreGame } from "@/lib/score/types";

// ---------------------------------------------------------------------------
// The score on a date
// ---------------------------------------------------------------------------

export type BookParams = {
  /** φ: weight of a piece per season of age. 1 keeps every season whole, 0 only the current one. */
  decay: number;
  /** k: pseudo-possessions of replacement-level play. */
  pseudoPossessions: number;
  /** r: the rating a player with no data has, points per 100 possessions. */
  replacement: number;
};

export type BookValue = {
  value: number;
  /** Raw on-court possessions behind the value, all seasons, undecayed. */
  possessions: number;
  /** Decayed possessions, Σ w_p. */
  weight: number;
  minutes: number;
};

type RatedPiece = Pick<PieceRating, "season" | "possessions" | "minutes" | "rating">;

/** Combines a player's pieces (seasons ≤ `season`) into his value in `season`. */
export function combinePieces(pieces: readonly RatedPiece[], season: number, params: BookParams): BookValue {
  let weighted = 0;
  let weight = 0;
  let possessions = 0;
  let minutes = 0;
  for (const piece of pieces) {
    const age = season - piece.season;
    if (age < 0) throw new Error(`Piece from season ${piece.season} used in season ${season}.`);
    const w = piece.possessions * params.decay ** age;
    weighted += w * piece.rating;
    weight += w;
    possessions += piece.possessions;
    minutes += piece.minutes;
  }
  const denominator = weight + params.pseudoPossessions;
  const value =
    denominator > 0 ? (weighted + params.pseudoPossessions * params.replacement) / denominator : params.replacement;
  return { value, possessions, weight, minutes };
}

/** Chronological order: season, then ET date, then game ID. Input order is not trusted. */
export function chronological(games: readonly ScoreGame[]): ScoreGame[] {
  return [...games].sort((a, b) =>
    a.season !== b.season
      ? a.season - b.season
      : a.etDate !== b.etDate
        ? a.etDate < b.etDate
          ? -1
          : 1
        : a.gameId < b.gameId
          ? -1
          : a.gameId > b.gameId
            ? 1
            : 0,
  );
}

/** Full-season piece ratings per season, indexed by athlete, cached. */
export type RatingHistory = {
  coefficients: BoxCoefficients;
  /** Season to athlete to his pieces that season. */
  bySeason: Map<number, Map<string, PieceRating[]>>;
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

export function buildRatingHistory(games: readonly ScoreGame[], coefficients: BoxCoefficients): RatingHistory {
  const seasons = [...new Set(games.map((game) => game.season))].sort((a, b) => a - b);
  const bySeason = new Map<number, Map<string, PieceRating[]>>();
  for (const season of seasons) {
    bySeason.set(season, indexByAthlete(seasonPieceRatings(buildSeasonTotals(games, season), coefficients)));
  }
  return { coefficients, bySeason };
}

/** Every athlete's pieces in completed seasons before `season`, newest season last. */
function pastPieces(history: RatingHistory, season: number, athleteId: string): PieceRating[] {
  const pieces: PieceRating[] = [];
  for (const [pieceSeason, index] of [...history.bySeason].sort((a, b) => a[0] - b[0])) {
    if (pieceSeason >= season) continue;
    pieces.push(...(index.get(athleteId) ?? []));
  }
  return pieces;
}

/**
 * Every player's value in `season` from games before ET date `before` (null: the whole
 * season, i.e. its end). Games after the date, and every later season, are never read.
 */
export function playerValuesOnDate(
  games: readonly ScoreGame[],
  season: number,
  before: string | null,
  coefficients: BoxCoefficients,
  params: BookParams,
): Map<string, BookValue> {
  const usable = games.filter((game) => game.season < season || (game.season === season && (before === null || game.etDate < before)));
  const history = buildRatingHistory(
    usable.filter((game) => game.season < season),
    coefficients,
  );
  const current = indexByAthlete(seasonPieceRatings(buildSeasonTotals(usable, season, before), coefficients));
  return valuesFrom(history, season, current, params);
}

function valuesFrom(
  history: RatingHistory,
  season: number,
  current: ReadonlyMap<string, PieceRating[]>,
  params: BookParams,
): Map<string, BookValue> {
  const athletes = new Set<string>(current.keys());
  for (const [pieceSeason, index] of history.bySeason) {
    if (pieceSeason < season) for (const id of index.keys()) athletes.add(id);
  }
  const output = new Map<string, BookValue>();
  for (const athleteId of [...athletes].sort()) {
    const pieces = [...pastPieces(history, season, athleteId), ...(current.get(athleteId) ?? [])];
    output.set(athleteId, combinePieces(pieces, season, params));
  }
  return output;
}

/** Values at the end of `season` from a prebuilt history (which must contain that season). */
export function endOfSeasonValues(history: RatingHistory, season: number, params: BookParams): Map<string, BookValue> {
  return valuesFrom(history, season, history.bySeason.get(season) ?? new Map(), params);
}

/**
 * Walks the given seasons date by date. Before each date's games are added, `visit` gets
 * the date's games and a lookup of each player's pieces from games before that date (his
 * completed seasons' pieces, then the current season's to date; empty when he has none).
 * Earlier seasons in `games` give the past pieces. The pieces do not depend on the book's
 * parameters, so one walk serves any number of (φ, k, r) choices.
 */
export function walkPieces(
  games: readonly ScoreGame[],
  seasons: readonly number[],
  coefficients: BoxCoefficients,
  visit: (season: number, etDate: string, day: ScoreGame[], piecesOf: (athleteId: string) => PieceRating[]) => void,
): void {
  const ordered = chronological(games);
  const history = buildRatingHistory(ordered, coefficients);
  for (const season of [...seasons].sort((a, b) => a - b)) {
    const seasonGames = ordered.filter((game) => game.season === season);
    const totals = createSeasonTotals(season);
    let cursor = 0;
    while (cursor < seasonGames.length) {
      const etDate = seasonGames[cursor].etDate;
      let end = cursor;
      while (end < seasonGames.length && seasonGames[end].etDate === etDate) end += 1;
      const day = seasonGames.slice(cursor, end);
      cursor = end;
      const current = indexByAthlete(seasonPieceRatings(totals, coefficients));
      const cache = new Map<string, PieceRating[]>();
      visit(season, etDate, day, (athleteId) => {
        const cached = cache.get(athleteId);
        if (cached) return cached;
        const pieces = [...pastPieces(history, season, athleteId), ...(current.get(athleteId) ?? [])];
        cache.set(athleteId, pieces);
        return pieces;
      });
      for (const game of day) addGameToTotals(totals, game);
    }
  }
}

/**
 * Walks the given seasons date by date. Before each date's games are added, `visit` gets
 * the date's games and a lookup of each player's value from games before that date (null
 * when he has no piece yet). Earlier seasons in `games` give the past pieces.
 */
export function walkDates(
  games: readonly ScoreGame[],
  seasons: readonly number[],
  coefficients: BoxCoefficients,
  params: BookParams,
  visit: (season: number, etDate: string, day: ScoreGame[], valueOf: (athleteId: string) => BookValue | null) => void,
): void {
  walkPieces(games, seasons, coefficients, (season, etDate, day, piecesOf) => {
    const cache = new Map<string, BookValue | null>();
    visit(season, etDate, day, (athleteId) => {
      if (cache.has(athleteId)) return cache.get(athleteId) as BookValue | null;
      const pieces = piecesOf(athleteId);
      const value = pieces.length > 0 ? combinePieces(pieces, season, params) : null;
      cache.set(athleteId, value);
      return value;
    });
  });
}

// ---------------------------------------------------------------------------
// The comparator: production's Game Score book
// ---------------------------------------------------------------------------

/**
 * A team's lines as production stores them (scripts/live/fetch-boxscores.ts): players
 * with positive minutes, minutes rounded to whole numbers, Game Score to one decimal.
 */
export function productionLines(game: ScoreGame, teamId: string): StoredLine[] {
  return (game.box[teamId] ?? [])
    .filter((line) => line.minutes > 0)
    .map((line) => [line.athleteId, Math.round(line.minutes), Number(gameScore(line).toFixed(1))]);
}

/** Adds one game to production's book, both teams, with the production parameters. */
export function recordComparatorGame(book: PlayerBook, game: ScoreGame, params: InjuryParams = INJURY_PARAMS): void {
  recordPlayerGame(book, game.homeId, productionLines(game, game.homeId), params);
  recordPlayerGame(book, game.awayId, productionLines(game, game.awayId), params);
}

/**
 * Game Score per minute above replacement, decayed and shrunk as production does:
 * (score + k·gRep) / (minutes + k) − gRep. Unfloored is the primary comparator; floored at
 * zero is production's `lostValue` divided by expected minutes. Null without a track.
 */
export function comparatorValue(
  book: PlayerBook,
  athleteId: string,
  floored: boolean,
  params: InjuryParams = INJURY_PARAMS,
): number | null {
  const track = book.get(athleteId);
  if (!track) return null;
  const value = (track.score + params.k * params.gRep) / (track.minutes + params.k) - params.gRep;
  return floored ? Math.max(0, value) : value;
}

/** Production's expected minutes: decayed minutes per game. */
export function comparatorExpectedMinutes(book: PlayerBook, athleteId: string): number {
  const track = book.get(athleteId);
  return track && track.gameWeight > 0 ? track.gameMinutes / track.gameWeight : 0;
}

/** Production's book after every game in `games` (chronological order enforced). */
export function replayComparator(games: readonly ScoreGame[], params: InjuryParams = INJURY_PARAMS): PlayerBook {
  const book: PlayerBook = new Map();
  for (const game of chronological(games)) recordComparatorGame(book, game, params);
  return book;
}

// ---------------------------------------------------------------------------
// Team predictions from player values
// ---------------------------------------------------------------------------

export type MinutesShare = { athleteId: string; share: number };

/** Each player's share of a team's minutes; shares sum to one. Sorted by athlete. */
export function minutesShares(minutesByAthlete: ReadonlyMap<string, number>): MinutesShare[] {
  let total = 0;
  for (const minutes of minutesByAthlete.values()) total += minutes;
  return [...minutesByAthlete]
    .filter(([, minutes]) => minutes > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([athleteId, minutes]) => ({ athleteId, share: minutes / total }));
}

/**
 * Σ share_i × v_i over players with a value, and u, the summed share of those without
 * one (`valueOf` returns null), whose v is zero.
 */
export function teamFeature(
  shares: readonly MinutesShare[],
  valueOf: (athleteId: string) => number | null,
): { weighted: number; unknown: number } {
  let weighted = 0;
  let unknown = 0;
  for (const { athleteId, share } of shares) {
    const value = valueOf(athleteId);
    if (value === null) unknown += share;
    else weighted += share * value;
  }
  return { weighted, unknown };
}

/** a + b × weighted + c × unknown, plus d × teamNet when the line has a d. */
export type TeamLine = { a: number; b: number; c: number; d?: number };

/** `teamNet`: the team's own adjusted net rating in season N, for lines with a d term. */
export type TeamLineRow = { weighted: number; unknown: number; actual: number; teamNet?: number };

/**
 * Least squares of actual on [1, weighted, unknown], and teamNet when `options.teamNet`
 * (a missing teamNet counts as 0). With no unknown share anywhere, c is 0. A line fitted
 * without teamNet has no d key.
 */
export function fitTeamLine(rows: readonly TeamLineRow[], options: { teamNet?: boolean } = {}): TeamLine {
  const useUnknown = rows.some((row) => row.unknown !== 0);
  const useNet = options.teamNet === true;
  const p = 2 + (useUnknown ? 1 : 0) + (useNet ? 1 : 0);
  const matrix = new Float64Array(p * p);
  const rhs = new Float64Array(p);
  for (const row of rows) {
    const x = [1, row.weighted];
    if (useUnknown) x.push(row.unknown);
    if (useNet) x.push(row.teamNet ?? 0);
    for (let i = 0; i < p; i += 1) {
      rhs[i] += x[i] * row.actual;
      for (let j = 0; j <= i; j += 1) matrix[i * p + j] += x[i] * x[j];
    }
  }
  const theta = solveSymmetric(matrix, p, rhs);
  const line: TeamLine = { a: theta[0], b: theta[1], c: useUnknown ? theta[2] : 0 };
  if (useNet) line.d = theta[p - 1];
  return line;
}

export function predictTeam(line: TeamLine, feature: { weighted: number; unknown: number; teamNet?: number }): number {
  return line.a + line.b * feature.weighted + line.c * feature.unknown + (line.d ?? 0) * (feature.teamNet ?? 0);
}
