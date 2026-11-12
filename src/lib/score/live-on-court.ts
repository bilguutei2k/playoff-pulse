// Stage 2 of the 548 score for the live season: the Stage 1 box value today plus δ, the
// on-court correction from lineup results (docs/score/registration-stage2.md). Pure: no
// fetch, no file access, no clock; "today" is passed in.
//
// The registration defines a player's rating on a date as his Stage 1 value on that date
// plus his δ from the latest checkpoint on or before it. Checkpoints fall every 21 days
// from the season's first game date; the checkpoint on date D solves (src/lib/score/on-court.ts,
// unchanged) with the stints of this season's games before D and the Stage 1 values as of
// D, pulled toward ρ × the carried δ (each player's final δ of 2025-26, from the committed
// data/score/delta-2026.json written by scripts/score/build-delta.ts). Before the first
// checkpoint δ is ρ × the carried δ. A player with no stints keeps ρ × his carried δ.
//
// The Stage 1 value today is exactly the live Stage 1 score (src/lib/score/live.ts). The
// solve uses regular-season games only, as the registered test did; the box value keeps
// every stored game, as Stage 1 does.
//
// The score is a display number, labelled experimental. It is never a forecast input.

import { createOnCourtSystem, addRow, checkpointDates, solveOnCourt, stintRow, type OnCourtParams } from "@/lib/score/on-court";
import { liveScores, scoreGamesFromDays, SCORE_BOUND, type LiveScore, type PriorPiece } from "@/lib/score/live";
import { readStint, type StintDay } from "@/lib/score/live-stints";
import type { BookParams } from "@/lib/score/book";
import type { BoxCoefficients } from "@/lib/score/box-model";
import {
  SCORE_DELTA_SEASON,
  SCORE_FIT_SHA256,
  SCORE_FIT_STAGE2_SHA256,
  SCORE_MODEL_VERSION_S2,
  SCORE_ON_COURT,
} from "@/lib/score/params";
import type { PlayerGamesDay } from "@/lib/season/player-stats";

// ---------------------------------------------------------------------------
// The carried δ file
// ---------------------------------------------------------------------------

/** Decimals of each δ in the carried file. */
export const DELTA_DECIMALS = 6;

/** data/score/delta-{season}.json: every player's final δ at the end of `season`. */
export type CarriedDeltaFile = {
  version: 1;
  modelVersion: string;
  /** SHA-256 of docs/score/fit.json (Stage 1) and docs/score/fit-stage2.json. */
  fitSha256: string;
  fitStage2Sha256: string;
  /** The completed season (by ending year) whose end the values are. */
  season: number;
  /** The live season (by ending year) that carries them. */
  forSeason: number;
  lambda: number;
  rho: number;
  /** Seasons walked, by ending year, first and last. */
  walked: [number, number];
  decimals: number;
  /** Athlete ID to δ, in ID order. */
  players: Record<string, number>;
};

export const storeDelta = (value: number) => Number(value.toFixed(DELTA_DECIMALS));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** No δ may lie outside ±this many points per 100 possessions. */
export const ON_COURT_BOUND = 10;

/**
 * Checks a parsed carried δ file for the live season `forSeason` and returns δ by athlete.
 * Throws with a reason when it is malformed, from another model or fit, for another
 * season, or holds a value that is not finite and within ±ON_COURT_BOUND.
 */
