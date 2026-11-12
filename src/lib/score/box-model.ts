// Stage 1 of the 548 score: a box-score model with the same coefficients for every
// position, fitted to on-court results from lineups. Pure: no fetch, no file access, no
// clock; the only randomness is the seeded fold assignment.
//
// Possessions. A team's possessions in a game are the mean of the two teams'
// FGA − ORB + TOV + 0.44 × FTA. A player's on-court possessions are team possessions ×
// his minutes / (team minutes / 5), so a team's players add up to five times its
// possessions.
//
// A piece is one (player, team, season): sums of his counting stats and on-court
// possessions. A team-season has the same sums over all its players, its net rating
// 100 × (points − opponent points) / possessions, and an opponent-adjusted net rating
// (`adjustedNetRatings`).
//
// Rating of a piece: adjustedNet_t / 5 + Σ_k β_k (x_ik − x̄_tk), with x_ik = 100 × stat /
// on-court possessions and x̄_tk = 100 × team stat / (5 × team possessions). Because the
// rates are possession-weighted means, a team's possession-weighted ratings times five
// equal its adjusted net rating exactly, whatever β is.
//
// Estimators:
//   primary      lineup regression: stint margin per 100 on the five-versus-five sums of
//                within-team rate deviations, with the two teams' adjusted nets as an
//                offset of coefficient one, all computed with the stint's own game left
//                out (`lineupRows`, `fitLineupModel`);
//   cross-check  regression of multi-season RAPM totals on the same deviations
//                (`rapmTargetRows`, `fitRapmTargetModel`); reported, not published;
//   role-aware   the primary plus position interactions for assists, rebounds, steals
//                and blocks, with a stronger ridge; a comparison only.

import { createSeededRandom } from "@/lib/model/random";
import { gameScore } from "@/lib/season/box-scores";
import type { PlayerBoxLine } from "@/lib/season/player-stats";
import { solveSymmetric } from "@/lib/score/rapm";
import type { ScoreGame } from "@/lib/score/types";

// ---------------------------------------------------------------------------
// Stats and positions
// ---------------------------------------------------------------------------

/** The counting stats of the model, in coefficient order. */
export const BOX_STATS = [
  "points",
  "fieldGoalsAttempted",
  "freeThrowsAttempted",
  "threePointersMade",
  "assists",
  "turnovers",
  "offensiveRebounds",
  "defensiveRebounds",
  "steals",
  "blocks",
  "fouls",
] as const satisfies readonly (keyof PlayerBoxLine)[];

export type BoxStat = (typeof BOX_STATS)[number];
export const STAT_COUNT = BOX_STATS.length;

/** Stats whose coefficient the role-aware variant lets vary with position. */
export const ROLE_STATS = ["assists", "offensiveRebounds", "defensiveRebounds", "steals", "blocks"] as const;
export const ROLE_INDEX: readonly number[] = ROLE_STATS.map((stat) => BOX_STATS.indexOf(stat));

/**
 * ESPN position abbreviation to a number on a guard-to-centre line: G = 1, F = 3, C = 5.
 * The live season's lines carry only G, F, C and "NA"; older summaries may carry the
 * five classic positions and hybrids, which map onto the same three-level scale so a
 * fit on old seasons means the same on live ones: PG and SG are guards (1), SF and PF
 * forwards (3), G-F hybrids 2 and F-C hybrids 4. Anything else, or null, is 3.
 */
export function positionNumber(position: string | null): number {
  switch ((position ?? "").trim().toUpperCase()) {
    case "G":
    case "PG":
    case "SG":
      return 1;
    case "GF":
    case "G-F":
    case "G/F":
    case "F-G":
      return 2;
    case "FC":
    case "F-C":
    case "F/C":
    case "C-F":
      return 4;
    case "C":
      return 5;
    default:
      return 3;
  }
}

/** The most frequent position string among votes; ties go to the alphabetically first. */
export function modalPosition(votes: Readonly<Record<string, number>>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const key of Object.keys(votes).sort()) {
    if (votes[key] > bestCount) {
      best = key;
      bestCount = votes[key];
    }
  }
  return best === "" ? null : best;
}

