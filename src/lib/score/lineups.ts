// Rebuilds who was on the floor from a game's normalised play-by-play, cuts the game into
// stints (the same ten players on the court) and audits the result against the box score.
// Pure: no fetch, no file access, no clock.
//
// Period 1 opens with the box score's starters. A later period opens either with the five
// who ended the period before, when the game logs ESPN's period-start substitutions (each
// change at the break is then a substitution at the period's full clock), or with the
// five inferred from the period itself: a player is on at the start if he acts, or is
// substituted out, before he is substituted in. When inference leaves a side short, the
// players who appear nowhere in the period fill it, and if more than one choice exists the
// box score decides, but only when exactly one choice reconciles with it.
//
// The stints feed a regularised adjusted plus-minus fit, where a wrong lineup does more
// harm than a missing one, so a game that does not reconcile keeps `stints: null` and the
// reason, and is never guessed.

import type { PlayerBoxLine } from "@/lib/season/player-stats";
import { periodSeconds, possessionEnds, type PlayEvent } from "./possessions";
import type { Five, LineupAudit, LineupSource, Stint } from "./types";

/** The rule a game's rebuilt stints must pass to be kept. */
export const REJECTION_RULE = {
  /** A player "misses" when his stint plus-minus is further than this from the box score's. */
  plusMinusTolerance: 1,
  /** More misses than this rejects the game (ESPN's own box plus-minus is sometimes wrong). */
  maxPlusMinusMisses: 2,
  /** Largest allowed gap, in minutes, between a player's stint time and box minutes. */
  maxMinutesGap: 2.0,
  /** Most complete period-start assignments the box score is asked to choose between. */
  maxAssignments: 256,
} as const;

export type GameInput = {
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  /** ESPN team ID to the box lines of everyone who played. */
  box: Record<string, PlayerBoxLine[]>;
  /** Athletes listed for each team who did not play; a substitution may still name one. */
  inactive?: Record<string, string[]>;
  events: PlayEvent[];
};

/**
 * How each team-period's opening five was found, counted over a game. Period 1 is counted
 * only when the box score does not mark exactly five starters.
 */
export type PeriodStartCounts = {
  /** Carried over from the period before, with ESPN's period-start substitutions. */
  substitutions: number;
  /** Exactly five players acted or left before coming in. */
  inferred: number;
  /** Inference left the side short and players silent all period filled it (one choice). */
  silentFill: number;
  /** More than one fill was possible; the box score picked the only one that reconciles. */
  fromBox: number;
  /** The game logs period-start substitutions, but the carried-over five contradicted the period's plays. */
  carryOverContradicted: number;
};

export type RebuildDiagnostics = {
  /** |stint plus-minus − box plus-minus| per player who played, for the assignment reported. */
  plusMinusGaps: number[];
  /** Players whose stints differ from the box score: signed gaps, stints minus box. */
  playerGaps: Array<{ athleteId: string; plusMinus: number; minutes: number }>;
  /** Possessions ended, per team ID. */
  possessions: Record<string, number>;
  /** Plays naming a player on the floor whom the rebuilt lineup has on the bench. */
  offFloorActions: number;
  /** Index into the events of the first play without five a side, or null. */
  firstWrongCount: number | null;
  periodStarts: PeriodStartCounts;
  /** Complete period-start assignments simulated, and how many reconciled. */
  assignmentsTried: number;
  assignmentsReconciled: number;
};

export type GameRebuild = {
  stints: Stint[] | null;
  audit: LineupAudit;
  diagnostics: RebuildDiagnostics;
};

type Side = "home" | "away";
type Lineups = Record<Side, Set<string>>;

type WorkingStint = {
  period: number;
  seconds: number;
  home: string[];
  away: string[];
  homePossessions: number;
  awayPossessions: number;
  homePoints: number;
  awayPoints: number;
  startMargin: number;
};

