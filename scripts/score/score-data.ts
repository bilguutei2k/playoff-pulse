// Shared by fit-score.ts and evaluate-score.ts: the era guards, the constants of the
// Stage 1 test (docs/score/registration.md), and the computations both scripts run on
// built games — team targets, end-of-season values per metric, book tuning, the game-level
// check, the owner checks and RAPM windows. Reads files only through the loaders below.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createSeededRandom } from "../../src/lib/model/random";
import type { PlayerBook } from "../../src/lib/season/injury-model";
import {
  buildRatingHistory,
  chronological,
  combinePieces,
  comparatorValue,
  endOfSeasonValues,
  fitTeamLine,
  minutesShares,
  predictTeam,
  recordComparatorGame,
  teamFeature,
  walkDates,
  walkPieces,
  type BookParams,
  type MinutesShare,
  type TeamLine,
  type TeamLineRow,
} from "../../src/lib/score/book";
import {
  BOX_STATS,
  adjustedNetRatings,
  buildSeasonTotals,
  modalPosition,
  netRating,
  positionClass,
  type BoxCoefficients,
  type PieceRating,
  type SeasonTotals,
} from "../../src/lib/score/box-model";
import { buildRapmDesign, fitRapm, type RapmPenalties, type RapmPlayer } from "../../src/lib/score/rapm";
import type { ScoreGame } from "../../src/lib/score/types";
import { gamesPath, loadScoreGames } from "./store";

// ---------------------------------------------------------------------------
// Constants of the registered test
// ---------------------------------------------------------------------------

export const FIRST_SEASON = 2011;
/** The training era ends with 2019-20. No later season may be loaded before the freeze. */
export const LAST_TRAINING_SEASON = 2020;
/** Seasons N+1 of the training pairs: ratings from the end of N, N ≥ 2011. */
export const TRAINING_TARGET_SEASONS = [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020] as const;
/** Seasons N+1 of the test: 2020-21 to 2025-26. */
export const TEST_TARGET_SEASONS = [2021, 2022, 2023, 2024, 2025, 2026] as const;
export const LAST_TEST_SEASON = 2026;
/** Under this many minutes in season N, a player has no value (v = 0, counted in u). */
export const MIN_PRIOR_MINUTES = 250;
/** Three-season RAPM windows. */
export const TRAINING_RAPM_WINDOWS: ReadonlyArray<readonly number[]> = [
  [2012, 2013, 2014],
  [2015, 2016, 2017],
  [2018, 2019, 2020],
];
export const TEST_RAPM_WINDOWS: ReadonlyArray<readonly number[]> = [
  [2021, 2022, 2023],
  [2024, 2025, 2026],
];
export const OWNER_CHECK_MIN_MINUTES = 1000;
export const BOOTSTRAP_DRAWS = 2000;
export const BAR = 0.9;

export const SCORE_DOCS = path.join(process.cwd(), "docs", "score");
export const FIT_PATH = path.join(SCORE_DOCS, "fit.json");
export const FREEZE_PATH = path.join(SCORE_DOCS, "freeze.json");
export const REGISTRATION_PATH = path.join(SCORE_DOCS, "registration.md");
export const EVALUATION_PATH = path.join(SCORE_DOCS, "evaluation.json");
export const TRAINING_EVALUATION_PATH = path.join(SCORE_DOCS, "evaluation-training.json");

export function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

// ---------------------------------------------------------------------------
// Era guards and loading
// ---------------------------------------------------------------------------

export function assertTrainingSeason(season: number): void {
  if (!Number.isInteger(season) || season > LAST_TRAINING_SEASON) {
    throw new Error(
      `Season ${season} is not in the training era (seasons up to ${LAST_TRAINING_SEASON}). ` +
        "Test seasons are read only by evaluate-score.ts --era test after the freeze.",
    );
  }
}

export type GameLoader = (season: number) => ScoreGame[];

/** Training-era games; refuses any later season before reading anything. */
export function loadTrainingGames(seasons: readonly number[], loader: GameLoader = loadScoreGames): ScoreGame[] {
  for (const season of seasons) assertTrainingSeason(season);
  return loadSeasons(seasons, loader);
}

/** Every season's games, chronological; a season that has not been built fails closed. */
export function loadSeasons(seasons: readonly number[], loader: GameLoader = loadScoreGames): ScoreGame[] {
  const games: ScoreGame[] = [];
  for (const season of seasons) {
    const loaded = loader(season);
    if (loaded.length === 0) throw new Error(`Season ${season} has no built games (scripts/score/build-games.ts).`);
    if (loaded.some((game) => game.season !== season)) throw new Error(`Season ${season}'s file holds another season's game.`);
    games.push(...withoutStrayTeams(loaded));
  }
  return chronological(games);
}

/** A team needs at least this many built games in a season for any of them to be used. */
export const MIN_TEAM_SEASON_GAMES = 10;

/**
 * Drops the games of a team whose season is otherwise missing. ESPN's box scores are empty
 * for every Chicago and New Orleans game from 2012-13 to 2017-18, bar one 2015-16 Chicago
 * game; a one-game "season" would give that team a meaningless net rating and rates.
 */
