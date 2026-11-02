// Shared wording and numbers for the track record, gated by the live section of
// docs/claims-ledger.md: below 500 scored games every result carries the small-sample
// label, and missed and incomplete seals are always shown.

import { clampProbability } from "@/lib/season/math";

export const SMALL_SAMPLE_GAMES = 500;

export const SMALL_SAMPLE_LABEL = (scored: number) =>
  `Small sample: ${scored} scored ${scored === 1 ? "game" : "games"}. Results below ${SMALL_SAMPLE_GAMES} scored games say little about skill.`;

/** One forecast's Brier score: squared error of the home win probability. */
export function gameBrier(homeWinProbability: number, homeWon: boolean): number {
  return (clampProbability(homeWinProbability) - (homeWon ? 1 : 0)) ** 2;
}
