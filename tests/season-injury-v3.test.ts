import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@/lib/model/random";
import { currentAbsences, replayInjuryModel, simulationAbsences } from "@/lib/season/injury-model";
import { currentAbsencesV3, expectedGamesV3, fitHazards, replayInjuryV3, sampleAbsenceSchedule, stillOut, type V3Absence } from "@/lib/season/injury-v3";
import { INJURY_PARAMS, INJURY_STATUS_TABLE, INJURY_SURVIVAL, LIVE_PARAMS } from "@/lib/season/params";
import { createFilterState } from "@/lib/season/ratings";
import { playSeries, simulateSeason, type SimulationInput } from "@/lib/season/simulate";
import { SEASON_TEAMS, STATE_SIZE } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";
import type { StoredLine } from "@/lib/season/box-scores";
const [A, B] = SEASON_TEAMS.map((t) => t.id);
const table = { long: Array<number>(7).fill(0.1), short: Array<number>(7).fill(0.5) };
const absence: V3Absence = { teamId: A, athleteId: "star", points: 4, gamesMissed: 1, class: "short", expectedGames: 2 };

describe("v3 return hazard", () => {
  it("includes immediate returns after one miss and computes the exact expectation", () => {
    expect(stillOut(table, 1, "short", 1)).toBe(0.5);
    expect(stillOut(table, 1, "short", 3)).toBe(0.125);
    expect(expectedGamesV3(table, 1, "short")).toBeCloseTo(1, 10);
    expect(expectedGamesV3(table, 1, "short", 1)).toBeCloseTo(2, 10);
  });
  it("estimates next-game events and pools the unsupported zero boundary", () => {
    const rows = (["long", "short"] as const).flatMap((c) => Array.from({ length: 100 }, (_, i) => ({ missed: 1, class: c, returned: i < 25 })));
    const fit = fitHazards(rows);
    expect(fit.table.short).toEqual(Array(7).fill(0.25));
    expect(fit.counts.short[0]).toBe(0);
    expect(() => fitHazards(rows.map((r) => ({ ...r, returned: false })))).toThrow(/tail/);
  });
  it("has bounded decreasing survival and rejects invalid probabilities", () => {
    for (const c of ["long", "short"] as const) for (const k of [0, 1, 3, 7, 15, 30, 100]) {
      let before = 1;
      for (let j = 1; j < 120; j++) {
        const p = stillOut(table, k, c, j);
        expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(before); before = p;
      }
    }
    expect(() => stillOut(table, 1, "short", 1, 2)).toThrow();
  });
  it("samples consecutive absences deterministically and matches the analytic curve", () => {
    const random = createSeededRandom("hazard");
    const counts = [0, 0, 0];
    for (let i = 0; i < 10000; i++) {
      const curve = sampleAbsenceSchedule({ mode: "v3", current: [absence], hazards: table }, random)[A];
      counts.forEach((_, j) => { counts[j] += Number(curve[j] > 0); });
      expect(curve.every((v, j) => j === 0 || v <= curve[j - 1])).toBe(true);
    }
    counts.forEach((n, j) => expect(Math.abs(n / 10000 - stillOut(table, 1, "short", j + 1))).toBeLessThan(0.02));
  });
});