export function readCarriedDelta(raw: unknown, forSeason: number): Map<string, number> {
  if (!isRecord(raw) || raw.version !== 1) throw new Error("carried δ file is malformed");
  if (raw.modelVersion !== SCORE_MODEL_VERSION_S2) {
    throw new Error(`carried δ file is for model ${String(raw.modelVersion)}, not ${SCORE_MODEL_VERSION_S2}`);
  }
  if (raw.fitSha256 !== SCORE_FIT_SHA256 || raw.fitStage2Sha256 !== SCORE_FIT_STAGE2_SHA256) {
    throw new Error("carried δ file was computed with another fit");
  }
  if (raw.season !== SCORE_DELTA_SEASON || raw.forSeason !== forSeason || forSeason !== SCORE_DELTA_SEASON + 1) {
    throw new Error(`carried δ file is from season ${String(raw.season)} for ${String(raw.forSeason)}, not for ${forSeason}`);
  }
  if (raw.lambda !== SCORE_ON_COURT.lambda || raw.rho !== SCORE_ON_COURT.rho) throw new Error("carried δ file has other λ or ρ");
  if (!isRecord(raw.players)) throw new Error("carried δ file is malformed");
  const output = new Map<string, number>();
  for (const [athleteId, value] of Object.entries(raw.players)) {
    if (!/^\d+$/.test(athleteId) || typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > ON_COURT_BOUND) {
      throw new Error(`carried δ file has a malformed value for ${athleteId}`);
    }
    output.set(athleteId, value);
  }
  if (output.size === 0) throw new Error("carried δ file has no players");
  return output;
}

/** One player per line, so a diff of the file reads. */
export function carriedDeltaContent(file: CarriedDeltaFile): string {
  const head = JSON.stringify({ ...file, players: undefined }).slice(0, -1);
  const rows = Object.entries(file.players).map(([athleteId, value]) => `${JSON.stringify(athleteId)}:${value.toFixed(DELTA_DECIMALS)}`);
  return `${head},"players":{\n${rows.join(",\n")}\n}}\n`;
}

// ---------------------------------------------------------------------------
// Today's Stage 2 rating
// ---------------------------------------------------------------------------

export type LiveOnCourtInput = {
  season: number;
  /** The ET date the rating is for (the job's slate date). */
  today: string;
  /** Stored player days of the season: the Stage 1 box value and the season's first game date. */
  days: readonly PlayerGamesDay[];
  /** Stored stint days of the season. */
  stintDays: readonly StintDay[];
  prior: ReadonlyMap<string, readonly PriorPiece[]>;
  /** Each player's final δ of the previous season; absent means 0. */
  carried: ReadonlyMap<string, number>;
  coefficients: BoxCoefficients;
  book: BookParams;
  params: OnCourtParams;
  checkpointDays: number;
  /** Stage 1 value of a player on the floor without one, in the solve only. */
  replacement: number;
};

export type LiveOnCourtRating = LiveScore & {
  /** δ: what his lineups' results add to or take from his box value. */
  delta: number;
  /** Stage 2 rating: score (the box value) + δ. */
  rating: number;
};

export type LiveOnCourt = {
  /** The season's first stored game date; null with no stored game. */
  firstGame: string | null;
  /** The checkpoint in use (its ET date), or null before the first: δ is ρ × the carried δ. */
  checkpoint: string | null;
  /** Stint rows and accepted regular-season games in the checkpoint's solve. */
  rows: number;
  stintGames: number;
  /** Every player with a Stage 1 value today. */
  ratings: Map<string, LiveOnCourtRating>;
};

/** δ held at checkpoint `before` (games before it), or ρ × carried with no checkpoint. */
function deltaAt(input: LiveOnCourtInput, before: string | null): { delta: Map<string, number>; rows: number; stintGames: number } {
  const { rho, lambda } = input.params;
  const delta = new Map<string, number>();
  for (const [athleteId, value] of input.carried) delta.set(athleteId, rho * value);
  if (before === null) return { delta, rows: 0, stintGames: 0 };

  // Stage 1 values on the checkpoint's date: the same live computation on the games before it.
  const boxGames = scoreGamesFromDays(input.days, input.season).filter((game) => game.etDate < before);
  const box = liveScores({ season: input.season, games: boxGames, prior: input.prior, coefficients: input.coefficients, params: input.book });

  // Stints of accepted regular-season games before the date, in the walk's order: date, then game ID.
  const games = input.stintDays
    .flatMap((day) => Object.values(day.games))
    .filter((game) => game.kind === "regular" && game.stints !== null && game.etDate < before)
    .sort((a, b) => (a.etDate !== b.etDate ? (a.etDate < b.etDate ? -1 : 1) : a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));
  const system = createOnCourtSystem(512);
  for (const game of games) {
    for (const stored of game.stints ?? []) {
      const row = stintRow(readStint(stored));
      if (row) addRow(system, row);
    }
  }
  if (system.rows === 0) return { delta, rows: 0, stintGames: games.length };
  const base = system.ids.map((id) => box.get(id)?.score ?? input.replacement);
  const prior = system.ids.map((id, i) => base[i] + rho * (input.carried.get(id) ?? 0));
  const solution = solveOnCourt(system, lambda, prior);
  system.ids.forEach((id, i) => delta.set(id, solution.rating[i] - base[i]));
  return { delta, rows: system.rows, stintGames: games.length };
}

