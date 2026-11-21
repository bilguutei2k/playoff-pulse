// v4, M2: expected minutes (docs/live/registration-v4.md). Pure: no files, no clock.
//
// A player's expected minutes are his running average of minutes in games played
// (decay alpha) times a presence weight, rescaled so his team's weights sum to 5 (240
// minutes). Presence is 1 after a game played and halves with each team game missed
// while not listed. Listed players take presence 1 - P(out | status). A player listed on
// the previous game's rows and now unlisted takes presence 1. Nobody is ever inferred
// out: without a report row a player only fades (H3).
//
// Membership: a player belongs to the team of his last appearance. On opening night a
// team's members are its stored roster (live) or its first-five-games membership
// (history, disclosed). A team the report marks NOT YET SUBMITTED keeps its last filed
// rows of the season, for every purpose (v3 Amendment 1's reading).

import type { StatusCode } from "@/lib/season/availability";

export type ListedRow = { athleteId: string; status: StatusCode; reason: string };

export type MinutesPlayer = {
  /** Running average of minutes in games played; null before his first game. */
  average: number | null;
  team: string | null;
  presence: number;
  /** On his team's rows for its latest game. */
  listed: boolean;
  /** Team games (with usable lines) since his last appearance for his team. */
  missed: number;
  /** Team games as a member and games played, by season, for S1's long-run rate. */
  participation: Map<number, { games: number; played: number }>;
};

export type MinutesState = {
  players: Map<string, MinutesPlayer>;
  /** Team ID to member athlete IDs. Iterated in sorted order wherever a sum depends on it. */
  members: Map<string, Set<string>>;
  /** Team ID to its last filed rows of the season (for NOT YET SUBMITTED). */
  filedRows: Map<string, ListedRow[]>;
};

export function createMinutesState(): MinutesState {
  return { players: new Map(), members: new Map(), filedRows: new Map() };
}

export function copyMinutesState(state: MinutesState): MinutesState {
  const players = new Map<string, MinutesPlayer>();
  for (const [id, player] of state.players) {
    players.set(id, {
      ...player,
      participation: new Map([...player.participation].map(([season, row]) => [season, { ...row }])),
    });
  }
  return {
    players,
    members: new Map([...state.members].map(([team, set]) => [team, new Set(set)])),
    filedRows: new Map([...state.filedRows].map(([team, rows]) => [team, rows.map((row) => ({ ...row }))])),
  };
}

function playerOf(state: MinutesState, athleteId: string): MinutesPlayer {
  let player = state.players.get(athleteId);
  if (!player) {
    player = { average: null, team: null, presence: 1, listed: false, missed: 0, participation: new Map() };
    state.players.set(athleteId, player);
  }
  return player;
}

function join(state: MinutesState, athleteId: string, teamId: string): MinutesPlayer {
  const player = playerOf(state, athleteId);
  if (player.team !== teamId) {
    if (player.team !== null) state.members.get(player.team)?.delete(athleteId);
    player.team = teamId;
    player.presence = 1;
    player.listed = false;
    player.missed = 0;
  }
  let set = state.members.get(teamId);
  if (!set) {
    set = new Set();
    state.members.set(teamId, set);
  }
  set.add(athleteId);
  return player;
}

/** Season start: every team's members are replaced by its opening roster, presence 1. */
export function setOpeningRosters(state: MinutesState, rosters: ReadonlyMap<string, readonly string[]>): void {
  state.members.clear();
  state.filedRows.clear();
  for (const player of state.players.values()) {
    player.team = null;
    player.listed = false;
    player.missed = 0;
    player.presence = 1;
  }
  for (const teamId of [...rosters.keys()].sort()) {
    for (const athleteId of [...(rosters.get(teamId) ?? [])].sort()) join(state, athleteId, teamId);
  }
}

/** The rows that stand for a team: the report's, or its last filed rows when it has not submitted. */
export function teamRows(
  state: MinutesState,
  teamId: string,
  report: { rows: readonly ListedRow[]; unfiled: boolean } | null,
): ListedRow[] {
  if (!report) return [];
  if (report.unfiled) return state.filedRows.get(teamId) ?? [];
  return [...report.rows];
}

/** Records the rows a team's game was played under (filed rows only change when it filed). */
export function recordRows(
  state: MinutesState,
  teamId: string,
  report: { rows: readonly ListedRow[]; unfiled: boolean } | null,
): void {
  if (report && !report.unfiled) state.filedRows.set(teamId, report.rows.map((row) => ({ ...row })));
}

