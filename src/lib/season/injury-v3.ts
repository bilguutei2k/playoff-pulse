// The v3 absence engine (`live-2026.27-v3`). Pure and deterministic. It sits beside v2's
// engine (`injury-model.ts`) and never writes v2's tracker: v2's player values, ratings
// replay and report-covered seal terms are reused unchanged (decision D7).
//
// What v3 changes, and only for absences carried forward in time:
// - D1: its own gap counter, the true number of team games (with a box score) since a
//   player's absence began, kept beside v2's `tracker.missed`;
// - D2 (H3): an unreported absence stops counting once the gap passes the rotation window;
// - D3/D4 (H2): return chances from a discrete-time hazard, h(class, bucket(k)), giving a
//   survival curve S(j), the chance he is still out at the team's j-th next game;
// - D5/D6 (H1): the season simulation samples one duration per player per iteration and
//   charges it game by game through placeholders, the play-in and every series.
//
// The switches exist only for the size report; production uses V3_ALL_ON.

import { absenceClass, type AbsenceClass, type StatusCode } from "@/lib/season/availability";
import type { StoredLine } from "@/lib/season/box-scores";
import {
  currentAbsences,
  expectedFurtherGames,
  lostValue,
  type AvailabilityTracker,
  type InjuryParams,
  type ListedPlayer,
  type ReportPoint,
  type StatusTable,
  type SurvivalTable,
  type TeamAbsences,
} from "@/lib/season/injury-model";
import type { AbsenceSchedule } from "@/lib/season/simulate";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";

/** The rotation window, as in v2's engine. */
export const ROTATION_GAMES = 10;
/** Unreported players stay listed as "no longer counted" while the gap is 11 to 20. */
export const NO_LONGER_COUNTED_UNTIL = 20;
/** Length of every survival curve handed to the simulator: more than any team's remaining games. */
export const SURVIVAL_HORIZON = 200;

// ---------------------------------------------------------------------------
// D1: the gap counter
// ---------------------------------------------------------------------------

export type GapEntry = { teamId: string; athleteId: string; season: number; gap: number };

export type GapTracker = {
  season: number | null;
  /** By `${teamId}:${athleteId}`. */
  gaps: Map<string, GapEntry>;
  /**
   * Amendment 1: each team's last filed report rows of the current season. A report marking
   * a team NOT YET SUBMITTED carries no information, so D2's expiry test reads these rows
   * for a team whose latest word is unfiled. Nothing else reads them.
   */
  filedRows: Map<string, readonly ListedPlayer[]>;
  /** Teams whose latest word is a report marking them NOT YET SUBMITTED. */
  unfiled: Set<string>;
};

export function createGapTracker(): GapTracker {
  return { season: null, gaps: new Map(), filedRows: new Map(), unfiled: new Set() };
}

/**
 * Records the report that becomes a team's latest word (as v2's replay and
 * `applyLatestReport` make it): filed rows replace its last filed rows; an unfiled report
 * leaves them and marks the team unfiled. A null point changes nothing, as in v2.
 */
export function recordLatestWord(tracker: GapTracker, point: ReportPoint | null, teamId: string): void {
  if (!point) return;
  if (point.notSubmitted.includes(teamId)) {
    tracker.unfiled.add(teamId);
    return;
  }
  tracker.unfiled.delete(teamId);
  tracker.filedRows.set(
    teamId,
    point.rows.filter((row) => row.teamId === teamId),
  );
}

/** The rows D2's expiry test reads for a team: its last filed rows when its latest word is unfiled. */
export function expiryRows(
  tracker: AvailabilityTracker,
  gaps: GapTracker,
  teamId: string,
): readonly ListedPlayer[] {
  if (gaps.unfiled.has(teamId)) return gaps.filedRows.get(teamId) ?? [];
  return tracker.latestRows.get(teamId) ?? [];
}

/**
 * One team's game with a stored box score. A gap starts when v2's tracker first records
 * the miss (`missedBefore === 0` in v2's absent list), grows by one for every later team
 * game with a box score in which the player does not appear, and ends when he appears for
 * that team, appears for another team, or the season rolls. Call once per team per game,
 * with that team's lines and v2's absences for it, as the replay's `onAbsences` does.
 */
