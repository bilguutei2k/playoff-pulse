// The 548 score for the live season, from the job's stored box lines and the committed
// prior file. Pure: no fetch, no file access, no clock.
//
// A player's score today is the book's value (`combinePieces`) over his pieces: this
// season's to date, rated with team rates and opponent-adjusted net to date exactly as
// `playerValuesOnDate` rates a season in progress, plus his pieces from the last three
// completed seasons, rated once with full-season team rates and stored in
// data/score/prior-2026.json (scripts/score/build-prior.ts). The stored lines are turned
// into `ScoreGame`s here so the engine (box-model.ts, book.ts) runs unchanged.
//
// The score is a display number, labelled experimental and box-score only. It is never a
// forecast input: nothing under src/lib/season/ or src/lib/model/ imports this folder.

import { chronological, combinePieces, type BookParams } from "@/lib/score/book";
import { buildSeasonTotals, seasonPieceRatings, type BoxCoefficients } from "@/lib/score/box-model";
import { SCORE_FIT_SHA256, SCORE_MODEL_VERSION } from "@/lib/score/params";
import type { LineupAudit, ScoreGame } from "@/lib/score/types";
import { fromStoredLine, type PlayerBoxLine, type PlayerGamesDay } from "@/lib/season/player-stats";

// ---------------------------------------------------------------------------
// The prior file
// ---------------------------------------------------------------------------

/** One rated piece in the prior file: [season, teamId, possessions, minutes, rating]. */
export type StoredPriorPiece = [season: number, teamId: string, possessions: number, minutes: number, rating: number];

export const PRIOR_PIECE_COLUMNS = ["season", "teamId", "possessions", "minutes", "rating"] as const;

/** data/score/prior-{lastSeason}.json. */
export type ScorePriorFile = {
  version: 1;
  modelVersion: string;
  /** SHA-256 of docs/score/fit.json, whose coefficients rated these pieces. */
  fitSha256: string;
  /** The live season (by ending year) these pieces are the past of. */
  forSeason: number;
  /** Completed seasons included, by ending year, oldest first. */
  seasons: number[];
  columns: typeof PRIOR_PIECE_COLUMNS;
  /** Athlete ID to his pieces, by season then team. */
  players: Record<string, StoredPriorPiece[]>;
};

export type PriorPiece = { season: number; teamId: string; possessions: number; minutes: number; rating: number };

