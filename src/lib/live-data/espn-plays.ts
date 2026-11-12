// ESPN adapter for the 548 score: strictly validates a stored game summary's header, box
// score and play-by-play into the normalised events the score's lineup rebuild reads
// (`PlayEvent` in src/lib/score/possessions.ts). Every ESPN play-type string is read here
// and nowhere else.
//
// Anything that does not match the expected shape throws; the build script then keeps the
// game's box lines (when they parsed) and rejects its lineups. This module may import the
// score's types; the score never imports from here.

import type { FreeThrowKind, PlayEvent } from "@/lib/score/possessions";
import { periodSeconds } from "@/lib/score/possessions";
import type { PlayerBoxScore } from "@/lib/season/player-stats";
import { parsePlayerBoxScore } from "./espn-season";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Team totals the box score carries beyond its player lines. Null when ESPN omits one. */
export type TeamTotals = {
  /** Player and team turnovers together (ESPN's "totalTurnovers"). */
  totalTurnovers: number | null;
  offensiveRebounds: number | null;
};

export type ScoreSummary = {
  gameId: string;
  homeId: string;
  awayId: string;
  /** Final score from the summary's header. */
  homeScore: number;
  awayScore: number;
  box: PlayerBoxScore;
  teamTotals: Record<string, TeamTotals>;
};

/** Seconds left from ESPN's clock text: "11:42", "0:55.3", "55.3" or "5". */
export function parseClock(display: string, period: number, gameId: string): number {
  const minutes = /^(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(display);
  const seconds = minutes ? Number(minutes[1]) * 60 + Number(minutes[2]) : /^\d{1,3}(?:\.\d+)?$/.test(display) ? Number(display) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > periodSeconds(period)) {
    throw new Error(`ESPN plays ${gameId}: clock "${display}" in period ${period} is not a game clock.`);
  }
  return Math.round(seconds * 10) / 10;
}

/**
 * The header, box score and team totals of a stored summary. ESPN sometimes lists a
 * row with no athlete ID (a two-way player with only a short name), flagged did-not-play
 * or with an empty stat line; such a row names nobody and is dropped before the strict
 * box parser sees it. A row with no ID and real stats still throws.
 */
export function parseScoreSummary(payload: unknown, gameId: string): ScoreSummary {
  const root = asRecord(payload);
  const competition = asRecord(asArray(asRecord(root?.header)?.competitions)[0]);
  const competitors = asArray(competition?.competitors).map(asRecord);
  const home = competitors.find((row) => row?.homeAway === "home");
  const away = competitors.find((row) => row?.homeAway === "away");
  const homeId = String(asRecord(home?.team)?.id ?? "");
  const awayId = String(asRecord(away?.team)?.id ?? "");
  if (competitors.length !== 2 || !homeId || !awayId || homeId === awayId) {
    throw new Error(`ESPN summary ${gameId}: the header does not name a home and an away team.`);
  }
  const homeScore = Number(home?.score);
  const awayScore = Number(away?.score);
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) {
    throw new Error(`ESPN summary ${gameId}: the header has no final score.`);
  }

  const boxscore = asRecord(root?.boxscore);
  const cleanedPlayers = asArray(boxscore?.players).map((rawBlock) => {
    const block = asRecord(rawBlock);
    if (!block) return rawBlock;
    const statistics = asArray(block.statistics).map((rawGroup) => {
      const group = asRecord(rawGroup);
      if (!group) return rawGroup;
      const athletes = asArray(group.athletes).filter((rawRow) => {
        const row = asRecord(rawRow);
        const id = asRecord(row?.athlete)?.id;
        if (typeof id === "string" && id) return true;
        const empty = asArray(row?.stats).every((cell) => /^(--|[+-]?0|0-0)?$/.test(String(cell)));
        return !(row?.didNotPlay === true || empty);
      });
      return { ...group, athletes };
    });
    return { ...block, statistics };
  });
  const box = parsePlayerBoxScore({ boxscore: { ...boxscore, players: cleanedPlayers } }, gameId);
  if (!box[homeId] || !box[awayId]) {
    throw new Error(`ESPN summary ${gameId}: the box score's teams are not the header's.`);
  }

  const teamTotals: Record<string, TeamTotals> = {};
  for (const rawTeam of asArray(boxscore?.teams)) {
    const team = asRecord(rawTeam);
    const teamId = String(asRecord(team?.team)?.id ?? "");
    if (teamId !== homeId && teamId !== awayId) continue;
    const values = new Map<string, unknown>();
    for (const rawStat of asArray(team?.statistics)) {
      const stat = asRecord(rawStat);
      if (typeof stat?.name === "string") values.set(stat.name, stat.displayValue);
    }
    const whole = (name: string): number | null => {
      const value = Number(values.get(name));
      return values.has(name) && Number.isInteger(value) ? value : null;
    };
    teamTotals[teamId] = {
      totalTurnovers: whole("totalTurnovers") ?? whole("turnovers"),
      offensiveRebounds: whole("offensiveRebounds"),
    };
  }
  return { gameId, homeId, awayId, homeScore, awayScore, box, teamTotals };
}