/** Guard, forward or centre, for the owner checks: 1–1.5 G, 4.5–5 C, else F. */
export function positionClass(position: string | null): "G" | "F" | "C" {
  const value = positionNumber(position);
  if (value <= 1.5) return "G";
  if (value >= 4.5) return "C";
  return "F";
}

// ---------------------------------------------------------------------------
// One game
// ---------------------------------------------------------------------------

/** FGA − ORB + TOV + 0.44 × FTA over a team's lines. */
export function teamPossessionEstimate(lines: readonly PlayerBoxLine[]): number {
  let total = 0;
  for (const line of lines) {
    total += line.fieldGoalsAttempted - line.offensiveRebounds + line.turnovers + 0.44 * line.freeThrowsAttempted;
  }
  return total;
}

export type PlayerGameLine = {
  athleteId: string;
  minutes: number;
  possessions: number;
  /** In `BOX_STATS` order. */
  stats: number[];
  /** Hollinger Game Score, unrounded. */
  gameScore: number;
  position: string | null;
};

export type TeamGame = {
  teamId: string;
  opponentId: string;
  /** The game's possessions, shared by both teams. */
  possessions: number;
  minutes: number;
  points: number;
  opponentPoints: number;
  /** Players with positive minutes. */
  lines: PlayerGameLine[];
};

/** Both teams' lines of a game, home first. Lines without positive minutes are dropped, as production does. */
export function teamGames(game: ScoreGame): [TeamGame, TeamGame] {
  const homeLines = (game.box[game.homeId] ?? []).filter((line) => line.minutes > 0);
  const awayLines = (game.box[game.awayId] ?? []).filter((line) => line.minutes > 0);
  const possessions = (teamPossessionEstimate(homeLines) + teamPossessionEstimate(awayLines)) / 2;
  const side = (
    teamId: string,
    opponentId: string,
    lines: PlayerBoxLine[],
    points: number,
    opponentPoints: number,
  ): TeamGame => {
    const minutes = lines.reduce((total, line) => total + line.minutes, 0);
    return {
      teamId,
      opponentId,
      possessions,
      minutes,
      points,
      opponentPoints,
      lines: lines.map((line) => ({
        athleteId: line.athleteId,
        minutes: line.minutes,
        possessions: minutes > 0 ? (possessions * line.minutes) / (minutes / 5) : 0,
        stats: BOX_STATS.map((stat) => line[stat]),
        gameScore: gameScore(line),
        position: line.position,
      })),
    };
  };
  return [
    side(game.homeId, game.awayId, homeLines, game.homeScore, game.awayScore),
    side(game.awayId, game.homeId, awayLines, game.awayScore, game.homeScore),
  ];
}

// ---------------------------------------------------------------------------
// Season sums
// ---------------------------------------------------------------------------

export type Piece = {
  athleteId: string;
  teamId: string;
  season: number;
  games: number;
  minutes: number;
  possessions: number;
  stats: number[];
  gameScore: number;
  /** Position string (or "" for null) to the number of games listed at it. */
  positions: Record<string, number>;
};

export type TeamSeason = {
  teamId: string;
  season: number;
  games: number;
  minutes: number;
  /** Team possessions (the sum of each game's possessions). */
  possessions: number;
  points: number;
  opponentPoints: number;
  /** Sums over the team's players, in `BOX_STATS` order. */
  stats: number[];
  /** Opponent ID to the possessions played against it. */
  opponents: Record<string, number>;
};

export type SeasonTotals = {
  season: number;
  /** Keyed by `pieceKey(teamId, athleteId)`. */
  pieces: Map<string, Piece>;
  teams: Map<string, TeamSeason>;
  /** Through which date (exclusive) games were added, or null for no limit. */
  before: string | null;
};

export function pieceKey(teamId: string, athleteId: string): string {
  return `${teamId}|${athleteId}`;
}

export function createSeasonTotals(season: number, before: string | null = null): SeasonTotals {
  return { season, pieces: new Map(), teams: new Map(), before };
}

