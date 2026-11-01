// How title odds moved, read from the daily snapshots the pipeline publishes.

import type { TeamHistoryPoint } from "@/lib/season/types";

/** Smaller differences are rounding, not a change in the forecast. */
const MEANINGFUL_CHANGE = 0.0005;

export type TitleOddsChange = {
  /** The earlier date being compared against. */
  since: string;
  /** Change in title probability by team ID. */
  change: Record<string, number>;
};

/**
 * Compares the latest point with the most recent earlier day whose numbers differ.
 * The odds do not move on a morning before any game ends, so comparing only with the
 * previous day would show a column of zeros until that night's first final.
 */
export function titleOddsChange(history: readonly TeamHistoryPoint[]): TitleOddsChange | null {
  const points = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const latest = points.at(-1);
  if (!latest) return null;
  for (const earlier of points.slice(0, -1).reverse()) {
    const change: Record<string, number> = {};
    let differs = false;
    for (const [teamId, value] of Object.entries(latest.champion)) {
      const before = earlier.champion[teamId];
      if (before === undefined) continue;
      change[teamId] = value - before;
      if (Math.abs(change[teamId]) >= MEANINGFUL_CHANGE) differs = true;
    }
    if (differs) return { since: earlier.date, change };
  }
  return null;
}
