import { describe, expect, it } from "vitest";
// @ts-expect-error standalone Node script intentionally has no build dependency
import { decideWatchdog } from "../scripts/live/watchdog-decision.mjs";

const now = "2026-11-05T20:00:00Z";
const run = (minutes: number, conclusion = "success", status = "completed") => ({
  created_at: new Date(Date.parse(now) - minutes * 60_000).toISOString(), status, conclusion, display_title: "Live forecast",
});
const game = { id: "g", etDate: "2026-11-05", tipUtc: "2026-11-05T19:49:00Z", status: "scheduled" };
const seal = { type: "seal", gameId: "g", modelVersion: "live-2026.27-v2", sealKind: "morning" };
const decide = (overrides = {}) => decideWatchdog({
  now, runs: [run(5)], state: { generatedAt: now }, games: [], ledger: [], health: {}, ...overrides,
});

describe("watchdog decisions", () => {
  it("restarts only when no real recent or active run exists", () => {
    expect(decide().dispatch).toBe(false);
    expect(decide({ runs: [run(25)] }).dispatch).toBe(false);
    expect(decide({ runs: [run(26)] }).dispatch).toBe(true);
    for (const status of ["queued", "in_progress", "pending", "waiting", "requested"]) {
      expect(decide({ runs: [run(80, "", status)] }).dispatch).toBe(false);
    }
    expect(decide({ runs: [{ ...run(1), display_title: "Live forecast (dry run)" }] }).dispatch).toBe(true);
  });
  it("alerts strictly past 2.5 hours, including invalid state timestamps", () => {
    expect(decide({ state: { generatedAt: "2026-11-05T17:30:00Z" } }).alerts).toEqual([]);
    expect(decide({ state: { generatedAt: "2026-11-05T17:29:59Z" } }).alerts).toHaveLength(1);
    expect(decide({ state: { generatedAt: "broken" } }).alerts).toHaveLength(1);
  });
  it("requires a v2 final or morning seal; reissued and v1 do not hide a gap", () => {
    expect(decide({ games: [game] }).alerts).toHaveLength(1);
    for (const sealKind of ["morning", "final"]) {
      expect(decide({ games: [game], ledger: [{ ...seal, sealKind }] }).alerts).toEqual([]);
    }
    for (const row of [{ ...seal, sealKind: "reissued" }, { ...seal, modelVersion: "live-2026.27-v1" }]) {
      expect(decide({ games: [game], ledger: [row] }).alerts).toHaveLength(1);
    }
  });
  it("does not flag pre-v2, canceled or not-yet-ten-minutes-past-tip games", () => {
    for (const g of [
      { ...game, etDate: "2026-11-01" }, { ...game, status: "canceled" },
      { ...game, tipUtc: "2026-11-05T19:50:00Z" }, { ...game, tipUtc: "2026-11-05T21:00:00Z" },
    ]) expect(decide({ games: [g] }).alerts).toEqual([]);
  });
  it("counts failures across cancellations, stops at recovery, excludes dry runs", () => {
    const runs = [run(1, "failure"), run(2, "cancelled"), run(3, "timed_out"), run(4, "startup_failure")];
    expect(decide({ runs })).toMatchObject({ streak: 3, alerts: [expect.stringContaining("3 times")] });
    expect(decide({ runs: [run(0), ...runs] }).streak).toBe(0);
    expect(decide({ runs: [{ ...run(0), display_title: "Live forecast (dry run)" }, ...runs] }).streak).toBe(3);
  });
  it("alerts on viewsProblem even without reportProblem", () => {
    expect(decide({ health: { viewsProblem: "players invalid", reportProblem: null } }).alerts).toEqual(["viewsProblem: players invalid"]);
  });
});