function replay(missed: number, v3: boolean, listed = false, departure = false) {
  const games: SeasonGame[] = Array.from({ length: 20 + missed }, (_, i) => ({
    id: String(i), season: 2027, kind: "regular", tipUtc: new Date(Date.UTC(2026, 9, 1 + i, 23)).toISOString(),
    etDate: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), homeId: A, awayId: B,
    neutral: false, status: "final", homeScore: 100, awayScore: 95,
  }));
  return (v3 ? replayInjuryV3 : replayInjuryModel)({ games, state: createFilterState(LIVE_PARAMS), stateSeason: 2027,
    params: LIVE_PARAMS, injury: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE,
    boxScores: (id): Record<string, StoredLine[]> => ({
      [A]: Number(id) < 20 ? [["star", 35, 25], ["role", 30, 10]] : [["role", 30, 10]],
      [B]: departure && Number(id) === games.length - 1 ? [["star", 35, 25]] : [["other", 30, 10]],
    }),
    availability: () => listed ? { morning: null, final: { at: "2026-11-01T10:00", notSubmitted: [], rows: [{ teamId: A, athleteId: "star", status: "O", reason: "knee" }] } } : null,
  });
}
const select = (r: ReturnType<typeof replay>) => currentAbsencesV3(r.tracker, INJURY_PARAMS, INJURY_SURVIVAL, { expireInferred: true, statusTable: INJURY_STATUS_TABLE });
describe("v3 stale inference", () => {
  it("expires after more than ten misses, even before a departed player's next debut", () => {
    expect(select(replay(10, true)).current.some((a) => a.athleteId === "star")).toBe(true);
    const r = replay(14, true);
    expect(select(r).current.some((a) => a.athleteId === "star")).toBe(false);
    expect(select(r).excluded).toContainEqual({ teamId: A, athleteId: "star", gamesMissed: 14, reason: "no longer counted: out of the rotation window" });
    expect(currentAbsences(replay(14, false).tracker, INJURY_PARAMS, INJURY_SURVIVAL).some((a) => a.athleteId === "star")).toBe(true);
  });
  it("expires immediately upon a new-team appearance but keeps report policy", () => {
    expect(select(replay(2, true, false, true)).excluded[0].reason).toMatch(/joined another team/);
    expect(select(replay(14, true, true)).current.some((a) => a.athleteId === "star")).toBe(true);
  });
  it("does not change ratings or report-based game forecasts", () => {
    expect(replay(14, true).state).toEqual(replay(14, false).state);
  });
});

describe("v3 team-game expiry", () => {
  it("charges two games only, and carries the balance across the regular/postseason boundary", () => {
    const curve = sampleAbsenceSchedule({ mode: "v3", current: [absence] }, () => 0.5)[A];
    expect(curve.slice(0, 4)).toEqual([4, 4, 0, 0]);
    const longer = sampleAbsenceSchedule({ mode: "v3", current: [{ ...absence, expectedGames: 4 }] }, () => 0.5)[A];
    expect(longer.slice(2, 7)).toEqual([4, 4, 0, 0, 0]);
  });
  it("consumes only future series games and respects the observed score", () => {
    const calls: number[] = [];
    expect(playSeries(0, 1, 3, 2, new Float64Array(STATE_SIZE), LIVE_PARAMS, () => 0, (t) => { calls.push(t); return 0; })).toBe(0);
    expect(calls).toEqual([0, 1]);
    calls.length = 0;
    playSeries(0, 1, 4, 2, new Float64Array(STATE_SIZE), LIVE_PARAMS, () => 0, (t) => { calls.push(t); return 0; });
    expect(calls).toEqual([]);
  });
  const input = (): SimulationInput => ({ season: 2027, phase: "regular-season", games: [], state: createFilterState(LIVE_PARAMS),
    params: LIVE_PARAMS, asOfEtDate: "2026-11-05", lastGameEtDate: {}, iterations: 1200 });
  it("charges unscheduled placeholders and gives deterministic bounded forecasts", () => {
    const base = input();
    const healthy = simulateSeason(base);
    const opt = { ...base, absenceSchedule: { mode: "v3" as const, current: [{ ...absence, expectedGames: 82, points: 15 }] } };
    const hurt = simulateSeason(opt);
    expect(hurt.teams[0].projectedWins).toBeLessThan(healthy.teams[0].projectedWins);
    expect(simulateSeason(opt)).toEqual(hurt);
    expect(hurt.sums.champion).toBeCloseTo(1, 10);
  });
  it("restores title odds relative to a perpetual scalar for a postseason-only absence", () => {
    const base = input();
    // All regular slots have elapsed: four missed games now cover the postseason start.
    const current = [{ ...absence, expectedGames: 84 }];
    const old = simulateSeason({ ...base, absences: simulationAbsences(current, { [A]: 82 }) });
    const fixed = simulateSeason({ ...base, absenceSchedule: { mode: "v3", current } });
    expect(fixed.teams[0].champion).toBeGreaterThanOrEqual(old.teams[0].champion);
  });
});