export function recordGapGame(
  tracker: GapTracker,
  game: SeasonGame,
  teamId: string,
  lines: readonly StoredLine[],
  absences: TeamAbsences,
): void {
  if (tracker.season !== game.season) {
    tracker.gaps.clear();
    tracker.filedRows.clear();
    tracker.unfiled.clear();
    tracker.season = game.season;
  }
  const appeared = new Set(lines.map((line) => line[0]));
  for (const [key, entry] of tracker.gaps) {
    if (appeared.has(entry.athleteId)) {
      // Back for this team, or seen for another: the gap is over either way.
      tracker.gaps.delete(key);
    } else if (entry.teamId === teamId) {
      entry.gap += 1;
    }
  }
  for (const row of absences.absent) {
    if (row.missedBefore !== 0) continue;
    const key = `${teamId}:${row.athleteId}`;
    if (!tracker.gaps.has(key)) {
      tracker.gaps.set(key, { teamId, athleteId: row.athleteId, season: game.season, gap: 1 });
    }
  }
}

/**
 * An `onAbsences` hook for `replayInjuryModel` that keeps `tracker` up to date: gaps from
 * the box score, and the team's latest word from the game's final-point report, the report
 * the replay itself makes the team's latest rows.
 */
export function gapHook(
  tracker: GapTracker,
  source: {
    boxScores: (gameId: string) => Record<string, StoredLine[]> | undefined;
    availability: (gameId: string) => { final: ReportPoint | null } | null;
  },
  next?: (game: SeasonGame, teamId: string, absences: TeamAbsences) => void,
): (game: SeasonGame, teamId: string, absences: TeamAbsences) => void {
  return (game, teamId, absences) => {
    const lines = source.boxScores(game.id)?.[teamId];
    if (!lines) throw new Error(`gapHook: no box score lines for ${game.id} ${teamId}.`);
    recordGapGame(tracker, game, teamId, lines, absences);
    recordLatestWord(tracker, source.availability(game.id)?.final ?? null, teamId);
    next?.(game, teamId, absences);
  };
}

/**
 * v3's counterpart of v2's `applyLatestReport`, for the gap tracker: call it with the same
 * point and teams whenever v2's `applyLatestReport` is called on the tracker.
 */
export function applyLatestWord(tracker: GapTracker, point: ReportPoint | null, teamIds: Iterable<string>): void {
  for (const teamId of teamIds) recordLatestWord(tracker, point, teamId);
}

/** The gap for a player on a team in `season`, or 0. */
export function gapOf(tracker: GapTracker, season: number, teamId: string, athleteId: string): number {
  const entry = tracker.gaps.get(`${teamId}:${athleteId}`);
  return entry && entry.season === season ? entry.gap : 0;
}

// ---------------------------------------------------------------------------
// D3: hazards
// ---------------------------------------------------------------------------

/** Upper bound of each hazard bucket of k, games missed so far: 1, 2-3, 4-7, 8-15, 16-30, 31+. */
export const HAZARD_BUCKETS = [1, 3, 7, 15, 30, Number.POSITIVE_INFINITY] as const;
export const HAZARD_BUCKET_LABELS = ["1", "2-3", "4-7", "8-15", "16-30", "31+"] as const;

export type HazardTable = {
  /** P(returns at the team's next game | missed k so far), by bucket of k. */
  long: readonly number[];
  short: readonly number[];
  /** False when one table serves both classes (then long equals short). */
  classUsed: boolean;
};

/** Bucket of k games missed so far. Bucket 0 does not exist: nobody is at risk before missing a game. */
export function hazardBucket(k: number): number {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`No hazard for ${k} games missed: a player is at risk of returning only after missing one.`);
  }
  return HAZARD_BUCKETS.findIndex((upper) => k <= upper);
}

export function hazard(table: HazardTable, k: number, absence: AbsenceClass): number {
  const row = table.classUsed && absence === "long" ? table.long : table.short;
  return row[hazardBucket(k)];
}

export type HazardObservation = { k: number; class: AbsenceClass; returned: boolean };

export const MIN_AT_RISK = 100;
export const MIN_RETURNS = 5;

export type HazardCells = {
  atRisk: number[];
  returns: number[];
  /** The buckets each bucket was pooled with, itself included. */
  pools: number[][];
  hazards: number[];
};

/**
 * Returns / at-risk per bucket of one class. A cell needs at least MIN_AT_RISK at-risk
 * observations and MIN_RETURNS returns, else it pools with the next shorter bucket of its
 * class (the first bucket with the next longer), repeatedly. A zero tail hazard aborts.
 */
