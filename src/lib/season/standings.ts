// Standings and NBA seeding from game results.
//
// Tiebreakers implemented, per NBA rules:
//   Two teams: head-to-head, division leader, division record (same division
//   only), conference record, point differential.
//   Three or more: division leader, combined head-to-head, division record (all
//   in one division only), conference record, point differential. As soon as any
//   team separates, the remainder restarts the procedure.
//
// Skipped on purpose: record against playoff-eligible teams in each conference.
// Eligibility depends on the result being computed, and gate S4 shows the
// implemented rules reproduce actual seeds without them. The final fallback,
// a random draw in the real rules, is a stable team-order choice here.

import { SEASON_TEAMS, TEAM_COUNT, teamIndex } from "@/lib/season/teams";
import type { Conference, Division, SeasonGame } from "@/lib/season/types";

const DIVISIONS: Division[] = [
  "Atlantic",
  "Central",
  "Southeast",
  "Northwest",
  "Pacific",
  "Southwest",
];

const CONFERENCE_INDEX = SEASON_TEAMS.map((team) => (team.conference === "East" ? 0 : 1));
const DIVISION_INDEX = SEASON_TEAMS.map((team) => DIVISIONS.indexOf(team.division));
const TEAMS_BY_CONFERENCE: Record<Conference, number[]> = {
  East: SEASON_TEAMS.flatMap((team, index) => (team.conference === "East" ? [index] : [])),
  West: SEASON_TEAMS.flatMap((team, index) => (team.conference === "West" ? [index] : [])),
};
const TEAMS_BY_DIVISION = DIVISIONS.map((division) =>
  SEASON_TEAMS.flatMap((team, index) => (team.division === division ? [index] : [])),
);

/** Flat, fast standings table. Everything is indexed by team order. */
export type StandingsTable = {
  wins: Int32Array;
  losses: Int32Array;
  divisionWins: Int32Array;
  divisionLosses: Int32Array;
  conferenceWins: Int32Array;
  conferenceLosses: Int32Array;
  /** Wins of row team over column team. */
  headToHead: Int32Array;
  pointDifferential: Float64Array;
};

export function createStandingsTable(): StandingsTable {
  return {
    wins: new Int32Array(TEAM_COUNT),
    losses: new Int32Array(TEAM_COUNT),
    divisionWins: new Int32Array(TEAM_COUNT),
    divisionLosses: new Int32Array(TEAM_COUNT),
    conferenceWins: new Int32Array(TEAM_COUNT),
    conferenceLosses: new Int32Array(TEAM_COUNT),
    headToHead: new Int32Array(TEAM_COUNT * TEAM_COUNT),
    pointDifferential: new Float64Array(TEAM_COUNT),
  };
}

export function copyStandingsTable(from: StandingsTable, to: StandingsTable): void {
  to.wins.set(from.wins);
  to.losses.set(from.losses);
  to.divisionWins.set(from.divisionWins);
  to.divisionLosses.set(from.divisionLosses);
  to.conferenceWins.set(from.conferenceWins);
  to.conferenceLosses.set(from.conferenceLosses);
  to.headToHead.set(from.headToHead);
  to.pointDifferential.set(from.pointDifferential);
}

export function recordGame(
  table: StandingsTable,
  home: number,
  away: number,
  homeMargin: number,
): void {
  const winner = homeMargin > 0 ? home : away;
  const loser = homeMargin > 0 ? away : home;
  table.wins[winner] += 1;
  table.losses[loser] += 1;
  table.headToHead[winner * TEAM_COUNT + loser] += 1;
  table.pointDifferential[home] += homeMargin;
  table.pointDifferential[away] -= homeMargin;
  if (CONFERENCE_INDEX[home] === CONFERENCE_INDEX[away]) {
    table.conferenceWins[winner] += 1;
    table.conferenceLosses[loser] += 1;
    if (DIVISION_INDEX[home] === DIVISION_INDEX[away]) {
      table.divisionWins[winner] += 1;
      table.divisionLosses[loser] += 1;
    }
  }
}

/** A game that counts toward standings: final, regular, not the Cup final. */
export function countsTowardStandings(game: SeasonGame): boolean {
  return (
    game.kind === "regular" &&
    game.status === "final" &&
    game.homeScore !== null &&
    game.awayScore !== null
  );
}

export function buildStandings(games: readonly SeasonGame[]): StandingsTable {
  const table = createStandingsTable();
  for (const game of games) {
    if (!countsTowardStandings(game)) continue;
    recordGame(
      table,
      teamIndex(game.homeId),
      teamIndex(game.awayId),
      (game.homeScore as number) - (game.awayScore as number),
    );
  }
  return table;
}