const FREE_THROW = /^Free Throw - (?:(Technical|Flagrant|Clear Path)\s*)?(?:(\d) of (\d))?$/i;
const SUBSTITUTION = /^(.*?)\s*enters the game for\s*(.*?)$/;
/** Plays that name players who need not be on the floor: technicals, ejections, stoppages. */
const OFF_FLOOR_TYPES = /technical|techfoul|ejection|timeout|challenge|review|not available|replay/i;

type Kind = PlayEvent["kind"];

function classify(typeText: string, shooting: boolean): Kind {
  if (typeText === "Substitution") return "substitution";
  if (/^Free Throw\b/i.test(typeText)) return "freeThrow";
  if (/^end\b/i.test(typeText)) return "periodEnd";
  if (/rebound/i.test(typeText)) return "rebound";
  if (/turnover/i.test(typeText) || typeText === "Traveling") return "turnover";
  if (shooting) return "fieldGoal";
  if (/no foul/i.test(typeText)) return "other";
  if (/foul|technical|techfoul|3-seconds|offensive charge/i.test(typeText)) return "foul";
  return "other";
}

/**
 * A summary's plays as normalised events, in ESPN's order (sequence numbers are not
 * monotonic; the list order is, by period and clock). `roster` maps athlete IDs to team
 * IDs (everyone the box score lists); a play's side is its first participant's team where
 * the roster knows him, and ESPN's team otherwise.
 */
