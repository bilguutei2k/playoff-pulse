// Display values for the v8 team page: the next ten games as chart bars, the projected
// record band's positions, expected games out as blocks, and the possessive used in
// headings. Formatting and layout only: every probability and projection is the
// published forecast's, a seal's or a projection's, read through `teamSchedule`.

import { formatShortDay } from "@/lib/utils/dates";
import { splitPercents } from "@/lib/view/card";
import type { OddsRow } from "@/lib/view/odds";
import type { TeamGameRow } from "@/lib/view/team";
import { teamDisplay } from "@/lib/view/teams";

export type NextGameBar = {
  gameId: string;
  /** "@MEM" away, "DEN" at home. */
  label: string;
  date: string;
  /** The team's whole-percent chance, 1 to 99. */
  percent: number;
  /** Sealed numbers are solid; projections, never scored, are dashed. */
  sealed: boolean;
  withInjuries: boolean;
};

/** The team's next games that have a number (seal or projection), up to `count`. */
export function nextGameBars(upcoming: readonly TeamGameRow[], count = 10): NextGameBar[] {
  return upcoming
    .filter((row) => row.forecast !== null && row.game.status === "scheduled")
    .slice(0, count)
    .map((row) => {
      const code = teamDisplay(row.opponentId).code;
      return {
        gameId: row.game.id,
        label: row.home ? code : `@${code}`,
        date: formatShortDay(row.game.etDate),
        percent: splitPercents(row.forecast!.probability).home,
        sealed: row.forecast!.source === "sealed",
        withInjuries: row.forecast!.withInjuries,
      };
    });
}

export type RecordBand = {
  /** Regular-season games: the axis runs from 0 to this. */
  total: number;
  /** Positions on the axis, in percent. */
  low: number;
  high: number;
  mean: number;
};

/** Where the 10th-to-90th percentile band and the average sit on a 0-to-season axis. */
export function recordBand(row: Pick<OddsRow, "projectedWins" | "projectedLosses" | "projectedWinsP10" | "projectedWinsP90">): RecordBand {
  const total = Math.max(1, Math.round(row.projectedWins + row.projectedLosses));
  const at = (wins: number) => Math.min(100, Math.max(0, (wins / total) * 100));
  return { total, low: at(row.projectedWinsP10), high: at(row.projectedWinsP90), mean: at(row.projectedWins) };
}

/** Expected further games out as whole blocks, capped, with the overflow as "+N". */
export function gameBlocks(expectedGames: number, cap = 12): { blocks: number; more: number } {
  const games = Math.max(0, Math.round(expectedGames));
  return { blocks: Math.min(cap, games), more: Math.max(0, games - cap) };
}

/** "Pacers'" or "Heat's". */
export function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/** The team's whole-percent chance in a seal or projection, as the results and schedule show it. */
export function teamPercent(probability: number): number {
  return splitPercents(probability).home;
}