/** Fixed decimals for the prior file: possessions and minutes to 0.01, rating to 0.0001. */
export function storePriorPiece(piece: PriorPiece): StoredPriorPiece {
  return [
    piece.season,
    piece.teamId,
    Number(piece.possessions.toFixed(2)),
    Number(piece.minutes.toFixed(2)),
    Number(piece.rating.toFixed(4)),
  ];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks a parsed prior file for the live season `forSeason` and returns its pieces by
 * athlete. Throws with a reason when it is malformed, from another model version or fit,
 * for another season, or holds a piece from a season not before `forSeason`.
 */
export function readScorePrior(raw: unknown, forSeason: number): Map<string, PriorPiece[]> {
  if (!isRecord(raw) || raw.version !== 1) throw new Error("prior file is malformed");
  if (raw.modelVersion !== SCORE_MODEL_VERSION) {
    throw new Error(`prior file is for model ${String(raw.modelVersion)}, not ${SCORE_MODEL_VERSION}`);
  }
  if (raw.fitSha256 !== SCORE_FIT_SHA256) throw new Error("prior file was rated with another fit");
  if (raw.forSeason !== forSeason) throw new Error(`prior file is for season ${String(raw.forSeason)}, not ${forSeason}`);
  if (
    !Array.isArray(raw.seasons) ||
    !raw.seasons.every((season) => Number.isInteger(season) && (season as number) < forSeason) ||
    JSON.stringify(raw.columns) !== JSON.stringify(PRIOR_PIECE_COLUMNS) ||
    !isRecord(raw.players)
  ) {
    throw new Error("prior file is malformed");
  }
  const seasons = new Set(raw.seasons as number[]);
  const output = new Map<string, PriorPiece[]>();
  for (const [athleteId, pieces] of Object.entries(raw.players)) {
    if (!/^\d+$/.test(athleteId) || !Array.isArray(pieces) || pieces.length === 0) {
      throw new Error(`prior file has a malformed player ${athleteId}`);
    }
    output.set(
      athleteId,
      pieces.map((piece: unknown) => {
        if (
          !Array.isArray(piece) ||
          piece.length !== 5 ||
          !seasons.has(piece[0]) ||
          typeof piece[1] !== "string" ||
          !piece.slice(2).every((value) => typeof value === "number" && Number.isFinite(value)) ||
          !(piece[2] > 0) ||
          !(piece[3] >= 0)
        ) {
          throw new Error(`prior file has a malformed piece for ${athleteId}`);
        }
        return { season: piece[0], teamId: piece[1], possessions: piece[2], minutes: piece[3], rating: piece[4] };
      }),
    );
  }
  return output;
}

// ---------------------------------------------------------------------------
// Stored lines as engine games
// ---------------------------------------------------------------------------

const NO_LINEUPS: LineupAudit = {
  source: "inferred",
  wrongCountPlays: 0,
  maxPlusMinusGap: 0,
  plusMinusMisses: 0,
  maxMinutesGap: 0,
  homePointsGap: 0,
  awayPointsGap: 0,
  rejected: "live season: box lines only",
};

/**
 * The live season's stored games as `ScoreGame`s (box lines and final scores, no stints),
 * one per game ID, in chronological order. Names and positions come from the day's athletes.
 */
export function scoreGamesFromDays(days: readonly PlayerGamesDay[], season: number): ScoreGame[] {
  const byId = new Map<string, ScoreGame>();
  for (const day of [...days].sort((a, b) => a.etDate.localeCompare(b.etDate))) {
    for (const stored of Object.values(day.games)) {
      const box: Record<string, PlayerBoxLine[]> = {};
      for (const teamId of Object.keys(stored.teams).sort()) {
        box[teamId] = stored.teams[teamId].lines.map((line) => {
          const counting = fromStoredLine(line);
          const athlete = day.athletes[counting.athleteId];
          return { ...counting, name: athlete?.name ?? counting.athleteId, position: athlete?.position ?? null };
        });
      }
      byId.set(stored.gameId, {
        gameId: stored.gameId,
        season,
        etDate: stored.etDate,
        homeId: stored.homeId,
        awayId: stored.awayId,
        homeScore: stored.homeScore,
        awayScore: stored.awayScore,
        box,
        stints: null,
        audit: NO_LINEUPS,
      });
    }
  }
  return chronological([...byId.values()]);
}

// ---------------------------------------------------------------------------
// Today's score
// ---------------------------------------------------------------------------

export type LiveScore = {
  /** Points per 100 possessions against an average player, the book's value. */
  score: number;
  /** His on-court possessions this season, every team. */
  possessions: number;
  /** This season's possessions over the book's total weight, k pseudo-possessions included: 0 to 1. */
  share: number;
};

/**
 * Every player's score in `season` from this season's games (all of them: the stored
 * games are finished) and his prior pieces. A player with no piece in either has none.
 */
export function liveScores(input: {
  season: number;
  games: readonly ScoreGame[];
  prior: ReadonlyMap<string, readonly PriorPiece[]>;
  coefficients: BoxCoefficients;
  params: BookParams;
}): Map<string, LiveScore> {
  const current = new Map<string, Array<{ season: number; possessions: number; minutes: number; rating: number }>>();
  for (const piece of seasonPieceRatings(buildSeasonTotals(input.games, input.season), input.coefficients)) {
    const list = current.get(piece.athleteId) ?? [];
    list.push(piece);
    current.set(piece.athleteId, list);
  }
  const athletes = [...new Set([...input.prior.keys(), ...current.keys()])].sort();
  const output = new Map<string, LiveScore>();
  for (const athleteId of athletes) {
    const now = current.get(athleteId) ?? [];
    const pieces = [...(input.prior.get(athleteId) ?? []), ...now];
    if (pieces.length === 0) continue;
    const value = combinePieces(pieces, input.season, input.params);
    const possessions = now.reduce((total, piece) => total + piece.possessions, 0);
    const denominator = value.weight + input.params.pseudoPossessions;
    output.set(athleteId, { score: value.value, possessions, share: denominator > 0 ? possessions / denominator : 0 });
  }
  return output;
}

const three = (value: number) => Number(value.toFixed(3));

export type PublishedScore = { score: number; share: number };

/** The scores as the player index publishes them: three decimals each. */
export function publishedScores(scores: ReadonlyMap<string, LiveScore>): Map<string, PublishedScore> {
  return new Map([...scores].map(([athleteId, value]) => [athleteId, { score: three(value.score), share: three(value.share) }]));
}

/** From the stored days and the prior file's pieces to the published scores, with the frozen parameters. */
export function liveScoresFromDays(input: {
  season: number;
  days: readonly PlayerGamesDay[];
  prior: ReadonlyMap<string, readonly PriorPiece[]>;
  coefficients: BoxCoefficients;
  params: BookParams;
}): Map<string, LiveScore> {
  return liveScores({ ...input, games: scoreGamesFromDays(input.days, input.season) });
}

/** No published score may lie outside ±this many points per 100 possessions. */
export const SCORE_BOUND = 25;

/** Invariants of published scores: finite, within `SCORE_BOUND`, share in [0, 1]. Empty when they hold. */
export function scoreProblems(scores: ReadonlyMap<string, PublishedScore>): string[] {
  const problems: string[] = [];
  for (const [athleteId, { score, share }] of scores) {
    if (!Number.isFinite(score) || Math.abs(score) > SCORE_BOUND) problems.push(`548 score ${score} for ${athleteId} is outside ±${SCORE_BOUND}`);
    if (!Number.isFinite(share) || share < 0 || share > 1) problems.push(`548 score share ${share} for ${athleteId} is outside [0, 1]`);
  }
  return problems;
}