type PeriodResult = {
  stints: WorkingStint[];
  end: Record<Side, string[]>;
  wrongCountPlays: number;
  firstWrongCount: number | null;
  offFloorActions: number;
};

type OpeningOrigin = "starters" | "substitutions" | "inferred" | "silentFill" | "fromBox";

type Leaf = {
  periods: PeriodResult[];
  origins: OpeningOrigin[];
  contradicted: number;
};

function emptyCounts(): PeriodStartCounts {
  return { substitutions: 0, inferred: 0, silentFill: 0, fromBox: 0, carryOverContradicted: 0 };
}

function zeroAudit(source: LineupSource, rejected: string): LineupAudit {
  return {
    source,
    wrongCountPlays: 0,
    maxPlusMinusGap: 0,
    plusMinusMisses: 0,
    maxMinutesGap: 0,
    homePointsGap: 0,
    awayPointsGap: 0,
    rejected,
  };
}

function rejectedEarly(input: GameInput, reason: string): GameRebuild {
  return {
    stints: null,
    audit: zeroAudit("inferred", reason),
    diagnostics: {
      plusMinusGaps: [],
      playerGaps: [],
      possessions: { [input.homeId]: 0, [input.awayId]: 0 },
      offFloorActions: 0,
      firstWrongCount: null,
      periodStarts: emptyCounts(),
      assignmentsTried: 0,
      assignmentsReconciled: 0,
    },
  };
}

/** All ways to pick `size` items from `items`, in order. */
function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  return [
    ...combinations(rest, size - 1).map((tail) => [first, ...tail]),
    ...combinations(rest, size),
  ];
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Rebuilds a game's stints and audits them. Returns `stints: null` with a reason in
 * `audit.rejected` whenever the lineups cannot be trusted.
 */
