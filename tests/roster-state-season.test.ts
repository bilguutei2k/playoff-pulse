// v4 property tests of the season layer (registration-v4.md, A6): H1, H2 and the simulator.

import { describe, expect, it } from "vitest";
import { buildV4Season, survivalCurveV4, type GroupHazardTable } from "@/lib/season/availability-v4";
import type { StoredLine } from "@/lib/season/box-scores";
import { etDateOf } from "@/lib/season/dates";
import type { GameAvailability } from "@/lib/season/injury-model";
import { LIVE_PARAMS } from "@/lib/season/params";
import { createFilterState } from "@/lib/season/ratings";
import { replayRosterState } from "@/lib/season/roster-state";
import { simulateSeason, type SimulationInput, type V4SimulationInput } from "@/lib/season/simulate";
import { SEASON_TEAMS, STATE_SIZE, TEAM_COUNT } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";
import { collectGroupedObservationsFrom } from "../scripts/live/v4/hazard-data";
import { fixtureInput, fixtureOneGameLeftInput, fixtureState } from "../scripts/verify/simulation-fixture";
import { PARAMS, syntheticWorld } from "./roster-state.test";

const STATUS = { O: 0.999, D: 0.98, Q: 0.48, P: 0.19, A: 0.19 };
const HAZARDS: GroupHazardTable = {
  classTable: { long: [0.3, 0.06, 0.03, 0.02, 0.02, 0.01], short: [0.4, 0.3, 0.2, 0.1, 0.05, 0.02], classUsed: true },
  shrinkage: 10,
  cells: {},
};

/** v4 input from the fixture's 31-value state: playoff strengths = regular plus a little independent noise. */
function v4Input(players: V4SimulationInput["players"] = [], background = 0): V4SimulationInput {
  const state = fixtureState();
  const size = 2 * TEAM_COUNT + 1;
  const index = (i: number) => (i <= TEAM_COUNT ? i : i - TEAM_COUNT - 1);
  const mean = new Float64Array(size);
  const cov = new Float64Array(size * size);
  for (let a = 0; a < size; a += 1) {
    mean[a] = state.mean[index(a)];
    for (let b = 0; b < size; b += 1) cov[a * size + b] = state.cov[index(a) * STATE_SIZE + index(b)] + (a === b && a > TEAM_COUNT ? 0.01 : 0);
  }
  const charges = () => Array.from({ length: TEAM_COUNT }, () => new Float64Array(200).fill(background));
  return {
    mean,
    cov,
    dailyVariance: new Float64Array(TEAM_COUNT).fill(0.05),
    sigma: 11,
    backgroundRegular: charges(),
    backgroundPlayoff: charges(),
    players,
    horizonDays: null,
  };
}
const withV4 = (input: SimulationInput, v4: V4SimulationInput): SimulationInput => ({ ...input, v4 });

