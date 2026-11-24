// One team's published season odds by date, from the odds history view
// (src/lib/season/odds-history.ts): the values are copied exactly as published, never
// recomputed or smoothed. Pure: no fetch, no file access.

import type { OddsHistoryFile } from "@/lib/season/odds-history";

export type TeamOddsPoint = {
  /** ET date. */
  date: string;
  /** True for the slate date: the odds the site publishes today. */
  today: boolean;
  makePlayoffs: number;
  champion: number;
  projectedWins: number;
};

/**
 * The team's playoff odds, title odds and projected wins on every published date, oldest
 * first. Null, so the page shows nothing, when the view is not published, the team is not
 * in it, or it has fewer than two dates (one date is not a history).
 */
export function teamOddsHistory(file: OddsHistoryFile | null, teamId: string, slateEtDate: string): TeamOddsPoint[] | null {
  if (!file) return null;
  const column = file.teamIds.indexOf(teamId);
  if (column < 0 || file.dates.length < 2) return null;
  const points: TeamOddsPoint[] = [];
  for (const [row, date] of file.dates.entries()) {
    const makePlayoffs = file.makePlayoffs[row]?.[column];
    const champion = file.champion[row]?.[column];
    const projectedWins = file.projectedWins[row]?.[column];
    // The parser already rejects ragged matrices; a missing value still never becomes a point.
    if (![makePlayoffs, champion, projectedWins].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
    points.push({ date, today: date === slateEtDate, makePlayoffs, champion, projectedWins });
  }
  return points;
}