/** Adds one game's lines to the season sums. */
export function addGameToTotals(totals: SeasonTotals, game: ScoreGame): void {
  for (const side of teamGames(game)) {
    const team = totals.teams.get(side.teamId) ?? {
      teamId: side.teamId,
      season: totals.season,
      games: 0,
      minutes: 0,
      possessions: 0,
      points: 0,
      opponentPoints: 0,
      stats: new Array<number>(STAT_COUNT).fill(0),
      opponents: {},
    };
    team.games += 1;
    team.minutes += side.minutes;
    team.possessions += side.possessions;
    team.points += side.points;
    team.opponentPoints += side.opponentPoints;
    team.opponents[side.opponentId] = (team.opponents[side.opponentId] ?? 0) + side.possessions;
    for (const line of side.lines) {
      const key = pieceKey(side.teamId, line.athleteId);
      const piece = totals.pieces.get(key) ?? {
        athleteId: line.athleteId,
        teamId: side.teamId,
        season: totals.season,
        games: 0,
        minutes: 0,
        possessions: 0,
        stats: new Array<number>(STAT_COUNT).fill(0),
        gameScore: 0,
        positions: {},
      };
      piece.games += 1;
      piece.minutes += line.minutes;
      piece.possessions += line.possessions;
      piece.gameScore += line.gameScore;
      const position = line.position ?? "";
      piece.positions[position] = (piece.positions[position] ?? 0) + 1;
      for (let k = 0; k < STAT_COUNT; k += 1) {
        piece.stats[k] += line.stats[k];
        team.stats[k] += line.stats[k];
      }
      totals.pieces.set(key, piece);
    }
    totals.teams.set(side.teamId, team);
  }
}

/** One season's sums from its games, optionally only games before an ET date. */
export function buildSeasonTotals(games: readonly ScoreGame[], season: number, before: string | null = null): SeasonTotals {
  const totals = createSeasonTotals(season, before);
  for (const game of games) {
    if (game.season !== season) continue;
    if (before !== null && game.etDate >= before) continue;
    addGameToTotals(totals, game);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Team ratings
// ---------------------------------------------------------------------------

export function netRating(team: Pick<TeamSeason, "possessions" | "points" | "opponentPoints">): number {
  return team.possessions > 0 ? (100 * (team.points - team.opponentPoints)) / team.possessions : 0;
}

const SOS_TOLERANCE = 1e-10;
const SOS_MAX_ITERATIONS = 2000;

/**
 * Opponent-adjusted net rating, a possession-weighted simple rating system:
 *
 *   adj_t = net_t + Σ_o w_to adj_o / Σ_o w_to,
 *
 * where w_to is the possessions t played against o. A team that played strong opponents
 * is credited with their strength. Solved by damped fixed-point iteration (half old, half
 * new, which avoids oscillation on near-bipartite early-season schedules) from `start`
 * (default: adj = net), until no value moves by more than 1e-10 or 2,000 rounds. Because
 * every game is inside one connected group of teams, the possession-weighted mean of adj
 * stays zero in each group (as the mean of net is), so no centring is needed. Home court
 * is ignored: over a season schedules are close to balanced home and away.
 */
export function adjustedNetRatings(
  teams: Iterable<TeamSeason>,
  start?: ReadonlyMap<string, number>,
): Map<string, number> {
  const list = [...teams].sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));
  const net = list.map((team) => netRating(team));
  const index = new Map(list.map((team, i) => [team.teamId, i]));
  const schedule = list.map((team) =>
    Object.keys(team.opponents)
      .sort()
      .filter((id) => index.has(id) && team.opponents[id] > 0)
      .map((id) => ({ opponent: index.get(id) as number, weight: team.opponents[id] })),
  );
  const totalWeight = schedule.map((rows) => rows.reduce((sum, row) => sum + row.weight, 0));
  let current = list.map((team, i) => start?.get(team.teamId) ?? net[i]);
  for (let round = 0; round < SOS_MAX_ITERATIONS; round += 1) {
    let change = 0;
    const next = current.map((value, i) => {
      let strength = 0;
      for (const row of schedule[i]) strength += row.weight * current[row.opponent];
      const target = net[i] + (totalWeight[i] > 0 ? strength / totalWeight[i] : 0);
      const updated = 0.5 * value + 0.5 * target;
      change = Math.max(change, Math.abs(updated - value));
      return updated;
    });
    current = next;
    if (change < SOS_TOLERANCE) break;
  }
  return new Map(list.map((team, i) => [team.teamId, current[i]]));
}