export function parsePlays(
  payload: unknown,
  gameId: string,
  homeId: string,
  awayId: string,
  roster: ReadonlyMap<string, string>,
): PlayEvent[] {
  const plays = asArray(asRecord(payload)?.plays);
  if (plays.length === 0) throw new Error(`ESPN plays ${gameId}: the summary has no plays.`);
  const events: PlayEvent[] = [];
  let lastPeriod = 1;
  let lastClock = Infinity;

  for (const [position, rawPlay] of plays.entries()) {
    const play = asRecord(rawPlay);
    const label = `ESPN plays ${gameId}: play ${position}`;
    const typeText = asRecord(play?.type)?.text;
    // ESPN leaves the text out of some plays (an ejection, a team technical); the type is required.
    const text = typeof play?.text === "string" ? play.text : "";
    if (typeof typeText !== "string" || !typeText) throw new Error(`${label} has no type.`);
    const period = Number(asRecord(play?.period)?.number);
    if (!Number.isInteger(period) || period < 1 || period < lastPeriod) {
      throw new Error(`${label} has period ${String(asRecord(play?.period)?.number)} after ${lastPeriod}.`);
    }
    const clockText = asRecord(play?.clock)?.displayValue;
    if (typeof clockText !== "string") throw new Error(`${label} has no clock.`);
    const clock = parseClock(clockText, period, gameId);
    if (period === lastPeriod && clock > lastClock) {
      throw new Error(`${label}: the clock runs backwards (${clockText}).`);
    }
    lastPeriod = period;
    lastClock = clock;
    const homeScore = Number(play?.homeScore);
    const awayScore = Number(play?.awayScore);
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) {
      throw new Error(`${label} has no running score.`);
    }
    const rawTeam = asRecord(play?.team)?.id;
    let teamId: string | null = null;
    if (rawTeam !== undefined) {
      teamId = String(rawTeam);
      if (teamId !== homeId && teamId !== awayId) throw new Error(`${label} names team ${teamId}.`);
    }
    const athletes = asArray(play?.participants).map((rawParticipant) => {
      const id = asRecord(asRecord(rawParticipant)?.athlete)?.id;
      if (typeof id !== "string" || !id) throw new Error(`${label} has a participant with no athlete ID.`);
      return id;
    });
    const shooting =
      typeof play?.shootingPlay === "boolean" ? play.shootingPlay : /\b(makes|misses)\b/.test(text);
    const kind = classify(typeText, shooting);
    const scoring = play?.scoringPlay === true && kind !== "periodEnd";
    const scoreValue = Number(play?.scoreValue ?? 0);
    // From 2012-13 to 2019-20 ESPN stores a made free throw with scoreValue 0, so a scoring
    // free throw counts one point whatever its scoreValue says.
    const points = !scoring ? 0 : kind === "freeThrow" ? 1 : Number.isFinite(scoreValue) ? scoreValue : NaN;
    if (points < 0 || points > 3 || !Number.isInteger(points)) throw new Error(`${label} scores ${points}.`);
    const onFloor = OFF_FLOOR_TYPES.test(typeText) && !/3-seconds/i.test(typeText) ? [] : athletes;
    const base = { period, clock, teamId, onFloor, points, homeScore, awayScore };

    switch (kind) {
      case "substitution": {
        const match = SUBSTITUTION.exec(text);
        let entering: string | null = null;
        let leaving: string | null = null;
        if (athletes.length >= 2) {
          [entering, leaving] = athletes;
        } else if (athletes.length === 1 && match) {
          // ESPN sometimes leaves one name out: "X enters the game for ".
          if (match[1] && !match[2]) entering = athletes[0];
          else if (!match[1] && match[2]) leaving = athletes[0];
        } else if (athletes.length === 0) {
          // A substitution play naming nobody (empty, or a mislabelled period end) says nothing.
          events.push({ ...base, onFloor: [], points: 0, kind: "other" });
          break;
        } else {
          throw new Error(`${label}: cannot read the substitution "${text}".`);
        }
        const side = (entering ? roster.get(entering) : undefined) ?? (leaving ? roster.get(leaving) : undefined);
        events.push({ ...base, teamId: side ?? teamId, onFloor: [], points: 0, kind, entering, leaving });
        break;
      }
      case "freeThrow": {
        const match = FREE_THROW.exec(typeText);
        if (!match) throw new Error(`${label}: unknown free throw "${typeText}".`);
        const cause = (match[1] ?? "").toLowerCase();
        const freeThrow: FreeThrowKind =
          cause === "technical" ? "technical" : cause === "flagrant" ? "flagrant" : cause === "clear path" ? "clearPath" : "regular";
        const number = match[2] ? Number(match[2]) : 1;
        const of = match[3] ? Number(match[3]) : 1;
        if (number < 1 || number > of || (!match[2] && freeThrow !== "technical")) {
          throw new Error(`${label}: unknown free throw "${typeText}".`);
        }
        const shooterTeam = (athletes[0] ? roster.get(athletes[0]) : undefined) ?? teamId;
        events.push({
          ...base,
          teamId: shooterTeam,
          onFloor: freeThrow === "technical" ? [] : athletes,
          kind,
          made: points > 0,
          freeThrow,
          number,
          of,
        });
        break;
      }
      case "fieldGoal": {
        // The shooter is always the first participant, also on a blocked shot ("X blocks Y's
        // layup" lists Y, then X).
        const shooterTeam = (athletes[0] ? roster.get(athletes[0]) : undefined) ?? teamId;
        events.push({ ...base, teamId: shooterTeam, kind, made: points > 0 });
        break;
      }
      case "rebound": {
        // Some seasons label a few rebounds just "Rebound"; the side then comes from the text.
        const described = `${typeText} ${text}`;
        const side = /offensive/i.test(described) ? "offensive" : /defensive/i.test(described) ? "defensive" : null;
        const reboundTeam = (athletes[0] ? roster.get(athletes[0]) : undefined) ?? teamId;
        events.push({ ...base, teamId: reboundTeam, kind, side, byTeam: athletes.length === 0 });
        break;
      }
      case "foul":
      case "turnover": {
        // The fouling side, or the side that lost the ball: the first participant's team.
        const actorTeam = (athletes[0] ? roster.get(athletes[0]) : undefined) ?? teamId;
        events.push({ ...base, teamId: actorTeam, kind });
        break;
      }
      default: {
        if (points > 0 && !teamId) {
          teamId = (athletes[0] ? roster.get(athletes[0]) : undefined) ?? null;
          if (!teamId) throw new Error(`${label} scores ${points} for no team.`);
        }
        events.push({ ...base, teamId, kind });
      }
    }
  }
  return pairHalfSubstitutions(events);
}

