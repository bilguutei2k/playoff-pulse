// The odds page's seeding grid: every team's published chance of each seed
// (`seedProbabilities`, 15 per team), grouped by conference, teams in order of
// expected seed. Display only: the cells are the published numbers; the expected seed
// only orders the rows and is never shown.

import type { Conference } from "@/lib/season/types";
import { formatChance } from "@/lib/utils/format";
import type { OddsRow } from "@/lib/view/odds";

export type SeedGridRow = { teamId: string; seeds: number[] };
export type SeedGrid = { conference: Conference; rows: SeedGridRow[] };

/** Seeds 1–6 go straight to the playoffs, 7–10 to the play-in, 11–15 are out. `from`/`to` are 1-based, inclusive. */
export const SEED_BANDS = [
  { label: "Playoffs", from: 1, to: 6 },
  { label: "Play-in", from: 7, to: 10 },
  { label: "Out", from: 11, to: 15 },
] as const;

/** A team's mean seed over the simulations, for ordering only. */
function expectedSeed(seeds: readonly number[]): number {
  let mass = 0;
  let sum = 0;
  seeds.forEach((p, index) => {
    mass += p;
    sum += p * (index + 1);
  });
  return mass > 0 ? sum / mass : Number.POSITIVE_INFINITY;
}

/** East then West, each by expected seed (ties: more projected wins, then name). */
export function seedGrids(rows: readonly OddsRow[]): SeedGrid[] {
  return (["East", "West"] as const).map((conference) => ({
    conference,
    rows: rows
      .filter((row) => row.conference === conference)
      .map((row) => ({ row, mean: expectedSeed(row.seeds) }))
      .sort((a, b) => a.mean - b.mean || b.row.projectedWins - a.row.projectedWins || a.row.name.localeCompare(b.row.name))
      .map(({ row }) => ({ teamId: row.teamId, seeds: row.seeds })),
  }));
}

/**
 * The cell's shade step, 0 (no fill) to 5 (darkest). The steps are the heat greys in
 * styles/base.css; text is ink on steps 1 to 3 and white on 4 and 5, chosen so both
 * meet WCAG AA (4.5:1) on every step: no step sits in the mid-grey band where neither does.
 */
export const SEED_SHADES: Array<{ from: number; step: number }> = [
  { from: 0.5, step: 5 },
  { from: 0.3, step: 4 },
  { from: 0.15, step: 3 },
  { from: 0.05, step: 2 },
  { from: 0.005, step: 1 },
];

export function seedShade(probability: number): number {
  return SEED_SHADES.find((shade) => probability >= shade.from)?.step ?? 0;
}

/**
 * What a cell prints: the whole percent from 1% up, and nothing for anything under 1%
 * (the grid shows a dot for a chance above zero and leaves a zero empty). The threshold is
 * the published number's, not the rounded one's: 0.6% is "under 1%" and must not print as
 * 1. Past the regular season (`exact`) a certain seed prints 100.
 */
export function seedCellText(probability: number, exact: boolean): string | null {
  if (exact && probability === 1) return "100";
  if (probability < 0.01) return null;
  return formatChance(probability, { exact }).replace("%", "");
}