export function rebuildGame(input: GameInput): GameRebuild {
  const { homeId, awayId, events } = input;
  const sideOf = (teamId: string | null): Side | null =>
    teamId === homeId ? "home" : teamId === awayId ? "away" : null;

  // Who belongs to which side.
  const roster = new Map<string, Side>();
  for (const side of ["home", "away"] as const) {
    const teamId = side === "home" ? homeId : awayId;
    for (const line of input.box[teamId] ?? []) roster.set(line.athleteId, side);
    for (const athleteId of input.inactive?.[teamId] ?? []) {
      if (!roster.has(athleteId)) roster.set(athleteId, side);
    }
  }
  const played: Record<Side, string[]> = {
    home: (input.box[homeId] ?? []).map((line) => line.athleteId),
    away: (input.box[awayId] ?? []).map((line) => line.athleteId),
  };
  const starters: Record<Side, string[]> = {
    home: (input.box[homeId] ?? []).filter((line) => line.starter).map((line) => line.athleteId),
    away: (input.box[awayId] ?? []).filter((line) => line.starter).map((line) => line.athleteId),
  };
  if (events.length === 0) return rejectedEarly(input, "plays: the summary has no plays");

  // Events by period, which must run 1, 2, 3, ... in order.
  const periods: number[] = [];
  const periodRanges: Array<[number, number]> = [];
  for (let index = 0; index < events.length; index += 1) {
    const period = events[index].period;
    if (periods.length === 0 || periods[periods.length - 1] !== period) {
      if (period !== periods.length + 1) {
        return rejectedEarly(input, `plays: period ${period} follows period ${periods.length}`);
      }
      periods.push(period);
      periodRanges.push([index, index + 1]);
    } else {
      periodRanges[periodRanges.length - 1][1] = index + 1;
    }
  }
  if (periods.length < 4) return rejectedEarly(input, `plays: only ${periods.length} periods`);

  const sideOfSubstitution = (event: PlayEvent & { kind: "substitution" }): Side | null =>
    (event.entering ? roster.get(event.entering) : undefined) ??
    (event.leaving ? roster.get(event.leaving) : undefined) ??
    sideOf(event.teamId);

  // Home minus away after each play, from the plays' own points (ESPN's running score is
  // shifted against the plays in some seasons).
  const marginAfter: number[] = [];
  let running = 0;
  for (const event of events) {
    const side = sideOf(event.teamId);
    if (side === "home") running += event.points;
    if (side === "away") running -= event.points;
    marginAfter.push(running);
  }

  const possessionAt = new Map<number, string>();
  for (const end of possessionEnds(events, homeId, awayId)) possessionAt.set(end.index, end.teamId);

  /**
   * How an athlete next shows up in the period after `from`: on the floor in a play, going
   * out, coming in, or not at all.
   */
  const nextAppearance = (
    athleteId: string,
    from: number,
    until: number,
  ): "acts" | "out" | "in" | "none" => {
    for (let index = from + 1; index < until; index += 1) {
      const event = events[index];
      if (event.kind === "substitution") {
        if (event.leaving === athleteId) return "out";
        if (event.entering === athleteId) return "in";
      } else if (event.onFloor.includes(athleteId)) {
        return "acts";
      }
    }
    return "none";
  };

  /** Plays one period from the given opening fives: lineups, stints, points, possessions. */
  const simulatePeriod = (periodIndex: number, opening: Record<Side, string[]>): PeriodResult => {
    const period = periods[periodIndex];
    const [first, until] = periodRanges[periodIndex];
    const lineups: Lineups = { home: new Set(opening.home), away: new Set(opening.away) };
    const stints: WorkingStint[] = [];
    let clock = periodSeconds(period);
    let margin = first > 0 ? marginAfter[first - 1] : 0;
    const open = (): WorkingStint => {
      const stint: WorkingStint = {
        period,
        seconds: 0,
        home: [...lineups.home],
        away: [...lineups.away],
        homePossessions: 0,
        awayPossessions: 0,
        homePoints: 0,
        awayPoints: 0,
        startMargin: margin,
      };
      stints.push(stint);
      return stint;
    };
    let current = open();
    const lastFoul: Record<Side, { clock: number; stint: WorkingStint } | null> = { home: null, away: null };
    let wrongCountPlays = 0;
    let firstWrongCount: number | null = null;
    let offFloorActions = 0;
    /** The stint on the floor when the clock first showed its current reading. */
    let clockStart = current;
    let seenClock = -1;

    for (let index = first; index < until; index += 1) {
      const event = events[index];
      if (event.clock !== seenClock) {
        seenClock = event.clock;
        clockStart = current;
      }
      if (event.clock < clock) {
        current.seconds += clock - event.clock;
        clock = event.clock;
      }
      const side = sideOf(event.teamId);

      if (event.kind === "substitution") {
        const subSide = sideOfSubstitution(event);
        if (subSide) {
          const five = lineups[subSide];
          let leaving = event.leaving;
          let entering = event.entering;
          // A half substitution naming a player already where it sends him repeats an
          // earlier one (ESPN logs some twice, a second apart).
          const repeat =
            (leaving === null && entering !== null && five.has(entering)) ||
            (entering === null && leaving !== null && !five.has(leaving));
          if (repeat) {
            leaving = null;
            entering = null;
          } else if (leaving === null) {
            // ESPN left out who went off: the one player on the floor who is not seen again
            // on it before he comes back in.
            const candidates = [...five].filter((id) => {
              const next = nextAppearance(id, index, until);
              return next === "in" || next === "none";
            });
            const returning = candidates.filter((id) => nextAppearance(id, index, until) === "in");
            leaving = returning.length === 1 ? returning[0] : candidates.length === 1 ? candidates[0] : null;
          }
          if (entering === null && !repeat) {
            const candidates = [...roster.entries()]
              .filter(([id, owner]) => owner === subSide && !five.has(id))
              .map(([id]) => id)
              .filter((id) => {
                const next = nextAppearance(id, index, until);
                return next === "acts" || next === "out";
              });
            entering = candidates.length === 1 ? candidates[0] : null;
          }
          const changed = (leaving !== null && five.has(leaving)) || (entering !== null && !five.has(entering));
          if (leaving !== null) five.delete(leaving);
          if (entering !== null) five.add(entering);
          if (changed) current = open();
        }
      } else if (event.kind === "foul" && side) {
        lastFoul[side] = { clock: event.clock, stint: current };
      }

      // Free throws, and the possession a free throw ends, go to the ten on the floor at the
      // foul. A made basket goes to the ten on the floor when its clock reading began: play
      // cannot resume between substitutions and a basket at the same clock, so ESPN logged
      // the substitutions too early. After a foul by the other side at that clock, it is the
      // and-one basket and goes with the foul.
      let credited = current;
      if (side && (event.kind === "freeThrow" || (event.kind === "fieldGoal" && event.made))) {
        const foul = lastFoul[side === "home" ? "away" : "home"];
        const atFoul = foul !== null && foul.clock === event.clock ? foul.stint : null;
        credited = atFoul ?? (event.kind === "fieldGoal" ? clockStart : current);
      }
      if (event.points > 0 && side) {
        if (side === "home") credited.homePoints += event.points;
        else credited.awayPoints += event.points;
      }
      const possessionTeam = possessionAt.get(index);
      if (possessionTeam !== undefined) {
        if (possessionTeam === homeId) credited.homePossessions += 1;
        else credited.awayPossessions += 1;
      }

      if (lineups.home.size !== 5 || lineups.away.size !== 5) {
        wrongCountPlays += 1;
        firstWrongCount ??= index;
      }
      for (const athleteId of event.onFloor) {
        const owner = roster.get(athleteId);
        if (owner && !lineups[owner].has(athleteId)) offFloorActions += 1;
      }
      margin = marginAfter[index];
    }
    current.seconds += clock;
    return {
      stints,
      end: { home: [...lineups.home], away: [...lineups.away] },
      wrongCountPlays,
      firstWrongCount,
      offFloorActions,
    };
  };

  /** Who must, and who cannot, have been on the floor when the period began. */
  const evidence = (periodIndex: number, side: Side) => {
    const [first, until] = periodRanges[periodIndex];
    const known = new Set<string>();
    const excluded = new Set<string>();
    const seen = new Set<string>();
    for (let index = first; index < until; index += 1) {
      const event = events[index];
      if (event.kind === "substitution") {
        if (event.leaving && roster.get(event.leaving) === side && !seen.has(event.leaving)) {
          known.add(event.leaving);
        }
        if (event.entering && roster.get(event.entering) === side && !seen.has(event.entering)) {
          excluded.add(event.entering);
        }
        if (event.leaving) seen.add(event.leaving);
        if (event.entering) seen.add(event.entering);
      } else {
        for (const athleteId of event.onFloor) {
          if (roster.get(athleteId) === side && !seen.has(athleteId)) known.add(athleteId);
          seen.add(athleteId);
        }
      }
    }
    const silent = played[side].filter((athleteId) => !seen.has(athleteId));
    return { known, excluded, silent };
  };

  // The game logs period-start substitutions when at least two later periods open with one
  // (from 2017-18 nearly every game does). Before that ESPN logs one now and then, which
  // is no reason to carry a five over the break.
  const periodsWithStartSubstitutions = new Set(
    events
      .filter((event) => event.kind === "substitution" && event.period >= 2 && event.clock === periodSeconds(event.period))
      .map((event) => event.period),
  );
  const logsPeriodStarts = periodsWithStartSubstitutions.size >= 2;

  // Every complete assignment of period-start fives the plays allow.
  const leaves: Leaf[] = [];
  let overflow = false;
  let deadEnd: string | null = null;
  const search = (periodIndex: number, done: PeriodResult[], origins: OpeningOrigin[], contradicted: number) => {
    if (overflow) return;
    if (periodIndex === periods.length) {
      leaves.push({ periods: done, origins, contradicted });
      if (leaves.length > REJECTION_RULE.maxAssignments) overflow = true;
      return;
    }
    const options: Record<Side, Array<{ five: string[]; origin: OpeningOrigin }>> = { home: [], away: [] };
    let contradictedHere = 0;
    for (const side of ["home", "away"] as const) {
      if (periodIndex === 0 && starters[side].length === 5) {
        options[side] = [{ five: starters[side], origin: "starters" }];
        continue;
      }
      const { known, excluded, silent } = evidence(periodIndex, side);
      if (periodIndex === 0) {
        // The box score marks more or fewer than five starters: infer the opening five as
        // for a later period, filling only from the players it marks.
        const marked = starters[side];
        const need = 5 - known.size;
        const pool = marked.length > 5 ? silent.filter((id) => marked.includes(id)) : silent;
        const fills = need >= 0 ? combinations(pool, need) : [];
        if (fills.length === 0) {
          deadEnd ??= `starters: the box score marks ${marked.length} ${side} starters and the plays do not settle the five`;
          continue;
        }
        const origin: OpeningOrigin = need === 0 ? "inferred" : fills.length === 1 ? "silentFill" : "fromBox";
        options[side] = fills.map((fill) => ({ five: [...known, ...fill], origin }));
        continue;
      }
      const carried = done[periodIndex - 1].end[side];
      if (logsPeriodStarts) {
        const consistent =
          carried.length === 5 &&
          [...known].every((id) => carried.includes(id)) &&
          carried.every((id) => !excluded.has(id));
        if (consistent) {
          options[side] = [{ five: carried, origin: "substitutions" }];
          continue;
        }
        contradictedHere += 1;
      }
      const need = 5 - known.size;
      if (need < 0) {
        deadEnd ??= `period-start: ${known.size} ${side} players are on the floor at the start of period ${periods[periodIndex]}`;
        continue;
      }
      const fills = combinations(silent, need);
      if (fills.length === 0) {
        deadEnd ??= `period-start: only ${known.size + silent.length} ${side} players could have opened period ${periods[periodIndex]}`;
        continue;
      }
      const origin: OpeningOrigin = need === 0 ? "inferred" : fills.length === 1 ? "silentFill" : "fromBox";
      options[side] = fills.map((fill) => ({ five: [...known, ...fill], origin }));
    }
    for (const home of options.home) {
      for (const away of options.away) {
        const result = simulatePeriod(periodIndex, { home: home.five, away: away.five });
        search(
          periodIndex + 1,
          [...done, result],
          [...origins, home.origin, away.origin],
          contradicted + contradictedHere,
        );
        if (overflow) return;
      }
    }
  };
  search(0, [], [], 0);

  if (overflow) {
    return rejectedEarly(input, `period-start: more than ${REJECTION_RULE.maxAssignments} possible assignments`);
  }
  if (leaves.length === 0) {
    return rejectedEarly(input, deadEnd ?? "period-start: no possible assignment");
  }

  const boxBySide: Record<Side, PlayerBoxLine[]> = { home: input.box[homeId] ?? [], away: input.box[awayId] ?? [] };
  const judged = leaves.map((leaf) => judge(leaf, input, boxBySide, logsPeriodStarts));
  const passing = judged.filter((entry) => entry.audit.rejected === null);
  let chosen: (typeof judged)[number];
  let rejected: string | null = null;
  if (judged.length === 1) {
    chosen = judged[0];
  } else if (passing.length === 1) {
    chosen = passing[0];
  } else {
    chosen = [...judged].sort((a, b) => badness(a.audit) - badness(b.audit))[0];
    rejected =
      passing.length === 0
        ? `period-start: none of ${judged.length} assignments reconciles (closest: ${String(chosen.audit.rejected)})`
        : `period-start: ${passing.length} of ${judged.length} assignments reconcile`;
  }
  const audit: LineupAudit = rejected ? { ...chosen.audit, rejected } : chosen.audit;
  const counts = emptyCounts();
  for (const origin of chosen.leaf.origins) {
    if (origin !== "starters") counts[origin] += 1;
  }
  counts.carryOverContradicted = chosen.leaf.contradicted;
  return {
    stints: audit.rejected === null ? chosen.stints : null,
    audit,
    diagnostics: {
      plusMinusGaps: chosen.plusMinusGaps,
      playerGaps: chosen.playerGaps,
      possessions: chosen.possessions,
      offFloorActions: chosen.leaf.periods.reduce((sum, period) => sum + period.offFloorActions, 0),
      firstWrongCount: chosen.leaf.periods.find((period) => period.firstWrongCount !== null)?.firstWrongCount ?? null,
      periodStarts: counts,
      assignmentsTried: judged.length,
      assignmentsReconciled: passing.length,
    },
  };
}