/**
 * ESPN (notably 2017-18 to 2019-20) often splits a substitution in two plays at the same
 * clock: "X enters the game for " and " enters the game for Y". Joins each such half that
 * names only the player coming in with the next half at the same clock, for the same team,
 * that names only the player going out (or the other way round), in order. A half that
 * repeats a player of a full substitution at the same clock ("X enters the game for ",
 * then "X enters the game for Y") is a duplicate and is dropped first. Halves left without
 * a partner stay as they are.
 */
export function pairHalfSubstitutions(events: readonly PlayEvent[]): PlayEvent[] {
  const output: PlayEvent[] = [];
  const dropped = new Set<number>();
  const sameMoment = (a: PlayEvent, b: PlayEvent) => a.period === b.period && a.clock === b.clock;
  for (let index = 0; index < events.length; index += 1) {
    const half = events[index];
    if (half.kind !== "substitution" || (half.entering === null) === (half.leaving === null)) continue;
    const named = half.entering ?? half.leaving;
    for (let other = index - 1; other >= 0 && sameMoment(events[other], half); other -= 1) {
      const full = events[other];
      if (full.kind === "substitution" && full.entering && full.leaving && (full.entering === named || full.leaving === named)) dropped.add(index);
    }
    for (let other = index + 1; other < events.length && sameMoment(events[other], half); other += 1) {
      const full = events[other];
      if (full.kind === "substitution" && full.entering && full.leaving && (full.entering === named || full.leaving === named)) dropped.add(index);
    }
  }
  for (let index = 0; index < events.length; index += 1) {
    if (dropped.has(index)) continue;
    const event = events[index];
    if (event.kind !== "substitution" || (event.entering === null) === (event.leaving === null)) {
      output.push(event);
      continue;
    }
    let partner = -1;
    for (let next = index + 1; next < events.length; next += 1) {
      const other = events[next];
      if (other.period !== event.period || other.clock !== event.clock) break;
      if (dropped.has(next) || other.kind !== "substitution" || other.teamId !== event.teamId) continue;
      const fits = event.entering === null
        ? other.entering !== null && other.leaving === null
        : other.leaving !== null && other.entering === null;
      if (fits) {
        partner = next;
        break;
      }
    }
    if (partner < 0) {
      output.push(event);
      continue;
    }
    const other = events[partner];
    if (other.kind !== "substitution") continue;
    dropped.add(partner);
    output.push({ ...event, entering: event.entering ?? other.entering, leaving: event.leaving ?? other.leaving });
  }
  return output;
}
