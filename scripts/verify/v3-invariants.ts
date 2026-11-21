// Invariants of the v3 absence engine (`live-2026.27-v3`, plan step A5). Each check throws
// on failure. `checkV3Invariants` runs them all and is called by live-checks.ts; the unit
// tests in tests/injury-v3-invariants.test.ts run each one on its own.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTracker, simulationAbsences, type CurrentAbsence } from "../../src/lib/season/injury-model";
import {
  createGapTracker,
  currentAbsencesV3,
  gapHook,
  hazard,
  hazardBucket,
  sampledDuration,
  survivalCurve,
  V3_ALL_ON,
  type CurrentAbsenceV3,
  type HazardTable,
  type V3Model,
} from "../../src/lib/season/injury-v3";
import { INJURY_STATUS_TABLE, INJURY_SURVIVAL } from "../../src/lib/season/params";
import {
  simulateSeason,
  type AbsenceSchedule,
  type AbsenceTraceEvent,
  type ScheduledAbsence,
  type SimulationInput,
} from "../../src/lib/season/simulate";
import { SEASON_TEAMS, teamIndex } from "../../src/lib/season/teams";
import {
  REPLAY_INJURY,
  TEAM_A,
  TEAM_B,
  TEAM_C,
  runReplay,
  teamLines,
  type ReplayGameSpec,
} from "./replay-fixture";
import {
  fixtureInput,
  fixtureOneGameLeftInput,
  fixturePostseasonInput,
  fixtureSeriesAt,
  fixtureV2Absences,
} from "./simulation-fixture";

type FitFile = { hazards: HazardTable };

/** The frozen hazards from docs/live/v3-fit.json. */
export function fittedHazards(): HazardTable {
  const file = path.join(process.cwd(), "docs/live/v3-fit.json");
  return (JSON.parse(fs.readFileSync(file, "utf-8")) as FitFile).hazards;
}

function model(): V3Model {
  return {
    injury: REPLAY_INJURY,
    statusTable: INJURY_STATUS_TABLE,
    hazards: fittedHazards(),
    v2Survival: INJURY_SURVIVAL,
    switches: V3_ALL_ON,
  };
}

const STRONG = SEASON_TEAMS[4].id;
const HORIZON = 200;

function fixedPlayer(teamId: string, points: number, games: number, sampled = false, athleteId = "x"): ScheduledAbsence {
  return {
    teamId,
    athleteId,
    points,
    survival: Array.from({ length: HORIZON }, (_, index) => (index < games ? 1 : 0)),
    sampled,
  };
}

function traced(input: SimulationInput, schedule: AbsenceSchedule): AbsenceTraceEvent[] {
  const events: AbsenceTraceEvent[] = [];
  simulateSeason({ ...input, absenceSchedule: schedule, absenceTrace: (event) => events.push(event) });
  return events;
}

const KIND_ORDER = { regular: 0, placeholder: 1, "play-in": 2, series: 3 } as const;

/** Ordinals per team run 0, 1, 2, ... in every iteration, in the order regular, placeholder, play-in, series. */
function assertOrdinals(events: readonly AbsenceTraceEvent[]): void {
  const last = new Map<string, { ordinal: number; kind: number }>();
  let iteration = -1;
  for (const event of events) {
    if (event.iteration !== iteration) {
      iteration = event.iteration;
      last.clear();
    }
    assert.ok(event.ordinal !== null, "The v3 schedule charges every postseason game by ordinal.");
    const previous = last.get(event.teamId);
    assert.equal(event.ordinal, previous ? previous.ordinal + 1 : 0, "Team-game ordinals must be consecutive.");
    assert.ok(!previous || KIND_ORDER[event.kind] >= previous.kind, "Ordinals run regular, placeholders, play-in, series.");
    last.set(event.teamId, { ordinal: event.ordinal as number, kind: KIND_ORDER[event.kind] });
  }
}