export function poolHazards(observations: readonly HazardObservation[]): HazardCells {
  const size = HAZARD_BUCKETS.length;
  const atRisk = new Array<number>(size).fill(0);
  const returns = new Array<number>(size).fill(0);
  for (const row of observations) {
    const bucket = hazardBucket(row.k);
    atRisk[bucket] += 1;
    if (row.returned) returns[bucket] += 1;
  }
  const groups = atRisk.map((count, index) => ({ count, returns: returns[index], members: [index] }));
  const short = (group: (typeof groups)[number]) => group.count < MIN_AT_RISK || group.returns < MIN_RETURNS;
  for (let index = groups.length - 1; index > 0; index -= 1) {
    if (short(groups[index])) {
      groups[index - 1].count += groups[index].count;
      groups[index - 1].returns += groups[index].returns;
      groups[index - 1].members.push(...groups[index].members);
      groups.splice(index, 1);
    }
  }
  if (groups.length > 1 && short(groups[0])) {
    groups[1].count += groups[0].count;
    groups[1].returns += groups[0].returns;
    groups[1].members.unshift(...groups[0].members);
    groups.shift();
  }
  if (short(groups[0])) {
    throw new Error("Hazard fit: a class cannot meet the cell minimum even fully pooled.");
  }
  const hazards = new Array<number>(size).fill(Number.NaN);
  const pools: number[][] = new Array(size);
  for (const group of groups) {
    for (const member of group.members) {
      hazards[member] = group.returns / group.count;
      pools[member] = [...group.members].sort((a, b) => a - b);
    }
  }
  if (!(hazards[size - 1] > 0)) throw new Error("Hazard fit: the tail hazard is zero.");
  return { atRisk, returns, pools, hazards };
}

export type HazardFit = {
  table: HazardTable;
  cells: { long: HazardCells; short: HazardCells; pooled: HazardCells };
  /** The three readings of "long's pooled hazard is below short's"; the fit requires them to agree. */
  classRule: { firstBucket: boolean; overall: boolean; everyBucket: boolean };
};

export function fitHazards(observations: readonly HazardObservation[]): HazardFit {
  const long = poolHazards(observations.filter((row) => row.class === "long"));
  const short = poolHazards(observations.filter((row) => row.class === "short"));
  const pooled = poolHazards(observations);
  const rate = (cells: HazardCells) =>
    cells.returns.reduce((sum, value) => sum + value, 0) / cells.atRisk.reduce((sum, value) => sum + value, 0);
  const classRule = {
    firstBucket: long.hazards[0] < short.hazards[0],
    overall: rate(long) < rate(short),
    everyBucket: long.hazards.every((value, index) => value < short.hazards[index]),
  };
  const readings = Object.values(classRule);
  if (readings.some((value) => value !== readings[0])) {
    throw new Error(`Hazard fit: the class rule's readings disagree (${JSON.stringify(classRule)}).`);
  }
  const classUsed = classRule.firstBucket;
  const table: HazardTable = classUsed
    ? { long: long.hazards, short: short.hazards, classUsed }
    : { long: pooled.hazards, short: pooled.hazards, classUsed };
  return { table, cells: { long, short, pooled }, classRule };
}

// ---------------------------------------------------------------------------
// D2 and D4: who is out, and for how long
// ---------------------------------------------------------------------------

export type V3Switches = {
  /** D1 and D2 (H3). Off: v2's `currentAbsences` set and its missed counts. */
  expiry: boolean;
  /** D3 to D5 (H2). Off: v2's mean cutoff as shares of a game, charged as v2 charges them. */
  hazards: boolean;
  /** D6 (H1). Off: v2's single postseason charge, placeholders uncharged. */
  postseasonSchedule: boolean;
};

export const V3_ALL_ON: V3Switches = { expiry: true, hazards: true, postseasonSchedule: true };
export const V3_ALL_OFF: V3Switches = { expiry: false, hazards: false, postseasonSchedule: false };

export type V3Model = {
  injury: InjuryParams;
  /** v2's frozen status weights, used for S(1) of a listed player. */
  statusTable: StatusTable;
  hazards: HazardTable;
  /** v2's frozen table, used only when `switches.hazards` is off. */
  v2Survival: SurvivalTable;
  switches: V3Switches;
};

export type CurrentAbsenceV3 = {
  teamId: string;
  athleteId: string;
  /** Points of margin the team loses while he is out. */
  points: number;
  /** k: games missed so far (D1's gap; v2's count with expiry off). */
  gamesMissed: number;
  class: AbsenceClass;
  /** His status on the team's latest rows, null when not listed. */
  status: StatusCode | null;
  reason: string | null;
};