/** A team-season with one game's result removed. */
export function teamWithoutGame(team: TeamSeason, side: TeamGame): TeamSeason {
  const opponents = { ...team.opponents };
  opponents[side.opponentId] = (opponents[side.opponentId] ?? 0) - side.possessions;
  const stats = team.stats.slice();
  for (const line of side.lines) for (let k = 0; k < STAT_COUNT; k += 1) stats[k] -= line.stats[k];
  return {
    ...team,
    games: team.games - 1,
    minutes: team.minutes - side.minutes,
    possessions: team.possessions - side.possessions,
    points: team.points - side.points,
    opponentPoints: team.opponentPoints - side.opponentPoints,
    stats,
    opponents,
  };
}

// ---------------------------------------------------------------------------
// Ratings of pieces
// ---------------------------------------------------------------------------

export type BoxCoefficients = {
  /** One per `BOX_STATS` entry. */
  beta: readonly number[];
  /** Role-aware variant only: one per `ROLE_STATS` entry, on (position − 3) × deviation. */
  role?: readonly number[] | null;
};

/** Sums enough to compute rates: a piece or a team, possibly with a game left out. */
type RateSums = { possessions: number; stats: readonly number[] };

/** x_ik − x̄_tk for every stat; zero when either side has no possessions. */
export function rateDeviation(player: RateSums, team: RateSums): number[] {
  const deviation = new Array<number>(STAT_COUNT).fill(0);
  if (!(player.possessions > 0) || !(team.possessions > 0)) return deviation;
  for (let k = 0; k < STAT_COUNT; k += 1) {
    deviation[k] = (100 * player.stats[k]) / player.possessions - (100 * team.stats[k]) / (5 * team.possessions);
  }
  return deviation;
}

export type RatedPlayer = {
  athleteId: string;
  possessions: number;
  deviation: number[];
  /** Role-aware regressors: (position − 3) × deviation, centred within the team. */
  role: number[];
};

/**
 * Every player of a team with his deviations and centred role regressors. `players` are
 * the team's pieces (or leave-one-out copies); `team` the team's sums on the same basis.
 */
export function teamRegressors(
  players: ReadonlyArray<RateSums & { athleteId: string; position: string | null }>,
  team: RateSums,
): RatedPlayer[] {
  const rated = players.map((player) => {
    const deviation = rateDeviation(player, team);
    const offset = positionNumber(player.position) - 3;
    return {
      athleteId: player.athleteId,
      possessions: player.possessions,
      deviation,
      role: ROLE_INDEX.map((k) => offset * deviation[k]),
    };
  });
  // Centre the role regressors so a team's possession-weighted sum stays zero.
  let weight = 0;
  const mean = new Array<number>(ROLE_INDEX.length).fill(0);
  for (const player of rated) {
    if (!(player.possessions > 0)) continue;
    weight += player.possessions;
    for (let j = 0; j < mean.length; j += 1) mean[j] += player.possessions * player.role[j];
  }
  if (weight > 0) {
    for (let j = 0; j < mean.length; j += 1) mean[j] /= weight;
    for (const player of rated) {
      if (!(player.possessions > 0)) continue;
      for (let j = 0; j < mean.length; j += 1) player.role[j] -= mean[j];
    }
  }
  return rated;
}

export function ratingFromRegressors(adjustedNet: number, player: RatedPlayer, coefficients: BoxCoefficients): number {
  let rating = adjustedNet / 5;
  for (let k = 0; k < STAT_COUNT; k += 1) rating += coefficients.beta[k] * player.deviation[k];
  if (coefficients.role) {
    for (let j = 0; j < ROLE_INDEX.length; j += 1) rating += coefficients.role[j] * player.role[j];
  }
  return rating;
}

export type PieceRating = {
  athleteId: string;
  teamId: string;
  season: number;
  possessions: number;
  minutes: number;
  rating: number;
};