describe("v4 simulator", () => {
  it("holds the forecast sums and is deterministic", () => {
    const a = simulateSeason(withV4(fixtureInput(300), v4Input()));
    const b = simulateSeason(withV4(fixtureInput(300), v4Input()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.sums.champion).toBeCloseTo(1, 9);
    expect(a.sums.makePlayoffs).toBeCloseTo(16, 9);
  });

  it("refuses to be combined with v2's or v3's absences", () => {
    expect(() =>
      simulateSeason({ ...withV4(fixtureInput(10), v4Input()), absenceSchedule: { players: [], postseasonSchedule: true } }),
    ).toThrow(/alone/);
  });

  it("H1: an absence sampled past the last regular game lowers the team's strength in play-in and series games", () => {
    const team = SEASON_TEAMS[0].id;
    const absence = (games: number) => ({
      teamId: team,
      athleteId: "star",
      points: 6,
      playoffPoints: 6,
      survival: Array.from({ length: 200 }, (_, j) => (j < games ? 1 : 0)),
      background: new Array(200).fill(0),
    });
    const short = simulateSeason(withV4(fixtureOneGameLeftInput(2000), v4Input([absence(1)])));
    const long = simulateSeason(withV4(fixtureOneGameLeftInput(2000), v4Input([absence(200)])));
    const row = (forecast: typeof short) => forecast.teams.find((entry) => entry.teamId === team) as (typeof short.teams)[number];
    // The same regular season (one game, out in both; game draws share one stream, so only close), a weaker postseason.
    expect(Math.abs(row(long).projectedWins - row(short).projectedWins)).toBeLessThan(0.05);
    expect(row(long).champion + row(long).reachFinals).toBeLessThan(row(short).champion + row(short).reachFinals);
  });

  it("S1 off with no listed players builds zero charges (the full-health draw)", () => {
    const world = syntheticWorld();
    const state = replayRosterState({
      games: world.games.filter((game) => game.season === 2011),
      linesFor: (id) => world.lines.get(id),
      reportFor: () => null,
      openingRosters: () => new Map(["1", "2", "3", "4"].map((teamId) => [teamId, Array.from({ length: 8 }, (_, i) => `${teamId}-${i}`)])),
      params: PARAMS,
      statusTable: () => STATUS,
    });
    const options = {
      params: PARAMS,
      statusTable: STATUS,
      hazards: HAZARDS,
      background: { halfLife: 1, shrinkage: 320, tierRates: [0.6, 0.75, 0.83, 0.87] },
      horizonDays: null,
    };
    const off = buildV4Season(state, 2011, ["1", "2", "3", "4"], { ...options, backgroundOn: false });
    expect(off.input.players).toEqual([]);
    for (const row of [...off.input.backgroundRegular, ...off.input.backgroundPlayoff]) expect(row.every((value) => value === 0)).toBe(true);
    const on = buildV4Season(state, 2011, ["1", "2", "3", "4"], { ...options, backgroundOn: true });
    expect(Array.from(on.input.mean)).toEqual(Array.from(off.input.mean));
    expect(on.input.backgroundRegular.some((row) => row.some((value) => value !== 0))).toBe(true);
    // S1 starts at 1 for the next game: no background charge there.
    for (const row of on.input.backgroundRegular) expect(row[0]).toBe(0);
  });

  it("a listed player is charged by his sampled absence, never also by S1 while out", () => {
    const curve = survivalCurveV4("O", "Injury/Illness - Left Knee; Sprain", 2, STATUS, HAZARDS, 50);
    expect(curve[0]).toBe(STATUS.O);
    for (let j = 1; j < curve.length; j += 1) expect(curve[j]).toBeLessThanOrEqual(curve[j - 1]);
    const base = simulateSeason(withV4(fixtureInput(500), v4Input()));
    const listed = simulateSeason(
      withV4(
        fixtureInput(500),
        v4Input([{ teamId: SEASON_TEAMS[3].id, athleteId: "x", points: 4, playoffPoints: 4, survival: curve, background: new Array(200).fill(0) }]),
      ),
    );
    const row = (forecast: typeof base) => forecast.teams[3];
    expect(row(listed).projectedWins).toBeLessThan(row(base).projectedWins);
  });
});

describe("H2: hazard population", () => {
  const [A, B] = SEASON_TEAMS.map((team) => team.id);
  function season(returnsAt: number | null) {
    const games: SeasonGame[] = [];
    const box = new Map<string, Record<string, StoredLine[]>>();
    const availability = new Map<string, GameAvailability>();
    for (let day = 0; day < 12; day += 1) {
      const tipUtc = new Date(Date.UTC(2021, 9, 20 + 2 * day, 23, 30)).toISOString();
      const id = `g${day}`;
      games.push({ id, season: 2022, kind: "regular", tipUtc, etDate: etDateOf(tipUtc), homeId: A, awayId: B, neutral: false, status: "final", homeScore: 110, awayScore: 100 });
      const out = day >= 6 && (returnsAt === null || day < returnsAt);
      box.set(id, {
        [A]: [...(out ? [] : ([["star", 36, 30]] as StoredLine[])), ["wing", 34, 12], ["big", 30, 10], ["guard", 30, 9], ["bench", 20, 4]],
        [B]: [["b1", 36, 20], ["b2", 34, 12], ["b3", 30, 10], ["b4", 30, 9], ["b5", 20, 4]],
      });
      const rows = out ? [{ teamId: A, athleteId: "star", status: "O" as const, reason: "Injury/Illness - Left Knee; Sprain" }] : [];
      availability.set(id, { morning: null, final: { at: `${etDateOf(tipUtc)}T17:30`, notSubmitted: [], rows } });
    }
    return collectGroupedObservationsFrom({
      games,
      base: createFilterState(LIVE_PARAMS),
      stateSeason: 2021,
      boxScores: (id) => box.get(id),
      availability: (id) => availability.get(id) ?? null,
      seasons: [2022],
    });
  }

  it("a spell censored at season end adds no return", () => {
    const rows = season(null);
    expect(rows.length).toBe(5);
    expect(rows.every((row) => !row.returned)).toBe(true);
    expect(rows.map((row) => row.k)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((row) => row.group === "injury:sprain")).toBe(true);
  });

  it("a return is observed once, at the game he comes back", () => {
    const rows = season(9);
    expect(rows.map((row) => [row.k, row.returned])).toEqual([[1, false], [2, false], [3, true]]);
  });
});
