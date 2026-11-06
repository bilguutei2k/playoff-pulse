// Bookkeeping for the v8 record page: the 500-game waffle, how often the sealed
// favorite won against how many the seals expected, the scored seals grouped by ET
// date, and whether two versions' records cover the same games. No new model numbers:
// probabilities are the scored seals', Brier is the record's own per-game score.

import { clampProbability } from "@/lib/season/math";
import type { LedgerRow } from "@/lib/season/types";
import { SMALL_SAMPLE_GAMES, type ScoredGame, type VersionLedger } from "@/lib/view/record";

/** One cell per game toward 500: scored, sealed and not final yet, or still to come. */
export type WaffleCell = "scored" | "pending" | "empty";

export function waffleCells(scored: number, pending: number, total: number = SMALL_SAMPLE_GAMES): WaffleCell[] {
  const filled = Math.min(total, Math.max(0, scored));
  const waiting = Math.min(total - filled, Math.max(0, pending));
  return Array.from({ length: total }, (_, index) =>
    index < filled ? "scored" : index < filled + waiting ? "pending" : "empty",
  );
}

export type FavoriteSummary = {
  /** Scored games whose seal favored one side (not exactly even). */
  decided: number;
  /** Of those, the favorite won. */
  won: number;
  /** The sum of the favorites' sealed chances: how many the seals expected to win. */
  expected: number;
};

/** How often the sealed favorite won, and how many wins its own chances expected. */
export function favoriteSummary(scored: readonly ScoredGame[]): FavoriteSummary {
  let decided = 0;
  let won = 0;
  let expected = 0;
  for (const game of scored) {
    const p = clampProbability(game.seal.homeWinProbability);
    if (p === 0.5) continue;
    decided += 1;
    expected += Math.max(p, 1 - p);
    if (p > 0.5 === game.homeWon) won += 1;
  }
  return { decided, won, expected };
}

/** True when the sealed favorite lost. False for an even seal. */
export function favoriteLost(game: ScoredGame): boolean {
  const p = game.seal.homeWinProbability;
  if (p === 0.5) return false;
  return p > 0.5 !== game.homeWon;
}

/** Scored games grouped by ET date, most recent date first, each group in tip order, latest first. */
export function scoredByDate(scored: readonly ScoredGame[]): Array<{ etDate: string; games: ScoredGame[] }> {
  const groups = new Map<string, ScoredGame[]>();
  for (const game of scored) groups.set(game.seal.etDate, [...(groups.get(game.seal.etDate) ?? []), game]);
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([etDate, games]) => ({
      etDate,
      games: [...games].sort((a, b) => Date.parse(b.seal.tipUtc) - Date.parse(a.seal.tipUtc)),
    }));
}

/** Whether two versions' records score exactly the same games. */
export function sameScoredGames(a: VersionLedger, b: VersionLedger): boolean {
  if (a.scored.length !== b.scored.length) return false;
  const ids = new Set(a.scored.map((game) => game.seal.gameId));
  return b.scored.every((game) => ids.has(game.seal.gameId));
}

/** A version whose seals store absence points has the injury term; v1's never do. */
export function hasInjuryTerm(ledger: readonly LedgerRow[], modelVersion: string): boolean {
  return ledger.some((row) => row.type === "seal" && row.modelVersion === modelVersion && row.absencePoints !== undefined);
}

/** The earliest ET date this version scored, for "since Nov 2". */
export function firstScoredDate(scored: readonly ScoredGame[]): string | null {
  return scored.reduce<string | null>((first, game) => (first === null || game.seal.etDate < first ? game.seal.etDate : first), null);
}

/** "v2" from "live-2026.27-v2". */
export function versionShort(modelVersion: string): string {
  return modelVersion.split("-").at(-1) ?? modelVersion;
}

/** A Brier bar's share of its cell: 0.75 fills it (a 13% favorite that loses scores about that). */
export function brierShare(brier: number): number {
  return Math.min(1, Math.max(0, brier / 0.75));
}
