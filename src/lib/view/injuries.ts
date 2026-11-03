// The players behind each side's absence term, as the game card and the game page list
// them. Bookkeeping and wording only: every number is a stored seal's or the published
// state's. A seal written before `driversComplete` existed stored its three largest drivers a side; the
// rest of its list is rebuilt from the report it used, named with their status and given
// only their combined points (the side's points minus the three), never a per-player number.

import type { StatusCode } from "@/lib/season/availability";
import type { LiveReport } from "@/lib/season/live-reports";
import type { GameForecastView } from "@/lib/season/slate";
import { displayName, nameKey, surname } from "@/lib/utils/injuries";
import { teamDisplay } from "@/lib/view/teams";

export type AbsencePlayer = {
  /** "First Last". */
  name: string;
  /** Null for a player counted because he missed the team's last game and is not listed. */
  status: StatusCode | null;
  /** Points of margin he costs the side, or null where the seal did not store them. */
  points: number | null;
};

export type AbsenceGroupKey = "out" | "missed" | "doubtful" | "questionable" | "probable";

export type AbsenceGroup = { key: AbsenceGroupKey; label: string; players: AbsencePlayer[] };

/**
 * How the report in use treated the team: it filed; it had not filed and the side counts
 * current absences (seals that record `unfiled`); or it had not filed and the side counted
 * nobody (seals written before that rule).
 */
export type Filing = "filed" | "unfiled-counted" | "unfiled-nobody";

export type AbsenceSide = {
  teamId: string;
  /** Points of margin the side gives up in this number. */
  points: number;
  filing: Filing;
  /** Everyone, players with stored points first (largest first), then the rest in report order. */
  players: AbsencePlayer[];
  /** The same players by status: out, missed the last game, doubtful, questionable, probable or available. */
  groups: AbsenceGroup[];
  /**
   * On a seal that stored only its three largest drivers: how many other players the
   * report listed (null when the report is not available) and the points they add together.
   */
  others: { count: number | null; points: number } | null;
};

export type AbsenceSides = { away: AbsenceSide; home: AbsenceSide };

const GROUPS: Array<{ key: AbsenceGroupKey; label: string; statuses: Array<StatusCode | null> }> = [
  { key: "out", label: "Out", statuses: ["O"] },
  { key: "missed", label: "Missed the last game", statuses: [null] },
  { key: "doubtful", label: "Doubtful", statuses: ["D"] },
  { key: "questionable", label: "Questionable", statuses: ["Q"] },
  { key: "probable", label: "Probable or available", statuses: ["P", "A"] },
];

/** Below this a side's leftover points are rounding, not players. */
const LEFTOVER_POINTS = 0.05;

function groupPlayers(players: readonly AbsencePlayer[]): AbsenceGroup[] {
  return GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    players: players.filter((player) => group.statuses.includes(player.status)),
  })).filter((group) => group.players.length > 0);
}

type ForecastLists = Pick<
  GameForecastView,
  "absencePoints" | "drivers" | "driversComplete" | "unfiled"
>;

/** Report rows for a team that are not one of the stored drivers, matched by name. */
function otherRows(report: LiveReport, teamId: string, stored: readonly AbsencePlayer[]) {
  const rows = report.rows.filter((row) => row[0] === teamId);
  const used = new Set<number>();
  for (const player of stored) {
    const key = nameKey(player.name);
    let index = rows.findIndex((row, at) => !used.has(at) && nameKey(row[1]) === key);
    if (index < 0) {
      // A first name spelled differently ("Nic" for "Nicolas"): match on surname if unique.
      const last = key.split(" ").at(-1);
      const candidates = rows
        .map((row, at) => ({ at, last: nameKey(row[1]).split(" ").at(-1) }))
        .filter((row) => !used.has(row.at) && row.last === last);
      if (candidates.length === 1) index = candidates[0].at;
    }
    if (index >= 0) used.add(index);
  }
  return rows.filter((_, at) => !used.has(at));
}

function buildSide(
  forecast: ForecastLists & { absencePoints: { home: number; away: number }; drivers: NonNullable<ForecastLists["drivers"]> },
  side: "home" | "away",
  teamId: string,
  report: LiveReport | null,
): AbsenceSide {
  const points = forecast.absencePoints[side];
  const stored: AbsencePlayer[] = forecast.drivers[side].map((driver) => ({
    name: displayName(driver.name),
    status: driver.status,
    points: driver.points,
  }));
  if (forecast.driversComplete) {
    return {
      teamId,
      points,
      filing: forecast.unfiled?.[side] ? "unfiled-counted" : "filed",
      players: stored,
      groups: groupPlayers(stored),
      others: null,
    };
  }
  const known = stored.reduce((sum, player) => sum + (player.points ?? 0), 0);
  const leftover = Math.max(0, points - known);
  const rest: AbsencePlayer[] = report
    ? otherRows(report, teamId, stored).map(([, printed, status]) => ({
        name: displayName(printed),
        status,
        points: null,
      }))
    : [];
  const players = [...stored, ...rest];
  let others: AbsenceSide["others"] = null;
  if (rest.length > 0) others = { count: rest.length, points: leftover };
  else if (leftover >= LEFTOVER_POINTS) others = { count: report ? 0 : null, points: leftover };
  return {
    teamId,
    points,
    filing: report?.notSubmitted.includes(teamId) ? "unfiled-nobody" : "filed",
    players,
    groups: groupPlayers(players),
    others,
  };
}