/** Orders failing assignments from closest to furthest from reconciling. */
function badness(audit: LineupAudit): number {
  return (
    audit.wrongCountPlays * 1000 +
    (Math.abs(audit.homePointsGap) + Math.abs(audit.awayPointsGap)) * 100 +
    audit.plusMinusMisses * 10 +
    audit.maxMinutesGap
  );
}

/** Merges a period's stints with no change of players, and drops empty ones. */
function tidy(stints: WorkingStint[]): WorkingStint[] {
  const output: WorkingStint[] = [];
  for (const stint of stints) {
    const empty =
      stint.seconds === 0 &&
      stint.homePoints === 0 &&
      stint.awayPoints === 0 &&
      stint.homePossessions === 0 &&
      stint.awayPossessions === 0;
    if (empty) continue;
    const last = output[output.length - 1];
    const sameFloor =
      last &&
      last.period === stint.period &&
      sameSet(last.home, stint.home) &&
      sameSet(last.away, stint.away);
    if (sameFloor) {
      last.seconds += stint.seconds;
      last.homePoints += stint.homePoints;
      last.awayPoints += stint.awayPoints;
      last.homePossessions += stint.homePossessions;
      last.awayPossessions += stint.awayPossessions;
    } else {
      output.push({ ...stint });
    }
  }
  return output;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function toFive(ids: readonly string[]): Five {
  const sorted = [...ids].sort();
  return [sorted[0], sorted[1], sorted[2], sorted[3], sorted[4]];
}

/** Audits one complete assignment against the box score. */
function judge(
  leaf: Leaf,
  input: GameInput,
  box: Record<Side, PlayerBoxLine[]>,
  logsPeriodStarts: boolean,
) {
  const all = leaf.periods.flatMap((period) => period.stints);
  const wrongCountPlays = leaf.periods.reduce((sum, period) => sum + period.wrongCountPlays, 0);
  let homePoints = 0;
  let awayPoints = 0;
  let homePossessions = 0;
  let awayPossessions = 0;
  const plusMinus = new Map<string, number>();
  const seconds = new Map<string, number>();
  for (const stint of all) {
    homePoints += stint.homePoints;
    awayPoints += stint.awayPoints;
    homePossessions += stint.homePossessions;
    awayPossessions += stint.awayPossessions;
    const net = stint.homePoints - stint.awayPoints;
    for (const id of stint.home) {
      plusMinus.set(id, (plusMinus.get(id) ?? 0) + net);
      seconds.set(id, (seconds.get(id) ?? 0) + stint.seconds);
    }
    for (const id of stint.away) {
      plusMinus.set(id, (plusMinus.get(id) ?? 0) - net);
      seconds.set(id, (seconds.get(id) ?? 0) + stint.seconds);
    }
  }

  const plusMinusGaps: number[] = [];
  const playerGaps: RebuildDiagnostics["playerGaps"] = [];
  let maxPlusMinusGap = 0;
  let plusMinusMisses = 0;
  let maxMinutesGap = 0;
  let worstMinutes = "";
  const inBox = new Set<string>();
  for (const line of [...box.home, ...box.away]) {
    inBox.add(line.athleteId);
    const signed = (plusMinus.get(line.athleteId) ?? 0) - line.plusMinus;
    const signedMinutes = (seconds.get(line.athleteId) ?? 0) / 60 - line.minutes;
    if (signed !== 0 || Math.abs(signedMinutes) > 1) {
      playerGaps.push({ athleteId: line.athleteId, plusMinus: signed, minutes: round1(signedMinutes) });
    }
    const gap = Math.abs(signed);
    plusMinusGaps.push(gap);
    maxPlusMinusGap = Math.max(maxPlusMinusGap, gap);
    if (gap > REJECTION_RULE.plusMinusTolerance) plusMinusMisses += 1;
    const minutesGap = Math.abs((seconds.get(line.athleteId) ?? 0) / 60 - line.minutes);
    if (minutesGap > maxMinutesGap) {
      maxMinutesGap = minutesGap;
      worstMinutes = line.athleteId;
    }
  }
  // Anyone on the floor whom the box score does not list as having played.
  const unlisted: string[] = [];
  for (const [athleteId, time] of seconds) {
    if (inBox.has(athleteId)) continue;
    if (time > 0) unlisted.push(athleteId);
    const minutesGap = time / 60;
    if (minutesGap > maxMinutesGap) {
      maxMinutesGap = minutesGap;
      worstMinutes = athleteId;
    }
    const gap = Math.abs(plusMinus.get(athleteId) ?? 0);
    playerGaps.push({ athleteId, plusMinus: plusMinus.get(athleteId) ?? 0, minutes: round1(minutesGap) });
    plusMinusGaps.push(gap);
    maxPlusMinusGap = Math.max(maxPlusMinusGap, gap);
    if (gap > REJECTION_RULE.plusMinusTolerance) plusMinusMisses += 1;
  }

  const homePointsGap = homePoints - input.homeScore;
  const awayPointsGap = awayPoints - input.awayScore;
  let rejected: string | null = null;
  if (wrongCountPlays > 0) {
    rejected = `lineup-count: ${wrongCountPlays} plays without five a side`;
  } else if (homePointsGap !== 0 || awayPointsGap !== 0) {
    rejected = `points: stints give ${homePoints}-${awayPoints}, final ${input.homeScore}-${input.awayScore}`;
  } else if (unlisted.length > 0) {
    rejected = `box: ${unlisted.length} players on the floor have no box line (${unlisted.join(", ")})`;
  } else if (plusMinusMisses > REJECTION_RULE.maxPlusMinusMisses) {
    rejected = `plus-minus: ${plusMinusMisses} players off by more than ${REJECTION_RULE.plusMinusTolerance} (largest ${maxPlusMinusGap})`;
  } else if (maxMinutesGap > REJECTION_RULE.maxMinutesGap) {
    rejected = `minutes: ${round1(maxMinutesGap)} minutes off for ${worstMinutes}`;
  }

  const source: LineupSource =
    logsPeriodStarts && leaf.origins.every((origin) => origin === "substitutions" || origin === "starters")
      ? "substitutions"
      : "inferred";
  const audit: LineupAudit = {
    source,
    wrongCountPlays,
    maxPlusMinusGap,
    plusMinusMisses,
    maxMinutesGap: round1(maxMinutesGap),
    homePointsGap,
    awayPointsGap,
    rejected,
  };
  const stints: Stint[] | null =
    wrongCountPlays > 0
      ? null
      : tidy(all).map((stint) => ({
          period: stint.period,
          seconds: round1(stint.seconds),
          home: toFive(stint.home),
          away: toFive(stint.away),
          homePossessions: stint.homePossessions,
          awayPossessions: stint.awayPossessions,
          homePoints: stint.homePoints,
          awayPoints: stint.awayPoints,
          startMargin: stint.startMargin,
        }));
  return {
    leaf,
    audit,
    stints,
    plusMinusGaps,
    playerGaps,
    possessions: { [input.homeId]: homePossessions, [input.awayId]: awayPossessions },
  };
}
