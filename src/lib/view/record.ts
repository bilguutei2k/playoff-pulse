// Shared wording and numbers for the track record, gated by the live section of
// docs/claims-ledger.md: below 500 scored games every result carries the small-sample
// label, missed and incomplete seals are always shown, calibration waits for 100
// scored games, and nothing is set against the market before 500.

import { clampProbability } from "@/lib/season/math";
import { impliedHomeProbability } from "@/lib/season/market";
import { missedVersionOf, scoredSeal, sealKindOf, summarizeRecord } from "@/lib/season/live-state";
import type { LedgerRow, MissedRow, RecordSummary, ResultRow, SealRow } from "@/lib/season/types";

export const SMALL_SAMPLE_GAMES = 500;
export const CALIBRATION_MIN_GAMES = 100;
/** The claims ledger allows no model-against-market statement below this. */
export const MARKET_COMPARISON_MIN_GAMES = 500;

export const SMALL_SAMPLE_LABEL = (scored: number) =>
  `Small sample: ${scored} scored ${scored === 1 ? "game" : "games"}. Below ${SMALL_SAMPLE_GAMES}, results say little about skill.`;

/** One forecast's Brier score: squared error of the home win probability. */
export function gameBrier(homeWinProbability: number, homeWon: boolean): number {
  return (clampProbability(homeWinProbability) - (homeWon ? 1 : 0)) ** 2;
}

export type ScoredGame = {
  seal: SealRow;
  result: ResultRow;
  homeWon: boolean;
  brier: number;
  /** A version that seals twice was scored on its reissued or original morning seal. */
  noFinalSeal: boolean;
};

export type VersionLedger = {
  scored: ScoredGame[];
  missed: MissedRow[];
  pending: SealRow[];
};

/** A version's scored games (most recent first), misses and pending seals, from the ledger. */
export function versionLedger(ledger: readonly LedgerRow[], modelVersion: string): VersionLedger {
  const byGame = new Map<string, SealRow[]>();
  let twoSeals = false;
  for (const row of ledger) {
    if (row.type !== "seal" || row.modelVersion !== modelVersion) continue;
    if (row.sealKind !== undefined) twoSeals = true;
    byGame.set(row.gameId, [...(byGame.get(row.gameId) ?? []), row]);
  }
  const results = new Map<string, ResultRow>();
  for (const row of ledger) if (row.type === "result") results.set(row.gameId, row);
  const scored: ScoredGame[] = [];
  const pending: SealRow[] = [];
  for (const rows of byGame.values()) {
    const seal = scoredSeal(rows);
    if (!seal) continue;
    const result = results.get(seal.gameId);
    if (!result) {
      pending.push(seal);
      continue;
    }
    const homeWon = result.homeScore > result.awayScore;
    scored.push({
      seal,
      result,
      homeWon,
      brier: gameBrier(seal.homeWinProbability, homeWon),
      noFinalSeal: twoSeals && sealKindOf(seal) !== "final",
    });
  }
  scored.sort((a, b) => Date.parse(b.seal.tipUtc) - Date.parse(a.seal.tipUtc));
  const missed = ledger.filter(
    (row): row is MissedRow => row.type === "missed" && missedVersionOf(row) === modelVersion,
  );
  return { scored, missed, pending };
}

export type CalibrationBin = { from: number; to: number; count: number; forecast: number; observed: number };

/** Ten equal bins of the home win probability: mean forecast against the home win rate. */
export function calibrationBins(scored: readonly ScoredGame[]): CalibrationBin[] {
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i / 10, to: (i + 1) / 10, count: 0, sum: 0, wins: 0 }));
  for (const game of scored) {
    const p = clampProbability(game.seal.homeWinProbability);
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.count += 1;
    bin.sum += p;
    bin.wins += game.homeWon ? 1 : 0;
  }
  return bins
    .filter((bin) => bin.count > 0)
    .map((bin) => ({ from: bin.from, to: bin.to, count: bin.count, forecast: bin.sum / bin.count, observed: bin.wins / bin.count }));
}

/** Scored games whose seal stored a usable market line. */
export function withMarketLine(scored: readonly ScoredGame[]): ScoredGame[] {
  return scored.filter((game) => game.seal.market && impliedHomeProbability(game.seal.market) !== null);
}

/**
 * Model and market Brier on the same games, only once the claims ledger allows any
 * statement about the two: null below MARKET_COMPARISON_MIN_GAMES scored games.
 */
export function marketComparison(scored: readonly ScoredGame[]): { games: number; model: number; market: number } | null {
  if (scored.length < MARKET_COMPARISON_MIN_GAMES) return null;
  const games = withMarketLine(scored);
  if (games.length === 0) return null;
  let model = 0;
  let market = 0;
  for (const game of games) {
    model += game.brier;
    market += gameBrier(impliedHomeProbability(game.seal.market!)!, game.homeWon);
  }
  return { games: games.length, model: model / games.length, market: market / games.length };
}

const SPLIT_KEYS = [
  "originalMorningBrier",
  "originalMorningCount",
  "reissuedBrier",
  "reissuedCount",
  "latestPreFinalBrier",
  "latestPreFinalCount",
  "policyRevisions",
] as const;

/**
 * A published record with its pre-final split and policy revisions. A state written
 * since 2026-11-06 carries them and is returned as it is; an older one (the bundled copy,
 * or the minutes before the job's first run with this code) gets them from the same
 * snapshot's ledger through the job's own summarizeRecord. Nothing else is recomputed.
 */
export function withRecordSplit(record: RecordSummary, ledger: readonly LedgerRow[]): RecordSummary {
  if (record.noFinalSeal === null || record.originalMorningCount !== undefined || record.modelVersion === null) return record;
  const computed = summarizeRecord(ledger, record.modelVersion, 0.5, { finalSeals: true });
  const split: Partial<RecordSummary> = {};
  for (const key of SPLIT_KEYS) if (computed[key] !== undefined) Object.assign(split, { [key]: computed[key] });
  return { ...record, ...split };
}