export function withoutStrayTeams(seasonGames: readonly ScoreGame[]): ScoreGame[] {
  const played = new Map<string, number>();
  for (const game of seasonGames) {
    played.set(game.homeId, (played.get(game.homeId) ?? 0) + 1);
    played.set(game.awayId, (played.get(game.awayId) ?? 0) + 1);
  }
  const enough = (teamId: string) => (played.get(teamId) ?? 0) >= MIN_TEAM_SEASON_GAMES;
  return seasonGames.filter((game) => enough(game.homeId) && enough(game.awayId));
}

export function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function sha256File(file: string): string {
  return sha256(fs.readFileSync(file));
}

/** SHA-256 of each season's built games file and of the list. */
export function inputHashes(seasons: readonly number[]): { files: Record<string, string>; combined: string } {
  const files: Record<string, string> = {};
  for (const season of seasons) {
    const file = gamesPath(season);
    files[String(season)] = fs.existsSync(file) ? sha256File(file) : "missing";
  }
  return { files, combined: sha256(JSON.stringify(files)) };
}

/** JSON with a trailing newline; key order is insertion order, so builders fix it. */
export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export type FreezeRecord = { registrationSha256: string; fitSha256: string; frozenAt: string };

export type FreezePaths = { registration: string; fit: string; freeze: string };

export const DEFAULT_FREEZE_PATHS: FreezePaths = { registration: REGISTRATION_PATH, fit: FIT_PATH, freeze: FREEZE_PATH };

