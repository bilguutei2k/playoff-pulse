// Normalised play-by-play events, and where possessions end. Pure: no fetch, no file
// access, no clock.
//
// The ESPN adapter (src/lib/live-data/espn-plays.ts) turns a game summary's plays into
// `PlayEvent`s; nothing in this folder reads ESPN's strings. `lineups.ts` walks the same
// events to rebuild who was on the floor and credits each possession to a stint.
//
// A possession ends on a made field goal (after its and-one free throw, if any), a
// rebound by the other side after a live miss, a turnover, the last free throw of a trip
// when it is made, or the end of a period while a side has the ball. Free throws after a
// technical, flagrant, clear-path, take or away-from-play foul never end one: the side
// that had the ball keeps it. Rebounds that follow no live miss (ESPN logs a team rebound after every missed
// first free throw) change nothing.

/** Free throws by what awarded them. Only "regular" trips can end a possession. */
export type FreeThrowKind = "regular" | "technical" | "flagrant" | "clearPath";

type EventBase = {
  period: number;
  /** Seconds left on the game clock. */
  clock: number;
  /**
   * ESPN team ID the play belongs to: the shooter's side for shots (also when blocked),
   * the fouling side for fouls, the side that lost the ball for turnovers. Null when
   * ESPN names no team.
   */
  teamId: string | null;
  /** Athletes the play shows on the floor. Empty for technicals, ejections and team plays. */
  onFloor: string[];
  /** Points the play scored for `teamId` (0 when none). */
  points: number;
  /** ESPN's running score after the play. */
  homeScore: number;
  awayScore: number;
};

export type PlayEvent =
  | (EventBase & { kind: "substitution"; entering: string | null; leaving: string | null })
  | (EventBase & { kind: "fieldGoal"; made: boolean })
  | (EventBase & {
      kind: "freeThrow";
      made: boolean;
      freeThrow: FreeThrowKind;
      /** "2 of 3" is number 2 of 3; a technical free throw is 1 of 1. */
      number: number;
      of: number;
    })
  | (EventBase & {
      kind: "rebound";
      /** Null when ESPN does not say. */
      side: "offensive" | "defensive" | null;
      /** A team rebound (no player credited); ESPN's team on these is unreliable in early seasons. */
      byTeam: boolean;
    })
  | (EventBase & { kind: "turnover" })
  /** Every foul, including technical, flagrant and offensive fouls. */
  | (EventBase & { kind: "foul" })
  | (EventBase & { kind: "periodEnd" })
  /** Jump balls, timeouts, violations, reviews, ejections and anything else. */
  | (EventBase & { kind: "other" });

export type PossessionEnd = {
  /** Index into the event list of the play that ended the possession. */
  index: number;
  /** The side that had the ball. */
  teamId: string;
};

/** Regulation periods last twelve minutes, overtimes five. */
export function periodSeconds(period: number): number {
  return period <= 4 ? 720 : 300;
}

function otherSide(teamId: string, homeId: string, awayId: string): string {
  return teamId === homeId ? awayId : homeId;
}

/**
 * Whether the made field goal at `index` draws an and-one: a single regular free throw by
 * the same side at the same game clock, before any other shot, rebound or turnover.
 */
export function drawsAndOne(events: readonly PlayEvent[], index: number): boolean {
  const shot = events[index];
  for (let next = index + 1; next < events.length; next += 1) {
    const event = events[next];
    if (event.period !== shot.period || event.clock !== shot.clock) return false;
    if (event.kind === "freeThrow") {
      if (event.freeThrow !== "regular") continue;
      return event.teamId === shot.teamId && event.of === 1;
    }
    if (event.kind === "fieldGoal" || event.kind === "rebound" || event.kind === "turnover") return false;
    if (event.kind === "periodEnd") return false;
  }
  return false;
}

/**
 * Whether the single regular free throw at `index` is an and-one: a made field goal by the
 * same side at the same clock comes just before it, or (ESPN sometimes logs them the other
 * way round) just after it, with no other shot, rebound or turnover between. A single free
 * throw that is not an and-one follows a take foul or an away-from-play foul, after which
 * the shooting side keeps the ball.
 */