/** A fixed two-game absence costs its team's first two simulated games only. */
export function checkTwoGameAbsence(): void {
  for (const sampled of [false, true]) {
    // Across the regular/postseason boundary: one regular game left, then the postseason.
    const boundary = traced(fixtureOneGameLeftInput(300), {
      players: [fixedPlayer(STRONG, 3, 2, sampled)],
      postseasonSchedule: true,
    });
    assertOrdinals(boundary);
    const team = boundary.filter((event) => event.teamId === STRONG);
    assert.ok(team.some((event) => event.ordinal === 1 && event.kind !== "regular"), "The second game is a postseason game.");
    for (const event of team) {
      assert.equal(event.charge, (event.ordinal as number) < 2 ? 3 : 0, "A two-game absence has no effect from the third game.");
    }
    // Inside a series: the observed East 1v8 series at 2-1; its observed games consume no ordinal.
    const input = fixturePostseasonInput(300);
    const leader = SEASON_TEAMS[input.observed?.series[0].teamA as number].id;
    const series = traced(input, { players: [fixedPlayer(leader, 3, 2, sampled)], postseasonSchedule: true });
    assertOrdinals(series);
    for (const event of series.filter((row) => row.teamId === leader)) {
      assert.equal(event.kind, "series", "In the playoffs every charged game is a series game.");
      assert.equal(event.charge, (event.ordinal as number) < 2 ? 3 : 0, "Inside a series the absence ends after two games.");
    }
    const firstSeriesGames = new Map<number, number>();
    for (const event of series.filter((row) => row.teamId === leader)) {
      firstSeriesGames.set(event.iteration, (firstSeriesGames.get(event.iteration) ?? 0) + 1);
    }
    // From 2-1, game 4 is its ordinal 0: at most 4 more games in this series, 21 in three more.
    assert.ok(Math.max(...firstSeriesGames.values()) <= 4 + 21, "Observed series games must consume no ordinal.");
  }
}

/**
 * End to end inside a series: up 3-0 and losing the next two games for certain is the
 * same series as 3-2 at full strength (games 6 and 7, same home pattern).
 */
export function checkSeriesEquivalence(): void {
  const iterations = 6000;
  const input = fixtureSeriesAt(3, 0, iterations);
  const leader = SEASON_TEAMS[input.observed?.series[0].teamA as number].id;
  const out = simulateSeason({
    ...input,
    absenceSchedule: { players: [fixedPlayer(leader, 1000, 2)], postseasonSchedule: true },
  });
  const level = simulateSeason(fixtureSeriesAt(3, 2, iterations));
  const p = out.series[0].homeCourtSeriesProbability;
  const q = level.series[0].homeCourtSeriesProbability;
  const se = Math.sqrt((q * (1 - q)) / iterations) * Math.SQRT2;
  assert.ok(Math.abs(p - q) <= 4 * se + 1e-9, `3-0 plus two lost games must match 3-2 (${p} against ${q}).`);
}

/** An absence longer than the remaining regular season charges only the postseason games it covers. */
export function checkLongerThanRegular(): void {
  const events = traced(fixtureOneGameLeftInput(300), {
    players: [fixedPlayer(STRONG, 2.5, 3)],
    postseasonSchedule: true,
  });
  assertOrdinals(events);
  for (const event of events.filter((row) => row.teamId === STRONG)) {
    const ordinal = event.ordinal as number;
    assert.equal(event.charge, ordinal < 3 ? 2.5 : 0, "Charged exactly on the first three team games.");
    if (ordinal >= 1) assert.notEqual(event.kind, "regular", "Games after the last regular game are postseason games.");
  }
}

/** Title odds under a three-game absence are at least those under v2's scalar (same seed, 0.5 points). */
export function checkTitleOddsAtLeastScalar(): void {
  const input = fixtureOneGameLeftInput(4000);
  const contender = SEASON_TEAMS[17].id;
  const absence: CurrentAbsence = { teamId: contender, athleteId: "x", points: 4, gamesMissed: 1, class: "short", expectedGames: 3 };
  const pending = Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, 1]));
  const v2 = simulateSeason({ ...input, absences: simulationAbsences([absence], pending) });
  const v3 = simulateSeason({ ...input, absenceSchedule: { players: [fixedPlayer(contender, 4, 3)], postseasonSchedule: true } });
  const index = teamIndex(contender);
  assert.ok(v2.teams[index].champion > 0.02, "The check needs a contender.");
  assert.ok(
    v3.teams[index].champion >= v2.teams[index].champion - 0.005,
    `Title odds under the schedule (${v3.teams[index].champion}) must be at least the scalar's (${v2.teams[index].champion}).`,
  );
}