/** Throws unless the freeze exists and both hashes match the files now. */
export function assertFrozen(paths: FreezePaths = DEFAULT_FREEZE_PATHS): FreezeRecord {
  if (!fs.existsSync(paths.freeze)) {
    throw new Error(`No freeze at ${paths.freeze}: run scripts/score/freeze-score.ts before the test era.`);
  }
  const record = JSON.parse(fs.readFileSync(paths.freeze, "utf-8")) as Partial<FreezeRecord>;
  if (typeof record.registrationSha256 !== "string" || typeof record.fitSha256 !== "string" || typeof record.frozenAt !== "string") {
    throw new Error(`Freeze ${paths.freeze} is malformed.`);
  }
  for (const [label, file, expected] of [
    ["registration", paths.registration, record.registrationSha256],
    ["fit", paths.fit, record.fitSha256],
  ] as const) {
    if (!fs.existsSync(file)) throw new Error(`The frozen ${label} file ${file} is missing.`);
    const actual = sha256File(file);
    if (actual !== expected) throw new Error(`The ${label} file changed since the freeze (${actual} ≠ ${expected}).`);
  }
  return record as FreezeRecord;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export type SeasonCoverage = {
  season: number;
  games: number;
  gamesWithStints: number;
  stints: number;
  rejected: Record<string, number>;
  teams: number;
  players: number;
  /** Box lines by ESPN position string ("null" when missing), to check the position map. */
  positions: Record<string, number>;
};

export function coverage(games: readonly ScoreGame[]): SeasonCoverage[] {
  const seasons = [...new Set(games.map((game) => game.season))].sort((a, b) => a - b);
  return seasons.map((season) => {
    const list = games.filter((game) => game.season === season);
    const rejected: Record<string, number> = {};
    const players = new Set<string>();
    const teams = new Set<string>();
    const positions: Record<string, number> = {};
    for (const game of list) {
      if (game.stints === null) {
        // The reason's kind, without the game's own details.
        const kind = (game.audit.rejected ?? "unknown").split(":")[0];
        rejected[kind] = (rejected[kind] ?? 0) + 1;
      }
      teams.add(game.homeId);
      teams.add(game.awayId);
      for (const lines of Object.values(game.box)) {
        for (const line of lines) {
          players.add(line.athleteId);
          const key = line.position ?? "null";
          positions[key] = (positions[key] ?? 0) + 1;
        }
      }
    }
    return {
      season,
      games: list.length,
      gamesWithStints: list.filter((game) => game.stints !== null).length,
      stints: list.reduce((n, game) => n + (game.stints?.length ?? 0), 0),
      rejected: Object.fromEntries(Object.entries(rejected).sort()),
      teams: teams.size,
      players: players.size,
      positions: Object.fromEntries(Object.entries(positions).sort()),
    };
  });
}

// ---------------------------------------------------------------------------
// Seasons, targets and values
// ---------------------------------------------------------------------------

export type SeasonFacts = {
  season: number;
  totals: SeasonTotals;
  /** Minutes over all teams. */
  minutes: Map<string, number>;
  /** Team to athlete to minutes for that team. */
  teamMinutes: Map<string, Map<string, number>>;
  net: Map<string, number>;
  /** Opponent-adjusted net rating of each team over the whole season (`adjustedNetRatings`). */
  adjusted: Map<string, number>;
};

export function seasonFacts(games: readonly ScoreGame[], season: number): SeasonFacts {
  const totals = buildSeasonTotals(games, season);
  const minutes = new Map<string, number>();
  const teamMinutes = new Map<string, Map<string, number>>();
  for (const key of [...totals.pieces.keys()].sort()) {
    const piece = totals.pieces.get(key);
    if (!piece) continue;
    minutes.set(piece.athleteId, (minutes.get(piece.athleteId) ?? 0) + piece.minutes);
    const team = teamMinutes.get(piece.teamId) ?? new Map<string, number>();
    team.set(piece.athleteId, piece.minutes);
    teamMinutes.set(piece.teamId, team);
  }
  const net = new Map([...totals.teams.values()].map((team) => [team.teamId, netRating(team)]));
  return { season, totals, minutes, teamMinutes, net, adjusted: adjustedNetRatings(totals.teams.values()) };
}

export type TeamTarget = {
  teamId: string;
  /** N + 1. */
  season: number;
  /** Net rating per 100 possessions in N + 1, box-estimated possessions, regular season. */
  actual: number;
  /** Net rating in N, or null if the team did not play in N. */
  lastNet: number | null;
  /** Opponent-adjusted net rating in N, or null if the team did not play in N. */
  lastAdjusted: number | null;
  shares: MinutesShare[];
};

export function teamTargets(facts: ReadonlyMap<number, SeasonFacts>, targetSeasons: readonly number[]): TeamTarget[] {
  const targets: TeamTarget[] = [];
  for (const season of targetSeasons) {
    const current = facts.get(season);
    const previous = facts.get(season - 1);
    if (!current || !previous) throw new Error(`Seasons ${season - 1} and ${season} are both needed.`);
    for (const teamId of [...current.teamMinutes.keys()].sort()) {
      // A team with no built games in N (ESPN's box scores for Chicago and New Orleans are
      // empty from 2012-13 to 2017-18) has no prior ratings to carry: it is not a pair.
      if (!previous.teamMinutes.has(teamId)) continue;
      targets.push({
        teamId,
        season,
        actual: current.net.get(teamId) as number,
        lastNet: previous.net.get(teamId) ?? null,
        lastAdjusted: previous.adjusted.get(teamId) ?? null,
        shares: minutesShares(current.teamMinutes.get(teamId) as Map<string, number>),
      });
    }
  }
  return targets;
}

/** Keeps values only for players with at least `MIN_PRIOR_MINUTES` in season N. */
export function qualifyingValues(values: ReadonlyMap<string, number>, minutesInN: ReadonlyMap<string, number>): Map<string, number> {
  const kept = new Map<string, number>();
  for (const [athleteId, value] of values) {
    if ((minutesInN.get(athleteId) ?? 0) >= MIN_PRIOR_MINUTES) kept.set(athleteId, value);
  }
  return kept;
}

/** Season N to athlete to value at the end of N, already restricted to qualifying players. */
export type ValuesBySeason = Map<number, Map<string, number>>;

export type TargetRow = TeamLineRow & { teamId: string; season: number };

export function targetRows(targets: readonly TeamTarget[], values: ValuesBySeason): TargetRow[] {
  return targets.map((target) => {
    const prior = values.get(target.season - 1);
    if (!prior) throw new Error(`No values for season ${target.season - 1}.`);
    const feature = teamFeature(target.shares, (id) => prior.get(id) ?? null);
    // teamNet is read only by a line with a d term ("Game Score plus team net").
    return { teamId: target.teamId, season: target.season, actual: target.actual, ...feature, teamNet: target.lastAdjusted ?? 0 };
  });
}

export function rmseOf(errors: readonly number[]): number {
  return Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
}

/** Leave-one-season-out RMSE of the straight line: each season predicted from a line fitted on the others. */
export function leaveSeasonOutRmse(rows: readonly TargetRow[], options: { teamNet?: boolean } = {}): number {
  const seasons = [...new Set(rows.map((row) => row.season))].sort((a, b) => a - b);
  const errors: number[] = [];
  for (const season of seasons) {
    const line = fitTeamLine(
      rows.filter((row) => row.season !== season),
      options,
    );
    for (const row of rows) if (row.season === season) errors.push(row.actual - predictTeam(line, row));
  }
  return rmseOf(errors);
}

export type CoefficientSets = {
  score: BoxCoefficients;
  crossCheck: BoxCoefficients;
  roleAware: BoxCoefficients;
  teamNetOnly: BoxCoefficients;
  /** Hollinger Game Score in the score's frame: β all zero, `gameScore` = s. */
  gameScoreFrame: BoxCoefficients;
};

/** Metrics whose values come from the score's book (same φ, k, r). */
export const BOOK_METRICS = ["score", "crossCheck", "roleAware", "teamNetOnly", "gameScoreFrame"] as const;
export const COMPARATOR_METRICS = ["comparatorUnfloored", "comparatorFloored"] as const;
/**
 * "Game Score plus team net": the unfloored comparator's values with a fourth term in the
 * team line, d × the team's own adjusted net rating in season N.
 */
export const TEAM_NET_METRICS = ["gameScorePlusTeamNet"] as const;
export type BookMetric = (typeof BOOK_METRICS)[number];
export type ComparatorMetric = (typeof COMPARATOR_METRICS)[number];
export type TeamNetMetric = (typeof TEAM_NET_METRICS)[number];
export type Metric = BookMetric | ComparatorMetric | TeamNetMetric;
/** Every metric with a team line, in report order. */
export const METRICS: readonly Metric[] = [...BOOK_METRICS, ...COMPARATOR_METRICS, ...TEAM_NET_METRICS];

/** Whether a metric's team line carries the d × adjusted-net term. */
export function usesTeamNet(metric: Metric): boolean {
  return (TEAM_NET_METRICS as readonly string[]).includes(metric);
}

/** Values at the end of each season N in `seasonsN`, unrestricted (every player with a value). */
export function endOfSeasonBookValues(
  games: readonly ScoreGame[],
  seasonsN: readonly number[],
  coefficients: BoxCoefficients,
  params: BookParams,
): ValuesBySeason {
  const history = buildRatingHistory(games, coefficients);
  const output: ValuesBySeason = new Map();
  for (const season of seasonsN) {
    const values = endOfSeasonValues(history, season, params);
    output.set(season, new Map([...values].map(([id, value]) => [id, value.value])));
  }
  return output;
}

/** Production's comparator at the end of each season N, both forms. */
export function endOfSeasonComparator(
  games: readonly ScoreGame[],
  seasonsN: readonly number[],
): { unfloored: ValuesBySeason; floored: ValuesBySeason } {
  const wanted = new Set(seasonsN);
  const book: PlayerBook = new Map();
  const unfloored: ValuesBySeason = new Map();
  const floored: ValuesBySeason = new Map();
  const ordered = chronological(games);
  const snapshot = (season: number) => {
    const ids = [...book.keys()].sort();
    unfloored.set(season, new Map(ids.map((id) => [id, comparatorValue(book, id, false) as number])));
    floored.set(season, new Map(ids.map((id) => [id, comparatorValue(book, id, true) as number])));
  };
  ordered.forEach((game, index) => {
    recordComparatorGame(book, game);
    const next = ordered[index + 1];
    if ((!next || next.season !== game.season) && wanted.has(game.season)) snapshot(game.season);
  });
  return { unfloored, floored };
}

/** Every metric's qualifying values at the end of each season N. */
export function metricValues(
  games: readonly ScoreGame[],
  seasonsN: readonly number[],
  facts: ReadonlyMap<number, SeasonFacts>,
  coefficients: CoefficientSets,
  params: BookParams,
): Record<Metric, ValuesBySeason> {
  const restrict = (values: ValuesBySeason): ValuesBySeason =>
    new Map(
      [...values].map(([season, map]) => [season, qualifyingValues(map, (facts.get(season) as SeasonFacts).minutes)]),
    );
  const comparator = endOfSeasonComparator(games, seasonsN);
  const unfloored = restrict(comparator.unfloored);
  return {
    score: restrict(endOfSeasonBookValues(games, seasonsN, coefficients.score, params)),
    crossCheck: restrict(endOfSeasonBookValues(games, seasonsN, coefficients.crossCheck, params)),
    roleAware: restrict(endOfSeasonBookValues(games, seasonsN, coefficients.roleAware, params)),
    teamNetOnly: restrict(endOfSeasonBookValues(games, seasonsN, coefficients.teamNetOnly, params)),
    gameScoreFrame: restrict(endOfSeasonBookValues(games, seasonsN, coefficients.gameScoreFrame, params)),
    comparatorUnfloored: unfloored,
    comparatorFloored: restrict(comparator.floored),
    gameScorePlusTeamNet: unfloored,
  };
}

// ---------------------------------------------------------------------------
// Book tuning (training era only)
// ---------------------------------------------------------------------------

export const BOOK_GRID = {
  decay: [0, 0.25, 0.5, 0.75, 1],
  pseudoPossessions: [0, 250, 500, 1000, 2000, 4000, 8000],
  replacement: [-10, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1],
} as const;

export type BookTuning = {
  method: string;
  grid: typeof BOOK_GRID;
  /**
   * Per grid point: `rmse` is the criterion, the leave-one-season-out RMSE of game margins
   * predicted from the ratings held before each game; `endpointRmse` is the
   * leave-one-season-out RMSE of the season-to-season team prediction, reported so the
   * cost of the choice on the registered endpoint can be seen. Neither reads a test season.
   */
  table: Array<BookParams & { rmse: number; endpointRmse: number }>;
  chosen: BookParams & { rmse: number; endpointRmse: number };
};

/** Each side of a game: every player's share of the team's minutes and his pieces before the date. */
type SidePieces = Array<{ share: number; pieces: PieceRating[] }>;
type GamePieces = { gameId: string; season: number; actual: number; home: SidePieces; away: SidePieces };

/** One walk of the seasons, keeping what any (φ, k, r) needs to price every game. */
function collectGamePieces(games: readonly ScoreGame[], seasons: readonly number[], coefficients: BoxCoefficients): GamePieces[] {
  const collected: GamePieces[] = [];
  walkPieces(games, seasons, coefficients, (_season, _date, day, piecesOf) => {
    for (const game of day) {
      const side = (teamId: string): SidePieces =>
        minutesShares(new Map((game.box[teamId] ?? []).filter((l) => l.minutes > 0).map((l) => [l.athleteId, l.minutes]))).map(
          ({ athleteId, share }) => ({ share, pieces: piecesOf(athleteId) }),
        );
      collected.push({
        gameId: game.gameId,
        season: game.season,
        actual: game.homeScore - game.awayScore,
        home: side(game.homeId),
        away: side(game.awayId),
      });
    }
  });
  return collected;
}

function gameRowsFromPieces(collected: readonly GamePieces[], params: BookParams): GameRow[] {
  const feature = (side: SidePieces, season: number) => {
    let weighted = 0;
    let unknown = 0;
    for (const { share, pieces } of side) {
      if (pieces.length === 0) unknown += share;
      else weighted += share * combinePieces(pieces, season, params).value;
    }
    return { weighted, unknown };
  };
  return collected.map((game) => {
    const home = feature(game.home, game.season);
    const away = feature(game.away, game.season);
    return {
      gameId: game.gameId,
      season: game.season,
      actual: game.actual,
      weighted: home.weighted - away.weighted,
      unknown: home.unknown - away.unknown,
    };
  });
}

/** Leave-one-season-out RMSE of the game line: each season's games predicted from a line fitted on the others. */
function leaveSeasonOutGameRmse(rows: readonly GameRow[]): number {
  const seasons = [...new Set(rows.map((row) => row.season))].sort((a, b) => a - b);
  const errors: number[] = [];
  for (const season of seasons) {
    const line = fitTeamLine(rows.filter((row) => row.season !== season));
    for (const row of rows) if (row.season === season) errors.push(row.actual - predictTeam(line, row));
  }
  return rmseOf(errors);
}

/**
 * Grid search of φ, k and r. The criterion is in-season: the leave-one-season-out RMSE of
 * game margins predicted from the ratings each team's players held before the game, over
 * every training game. The site shows the rating on a date, and a criterion that only
 * looked at the end of a season would be blind to how the rating behaves in November (it
 * chose φ = 0, which leaves a player with no rating at all when a season starts). The
 * season-to-season team RMSE of each grid point is reported beside it.
 */
export function tuneBook(
  games: readonly ScoreGame[],
  targets: readonly TeamTarget[],
  facts: ReadonlyMap<number, SeasonFacts>,
  coefficients: BoxCoefficients,
): BookTuning {
  for (const target of targets) assertTrainingSeason(target.season);
  const targetSeasons = [...new Set(targets.map((t) => t.season))].sort((a, b) => a - b);
  const collected = collectGamePieces(games, targetSeasons, coefficients);
  const history = buildRatingHistory(games, coefficients);
  // For each N, every qualifying player's pieces from seasons ≤ N.
  const piecesByN = new Map<number, Map<string, PieceRating[]>>();
  for (const season of [...new Set(targets.map((t) => t.season - 1))]) {
    const minutes = (facts.get(season) as SeasonFacts).minutes;
    const map = new Map<string, PieceRating[]>();
    for (const [athleteId, played] of [...minutes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (played < MIN_PRIOR_MINUTES) continue;
      const pieces: PieceRating[] = [];
      for (const [pieceSeason, index] of [...history.bySeason].sort((a, b) => a[0] - b[0])) {
        if (pieceSeason <= season) pieces.push(...(index.get(athleteId) ?? []));
      }
      map.set(athleteId, pieces);
    }
    piecesByN.set(season, map);
  }
  const table: BookTuning["table"] = [];
  for (const decay of BOOK_GRID.decay) {
    for (const pseudoPossessions of BOOK_GRID.pseudoPossessions) {
      for (const replacement of BOOK_GRID.replacement) {
        const params = { decay, pseudoPossessions, replacement };
        const values: ValuesBySeason = new Map(
          [...piecesByN].map(([season, map]) => [
            season,
            new Map([...map].map(([id, pieces]) => [id, combinePieces(pieces, season, params).value])),
          ]),
        );
        table.push({
          ...params,
          rmse: leaveSeasonOutGameRmse(gameRowsFromPieces(collected, params)),
          endpointRmse: leaveSeasonOutRmse(targetRows(targets, values)),
        });
      }
    }
  }
  let chosen = table[0];
  for (const row of table) if (row.rmse < chosen.rmse - 1e-12) chosen = row;
  return {
    method:
      "leave-one-season-out RMSE of game margins, home + g·Δ(Σ share·v) + c·Δu, over training games, ratings held before each game; ties keep the earlier grid point",
    grid: BOOK_GRID,
    table,
    chosen,
  };
}

// ---------------------------------------------------------------------------
// Team-level results
// ---------------------------------------------------------------------------

export type TeamPrediction = { teamId: string; season: number; actual: number; predicted: number };

export function predictTargets(rows: readonly TargetRow[], line: TeamLine): TeamPrediction[] {
  return rows.map((row) => ({ teamId: row.teamId, season: row.season, actual: row.actual, predicted: predictTeam(line, row) }));
}

export function lastNetRows(targets: readonly TeamTarget[]): TargetRow[] {
  return targets.map((target) => ({
    teamId: target.teamId,
    season: target.season,
    actual: target.actual,
    weighted: target.lastNet ?? 0,
    unknown: 0,
  }));
}

export function rmseOfPredictions(predictions: readonly TeamPrediction[]): number {
  return rmseOf(predictions.map((p) => p.actual - p.predicted));
}

// ---------------------------------------------------------------------------
// The pass rule: three conditions, all required
// ---------------------------------------------------------------------------

export type PassConditions = {
  /** (i) RMSE(score) ≤ 0.90 × RMSE(comparator, unfloored): the owner's bar. */
  barVsComparator: { rmseScore: number; rmseComparator: number; ratio: number; bar: number; passed: boolean };
  /** (ii) RMSE(score) < RMSE(team-net-only ablation). */
  beatsTeamNetOnly: { rmseScore: number; rmseTeamNetOnly: number; passed: boolean };
  /** (iii) RMSE(score) < RMSE(last season's team net baseline). */
  beatsLastSeasonNet: { rmseScore: number; rmseLastSeasonNet: number; passed: boolean };
  /** All three hold. */
  passed: boolean;
};

/**
 * The registered pass rule. The score carries a share of last season's team net rating and
 * the comparator does not, so (i) alone could be met by team quality; (ii) and (iii)
 * require the box-score weights to add something beyond it.
 */
export function passConditions(rmse: Readonly<Record<"score" | "comparatorUnfloored" | "teamNetOnly" | "lastSeasonNet", number>>): PassConditions {
  const ratio = rmse.score / rmse.comparatorUnfloored;
  const barVsComparator = {
    rmseScore: rmse.score,
    rmseComparator: rmse.comparatorUnfloored,
    ratio,
    bar: BAR,
    passed: ratio <= BAR,
  };
  const beatsTeamNetOnly = { rmseScore: rmse.score, rmseTeamNetOnly: rmse.teamNetOnly, passed: rmse.score < rmse.teamNetOnly };
  const beatsLastSeasonNet = {
    rmseScore: rmse.score,
    rmseLastSeasonNet: rmse.lastSeasonNet,
    passed: rmse.score < rmse.lastSeasonNet,
  };
  return {
    barVsComparator,
    beatsTeamNetOnly,
    beatsLastSeasonNet,
    passed: barVsComparator.passed && beatsTeamNetOnly.passed && beatsLastSeasonNet.passed,
  };
}

/** Percentile with linear interpolation between order statistics (type 7). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export type RatioInterval = { draws: number; seed: string; low: number; median: number; high: number; shareAtOrBelowBar: number };

/**
 * Bootstrap of RMSE(new) / RMSE(comparator): resampling team-seasons, or whole seasons
 * (every team-season of a drawn season, with replacement over seasons).
 */
export function bootstrapRatio(
  primary: readonly TeamPrediction[],
  comparator: readonly TeamPrediction[],
  cluster: "team-season" | "season",
  seed: string,
): RatioInterval {
  const random = createSeededRandom(seed);
  const n = primary.length;
  const seasons = [...new Set(primary.map((p) => p.season))].sort((a, b) => a - b);
  const bySeason = new Map(seasons.map((season) => [season, primary.map((p, i) => (p.season === season ? i : -1)).filter((i) => i >= 0)]));
  const ratios: number[] = [];
  for (let draw = 0; draw < BOOTSTRAP_DRAWS; draw += 1) {
    const picks: number[] = [];
    if (cluster === "team-season") {
      for (let i = 0; i < n; i += 1) picks.push(Math.floor(random() * n));
    } else {
      for (let i = 0; i < seasons.length; i += 1) picks.push(...(bySeason.get(seasons[Math.floor(random() * seasons.length)]) as number[]));
    }
    const a = rmseOf(picks.map((i) => primary[i].actual - primary[i].predicted));
    const b = rmseOf(picks.map((i) => comparator[i].actual - comparator[i].predicted));
    ratios.push(a / b);
  }
  ratios.sort((x, y) => x - y);
  return {
    draws: BOOTSTRAP_DRAWS,
    seed,
    low: quantile(ratios, 0.025),
    median: quantile(ratios, 0.5),
    high: quantile(ratios, 0.975),
    shareAtOrBelowBar: ratios.filter((r) => r <= BAR).length / ratios.length,
  };
}

// ---------------------------------------------------------------------------
// Game-level check
// ---------------------------------------------------------------------------

export type GameRow = TeamLineRow & { gameId: string; season: number };

/**
 * One row per game: home minus away of Σ share × v (share of the team's minutes in that
 * game, v the value held before the game's date) and of u (the share of players with no
 * value yet), and the actual point margin. Fitted as
 * margin = home + g × Δweighted + c × Δunknown (`fitTeamLine`, with a as the home term).
 */
function gameRow(game: ScoreGame, valueOf: (id: string) => number | null): GameRow {
  const side = (teamId: string) =>
    teamFeature(
      minutesShares(new Map((game.box[teamId] ?? []).filter((l) => l.minutes > 0).map((l) => [l.athleteId, l.minutes]))),
      valueOf,
    );
  const home = side(game.homeId);
  const away = side(game.awayId);
  return {
    gameId: game.gameId,
    season: game.season,
    actual: game.homeScore - game.awayScore,
    weighted: home.weighted - away.weighted,
    unknown: home.unknown - away.unknown,
  };
}

/** Game rows for a box-score metric, values from the book before each date. */
export function bookGameRows(
  games: readonly ScoreGame[],
  seasons: readonly number[],
  coefficients: BoxCoefficients,
  params: BookParams,
): GameRow[] {
  const rows: GameRow[] = [];
  walkDates(games, seasons, coefficients, params, (_season, _date, day, valueOf) => {
    for (const game of day) rows.push(gameRow(game, (id) => valueOf(id)?.value ?? null));
  });
  return rows;
}

/** Game rows for the comparator, values from production's book before each date. */
export function comparatorGameRows(games: readonly ScoreGame[], seasons: readonly number[], floored: boolean): GameRow[] {
  const wanted = new Set(seasons);
  const book: PlayerBook = new Map();
  const rows: GameRow[] = [];
  const ordered = chronological(games);
  let cursor = 0;
  while (cursor < ordered.length) {
    const { season, etDate } = ordered[cursor];
    let end = cursor;
    while (end < ordered.length && ordered[end].season === season && ordered[end].etDate === etDate) end += 1;
    const day = ordered.slice(cursor, end);
    cursor = end;
    if (wanted.has(season)) for (const game of day) rows.push(gameRow(game, (id) => comparatorValue(book, id, floored)));
    for (const game of day) recordComparatorGame(book, game);
  }
  return rows;
}

export function meanAbsoluteError(rows: readonly TeamLineRow[], line: TeamLine): number {
  return rows.reduce((sum, row) => sum + Math.abs(row.actual - predictTeam(line, row)), 0) / rows.length;
}

// ---------------------------------------------------------------------------
// RAPM windows
// ---------------------------------------------------------------------------

export function windowRapm(games: readonly ScoreGame[], seasons: readonly number[], penalties: RapmPenalties): Map<string, RapmPlayer> {
  const wanted = new Set(seasons);
  const fit = fitRapm(buildRapmDesign(games.filter((game) => wanted.has(game.season))), penalties);
  return new Map(fit.players.map((player) => [player.athleteId, player]));
}

// ---------------------------------------------------------------------------
// Owner checks
// ---------------------------------------------------------------------------

export const OWNER_GROUPS = [
  "highAssistCentres",
  "highReboundGuards",
  "inefficientVolumeScorers",
  "defenceFirstPlayers",
  "statAccumulators",
  "lowUsageRolePlayers",
] as const;
export type OwnerGroup = (typeof OWNER_GROUPS)[number];

export type PlayerSeason = {
  athleteId: string;
  season: number;
  minutes: number;
  games: number;
  possessions: number;
  position: "G" | "F" | "C";
  assistsPer100: number;
  reboundsPer100: number;
  /** FGA + 0.44 × FTA per 100 on-court possessions. */
  shotAttemptsPer100: number;
  trueShooting: number;
  gameScorePerMinute: number;
};

const STAT = (name: (typeof BOX_STATS)[number]) => BOX_STATS.indexOf(name);

/** Player-seasons with at least `OWNER_CHECK_MIN_MINUTES`, summed over teams. */
export function playerSeasons(facts: SeasonFacts): PlayerSeason[] {
  const sums = new Map<string, { minutes: number; games: number; possessions: number; stats: number[]; gameScore: number; positions: Record<string, number> }>();
  for (const key of [...facts.totals.pieces.keys()].sort()) {
    const piece = facts.totals.pieces.get(key);
    if (!piece) continue;
    const sum = sums.get(piece.athleteId) ?? { minutes: 0, games: 0, possessions: 0, stats: BOX_STATS.map(() => 0), gameScore: 0, positions: {} };
    sum.minutes += piece.minutes;
    sum.games += piece.games;
    sum.possessions += piece.possessions;
    sum.gameScore += piece.gameScore;
    piece.stats.forEach((value, k) => {
      sum.stats[k] += value;
    });
    for (const [position, count] of Object.entries(piece.positions)) sum.positions[position] = (sum.positions[position] ?? 0) + count;
    sums.set(piece.athleteId, sum);
  }
  const output: PlayerSeason[] = [];
  for (const [athleteId, sum] of sums) {
    if (sum.minutes < OWNER_CHECK_MIN_MINUTES || !(sum.possessions > 0)) continue;
    const per100 = (value: number) => (100 * value) / sum.possessions;
    const attempts = sum.stats[STAT("fieldGoalsAttempted")] + 0.44 * sum.stats[STAT("freeThrowsAttempted")];
    output.push({
      athleteId,
      season: facts.season,
      minutes: sum.minutes,
      games: sum.games,
      possessions: sum.possessions,
      position: positionClass(modalPosition(sum.positions)),
      assistsPer100: per100(sum.stats[STAT("assists")]),
      reboundsPer100: per100(sum.stats[STAT("offensiveRebounds")] + sum.stats[STAT("defensiveRebounds")]),
      shotAttemptsPer100: per100(attempts),
      trueShooting: attempts > 0 ? sum.stats[STAT("points")] / (2 * attempts) : 0,
      gameScorePerMinute: sum.gameScore / sum.minutes,
    });
  }
  return output.sort((a, b) => (a.athleteId < b.athleteId ? -1 : 1));
}

/** Members of each group in one season, by the mechanical definitions in the registration. */
export function ownerGroups(players: readonly PlayerSeason[], defensiveRapm: ReadonlyMap<string, number>): Record<OwnerGroup, PlayerSeason[]> {
  const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
  const centres = players.filter((p) => p.position === "C");
  const guards = players.filter((p) => p.position === "G");
  const attempts = sorted(players.map((p) => p.shotAttemptsPer100));
  const shooting = sorted(players.map((p) => p.trueShooting));
  const withRapm = players.filter((p) => defensiveRapm.has(p.athleteId));
  const defence = sorted(withRapm.map((p) => defensiveRapm.get(p.athleteId) as number));
  const assistCut = quantile(sorted(centres.map((p) => p.assistsPer100)), 0.8);
  const reboundCut = quantile(sorted(guards.map((p) => p.reboundsPer100)), 0.8);
  const gameScoreCut = quantile(sorted(players.map((p) => p.gameScorePerMinute)), 0.9);
  return {
    highAssistCentres: centres.filter((p) => p.assistsPer100 >= assistCut),
    highReboundGuards: guards.filter((p) => p.reboundsPer100 >= reboundCut),
    inefficientVolumeScorers: players.filter(
      (p) => p.shotAttemptsPer100 >= quantile(attempts, 0.8) && p.trueShooting <= quantile(shooting, 1 / 3),
    ),
    defenceFirstPlayers: withRapm.filter(
      (p) => (defensiveRapm.get(p.athleteId) as number) >= quantile(defence, 0.8) && p.shotAttemptsPer100 < quantile(attempts, 0.5),
    ),
    statAccumulators: players.filter((p) => p.gameScorePerMinute >= gameScoreCut),
    lowUsageRolePlayers: players.filter((p) => p.shotAttemptsPer100 <= quantile(attempts, 1 / 3) && p.minutes / p.games >= 24),
  };
}

export type OwnerCheckResult = {
  group: OwnerGroup;
  /** Player-seasons in the group with a RAPM total and both ratings. */
  size: number;
  /** Mean of (score − RAPM total), score in its own units. */
  score: number | null;
  /** Mean of ((a + b·v) / 5 − RAPM total), each metric through its frozen team line. */
  scoreMapped: number | null;
  comparatorMapped: number | null;
};

/**
 * The six owner checks on player-seasons in `seasons`. Values are each metric's end-of-season
 * value (unrestricted by the 250-minute rule; the 1,000-minute rule applies). RAPM is the
 * three-season window containing the season.
 */
export function ownerChecks(
  factsBySeason: ReadonlyMap<number, SeasonFacts>,
  seasons: readonly number[],
  rapmBySeason: ReadonlyMap<number, ReadonlyMap<string, RapmPlayer>>,
  score: ValuesBySeason,
  comparator: ValuesBySeason,
  scoreLine: TeamLine,
  comparatorLine: TeamLine,
): OwnerCheckResult[] {
  const sums = new Map(OWNER_GROUPS.map((group) => [group, { n: 0, raw: 0, mapped: 0, comparator: 0 }]));
  for (const season of seasons) {
    const rapm = rapmBySeason.get(season);
    const facts = factsBySeason.get(season);
    if (!rapm || !facts) throw new Error(`Owner checks need RAPM and facts for ${season}.`);
    const defence = new Map([...rapm].map(([id, player]) => [id, player.defence]));
    const groups = ownerGroups(playerSeasons(facts), defence);
    for (const group of OWNER_GROUPS) {
      const sum = sums.get(group) as { n: number; raw: number; mapped: number; comparator: number };
      for (const player of groups[group]) {
        const target = rapm.get(player.athleteId)?.total;
        const v = score.get(season)?.get(player.athleteId);
        const c = comparator.get(season)?.get(player.athleteId);
        if (target === undefined || v === undefined || c === undefined) continue;
        sum.n += 1;
        sum.raw += v - target;
        sum.mapped += (scoreLine.a + scoreLine.b * v) / 5 - target;
        sum.comparator += (comparatorLine.a + comparatorLine.b * c) / 5 - target;
      }
    }
  }
  return OWNER_GROUPS.map((group) => {
    const sum = sums.get(group) as { n: number; raw: number; mapped: number; comparator: number };
    return {
      group,
      size: sum.n,
      score: sum.n > 0 ? sum.raw / sum.n : null,
      scoreMapped: sum.n > 0 ? sum.mapped / sum.n : null,
      comparatorMapped: sum.n > 0 ? sum.comparator / sum.n : null,
    };
  });
}

/** Unrestricted end-of-season values for the owner checks: score book and unfloored comparator. */
export function ownerCheckValues(
  games: readonly ScoreGame[],
  seasons: readonly number[],
  coefficients: BoxCoefficients,
  params: BookParams,
): { score: ValuesBySeason; comparator: ValuesBySeason } {
  return {
    score: endOfSeasonBookValues(games, seasons, coefficients, params),
    comparator: endOfSeasonComparator(games, seasons).unfloored,
  };
}
