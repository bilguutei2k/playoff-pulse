import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@/lib/model/random";
import { solveSeriesExactly } from "@/lib/model/series-solver";
import { etDateOf } from "@/lib/season/dates";
import { normalCdf } from "@/lib/season/math";
import { LIVE_PARAMS } from "@/lib/season/params";
import { createFilterState, type FilterState } from "@/lib/season/ratings";
import { assertForecastSums, playSeries, simulateSeason } from "@/lib/season/simulate";
import {
  breakTie,
  buildStandings,
  createStandingsTable,
  recordGame,
  seedConference,
} from "@/lib/season/standings";
import { HCA_INDEX, SEASON_TEAMS, STATE_SIZE, TEAM_COUNT, teamIndex } from "@/lib/season/teams";
import type { ModelParams, SeasonGame } from "@/lib/season/types";

const params: ModelParams = { ...LIVE_PARAMS };
const AS_OF = "2026-11-01";

function allFinal(): SeasonGame[] {
  // A simple finished round robin so every team reaches the format's total with
  // placeholders, and no scheduled game is needed.
  return [];
}

function flatState(meanFor: (teamIndex: number) => number, variance = 0.0001): FilterState {
  const state = createFilterState(params);
  state.cov.fill(0);
  for (let index = 0; index < STATE_SIZE; index += 1) {
    state.cov[index * STATE_SIZE + index] = variance;
    state.mean[index] = index < HCA_INDEX ? meanFor(index) : 2;
  }
  return state;
}

function emptyLast(): Record<string, string | null> {
  return Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, null]));
}

function run(state: FilterState, iterations = 1500, extra: SeasonGame[] = allFinal()) {
  return simulateSeason({
    season: 2027,
    phase: "regular-season",
    games: extra,
    state,
    params,
    asOfEtDate: AS_OF,
    lastGameEtDate: emptyLast(),
    iterations,
  });
}

describe("season simulator invariants", () => {
  it("meets every structural sum", () => {
    const forecast = run(flatState(() => 0));
    expect(forecast.sums.champion).toBeCloseTo(1, 9);
    expect(forecast.sums.makePlayoffs).toBeCloseTo(16, 9);
    expect(forecast.sums.topSix).toBeCloseTo(12, 9);
    expect(forecast.sums.playIn).toBeCloseTo(8, 9);
    expect(() => assertForecastSums(forecast)).not.toThrow();
  });

  it("is deterministic: same inputs give the same output", () => {
    const first = run(flatState((index) => index / 10), 300);
    const second = run(flatState((index) => index / 10), 300);
    expect(second).toEqual(first);
  });

  it("gives a clearly stronger team more wins, more playoffs and more titles", () => {
    const strong = teamIndex("2");
    const forecast = run(flatState((index) => (index === strong ? 8 : 0)));
    const best = forecast.teams[strong];
    const others = forecast.teams.filter((_, index) => index !== strong);
    for (const other of others) {
      expect(best.projectedWins).toBeGreaterThan(other.projectedWins);
      expect(best.champion).toBeGreaterThan(other.champion);
    }
    expect(best.makePlayoffs).toBeGreaterThan(0.95);
  });

  it("keeps all 82 games per team when the schedule is empty", () => {
    const forecast = run(flatState(() => 0), 200);
    for (const team of forecast.teams) {
      expect(team.projectedWins).toBeGreaterThan(30);
      expect(team.projectedWins).toBeLessThan(52);
    }
    const total = forecast.teams.reduce((sum, team) => sum + team.projectedWins, 0);
    expect(total / TEAM_COUNT).toBeCloseTo(41, 0);
  });

  it("widens outcomes when rating uncertainty is larger", () => {
    const narrow = run(flatState(() => 0, 0.0001), 800);
    const wide = run(flatState(() => 0, 25), 800);
    const spread = (forecast: typeof narrow) =>
      forecast.teams.reduce(
        (sum, team) => sum + (team.projectedWinsP90 - team.projectedWinsP10),
        0,
      );
    expect(spread(wide)).toBeGreaterThan(spread(narrow));
  });

  it("counts a real scheduled game instead of a placeholder", () => {
    const tipUtc = "2026-11-02T23:00:00Z";
    const game: SeasonGame = {
      id: "g1",
      season: 2027,
      kind: "regular",
      tipUtc,
      etDate: etDateOf(tipUtc),
      homeId: "1",
      awayId: "2",
      neutral: false,
      status: "scheduled",
      homeScore: null,
      awayScore: null,
    };
    const forecast = run(flatState(() => 0), 200, [game]);
    expect(forecast.teams[teamIndex("1")].projectedWins).toBeGreaterThan(30);
  });

  it("refuses to simulate a regular season that has nothing left", () => {
    const games: SeasonGame[] = [];
    let id = 0;
    // Build a schedule where every team has 82 finished games.
    for (let round = 0; round < 41; round += 1) {
      for (let index = 0; index < TEAM_COUNT; index += 2) {
        for (const [home, away] of [
          [index, index + 1],
          [index + 1, index],
        ]) {
          id += 1;
          games.push({
            id: String(id),
            season: 2027,
            kind: "regular",
            tipUtc: "2026-11-01T23:00:00Z",
            etDate: "2026-11-01",
            homeId: SEASON_TEAMS[home].id,
            awayId: SEASON_TEAMS[away].id,
            neutral: false,
            status: "final",
            homeScore: 101,
            awayScore: 100,
          });
        }
      }
    }
    expect(() => run(flatState(() => 0), 10, games)).toThrow(/phase is wrong/);
  });
});