export type NoLongerCounted = {
  teamId: string;
  athleteId: string;
  gamesMissed: number;
  reason: "out-of-rotation-window";
};

/**
 * Who is out as of the latest rows, v2's rule apart from D2. Report-listed players follow
 * the report as in v2 (Out or Doubtful counts; Probable or Available never; Questionable
 * when his gap is open). An unreported player in the gap map counts while his gap is at
 * most ROTATION_GAMES and his last team is this team; from 11 to 20 he is listed as no
 * longer counted, then dropped. Someone who joined another team is not listed. Amendment 1:
 * for a team whose latest word marks it NOT YET SUBMITTED, the expiry test (only) reads its
 * last filed rows of the season, so a listed long-term absentee does not expire; who counts
 * and his S(1) still read the latest rows as v2 does.
 */
export function currentAbsencesV3(
  tracker: AvailabilityTracker,
  gaps: GapTracker,
  season: number,
  model: V3Model,
): { current: CurrentAbsenceV3[]; noLongerCounted: NoLongerCounted[] } {
  if (!model.switches.expiry) {
    const current = currentAbsences(tracker, model.injury, model.v2Survival).map((row) => {
      const listed = tracker.latestRows.get(row.teamId)?.find((entry) => entry.athleteId === row.athleteId);
      return {
        teamId: row.teamId,
        athleteId: row.athleteId,
        points: row.points,
        gamesMissed: row.gamesMissed,
        class: row.class,
        status: listed?.status ?? null,
        reason: listed?.reason ?? null,
      };
    });
    return { current, noLongerCounted: [] };
  }
  const current: CurrentAbsenceV3[] = [];
  const noLongerCounted: NoLongerCounted[] = [];
  for (const team of SEASON_TEAMS) {
    const rows: readonly ListedPlayer[] = tracker.latestRows.get(team.id) ?? [];
    const statusOf = new Map(rows.map((row) => [row.athleteId, row]));
    const players = new Set<string>();
    for (const row of rows) {
      if (row.athleteId !== null && (row.status === "O" || row.status === "D")) players.add(row.athleteId);
    }
    for (const entry of gaps.gaps.values()) {
      if (entry.teamId !== team.id || entry.season !== season || entry.gap <= 0) continue;
      const listed = statusOf.get(entry.athleteId);
      if (listed) {
        if (listed.status === "P" || listed.status === "A") continue;
        players.add(entry.athleteId);
        continue;
      }
      // v2's rule: someone who has since joined another team is that team's concern.
      if (tracker.book.get(entry.athleteId)?.lastTeamId !== team.id) continue;
      // D2, amended: the expiry test reads the team's last filed rows if its latest word is unfiled.
      const onFiledRows = expiryRows(tracker, gaps, team.id).some((row) => row.athleteId === entry.athleteId);
      if (entry.gap > ROTATION_GAMES && !onFiledRows) {
        if (entry.gap <= NO_LONGER_COUNTED_UNTIL && lostValue(tracker.book, entry.athleteId, model.injury) > 0) {
          noLongerCounted.push({
            teamId: team.id,
            athleteId: entry.athleteId,
            gamesMissed: entry.gap,
            reason: "out-of-rotation-window",
          });
        }
        continue;
      }
      players.add(entry.athleteId);
    }
    // v2's order: listed Out/Doubtful first in report order, then the gap map's order.
    for (const athleteId of players) {
      const lost = lostValue(tracker.book, athleteId, model.injury);
      if (lost <= 0) continue;
      const row = statusOf.get(athleteId);
      current.push({
        teamId: team.id,
        athleteId,
        points: model.injury.beta * lost,
        gamesMissed: gapOf(gaps, season, team.id, athleteId),
        class: absenceClass(row?.reason),
        status: row?.status ?? null,
        reason: row?.reason ?? null,
      });
    }
  }
  return { current, noLongerCounted };
}

/**
 * S(1..horizon): the chance he is still out at the team's j-th next game (index j-1).
 * Hazards on (D4): S(1) is the status weight if he is listed Out, Doubtful or Questionable,
 * else 1 - h(k); S(j) = S(j-1) * (1 - h(k + j - 1)). Hazards off: v2's mean cutoff as
 * shares, S(j) = clamp(E - (j - 1), 0, 1) with E from v2's table.
 */