/**
 * Both sides' lists for a number with the injury term; null for a number without it.
 * `report` is the stored report the seal used, needed only for a seal that kept three
 * drivers a side.
 */
export function absenceSides(input: {
  forecast: ForecastLists | null;
  homeId: string;
  awayId: string;
  report: LiveReport | null;
}): AbsenceSides | null {
  const { forecast } = input;
  if (!forecast?.absencePoints || !forecast.drivers) return null;
  const full = { ...forecast, absencePoints: forecast.absencePoints, drivers: forecast.drivers };
  return {
    away: buildSide(full, "away", input.awayId, input.report),
    home: buildSide(full, "home", input.homeId, input.report),
  };
}

/** Players named on a card per side, at most. */
export const CARD_NAMED = 3;

const CARD_WORDS: Record<string, string> = { O: "out", D: "doubtful", Q: "questionable" };

/** Out, doubtful, questionable, or counted out because he missed the last game. */
function injured(player: AbsencePlayer): boolean {
  return player.status === null || player.status in CARD_WORDS;
}

function cardWord(player: AbsencePlayer): string {
  return player.status === null ? "missed last game" : CARD_WORDS[player.status];
}

/**
 * A card's injury line for one side, "IND −12.2: Haliburton, Siakam, Nembhard out +7 more":
 * the three largest out, doubtful or questionable players by points, then how many more
 * are listed at those statuses. Probable and available players are never named. Null for
 * a side whose absences move the line by less than `threshold` points.
 */
export function cardInjuryLine(side: AbsenceSide, threshold = 1): string | null {
  const code = teamDisplay(side.teamId).code;
  if (side.filing === "unfiled-nobody" && side.points < threshold) {
    return `${code}: report not filed, nobody counted`;
  }
  if (side.points < threshold) return null;
  const listed = side.players.filter(injured);
  const named = listed.filter((player) => player.points !== null).slice(0, CARD_NAMED);
  const more = listed.length - named.length;
  const words = named.map(cardWord);
  const names =
    named.length > 0 && words.every((word) => word === words[0])
      ? `${named.map((player) => surname(player.name)).join(", ")} ${words[0]}`
      : named.map((player, index) => `${surname(player.name)} ${words[index]}`).join(", ");
  let body: string;
  if (named.length > 0) body = more > 0 ? `${names} +${more} more` : names;
  else if (more > 0) body = `${more} listed`;
  else body = "probable or available players only";
  const filing = side.filing === "unfiled-counted" ? " (report not filed)" : "";
  return `${code} −${side.points.toFixed(1)}${filing}: ${body}`;
}

/** Both sides' card lines, away first; null for a number without the injury term. */
export function cardInjuryLines(sides: AbsenceSides | null, threshold = 1): string[] | null {
  if (!sides) return null;
  return [sides.away, sides.home]
    .map((side) => cardInjuryLine(side, threshold))
    .filter((line): line is string => line !== null);
}

/**
 * The game page's sentence for an unfiled side, or null. `today` says whether the game
 * is on today's slate.
 */
export function filingNote(side: AbsenceSide, today: boolean): string | null {
  const code = teamDisplay(side.teamId).code;
  const report = today ? "today's report" : "that day's report";
  if (side.filing === "unfiled-counted") {
    return `${code} had not filed ${report} when this was sealed, so this counts players who missed its last game.`;
  }
  if (side.filing === "unfiled-nobody") {
    return `${code} had not filed ${report} when this was sealed. Seals written before the rule changed in November 2026 counted nobody for a team that had not filed.`;
  }
  return null;
}

/** "The other 7 listed players add −9.6 pts together." for a seal that kept three drivers. */
export function othersNote(side: AbsenceSide): string | null {
  if (!side.others) return null;
  const points = `−${side.others.points.toFixed(1)} pts`;
  const stored = "This seal stored points for its three largest absences only.";
  if (side.others.count === null) {
    return `${stored} The rest of the report is not available here; the other players add ${points} together.`;
  }
  if (side.others.count === 0) return `${stored} Other players add ${points} together.`;
  const players = side.others.count === 1 ? "listed player adds" : `${side.others.count} listed players add`;
  return `${stored} The other ${players} ${points} together.`;
}

/** A player's points on the game page: "−2.7", or "<0.1" for a sliver. */
export function playerPoints(points: number): string {
  return points >= 0.05 ? `−${points.toFixed(1)}` : "<0.1";
}