/** Every piece's rating in a season, sorted by team then athlete. */
export function seasonPieceRatings(
  totals: SeasonTotals,
  coefficients: BoxCoefficients,
  adjusted: ReadonlyMap<string, number> = adjustedNetRatings(totals.teams.values()),
): PieceRating[] {
  const byTeam = new Map<string, Piece[]>();
  for (const piece of totals.pieces.values()) {
    const list = byTeam.get(piece.teamId) ?? [];
    list.push(piece);
    byTeam.set(piece.teamId, list);
  }
  const output: PieceRating[] = [];
  for (const teamId of [...byTeam.keys()].sort()) {
    const team = totals.teams.get(teamId) as TeamSeason;
    const pieces = (byTeam.get(teamId) as Piece[]).sort((a, b) => (a.athleteId < b.athleteId ? -1 : 1));
    const rated = teamRegressors(
      pieces.map((piece) => ({ ...piece, position: modalPosition(piece.positions) })),
      team,
    );
    const net = adjusted.get(teamId) ?? 0;
    rated.forEach((player, index) => {
      output.push({
        athleteId: player.athleteId,
        teamId,
        season: totals.season,
        possessions: pieces[index].possessions,
        minutes: pieces[index].minutes,
        rating: ratingFromRegressors(net, player, coefficients),
      });
    });
  }
  return output;
}

// ---------------------------------------------------------------------------
// Lineup regression (primary and role-aware)
// ---------------------------------------------------------------------------

export type LineupRows = {
  /** Game ID of each game with stints, in input order; `rowGame` indexes it. */
  gameIds: string[];
  rowCount: number;
  rowGame: Int32Array;
  /** Mean of the two sides' possessions in the stint. */
  weight: Float64Array;
  /** Home minus away points per 100 possessions. */
  margin: Float64Array;
  /** adjNet_H − adjNet_A, both from the season with the game left out (exact SRS re-solve). */
  offset: Float64Array;
  /** Row-major, `featureCount` per row: 11 deviations, then 5 role regressors when role-aware. */
  features: Float64Array;
  featureCount: number;
  featureNames: string[];
};

/** A team's regressors with one game's own lines removed. */
function regressorsWithoutGame(totals: SeasonTotals, side: TeamGame, team: TeamSeason): Map<string, RatedPlayer> {
  const own = new Map(side.lines.map((line) => [line.athleteId, line]));
  const players: Array<RateSums & { athleteId: string; position: string | null }> = [];
  for (const piece of totals.pieces.values()) {
    if (piece.teamId !== side.teamId) continue;
    const line = own.get(piece.athleteId);
    const positions = { ...piece.positions };
    if (line) positions[line.position ?? ""] -= 1;
    players.push({
      athleteId: piece.athleteId,
      possessions: line ? piece.possessions - line.possessions : piece.possessions,
      stats: line ? piece.stats.map((value, k) => value - line.stats[k]) : piece.stats,
      position: modalPosition(positions) ?? modalPosition(piece.positions),
    });
  }
  players.sort((a, b) => (a.athleteId < b.athleteId ? -1 : 1));
  return new Map(teamRegressors(players, team).map((player) => [player.athleteId, player]));
}

const MAIN_FEATURES = BOX_STATS.map((stat) => stat);
const ROLE_FEATURES = ROLE_STATS.map((stat) => `position × ${stat}`);

/**
 * One row per stint with possessions: response margin − offset, weight mean possessions,
 * regressors the home five's sums minus the away five's, everything computed from season
 * sums with the stint's own game left out. Seasons are handled separately.
 */