/** Every player's Stage 2 rating today, with its Stage 1 box value and δ. */
export function liveOnCourt(input: LiveOnCourtInput): LiveOnCourt {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.today)) throw new Error(`today ${input.today} is not an ET date`);
  const games = scoreGamesFromDays(input.days, input.season);
  const box = liveScores({ season: input.season, games, prior: input.prior, coefficients: input.coefficients, params: input.book });
  const firstGame = games[0]?.etDate ?? null;
  const checkpoint = firstGame === null ? null : (checkpointDates(firstGame, input.today, input.checkpointDays).at(-1) ?? null);
  const held = deltaAt(input, checkpoint);
  const ratings = new Map<string, LiveOnCourtRating>();
  for (const [athleteId, value] of box) {
    const delta = held.delta.get(athleteId) ?? 0;
    ratings.set(athleteId, { ...value, delta, rating: value.score + delta });
  }
  return { firstGame, checkpoint, rows: held.rows, stintGames: held.stintGames, ratings };
}

const three = (value: number) => Number(value.toFixed(3));

/** A Stage 2 score as the player index publishes it: three decimals each. */
export type PublishedOnCourtScore = { score: number; share: number; box: number; onCourt: number };

export function publishedOnCourt(result: LiveOnCourt): Map<string, PublishedOnCourtScore> {
  return new Map(
    [...result.ratings].map(([athleteId, value]) => [
      athleteId,
      { score: three(value.rating), share: three(value.share), box: three(value.score), onCourt: three(value.delta) },
    ]),
  );
}

/** score and box + onCourt may differ by rounding each to three decimals, no more. */
export const PARTS_TOLERANCE = 0.0011;

/**
 * Invariants of published Stage 2 scores: every number finite, the score and the box
 * value within ±SCORE_BOUND, δ within ±ON_COURT_BOUND, the score the sum of its parts to
 * rounding, the share in [0, 1]. Empty when they hold.
 */
export function onCourtProblems(scores: ReadonlyMap<string, PublishedOnCourtScore>): string[] {
  const problems: string[] = [];
  for (const [athleteId, { score, share, box, onCourt }] of scores) {
    if (!Number.isFinite(score) || Math.abs(score) > SCORE_BOUND) problems.push(`548 score ${score} for ${athleteId} is outside ±${SCORE_BOUND}`);
    if (!Number.isFinite(box) || Math.abs(box) > SCORE_BOUND) problems.push(`548 box value ${box} for ${athleteId} is outside ±${SCORE_BOUND}`);
    if (!Number.isFinite(onCourt) || Math.abs(onCourt) > ON_COURT_BOUND) problems.push(`548 on-court value ${onCourt} for ${athleteId} is outside ±${ON_COURT_BOUND}`);
    if (!(Math.abs(score - (box + onCourt)) <= PARTS_TOLERANCE)) problems.push(`548 score ${score} for ${athleteId} is not ${box} + ${onCourt}`);
    if (!Number.isFinite(share) || share < 0 || share > 1) problems.push(`548 score share ${share} for ${athleteId} is outside [0, 1]`);
  }
  return problems;
}