export function survivalCurve(
  absence: CurrentAbsenceV3,
  model: V3Model,
  horizon: number = SURVIVAL_HORIZON,
): number[] {
  const curve = new Array<number>(horizon);
  if (!model.switches.hazards) {
    const expected = expectedFurtherGames(model.v2Survival, absence.gamesMissed, absence.class);
    for (let index = 0; index < horizon; index += 1) {
      curve[index] = Math.max(0, Math.min(1, expected - index));
    }
    return curve;
  }
  const k = absence.gamesMissed;
  const listed = absence.status === "O" || absence.status === "D" || absence.status === "Q";
  let s = listed ? model.statusTable[absence.status as StatusCode] : 1 - hazard(model.hazards, k, absence.class);
  for (let j = 1; j <= horizon; j += 1) {
    if (j > 1) s *= 1 - hazard(model.hazards, k + j - 1, absence.class);
    curve[j - 1] = s;
  }
  return curve;
}

/** "Expected games" for display: the sum of S(j) over the team's remaining regular-season games. */
export function expectedGamesShown(curve: readonly number[], remainingRegularGames: number): number {
  let total = 0;
  for (let index = 0; index < Math.min(remainingRegularGames, curve.length); index += 1) total += curve[index];
  return total;
}

/** The number of next games missed for a uniform draw u: D = #{j : S(j) > u}. */
export function sampledDuration(curve: readonly number[], u: number): number {
  let count = 0;
  while (count < curve.length && curve[count] > u) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// D5 and D6: the season simulation's input (types in simulate.ts, `absenceSchedule`)
// ---------------------------------------------------------------------------

export { returnStreamSeed, type AbsenceSchedule, type ScheduledAbsence } from "@/lib/season/simulate";

export function buildAbsenceSchedule(current: readonly CurrentAbsenceV3[], model: V3Model): AbsenceSchedule {
  return {
    players: current.map((absence) => ({
      teamId: absence.teamId,
      athleteId: absence.athleteId,
      points: absence.points,
      survival: survivalCurve(absence, model),
      sampled: model.switches.hazards,
    })),
    postseasonSchedule: model.switches.postseasonSchedule,
  };
}

// ---------------------------------------------------------------------------
// Single-game expectations: seals for unfiled sides, projections, displayed charges
// ---------------------------------------------------------------------------

/** Expected points a team gives up at its j-th next game (j from 1): sum of points * S(j). */
export function expectedCharge(schedule: AbsenceSchedule, teamId: string, j: number): number {
  let total = 0;
  for (const player of schedule.players) {
    if (player.teamId !== teamId) continue;
    total += player.points * (player.survival[j - 1] ?? 0);
  }
  return total;
}

export type AbsenceDriverV3 = {
  athleteId: string;
  status: StatusCode | null;
  points: number;
};

/**
 * A team's expected absence for its next game from v3's current absences, with drivers:
 * the v3 counterpart of v2's `nextGameAbsenceDetail`, used for a side the report in use
 * marks NOT YET SUBMITTED. The report becomes the team's latest word on a copy of the
 * tracker. `absence` is in Game Score (points / beta), as seals store it.
 */
export function nextGameAbsenceDetailV3(
  point: ReportPoint | null,
  teamId: string,
  tracker: AvailabilityTracker,
  gaps: GapTracker,
  season: number,
  model: V3Model,
): { absence: number; drivers: AbsenceDriverV3[] } {
  const view: AvailabilityTracker = { ...tracker, latestRows: new Map(tracker.latestRows) };
  const gapView: GapTracker = { ...gaps, filedRows: new Map(gaps.filedRows), unfiled: new Set(gaps.unfiled) };
  if (point) view.latestRows.set(teamId, point.rows.filter((row) => row.teamId === teamId));
  recordLatestWord(gapView, point, teamId);
  const current = currentAbsencesV3(view, gapView, season, model).current.filter((row) => row.teamId === teamId);
  let points = 0;
  const drivers: AbsenceDriverV3[] = [];
  for (const absence of current) {
    const charge = absence.points * survivalCurve(absence, model, 1)[0];
    points += charge;
    if (charge > 0) drivers.push({ athleteId: absence.athleteId, status: absence.status, points: charge });
  }
  drivers.sort((a, b) => b.points - a.points || a.athleteId.localeCompare(b.athleteId));
  return { absence: model.injury.beta > 0 ? points / model.injury.beta : 0, drivers };
}