/** An empty v3 input equals no absences, bit for bit. */
export function checkEmptyEqualsNone(): void {
  for (const input of [fixtureInput(300), fixturePostseasonInput(300), fixtureOneGameLeftInput(300)]) {
    const none = simulateSeason(input);
    for (const postseasonSchedule of [true, false]) {
      assert.deepStrictEqual(simulateSeason({ ...input, absenceSchedule: { players: [], postseasonSchedule } }), none);
    }
    // A player worth nothing, or out for no game, changes nothing either.
    assert.deepStrictEqual(
      simulateSeason({
        ...input,
        absenceSchedule: { players: [fixedPlayer(STRONG, 0, 5, true), fixedPlayer(STRONG, 3, 0, true, "y")], postseasonSchedule: true },
      }),
      none,
    );
  }
}

/** With a complete schedule, S = 1 equals v2 with unbounded expected games, bit for bit. */
export function checkSurvivalOneEqualsV2Unbounded(): void {
  const input = fixtureOneGameLeftInput(400);
  const teams = [SEASON_TEAMS[4].id, SEASON_TEAMS[11].id, SEASON_TEAMS[4].id, SEASON_TEAMS[23].id];
  const points = [2.75, 1.5, 0.625, 3.25];
  const current: CurrentAbsence[] = teams.map((teamId, index) => ({
    teamId,
    athleteId: `p${index}`,
    points: points[index],
    gamesMissed: 1,
    class: "short",
    expectedGames: 1e9,
  }));
  const pending = Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, 1]));
  const v2 = simulateSeason({ ...input, absences: simulationAbsences(current, pending) });
  for (const sampled of [false, true]) {
    const players = current.map((row) => ({
      teamId: row.teamId,
      athleteId: row.athleteId,
      points: row.points,
      survival: new Array<number>(HORIZON).fill(1),
      sampled,
    }));
    assert.deepStrictEqual(simulateSeason({ ...input, absenceSchedule: { players, postseasonSchedule: true } }), v2);
  }
}

/** With every switch off, the schedule reproduces v2's absences, placeholders included, bit for bit. */
export function checkSwitchesOffEqualsV2(): void {
  const input = fixtureInput(400);
  const absences: CurrentAbsence[] = [
    { teamId: SEASON_TEAMS[0].id, athleteId: "a", points: 3.1, gamesMissed: 2, class: "short", expectedGames: 2.4 },
    { teamId: SEASON_TEAMS[5].id, athleteId: "b", points: 2.5, gamesMissed: 9, class: "long", expectedGames: 20.8 },
    { teamId: SEASON_TEAMS[0].id, athleteId: "c", points: 0.9, gamesMissed: 1, class: "short", expectedGames: 4.73 },
  ];
  const pending = Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, 8]));
  const v2 = simulateSeason({ ...input, absences: simulationAbsences(absences, pending) });
  const players = absences.map((row) => ({
    teamId: row.teamId,
    athleteId: row.athleteId,
    points: row.points,
    survival: Array.from({ length: HORIZON }, (_, index) => Math.max(0, Math.min(1, row.expectedGames - index))),
    sampled: false,
  }));
  assert.deepStrictEqual(simulateSeason({ ...input, absenceSchedule: { players, postseasonSchedule: false } }), v2);
  // Both inputs at once are refused.
  assert.throws(
    () => simulateSeason({ ...input, absences: fixtureV2Absences(), absenceSchedule: { players, postseasonSchedule: false } }),
    /not both/,
  );
}

/** Sampled durations match S(j) within Monte Carlo error. */
export function checkSampledFrequencies(): void {
  const iterations = 4000;
  const absence: CurrentAbsenceV3 = {
    teamId: STRONG,
    athleteId: "s",
    points: 2,
    gamesMissed: 1,
    class: "short",
    status: null,
    reason: null,
  };
  const curve = survivalCurve(absence, model());
  const events = traced(fixtureInput(iterations), {
    players: [{ teamId: STRONG, athleteId: "s", points: 2, survival: curve, sampled: true }],
    postseasonSchedule: true,
  });
  for (let j = 1; j <= 10; j += 1) {
    const out = events.filter((event) => event.teamId === STRONG && event.ordinal === j - 1 && event.charge > 0).length;
    const share = out / iterations;
    const se = Math.sqrt((curve[j - 1] * (1 - curve[j - 1])) / iterations);
    assert.ok(Math.abs(share - curve[j - 1]) <= 4 * se + 1e-9, `Out at game ${j}: ${share} against S = ${curve[j - 1]}.`);
  }
  // The duration rule itself.
  assert.equal(sampledDuration([0.9, 0.5, 0.2, 0], 0.6), 1);
  assert.equal(sampledDuration([0.9, 0.5, 0.2, 0], 0.1), 3);
  assert.equal(sampledDuration([1, 1, 1], 0.999), 3);
}