export function lineupRows(games: readonly ScoreGame[], options: { roleAware: boolean }): LineupRows {
  const featureCount = STAT_COUNT + (options.roleAware ? ROLE_INDEX.length : 0);
  const seasons = [...new Set(games.map((game) => game.season))].sort((a, b) => a - b);
  const totalsBySeason = new Map(seasons.map((season) => [season, buildSeasonTotals(games, season)]));
  const adjustedBySeason = new Map(
    seasons.map((season) => {
      const totals = totalsBySeason.get(season) as SeasonTotals;
      return [season, adjustedNetRatings(totals.teams.values())];
    }),
  );
  const gameIds: string[] = [];
  const rowGame: number[] = [];
  const weight: number[] = [];
  const margin: number[] = [];
  const offset: number[] = [];
  const features: number[] = [];
  for (const game of games) {
    if (game.stints === null) continue;
    const gameIndex = gameIds.length;
    gameIds.push(game.gameId);
    const totals = totalsBySeason.get(game.season) as SeasonTotals;
    const adjusted = adjustedBySeason.get(game.season) as Map<string, number>;
    const [homeSide, awaySide] = teamGames(game);
    // Season sums without this game: its own lines, its result and its schedule entry.
    const homeTeam = teamWithoutGame(totals.teams.get(game.homeId) as TeamSeason, homeSide);
    const awayTeam = teamWithoutGame(totals.teams.get(game.awayId) as TeamSeason, awaySide);
    const teams = [...totals.teams.values()].map((team) =>
      team.teamId === game.homeId ? homeTeam : team.teamId === game.awayId ? awayTeam : team,
    );
    const adjustedWithout = adjustedNetRatings(teams, adjusted);
    const home = { regressors: regressorsWithoutGame(totals, homeSide, homeTeam), adjustedNet: adjustedWithout.get(game.homeId) ?? 0 };
    const away = { regressors: regressorsWithoutGame(totals, awaySide, awayTeam), adjustedNet: adjustedWithout.get(game.awayId) ?? 0 };
    const vector = (player: RatedPlayer | undefined): number[] =>
      player
        ? options.roleAware
          ? [...player.deviation, ...player.role]
          : player.deviation
        : new Array<number>(featureCount).fill(0);
    for (const stint of game.stints) {
      const possessions = (stint.homePossessions + stint.awayPossessions) / 2;
      if (!(possessions > 0)) continue;
      const row = new Array<number>(featureCount).fill(0);
      for (const id of stint.home) {
        const values = vector(home.regressors.get(id));
        for (let k = 0; k < featureCount; k += 1) row[k] += values[k];
      }
      for (const id of stint.away) {
        const values = vector(away.regressors.get(id));
        for (let k = 0; k < featureCount; k += 1) row[k] -= values[k];
      }
      rowGame.push(gameIndex);
      weight.push(possessions);
      margin.push((100 * (stint.homePoints - stint.awayPoints)) / possessions);
      offset.push(home.adjustedNet - away.adjustedNet);
      features.push(...row);
    }
  }
  return {
    gameIds,
    rowCount: weight.length,
    rowGame: Int32Array.from(rowGame),
    weight: Float64Array.from(weight),
    margin: Float64Array.from(margin),
    offset: Float64Array.from(offset),
    features: Float64Array.from(features),
    featureCount,
    featureNames: options.roleAware ? [...MAIN_FEATURES, ...ROLE_FEATURES] : [...MAIN_FEATURES],
  };
}

/**
 * Ridge penalties, relative to scale: the penalty on coefficient k is α × (ZᵀWZ)_kk, so
 * α = 0.01 shrinks a lone regressor's coefficient by about 1%, whatever its units.
 */
export type LineupPenalty = { alpha: number; roleAlpha: number };

export type LineupFit = {
  /** Home-court term, points per 100 possessions. */
  home: number;
  beta: number[];
  role: number[] | null;
  penalty: LineupPenalty;
  rows: number;
  /** Possession-weighted mean squared residual of the fitted rows. */
  meanSquaredError: number;
};

function lineupNormalEquations(rows: LineupRows, include: (row: number) => boolean) {
  const p = rows.featureCount + 1;
  const matrix = new Float64Array(p * p);
  const rhs = new Float64Array(p);
  const x = new Float64Array(p);
  for (let row = 0; row < rows.rowCount; row += 1) {
    if (!include(row)) continue;
    x[0] = 1;
    for (let k = 0; k < rows.featureCount; k += 1) x[k + 1] = rows.features[row * rows.featureCount + k];
    const w = rows.weight[row];
    const y = rows.margin[row] - rows.offset[row];
    for (let a = 0; a < p; a += 1) {
      rhs[a] += w * x[a] * y;
      for (let b = 0; b <= a; b += 1) matrix[a * p + b] += w * x[a] * x[b];
    }
  }
  return { p, matrix, rhs };
}

