// Reproducers for the three defects of v2 found by the 2026-11-05 review (H1, H2, H3).
// Each `v2:` test asserts the defect on today's exported functions, so it documents v2
// and stays green; v2 is frozen and keeps this behaviour. The `v3:` counterparts, which
// assert the fix, sit beside them.

import { describe, expect, it } from "vitest";
import {
  currentAbsences,
  simulationAbsences,
  type CurrentAbsence,
} from "@/lib/season/injury-model";
import { INJURY_SURVIVAL } from "@/lib/season/params";
import { simulateSeason } from "@/lib/season/simulate";
import { SEASON_TEAMS, teamIndex } from "@/lib/season/teams";
import {
  REPLAY_INJURY,
  TEAM_A,
  TEAM_B,
  runReplay,
  teamLines,
  type ReplayGameSpec,
} from "./support/replay-fixture";
import { fixtureInput, fixturePostseasonInput } from "./support/simulation-fixture";

const STARTERS_A = ["a1", "a2", "a3", "a4", "a5"];
const STARTERS_B = ["b1", "b2", "b3", "b4", "b5"];

/** Team A's star `star` plays the first `played` games and misses the next `missed`. */
function starMisses(played: number, missed: number): ReplayGameSpec[] {
  return Array.from({ length: played + missed }, (_, index) => ({
    home: index % 2 === 0 ? TEAM_A : TEAM_B,
    away: index % 2 === 0 ? TEAM_B : TEAM_A,
    lines: {
      [TEAM_A]: teamLines(TEAM_A, index < played ? ["star", ...STARTERS_A] : STARTERS_A),
      [TEAM_B]: teamLines(TEAM_B, STARTERS_B),
    },
  }));
}

function absence(teamId: string, points: number, expectedGames: number): CurrentAbsence {
  return { teamId, athleteId: "x", points, gamesMissed: 1, class: "short", expectedGames };
}

describe("H1: postseason absences never expire within a simulation", () => {
  it("v2: a two-game absence with no regular games left costs every postseason game in full", () => {
    const team = SEASON_TEAMS[0].id;
    const split = simulationAbsences([absence(team, 4, 2)], { [team]: 0 });
    // One scalar, subtracted from strength before the whole postseason.
    expect(split.postseason[team]).toBe(4);
    expect(split.regular[team]).toEqual([]);
  });

  it("v2: in the playoffs a two-game absence moves the odds exactly as a hundred-game one does", () => {
    const team = SEASON_TEAMS[5].id;
    const short = simulationAbsences([absence(team, 4, 2)], { [team]: 0 });
    const long = simulationAbsences([absence(team, 4, 100)], { [team]: 0 });
    const input = fixturePostseasonInput(300);
    expect(simulateSeason({ ...input, absences: short })).toEqual(
      simulateSeason({ ...input, absences: long }),
    );
  });

  it("v2: unscheduled regular-season placeholders are never charged", () => {
    const team = SEASON_TEAMS[5].id;
    const huge = simulationAbsences([absence(team, 30, 100)], { [team]: 8 });
    const forecast = simulateSeason({ ...fixtureInput(600), absences: huge });
    const row = forecast.teams[teamIndex(team)];
    // 30 points loses every scheduled game; the two placeholders still go at full strength.
    expect(row.projectedWins - row.wins).toBeGreaterThan(0.3);
  });
});

describe("H2: the return table conditions on another missed game", () => {
  it("v2: every frozen cell exceeds one game, so an inferred absence always costs the next game in full", () => {
    for (const row of [INJURY_SURVIVAL.long, INJURY_SURVIVAL.short]) {
      for (const value of row) expect(value).toBeGreaterThan(1);
    }
  });

  it("v2: a player who missed one game, on no report, is charged his whole value for the next", () => {
    const replay = runReplay(starMisses(6, 1));
    const current = currentAbsences(replay.tracker, REPLAY_INJURY, INJURY_SURVIVAL);
    const star = current.find((row) => row.athleteId === "star");
    expect(star?.gamesMissed).toBe(1);
    expect(star && star.points).toBeGreaterThan(0.5);
    const next = simulationAbsences(current, { [TEAM_A]: 1 }).regular[TEAM_A][0];
    expect(next).toBeCloseTo(star?.points ?? Number.NaN, 12);
  });
});

describe("H3: an inferred absence can outlive the rotation window", () => {
  it("v2: after twelve missed games an unreported player is still counted, his count stalled at ten", () => {
    const replay = runReplay(starMisses(6, 12));
    expect(replay.tracker.missed.get(`${TEAM_A}:star`)).toBe(10);
    const star = currentAbsences(replay.tracker, REPLAY_INJURY, INJURY_SURVIVAL).find(
      (row) => row.athleteId === "star",
    );
    expect(star?.gamesMissed).toBe(10);
    expect(star && star.points).toBeGreaterThan(0.5);
  });

  it("v2: after thirty missed games, with no appearance anywhere, he is still counted", () => {
    const replay = runReplay(starMisses(6, 30));
    const star = currentAbsences(replay.tracker, REPLAY_INJURY, INJURY_SURVIVAL).find(
      (row) => row.athleteId === "star",
    );
    expect(star).toBeDefined();
  });
});