/** The same inputs give the same output, sampling included. */
export function checkDeterministic(): void {
  const curve = survivalCurve(
    { teamId: STRONG, athleteId: "s", points: 2, gamesMissed: 3, class: "short", status: null, reason: null },
    model(),
  );
  const schedule: AbsenceSchedule = {
    players: [{ teamId: STRONG, athleteId: "s", points: 2, survival: curve, sampled: true }],
    postseasonSchedule: true,
  };
  for (const input of [fixtureInput(300), fixturePostseasonInput(300)]) {
    assert.deepStrictEqual(
      simulateSeason({ ...input, absenceSchedule: schedule }),
      simulateSeason({ ...input, absenceSchedule: schedule }),
    );
  }
}

/** S is non-increasing in [0, 1] for every class, k and status; bucket 0 throws. */
export function checkSurvivalShape(): void {
  const v3 = model();
  for (const absenceClass of ["long", "short"] as const) {
    for (const status of [null, "O", "D", "Q"] as const) {
      for (let k = status === null ? 1 : 0; k <= 60; k += 1) {
        const curve = survivalCurve(
          { teamId: STRONG, athleteId: "s", points: 1, gamesMissed: k, class: absenceClass, status, reason: null },
          v3,
        );
        curve.forEach((value, index) => {
          assert.ok(value >= 0 && value <= 1, "S must be a probability.");
          if (index > 0) assert.ok(value <= curve[index - 1], "S must be non-increasing.");
        });
        if (status !== null) assert.equal(curve[0], INJURY_STATUS_TABLE[status], "A listed player's S(1) is his status weight.");
        else assert.equal(curve[0], 1 - hazard(v3.hazards, k, absenceClass), "An unlisted player's S(1) is 1 - h(k).");
      }
    }
  }
  assert.throws(() => hazardBucket(0), /No hazard/);
  assert.throws(() => hazard(v3.hazards, 0, "short"), /No hazard/);
  assert.throws(
    () => survivalCurve({ teamId: STRONG, athleteId: "s", points: 1, gamesMissed: 0, class: "short", status: null, reason: null }, v3),
    /No hazard/,
  );
  assert.equal(hazardBucket(1), 0);
  assert.equal(hazardBucket(2), 1);
  assert.equal(hazardBucket(3), 1);
  assert.equal(hazardBucket(4), 2);
  assert.equal(hazardBucket(30), 4);
  assert.equal(hazardBucket(31), 5);
  assert.equal(hazardBucket(500), 5);
}

// ---------------------------------------------------------------------------
// D2 replays and v2's tracker
// ---------------------------------------------------------------------------

const STARTERS = { [TEAM_A]: ["a1", "a2", "a3", "a4", "a5"], [TEAM_B]: ["b1", "b2", "b3", "b4", "b5"], [TEAM_C]: ["c1", "c2", "c3", "c4", "c5"] };

function pairing(index: number, home: string, away: string, starWith: string | null): ReplayGameSpec {
  const lines = (teamId: string) => teamLines(teamId, starWith === teamId ? ["star", ...STARTERS[teamId]] : STARTERS[teamId]);
  return { home, away, lines: { [home]: lines(home), [away]: lines(away) } };
}

function replayV3(specs: readonly ReplayGameSpec[]) {
  const gaps = createGapTracker();
  const replay = runReplay(specs, (boxScores) => gapHook(gaps, boxScores));
  return { replay, gaps, ...currentAbsencesV3(replay.tracker, gaps, 2027, model()) };
}

/** A then B alternate; C plays B in between from game `cFrom` on, with the star on C from `debut`. */
function tradeSpecs(aGames: number, starOnA: number, debut: number | null): ReplayGameSpec[] {
  const specs: ReplayGameSpec[] = [];
  for (let index = 0; index < aGames; index += 1) {
    specs.push(pairing(index, TEAM_A, TEAM_B, index < starOnA ? TEAM_A : null));
    if (index >= starOnA) specs.push(pairing(index, TEAM_C, TEAM_B, debut !== null && index >= debut ? TEAM_C : null));
  }
  return specs;
}

