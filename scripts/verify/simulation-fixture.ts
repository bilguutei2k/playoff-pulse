// Fixed simulator inputs shared by the golden test (tests/season-simulator-golden.test.ts)
// and the v3 invariants (v3-invariants.ts). Never change what existing builders return. Nothing here
// is random at load time: every value is a pure function of the index it is built from.

import { addDays } from "@/lib/season/dates";
import { LIVE_PARAMS } from "@/lib/season/params";
import { createFilterState, type FilterState } from "@/lib/season/ratings";
import type { ObservedPostseason, SimulationAbsences, SimulationInput } from "@/lib/season/simulate";
import { HCA_INDEX, SEASON_TEAMS, STATE_SIZE, TEAM_COUNT } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";

export const FIXTURE_SEASON = 2027;
export const FIXTURE_AS_OF = "2027-03-20";

/** Ratings spread from -6 to +6, a small posterior covariance, home court 2.2. */
export function fixtureState(): FilterState {
  const state = createFilterState(LIVE_PARAMS);
  state.cov.fill(0);
  for (let index = 0; index < STATE_SIZE; index += 1) {
    state.cov[index * STATE_SIZE + index] = index < HCA_INDEX ? 1.5 + (index % 5) * 0.3 : 0.2;
    state.mean[index] = index < HCA_INDEX ? ((index * 7) % TEAM_COUNT) * 0.4 - 6 : 2.2;
  }
  for (let index = 0; index + 1 < HCA_INDEX; index += 2) {
    const a = index * STATE_SIZE + index + 1;
    const b = (index + 1) * STATE_SIZE + index;
    state.cov[a] = 0.1;
    state.cov[b] = 0.1;
  }
  return state;
}

function game(
  id: string,
  etDate: string,
  home: number,
  away: number,
  final: boolean,
  homeScore = 0,
  awayScore = 0,
): SeasonGame {
  return {
    id,
    season: FIXTURE_SEASON,
    kind: "regular",
    tipUtc: `${etDate}T23:30:00.000Z`,
    etDate,
    homeId: SEASON_TEAMS[home].id,
    awayId: SEASON_TEAMS[away].id,
    neutral: false,
    status: final ? "final" : "scheduled",
    homeScore: final ? homeScore : null,
    awayScore: final ? awayScore : null,
  };
}

/** Round `round` of a round robin by the circle method: team 0 fixed, the rest rotate. */
function circlePairs(round: number): Array<[number, number]> {
  const others = Array.from({ length: TEAM_COUNT - 1 }, (_, index) => 1 + ((index + round) % (TEAM_COUNT - 1)));
  const order = [0, ...others];
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < TEAM_COUNT / 2; index += 1) {
    pairs.push([order[index], order[TEAM_COUNT - 1 - index]]);
  }
  return pairs;
}

/**
 * A season in March: each team has 72 finished games, 8 scheduled ones (some on
 * back-to-backs), and 2 unscheduled slots left for placeholders.
 */
export function fixtureGames(): SeasonGame[] {
  const games: SeasonGame[] = [];
  let id = 0;
  // 72 finished: 36 rounds of the circle method, each pair home once and away once.
  for (let round = 0; round < 36; round += 1) {
    const etDate = addDays("2026-10-25", round * 4);
    for (const [a, b] of circlePairs(round % (TEAM_COUNT - 1))) {
      const swing = ((a * 13 + round * 7) % 23) - 11;
      id += 1;
      games.push(game(`f${id}`, etDate, a, b, true, 110 + swing, 108));
      id += 1;
      games.push(game(`f${id}`, addDays(etDate, 1), b, a, true, 104, 106 + swing));
    }
  }
  // Every team should have exactly 72 finished games; trim or pad is not needed by
  // construction, but the tests check the counts.
  // 8 scheduled: four days, two games a team each, the second day a back-to-back.
  for (let day = 0; day < 4; day += 1) {
    const first = addDays(FIXTURE_AS_OF, day * 3);
    for (let index = 0; index < TEAM_COUNT; index += 2) {
      const a = (index + day * 2) % TEAM_COUNT;
      const b = (index + 1 + day * 2) % TEAM_COUNT;
      id += 1;
      games.push(game(`s${id}`, first, a, b, false));
      id += 1;
      games.push(game(`s${id}`, addDays(first, 1), b, a, false));
    }
  }
  return games;
}

export function fixtureLastGameEtDate(): Record<string, string | null> {
  return Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, addDays(FIXTURE_AS_OF, -1)]));
}