function solveLineup(
  rows: LineupRows,
  equations: { p: number; matrix: Float64Array; rhs: Float64Array },
  penalty: LineupPenalty,
): Float64Array {
  const { p } = equations;
  const matrix = Float64Array.from(equations.matrix);
  for (let k = 1; k < p; k += 1) {
    const alpha = k - 1 < STAT_COUNT ? penalty.alpha : penalty.roleAlpha;
    // A regressor that is zero everywhere would leave the system singular; pin it at 0.
    matrix[k * p + k] = equations.matrix[k * p + k] > 0 ? equations.matrix[k * p + k] * (1 + alpha) : 1;
  }
  return solveSymmetric(matrix, p, equations.rhs);
}

function readLineupFit(rows: LineupRows, theta: Float64Array, penalty: LineupPenalty, mse: number): LineupFit {
  const beta = Array.from(theta.slice(1, 1 + STAT_COUNT));
  const role = rows.featureCount > STAT_COUNT ? Array.from(theta.slice(1 + STAT_COUNT)) : null;
  return { home: theta[0], beta, role, penalty, rows: rows.rowCount, meanSquaredError: mse };
}

function lineupLoss(rows: LineupRows, theta: Float64Array, include: (row: number) => boolean): number {
  let squared = 0;
  let weight = 0;
  for (let row = 0; row < rows.rowCount; row += 1) {
    if (!include(row)) continue;
    let prediction = theta[0] + rows.offset[row];
    for (let k = 0; k < rows.featureCount; k += 1) prediction += theta[k + 1] * rows.features[row * rows.featureCount + k];
    const error = rows.margin[row] - prediction;
    squared += rows.weight[row] * error * error;
    weight += rows.weight[row];
  }
  return weight > 0 ? squared / weight : Number.NaN;
}

export function fitLineupModel(rows: LineupRows, penalty: LineupPenalty): LineupFit {
  const all = () => true;
  const theta = solveLineup(rows, lineupNormalEquations(rows, all), penalty);
  return readLineupFit(rows, theta, penalty, lineupLoss(rows, theta, all));
}