export function checkExpiryReplays(): void {
  // More than ten missed: no longer counted at 12, dropped past 20.
  const twelve = replayV3(tradeSpecs(18, 6, null));
  assert.equal(twelve.gaps.gaps.get(`${TEAM_A}:star`)?.gap, 12);
  assert.ok(!twelve.current.some((row) => row.athleteId === "star"), "Past ten games an unreported absence stops counting.");
  assert.deepEqual(twelve.noLongerCounted.map((row) => [row.athleteId, row.gamesMissed]), [["star", 12]]);
  const ten = replayV3(tradeSpecs(16, 6, null));
  const atTen = ten.current.find((row) => row.athleteId === "star");
  assert.ok(atTen && atTen.gamesMissed === 10, "At ten missed games he still counts, with k = 10.");
  const late = replayV3(tradeSpecs(30, 6, null));
  assert.ok(!late.current.some((row) => row.athleteId === "star") && late.noLongerCounted.length === 0, "Past 20 he is dropped.");

  // Departure before a new-team debut: counted for A until he appears for C, then nowhere.
  const before = replayV3(tradeSpecs(9, 6, null));
  assert.ok(before.current.some((row) => row.athleteId === "star" && row.teamId === TEAM_A), "Before any debut he is A's absence.");
  const after = replayV3(tradeSpecs(9, 6, 8));
  assert.ok(!after.current.some((row) => row.athleteId === "star"), "After appearing for another team he is nobody's absence.");
  assert.ok(!after.noLongerCounted.some((row) => row.athleteId === "star"), "A player who joined another team is not listed.");
  assert.equal(after.gaps.gaps.size, 0, "An appearance elsewhere ends the gap.");

  // A report-listed player beyond ten games still counts, as the report says.
  const listed = tradeSpecs(20, 6, null).map((spec) => ({
    ...spec,
    availability: {
      morning: null,
      final: {
        at: "2026-10-21T18:30",
        notSubmitted: [],
        rows: [{ teamId: TEAM_A, athleteId: "star", status: "O" as const, reason: "Left Knee; Surgery" }],
      },
    },
  }));
  const report = replayV3(listed);
  const star = report.current.find((row) => row.athleteId === "star");
  assert.ok(star && star.gamesMissed === 14 && star.status === "O" && star.class === "long", "A listed player follows the report past ten games.");
}

/** v2's tracker and ratings are identical with and without the v3 hook. */
export function checkV2TrackerUntouched(): void {
  const listedSpecs = tradeSpecs(24, 6, 15).map((spec, index) =>
    index % 3 === 0
      ? {
          ...spec,
          availability: {
            morning: null,
            final: { at: "2026-10-21T18:30", notSubmitted: [], rows: [{ teamId: TEAM_A, athleteId: "a2", status: "Q" as const, reason: "Ankle" }] },
          },
        }
      : spec,
  );
  for (const specs of [tradeSpecs(30, 6, 12), listedSpecs]) {
    const plain = runReplay(specs, undefined, createTracker());
    const gaps = createGapTracker();
    let calls = 0;
    const hooked = runReplay(specs, (boxScores) => gapHook(gaps, boxScores, () => (calls += 1)), createTracker());
    assert.deepStrictEqual(hooked.tracker, plain.tracker, "The v3 hook must not change v2's tracker.");
    assert.deepStrictEqual(Array.from(hooked.state.mean), Array.from(plain.state.mean));
    assert.deepStrictEqual(Array.from(hooked.state.cov), Array.from(plain.state.cov));
    assert.equal(calls, 2 * specs.length, "The hook must see both teams of every game with a box score.");
  }
}

export const V3_CHECKS = {
  checkTwoGameAbsence,
  checkSeriesEquivalence,
  checkLongerThanRegular,
  checkTitleOddsAtLeastScalar,
  checkEmptyEqualsNone,
  checkSurvivalOneEqualsV2Unbounded,
  checkSwitchesOffEqualsV2,
  checkSampledFrequencies,
  checkDeterministic,
  checkSurvivalShape,
  checkExpiryReplays,
  checkV2TrackerUntouched,
} as const;

export function checkV3Invariants(): void {
  for (const check of Object.values(V3_CHECKS)) check();
}