export function isAndOne(events: readonly PlayEvent[], index: number): boolean {
  const shot = events[index];
  if (shot.kind !== "freeThrow" || shot.freeThrow !== "regular" || shot.of !== 1) return false;
  const search = (step: 1 | -1): boolean => {
    for (let other = index + step; other >= 0 && other < events.length; other += step) {
      const event = events[other];
      if (event.period !== shot.period || event.clock !== shot.clock) return false;
      if (event.kind === "fieldGoal") return event.made && event.teamId === shot.teamId;
      if (event.kind === "freeThrow" && event.freeThrow !== "technical") return false;
      if (event.kind === "rebound" || event.kind === "turnover" || event.kind === "periodEnd") return false;
    }
    return false;
  };
  return search(-1) || search(1);
}

/** Whether the and-one at `index` was logged before its basket (the basket then ends the possession). */
function precedesItsBasket(events: readonly PlayEvent[], index: number): boolean {
  const shot = events[index];
  for (let next = index + 1; next < events.length; next += 1) {
    const event = events[next];
    if (event.period !== shot.period || event.clock !== shot.clock) return false;
    if (event.kind === "fieldGoal") return event.made && event.teamId === shot.teamId;
    if (event.kind === "freeThrow" && event.freeThrow !== "technical") return false;
    if (event.kind === "rebound" || event.kind === "turnover" || event.kind === "periodEnd") return false;
  }
  return false;
}

/**
 * Every possession end in a game's events, in order. A period whose events stop without
 * a period-end play is closed at its last event.
 */
export function possessionEnds(
  events: readonly PlayEvent[],
  homeId: string,
  awayId: string,
): PossessionEnd[] {
  const ends: PossessionEnd[] = [];
  /** The side whose missed shot or last free throw is still live, waiting for a rebound. */
  let liveMiss: string | null = null;
  /** The side with the ball, and whether it has done anything with it yet. */
  let ball: string | null = null;
  let open = false;

  const end = (index: number, teamId: string) => {
    ends.push({ index, teamId });
    ball = otherSide(teamId, homeId, awayId);
    open = false;
    liveMiss = null;
  };
  const closePeriod = (index: number) => {
    if (open && ball) end(index, ball);
    ball = null;
    open = false;
    liveMiss = null;
  };

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const team = event.teamId;
    switch (event.kind) {
      case "fieldGoal":
        if (!team) break;
        ball = team;
        open = true;
        if (event.made) {
          liveMiss = null;
          if (!drawsAndOne(events, index)) end(index, team);
        } else {
          liveMiss = team;
        }
        break;
      case "freeThrow":
        if (!team || event.freeThrow === "technical") break;
        ball = team;
        open = true;
        if (event.freeThrow !== "regular" || event.number < event.of) {
          // Dead ball: a first free throw, or one after which the shooting side keeps the ball.
          liveMiss = null;
        } else if (!event.made) {
          liveMiss = team;
        } else if (event.of === 1 && (!isAndOne(events, index) || precedesItsBasket(events, index))) {
          // A take or away-from-play free throw (the side keeps the ball), or an and-one logged
          // before its basket, which then ends the possession.
          liveMiss = null;
        } else {
          end(index, team);
        }
        break;
      case "rebound": {
        // A rebound only matters after a live miss. For a player's rebound his side decides,
        // not the label; for a team rebound the label does (ESPN names the wrong team on
        // many, notably in 2010-11 and 2011-12).
        if (!liveMiss) break;
        if (!team && (!event.byTeam || event.side === null)) break;
        const kept = event.byTeam && event.side !== null ? event.side === "offensive" : team === liveMiss;
        if (kept) {
          ball = liveMiss;
          open = true;
          liveMiss = null;
        } else {
          end(index, liveMiss);
        }
        break;
      }
      case "turnover":
        if (team) end(index, team);
        break;
      case "periodEnd":
        closePeriod(index);
        break;
      default:
        break;
    }
    const next = events[index + 1];
    if (event.kind !== "periodEnd" && (!next || next.period !== event.period)) closePeriod(index);
  }
  return ends;
}