/** v2-style absences on four teams, regular games and postseason. */
export function fixtureV2Absences(): SimulationAbsences {
  const regular: Record<string, number[]> = {};
  const postseason: Record<string, number> = {};
  for (const team of SEASON_TEAMS) {
    regular[team.id] = new Array<number>(8).fill(0);
    postseason[team.id] = 0;
  }
  regular[SEASON_TEAMS[0].id] = [3.1, 3.1, 1.4, 0, 0, 0, 0, 0];
  regular[SEASON_TEAMS[5].id] = [2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5];
  postseason[SEASON_TEAMS[5].id] = 2.5;
  regular[SEASON_TEAMS[17].id] = [0.8, 0.8, 0.8, 0.8, 0.8, 0.3, 0, 0];
  regular[SEASON_TEAMS[29].id] = [4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2];
  postseason[SEASON_TEAMS[29].id] = 1.7;
  return { regular, postseason };
}

export function fixtureInput(iterations = 400): SimulationInput {
  return {
    season: FIXTURE_SEASON,
    phase: "regular-season",
    games: fixtureGames(),
    state: fixtureState(),
    params: { ...LIVE_PARAMS },
    asOfEtDate: FIXTURE_AS_OF,
    lastGameEtDate: fixtureLastGameEtDate(),
    iterations,
    uncertaintyScale: 1.5,
  };
}

/** The same teams in the postseason: regular season over, play-in partly done, one series under way. */
export function fixturePostseasonInput(iterations = 400): SimulationInput {
  const games = fixtureGames().map((row) =>
    row.status === "scheduled" ? { ...row, status: "final" as const, homeScore: 101, awayScore: 99 } : row,
  );
  // Fill each team's two remaining slots so no placeholder is left.
  let id = 0;
  for (let index = 0; index < TEAM_COUNT; index += 2) {
    for (let slot = 0; slot < 2; slot += 1) {
      id += 1;
      games.push(game(`p${id}`, "2027-04-10", index, index + 1, true, 100 + slot, 100 + (1 - slot) * 2));
    }
  }
  const byConference = (conference: "East" | "West") =>
    SEASON_TEAMS.map((team, index) => ({ team, index }))
      .filter((row) => row.team.conference === conference)
      .map((row) => row.index);
  const east = byConference("East");
  const west = byConference("West");
  const observed: ObservedPostseason = {
    seeds: { East: east, West: west },
    playInFinal: { East: { seven: east[6], eight: east[7] } },
    playInResults: { West: { sevenEightWinner: west[7] } },
    series: [
      {
        round: "first-round",
        conference: "East",
        teamA: east[0],
        teamB: east[7],
        winsA: 2,
        winsB: 1,
        homeCourt: east[0],
      },
    ],
  };
  return {
    season: FIXTURE_SEASON,
    phase: "playoffs",
    games,
    state: fixtureState(),
    params: { ...LIVE_PARAMS },
    asOfEtDate: "2027-04-20",
    lastGameEtDate: Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, "2027-04-18"])),
    iterations,
    uncertaintyScale: 1.5,
    observed,
  };
}

export function fixtureV2PostseasonAbsences(): SimulationAbsences {
  const regular: Record<string, number[]> = {};
  const postseason: Record<string, number> = {};
  for (const team of SEASON_TEAMS) {
    regular[team.id] = [];
    postseason[team.id] = 0;
  }
  postseason[SEASON_TEAMS[0].id] = 3;
  postseason[SEASON_TEAMS[5].id] = 1.2;
  postseason[SEASON_TEAMS[20].id] = 2.4;
  return { regular, postseason };
}

/** A complete schedule with one regular game left per team: no placeholders. */
export function fixtureOneGameLeftInput(iterations = 400): SimulationInput {
  const post = fixturePostseasonInput(iterations);
  let flipped = 0;
  const games = post.games.map((row) => {
    if (!row.id.startsWith("p") || Number(row.id.slice(1)) % 2 !== 0) return row;
    flipped += 1;
    return {
      ...row,
      etDate: "2027-04-12",
      tipUtc: "2027-04-12T23:30:00.000Z",
      status: "scheduled" as const,
      homeScore: null,
      awayScore: null,
    };
  });
  if (flipped !== TEAM_COUNT / 2) throw new Error("fixtureOneGameLeftInput: expected one game per pair.");
  return {
    ...fixtureInput(iterations),
    games,
    asOfEtDate: "2027-04-11",
    lastGameEtDate: Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, "2027-04-10"])),
  };
}

/** The postseason fixture with the observed East 1v8 series at a chosen score. */
export function fixtureSeriesAt(winsA: number, winsB: number, iterations = 400): SimulationInput {
  const input = fixturePostseasonInput(iterations);
  const observed = input.observed as ObservedPostseason;
  return {
    ...input,
    observed: { ...observed, series: observed.series.map((row) => ({ ...row, winsA, winsB })) },
  };
}