function ratio(wins: number, losses: number): number {
  const total = wins + losses;
  return total === 0 ? 0 : wins / total;
}

function winPercentage(table: StandingsTable, team: number): number {
  return ratio(table.wins[team], table.losses[team]);
}

/**
 * Sort `group` best first by `metric`, then resolve each set that is still tied
 * by restarting the procedure on it. Returns null when nothing separated.
 */
function separateBy(
  group: number[],
  metric: (team: number) => number,
  table: StandingsTable,
  isLeader: Uint8Array | null,
): number[] | null {
  const values = group.map((team) => ({ team, value: metric(team) }));
  values.sort((a, b) => b.value - a.value);
  if (Math.abs(values[0].value - values[values.length - 1].value) < 1e-9) return null;
  const result: number[] = [];
  let start = 0;
  while (start < values.length) {
    let end = start + 1;
    while (end < values.length && Math.abs(values[end].value - values[start].value) < 1e-9) {
      end += 1;
    }
    const tied = values.slice(start, end).map((entry) => entry.team);
    result.push(...(tied.length === 1 ? tied : breakTie(tied, table, isLeader)));
    start = end;
  }
  return result;
}

/**
 * Order a set of teams with identical win percentage. `isLeader` is null while
 * division leaders themselves are being determined, since the leader criterion
 * cannot apply to that decision.
 */
export function breakTie(
  group: number[],
  table: StandingsTable,
  isLeader: Uint8Array | null,
): number[] {
  if (group.length < 2) return [...group];
  const sameDivision = group.every(
    (team) => DIVISION_INDEX[team] === DIVISION_INDEX[group[0]],
  );
  const leaderMetric = (team: number) => (isLeader && isLeader[team] ? 1 : 0);
  const headToHeadMetric = (team: number) => {
    let wins = 0;
    let losses = 0;
    for (const other of group) {
      if (other === team) continue;
      wins += table.headToHead[team * TEAM_COUNT + other];
      losses += table.headToHead[other * TEAM_COUNT + team];
    }
    return ratio(wins, losses);
  };
  const steps: Array<(team: number) => number> =
    group.length === 2
      ? [headToHeadMetric, leaderMetric]
      : [leaderMetric, headToHeadMetric];
  if (sameDivision) {
    steps.push((team) => ratio(table.divisionWins[team], table.divisionLosses[team]));
  }
  steps.push((team) => ratio(table.conferenceWins[team], table.conferenceLosses[team]));
  steps.push((team) => table.pointDifferential[team]);
  for (const metric of steps) {
    const separated = separateBy(group, metric, table, isLeader);
    if (separated) return separated;
  }
  return [...group].sort((a, b) => a - b);
}

function orderByRecord(
  teams: number[],
  table: StandingsTable,
  isLeader: Uint8Array | null,
): number[] {
  const sorted = [...teams].sort(
    (a, b) => winPercentage(table, b) - winPercentage(table, a),
  );
  const result: number[] = [];
  let start = 0;
  while (start < sorted.length) {
    const value = winPercentage(table, sorted[start]);
    let end = start + 1;
    while (end < sorted.length && Math.abs(winPercentage(table, sorted[end]) - value) < 1e-9) {
      end += 1;
    }
    const tied = sorted.slice(start, end);
    result.push(...(tied.length === 1 ? tied : breakTie(tied, table, isLeader)));
    start = end;
  }
  return result;
}

const LEADER_SCRATCH = new Uint8Array(TEAM_COUNT);

export function divisionLeaders(table: StandingsTable, output = LEADER_SCRATCH): Uint8Array {
  output.fill(0);
  for (const teams of TEAMS_BY_DIVISION) {
    output[orderByRecord(teams, table, null)[0]] = 1;
  }
  return output;
}

/** Conference order, best seed first, as team indexes. */
export function seedConference(conference: Conference, table: StandingsTable): number[] {
  const leaders = divisionLeaders(table);
  return orderByRecord(TEAMS_BY_CONFERENCE[conference], table, leaders);
}

/** Better regular-season record, with a stable resolution of exact ties. */
export function hasHomeCourt(
  a: number,
  b: number,
  table: StandingsTable,
): boolean {
  const difference = winPercentage(table, a) - winPercentage(table, b);
  if (Math.abs(difference) >= 1e-9) return difference > 0;
  const leaders = divisionLeaders(table);
  return breakTie([a, b], table, leaders)[0] === a;
}

export { TEAMS_BY_CONFERENCE };
