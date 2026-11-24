// Display values for the v8 team page: the next ten games as chart bars, the projected
// record band's positions, expected games out as blocks, and the possessive used in
// headings. Formatting and layout only: every probability and projection is the
// published forecast's, a seal's or a projection's, read through `teamSchedule`.

import type { GameProjection } from "@/lib/season/projections";
import type { AbsenceDriver, PublishedAbsence } from "@/lib/season/types";
import { formatShortDay } from "@/lib/utils/dates";
import { splitPercents } from "@/lib/view/card";
import type { OddsRow } from "@/lib/view/odds";
import type { SealAbsence } from "@/lib/view/team";
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

/**
 * What the model takes off a team for absences in one game, as the team page's summary
 * tile shows it: what the game's own seal counted once it is sealed (a game that has
 * tipped has no projection, and its seal is the number its forecast used), else the
 * game's published projection (its side's `absencePoints`, basis and drivers), or, for a
 * game with neither, the season simulation's current absences. No new number: all three
 * are published as they are.
 */
export type NextGameAbsence = {
  points: number;
  /** "report": the seal rules on the NBA report filed for that game. */
  basis: "report" | "current-absences";
  /** Players counted with positive points; null when the seal's list is not complete. */
  count: number | null;
  /** Where the number comes from. */
  source: "seal" | "projection" | "current";
  /** Whether the number is the game's own (its seal's or its projection's), not current absences. */
  fromProjection: boolean;
  /** The players counted, largest first; null for the fallback (the current-absences list is shown beside it). */
  drivers: readonly AbsenceDriver[] | null;
};

export function nextGameAbsence(
  projection: GameProjection | null,
  teamId: string,
  current: { points: number; absences: readonly PublishedAbsence[] },
  seal: SealAbsence | null = null,
): NextGameAbsence {
  if (seal) {
    const drivers = seal.drivers ? seal.drivers.filter((driver) => driver.points > 0) : null;
    return {
      points: seal.points,
      // An unfiled side's seal took current absences, as the rule says.
      basis: seal.unfiled ? "current-absences" : "report",
      count: drivers ? drivers.length : null,
      source: "seal",
      fromProjection: true,
      drivers,
    };
  }
  const side = projection ? (projection.homeId === teamId ? "home" : projection.awayId === teamId ? "away" : null) : null;
  if (projection && side) {
    const unfiled = projection.unfiled[side];
    const drivers = projection.drivers[side].filter((driver) => driver.points > 0);
    return {
      points: projection.absencePoints[side],
      // A side the report marks NOT YET SUBMITTED takes current absences, as its seal would.
      basis: projection.basis.kind === "report" && !unfiled ? "report" : "current-absences",
      count: drivers.length,
      source: "projection",
      fromProjection: true,
      drivers,
    };
  }
  return {
    points: current.points,
    basis: "current-absences",
    count: current.absences.filter((absence) => absence.points > 0).length,
    source: "current",
    fromProjection: false,
    drivers: null,
  };
}

export type AbsenceGapPart = {
  kind: "not-on-report" | "weighted" | "only-on-report";
  players: { athleteId: string; name: string }[];
};

/**
 * Why the season odds' total (current absences) and the next game's total differ, by
 * player, from the two published lists only: who is counted out now but not on the
 * report for the next game, who is on both at a different weight (the report's status
 * weights him), and who is on the report but not counted out now. Null when the totals
 * are within 0.1 point or the next game's number is not a report's.
 */
export function absenceGap(
  current: { points: number; absences: readonly PublishedAbsence[] },
  next: NextGameAbsence,
): AbsenceGapPart[] | null {
  if (Math.abs(current.points - next.points) < 0.1 || next.basis !== "report" || !next.drivers) return null;
  const counted = current.absences.filter((absence) => absence.points > 0);
  const onReport = new Map(next.drivers.map((driver) => [driver.athleteId, driver]));
  const nowIds = new Set(counted.map((absence) => absence.athleteId));
  const player = (entry: { athleteId: string; name: string }) => ({ athleteId: entry.athleteId, name: entry.name });
  const parts: AbsenceGapPart[] = [
    { kind: "not-on-report", players: counted.filter((absence) => !onReport.has(absence.athleteId)).map(player) },
    {
      kind: "weighted",
      players: counted
        .filter((absence) => {
          const driver = onReport.get(absence.athleteId);
          return driver !== undefined && Math.abs(driver.points - absence.points) >= 0.05;
        })
        .map(player),
    },
    { kind: "only-on-report", players: next.drivers.filter((driver) => !nowIds.has(driver.athleteId)).map(player) },
  ];
  return parts.filter((part) => part.players.length > 0);
}