describe("playoff path against the exact series solver", () => {
  const homeCourt = teamIndex("2");
  const other = teamIndex("25");
  const strengths = new Float64Array(STATE_SIZE);
  strengths[homeCourt] = 2;
  strengths[other] = -1;
  strengths[HCA_INDEX] = 2;
  const hca = 2 + params.hcaPlayoffDelta;
  const gap = 3 * params.playoffSpread;
  const atHome = normalCdf((gap + hca) / params.sigma);
  const onRoad = 1 - normalCdf((-gap + hca) / params.sigma);
  const pattern = [true, true, false, false, true, false, true];

  it.each([
    [0, 0],
    [2, 1],
    [1, 3],
    [3, 3],
  ])("matches the exact solver from a %i-%i series score", (winsA, winsB) => {
    const exact = solveSeriesExactly(winsA, winsB, (gameNumber) =>
      pattern[gameNumber - 1] ? atHome : onRoad,
    ).teamAWinProbability;
    const random = createSeededRandom(`series-${winsA}-${winsB}`);
    const draws = 40_000;
    let won = 0;
    for (let draw = 0; draw < draws; draw += 1) {
      if (playSeries(homeCourt, other, winsA, winsB, strengths, params, random) === homeCourt) {
        won += 1;
      }
    }
    // About 4 standard errors at this sample size.
    expect(Math.abs(won / draws - exact)).toBeLessThan(0.01);
  });

  it("returns the leader immediately when a series is already decided", () => {
    const random = createSeededRandom("decided");
    expect(playSeries(homeCourt, other, 4, 2, strengths, params, random)).toBe(homeCourt);
    expect(playSeries(homeCourt, other, 1, 4, strengths, params, random)).toBe(other);
  });
});

describe("NBA tiebreakers", () => {
  const BOS = teamIndex("2");
  const NY = teamIndex("18");
  const PHI = teamIndex("20");
  const CHI = teamIndex("4");
  const ATL = teamIndex("1");

  it("uses head-to-head first for two tied teams", () => {
    const table = createStandingsTable();
    recordGame(table, NY, BOS, 5);
    recordGame(table, NY, BOS, 5);
    recordGame(table, BOS, NY, 5);
    expect(breakTie([BOS, NY], table, null)[0]).toBe(NY);
  });

  it("prefers a division leader when head-to-head is level", () => {
    const table = createStandingsTable();
    recordGame(table, BOS, CHI, 3);
    recordGame(table, CHI, BOS, 3);
    const leaders = new Uint8Array(TEAM_COUNT);
    leaders[CHI] = 1;
    expect(breakTie([BOS, CHI], table, leaders)[0]).toBe(CHI);
  });

  it("uses division record only inside one division", () => {
    const table = createStandingsTable();
    recordGame(table, BOS, NY, 3);
    recordGame(table, NY, BOS, 3);
    // BOS has the better Atlantic record against PHI.
    recordGame(table, BOS, PHI, 4);
    recordGame(table, PHI, NY, 4);
    expect(breakTie([BOS, NY], table, null)[0]).toBe(BOS);
  });

  it("falls to conference record, then point differential", () => {
    const conference = createStandingsTable();
    recordGame(conference, BOS, CHI, 2);
    recordGame(conference, CHI, BOS, 2);
    recordGame(conference, CHI, ATL, 2);
    expect(breakTie([BOS, CHI], conference, null)[0]).toBe(CHI);

    const differential = createStandingsTable();
    differential.pointDifferential[BOS] = 50;
    differential.pointDifferential[CHI] = 10;
    expect(breakTie([BOS, CHI], differential, null)[0]).toBe(BOS);
  });

  it("restarts the procedure once a team separates in a three-way tie", () => {
    const table = createStandingsTable();
    // Combined head-to-head: ATL is 4-0 and first. BOS and CHI are then a
    // two-team tie that head-to-head settles for CHI.
    recordGame(table, ATL, BOS, 5);
    recordGame(table, ATL, BOS, 5);
    recordGame(table, ATL, CHI, 5);
    recordGame(table, ATL, CHI, 5);
    recordGame(table, CHI, BOS, 5);
    const order = breakTie([BOS, CHI, ATL], table, new Uint8Array(TEAM_COUNT));
    expect(order).toEqual([ATL, CHI, BOS]);
  });

  it("seeds a conference by record and lists all fifteen teams", () => {
    const table = createStandingsTable();
    table.wins[BOS] = 60;
    table.losses[BOS] = 22;
    table.wins[NY] = 50;
    table.losses[NY] = 32;
    const order = seedConference("East", table);
    expect(order[0]).toBe(BOS);
    expect(order[1]).toBe(NY);
    expect(order).toHaveLength(15);
  });

  it("ignores the Cup final and postponed games in standings", () => {
    const base = {
      season: 2027,
      tipUtc: "2026-12-16T01:30:00Z",
      etDate: "2026-12-15",
      homeId: "2",
      awayId: "18",
      neutral: true,
      homeScore: 100,
      awayScore: 90,
    };
    const table = buildStandings([
      { ...base, id: "cup", kind: "cup-final", status: "final" },
      { ...base, id: "ghost", kind: "regular", status: "postponed" },
    ] as SeasonGame[]);
    expect(table.wins[BOS]).toBe(0);
    expect(table.losses[NY]).toBe(0);
  });
});