export type WeightTerm = {
  athleteId: string;
  /** Expected minutes before rescaling: average * presence. */
  raw: number;
  /** P(out) for a Questionable or Doubtful player (enumerated); null otherwise. */
  pOut: number | null;
  status: StatusCode | null;
};

/**
 * One team's expected-minutes terms for its next game, sorted by athlete ID. Players with
 * a status of Q or D are returned with `pOut` for M5's enumeration and `raw` at presence 1;
 * every other listed player takes presence 1 - P(out | status).
 */
export function minutesTerms(
  state: MinutesState,
  teamId: string,
  rows: readonly ListedRow[],
  statusTable: Readonly<Record<StatusCode, number>>,
  newPlayerMinutes: number,
): WeightTerm[] {
  const listed = new Map(rows.map((row) => [row.athleteId, row]));
  const terms: WeightTerm[] = [];
  for (const athleteId of [...(state.members.get(teamId) ?? [])].sort()) {
    const player = state.players.get(athleteId) as MinutesPlayer;
    const average = player.average ?? newPlayerMinutes;
    const row = listed.get(athleteId);
    if (row) {
      const pOut = statusTable[row.status];
      if (row.status === "Q" || row.status === "D") {
        terms.push({ athleteId, raw: average, pOut, status: row.status });
      } else {
        terms.push({ athleteId, raw: average * (1 - pOut), pOut: null, status: row.status });
      }
    } else {
      const presence = player.listed ? 1 : player.presence;
      terms.push({ athleteId, raw: average * presence, pOut: null, status: null });
    }
  }
  return terms;
}

/** Rescales raw expected minutes (each raised to kappa) so they sum to 5. Empty when nothing is positive. */
export function rescaleWeights(raw: ReadonlyArray<[string, number]>, kappa = 1): Array<[string, number]> {
  let total = 0;
  const powered = raw.map(([id, value]) => {
    const x = value > 0 ? (kappa === 1 ? value : value ** kappa) : 0;
    total += x;
    return [id, x] as [string, number];
  });
  if (!(total > 0)) return [];
  return powered.filter(([, x]) => x > 0).map(([id, x]) => [id, (5 * x) / total]);
}

/**
 * After a team-game with usable lines: members who played take presence 1 and update their
 * average; members who did not play halve their presence unless listed for this game (a
 * player listed for the previous game and unlisted now first returns to presence 1).
 */
export function recordTeamGame(
  state: MinutesState,
  season: number,
  teamId: string,
  lines: ReadonlyArray<[string, number]>,
  rows: readonly ListedRow[],
  alpha: number,
): void {
  const listedNow = new Set(rows.map((row) => row.athleteId));
  const played = new Map(lines.filter(([, minutes]) => minutes > 0));
  for (const athleteId of [...(state.members.get(teamId) ?? [])].sort()) {
    if (played.has(athleteId)) continue;
    const player = state.players.get(athleteId) as MinutesPlayer;
    if (player.listed && !listedNow.has(athleteId)) player.presence = 1;
    if (!listedNow.has(athleteId)) player.presence *= 0.5;
    player.missed += 1;
    player.listed = listedNow.has(athleteId);
    const row = player.participation.get(season) ?? { games: 0, played: 0 };
    row.games += 1;
    player.participation.set(season, row);
  }
  for (const [athleteId, minutes] of [...played].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const player = join(state, athleteId, teamId);
    player.presence = 1;
    player.missed = 0;
    player.listed = listedNow.has(athleteId);
    player.average = player.average === null ? minutes : (1 - alpha) * player.average + alpha * minutes;
    const row = player.participation.get(season) ?? { games: 0, played: 0 };
    row.games += 1;
    row.played += 1;
    player.participation.set(season, row);
  }
}

/** Marks who is listed after a team-game without usable lines: rows change, nothing else does. */
export function recordListingOnly(state: MinutesState, teamId: string, rows: readonly ListedRow[]): void {
  const listedNow = new Set(rows.map((row) => row.athleteId));
  for (const athleteId of state.members.get(teamId) ?? []) {
    const player = state.players.get(athleteId) as MinutesPlayer;
    player.listed = listedNow.has(athleteId);
  }
}