/** Fold of each index: a seeded shuffle of the sorted keys, dealt round-robin. */
export function seededFolds(keys: readonly string[], folds: number, seed: string): Int32Array {
  if (!Number.isInteger(folds) || folds < 2) throw new Error("Need at least two folds.");
  const random = createSeededRandom(seed);
  const unique = [...new Set(keys)].sort();
  for (let i = unique.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  const foldOf = new Map(unique.map((key, position) => [key, position % folds]));
  return Int32Array.from(keys.map((key) => foldOf.get(key) as number));
}

export type PenaltyCvCell = LineupPenalty & { loss: number };

/** K-fold cross-validation by game over a list of penalties. Ties keep the earlier one. */
export function crossValidateLineup(
  rows: LineupRows,
  grid: readonly LineupPenalty[],
  folds: number,
  seed: string,
): { cells: PenaltyCvCell[]; best: PenaltyCvCell } {
  const gameFold = seededFolds(rows.gameIds, folds, seed);
  const rowFold = (row: number) => gameFold[rows.rowGame[row]];
  const systems = Array.from({ length: folds }, (_, f) => lineupNormalEquations(rows, (row) => rowFold(row) === f));
  const p = rows.featureCount + 1;
  const cells = grid.map((penalty) => {
    let squared = 0;
    let weight = 0;
    for (let f = 0; f < folds; f += 1) {
      const matrix = new Float64Array(p * p);
      const rhs = new Float64Array(p);
      systems.forEach((system, g) => {
        if (g === f) return;
        for (let i = 0; i < matrix.length; i += 1) matrix[i] += system.matrix[i];
        for (let i = 0; i < p; i += 1) rhs[i] += system.rhs[i];
      });
      const theta = solveLineup(rows, { p, matrix, rhs }, penalty);
      let held = 0;
      for (let row = 0; row < rows.rowCount; row += 1) if (rowFold(row) === f) held += rows.weight[row];
      squared += lineupLoss(rows, theta, (row) => rowFold(row) === f) * held;
      weight += held;
    }
    return { ...penalty, loss: squared / weight };
  });
  let best = cells[0];
  for (const cell of cells) if (cell.loss < best.loss) best = cell;
  return { cells, best };
}

// ---------------------------------------------------------------------------
// Cross-check: regression on multi-season RAPM
// ---------------------------------------------------------------------------

export type RapmTargetRow = {
  athleteId: string;
  season: number;
  teamId: string;
  /** Piece possessions. */
  weight: number;
  /** RAPM total − adjNet_t / 5. */
  target: number;
  deviation: number[];
};

/**
 * One row per piece in the given seasons whose player has at least `minPossessions`
 * RAPM possessions (offence plus defence) in `rapm`. Deviations are full-season.
 */
export function rapmTargetRows(
  totals: readonly SeasonTotals[],
  rapm: ReadonlyMap<string, { total: number; offencePossessions: number; defencePossessions: number }>,
  minPossessions: number,
): RapmTargetRow[] {
  const rows: RapmTargetRow[] = [];
  for (const season of totals) {
    const adjusted = adjustedNetRatings(season.teams.values());
    const keys = [...season.pieces.keys()].sort();
    for (const key of keys) {
      const piece = season.pieces.get(key) as Piece;
      const player = rapm.get(piece.athleteId);
      if (!player || player.offencePossessions + player.defencePossessions < minPossessions) continue;
      if (!(piece.possessions > 0)) continue;
      const team = season.teams.get(piece.teamId) as TeamSeason;
      rows.push({
        athleteId: piece.athleteId,
        season: season.season,
        teamId: piece.teamId,
        weight: piece.possessions,
        target: player.total - (adjusted.get(piece.teamId) ?? 0) / 5,
        deviation: rateDeviation(piece, team),
      });
    }
  }
  return rows;
}

export type RapmTargetFit = {
  /** Unpenalised intercept; not part of the rating formula. */
  intercept: number;
  beta: number[];
  alpha: number;
  rows: number;
};

function solveTarget(rows: readonly RapmTargetRow[], include: (index: number) => boolean, alpha: number): Float64Array {
  const p = STAT_COUNT + 1;
  const matrix = new Float64Array(p * p);
  const rhs = new Float64Array(p);
  rows.forEach((row, index) => {
    if (!include(index)) return;
    const x = [1, ...row.deviation];
    for (let a = 0; a < p; a += 1) {
      rhs[a] += row.weight * x[a] * row.target;
      for (let b = 0; b <= a; b += 1) matrix[a * p + b] += row.weight * x[a] * x[b];
    }
  });
  for (let k = 1; k < p; k += 1) matrix[k * p + k] = matrix[k * p + k] > 0 ? matrix[k * p + k] * (1 + alpha) : 1;
  return solveSymmetric(matrix, p, rhs);
}

/** Possession-weighted ridge (relative penalty α) with the penalty chosen by K-fold CV by player. */
export function fitRapmTargetModel(
  rows: readonly RapmTargetRow[],
  alphas: readonly number[],
  folds: number,
  seed: string,
): RapmTargetFit & { cv: Array<{ alpha: number; loss: number }> } {
  const fold = seededFolds(rows.map((row) => row.athleteId), folds, seed);
  const cv = alphas.map((alpha) => {
    let squared = 0;
    let weight = 0;
    for (let f = 0; f < folds; f += 1) {
      const theta = solveTarget(rows, (index) => fold[index] !== f, alpha);
      rows.forEach((row, index) => {
        if (fold[index] !== f) return;
        let prediction = theta[0];
        for (let k = 0; k < STAT_COUNT; k += 1) prediction += theta[k + 1] * row.deviation[k];
        squared += row.weight * (row.target - prediction) ** 2;
        weight += row.weight;
      });
    }
    return { alpha, loss: squared / weight };
  });
  let best = cv[0];
  for (const cell of cv) if (cell.loss < best.loss) best = cell;
  const theta = solveTarget(rows, () => true, best.alpha);
  return { intercept: theta[0], beta: Array.from(theta.slice(1)), alpha: best.alpha, rows: rows.length, cv };
}
