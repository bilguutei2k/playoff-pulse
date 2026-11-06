// The live watchdog's pure decisions (scripts/live/watchdog-decision.mjs).
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain Node module with no types, run by the watchdog workflow without a build
import { alertBody, decideWatchdog, failureStreak, reportedKeys } from "../scripts/live/watchdog-decision.mjs";
import { liveScript, run as runCommand } from "./support/shell";

type Alert = { key: string; text: string };
const now = "2026-11-05T20:00:00Z";
let nextId = 1;
const run = (minutesAgo: number, conclusion: string | null = "success", status = "completed", title = "Live forecast") => ({
  id: nextId++,
  created_at: new Date(Date.parse(now) - minutesAgo * 60_000).toISOString(),
  status,
  conclusion,
  display_title: title,
});
const game = { id: "g1", etDate: "2026-11-05", tipUtc: "2026-11-05T19:49Z", status: "scheduled", homeId: "1", awayId: "2" };
const seal = { type: "seal", gameId: "g1", modelVersion: "live-2026.27-v2", sealKind: "morning" };
const decide = (overrides: Record<string, unknown> = {}) =>
  decideWatchdog({ now, workflowState: "active", runs: [run(5)], state: { generatedAt: now }, games: [], ledger: [], ...overrides });
const keys = (overrides: Record<string, unknown> = {}) => (decide(overrides).alerts as Alert[]).map((alert) => alert.key);

describe("restarting the chain", () => {
  it("dispatches only with no real run created in the last 25 minutes", () => {
    expect(decide()).toMatchObject({ dispatch: false, recent: true, active: false });
    expect(decide({ runs: [run(25)] }).dispatch).toBe(false);
    expect(decide({ runs: [run(26)] })).toMatchObject({ dispatch: true, recent: false });
    expect(keys({ runs: [run(26)] })).toEqual(["restart"]);
    expect(decide({ runs: [] }).dispatch).toBe(true);
  });

  it.each(["queued", "in_progress", "waiting", "pending", "requested"])("does not dispatch while a run is %s", (status) => {
    expect(decide({ runs: [run(80, null, status)] })).toMatchObject({ dispatch: false, active: true });
  });

  it("does not count a run that has shown as not completed for over 90 minutes", () => {
    expect(decide({ runs: [run(90, null, "in_progress")] }).dispatch).toBe(false);
    expect(decide({ runs: [run(91, null, "queued")] })).toMatchObject({ dispatch: true, active: false });
  });

  it("ignores dry runs, recent or running", () => {
    expect(decide({ runs: [run(1, "success", "completed", "Live forecast (dry run)")] }).dispatch).toBe(true);
    expect(decide({ runs: [run(1, null, "in_progress", "Live forecast (dry run)")] }).dispatch).toBe(true);
  });

  it("stays silent and idle when live-forecast is disabled by hand", () => {
    expect(decide({ runs: [], state: { generatedAt: "2026-11-01T00:00:00Z" }, workflowState: "disabled_manually" })).toEqual({
      paused: true, dispatch: false, active: null, recent: null, streak: null, alerts: [],
    });
  });

  it("alerts instead of dispatching when live-forecast is disabled otherwise", () => {
    expect(decide({ runs: [], workflowState: "disabled_inactivity" })).toMatchObject({ dispatch: false, paused: false });
    expect(keys({ runs: [], workflowState: "disabled_inactivity" })).toEqual(["workflow-disabled_inactivity"]);
  });

  it("still dispatches when the workflow's state could not be read", () => {
    expect(decide({ runs: [], workflowState: null }).dispatch).toBe(true);
  });

  it("neither dispatches nor guesses when the runs could not be listed", () => {
    expect(decide({ runs: null })).toMatchObject({ dispatch: false, streak: null, active: null });
    expect(keys({ runs: null })).toEqual(["runs-unreadable"]);
  });
});

describe("stale state", () => {
  it("alerts strictly past 2.5 hours, keyed by the stale timestamp", () => {
    expect(keys({ state: { generatedAt: "2026-11-05T17:30:00Z" } })).toEqual([]);
    expect(keys({ state: { generatedAt: "2026-11-05T17:29:59Z" } })).toEqual(["stale-2026-11-05T17:29:59Z"]);
  });

  it("alerts on an unreadable or missing timestamp", () => {
    expect(keys({ state: { generatedAt: "garbage" } })).toEqual(["stale-garbage"]);
    expect(keys({ state: {} })).toEqual(["stale-undefined"]);
  });
});

describe("tipped games without a v2 final or morning seal", () => {
  it("alerts per game, keyed by game", () => {
    expect(keys({ games: [game, { ...game, id: "g2" }] })).toEqual(["unsealed-g1", "unsealed-g2"]);
  });

  it.each(["morning", "final"])("a v2 %s seal is enough", (sealKind) => {
    expect(keys({ games: [game], ledger: [{ ...seal, sealKind }] })).toEqual([]);
  });

  it("a reissued seal, a v1 seal or a result row does not hide a gap", () => {
    for (const row of [{ ...seal, sealKind: "reissued" }, { ...seal, modelVersion: "live-2026.27-v1", sealKind: null }, { type: "result", gameId: "g1" }]) {
      expect(keys({ games: [game], ledger: [row] })).toEqual(["unsealed-g1"]);
    }
  });

  it("skips games before v2, canceled or postponed, inside the 10 minutes, untipped, or older than 24 hours", () => {
    for (const g of [
      { ...game, etDate: "2026-11-01" },
      { ...game, status: "canceled" },
      { ...game, status: "postponed" },
      { ...game, tipUtc: "2026-11-05T19:50Z" },
      { ...game, tipUtc: "2026-11-05T21:00Z" },
      { ...game, tipUtc: "2026-11-04T19:59Z" },
      { ...game, tipUtc: "garbage" },
    ]) {
      expect(keys({ games: [g] })).toEqual([]);
    }
    expect(keys({ games: [{ ...game, tipUtc: "2026-11-04T20:00Z" }] })).toEqual(["unsealed-g1"]);
  });

  it("does not guess when the games or the ledger could not be read", () => {
    expect(keys({ games: [game], ledger: null })).toEqual([]);
    expect(keys({ games: null, ledger: [] })).toEqual([]);
  });
});

describe("failure streak", () => {
  it("alerts at three failed real runs in a row, keyed by the streak's first run", () => {
    const runs = [run(1, "failure"), run(2, "cancelled"), run(3, "timed_out"), run(4, "startup_failure"), run(5, "success")];
    const decision = decide({ runs });
    expect(decision.streak).toBe(3);
    expect(keys({ runs })).toEqual([`failing-since-${runs[3].id}`]);
    expect(decide({ runs: runs.slice(1) }).streak).toBe(2);
  });

  it("ignores in-progress and dry runs, and ends at any other conclusion", () => {
    const failing = [run(2, "failure"), run(3, "failure"), run(4, "failure")];
    expect(decide({ runs: [run(1, null, "in_progress"), ...failing] }).streak).toBe(3);
    expect(decide({ runs: [run(0, "success", "completed", "Live forecast (dry run)"), ...failing] }).streak).toBe(3);
    expect(decide({ runs: [run(1, "neutral"), ...failing] }).streak).toBe(0);
  });

  it("sorts by creation time, not list order", () => {
    expect(failureStreak([run(10, "failure"), run(1, "success"), run(20, "failure")]).streak).toBe(0);
  });

  it.each([
    ["failure", "failure", "failure"],
    ["failure", "cancelled", "failure", "skipped", "failure", "success", "failure"],
    ["cancelled", "cancelled", "success", "failure"],
    ["startup_failure", "timed_out", "stale", "action_required", "failure"],
    [],
  ])("counts like scripts/live/chain-decision.sh: %j", (...conclusions: string[]) => {
    const runs = conclusions.map((conclusion, index) => run(index + 1, conclusion));
    const [newest = "cancelled", ...earlier] = conclusions;
    const script = runCommand("bash", [liveScript("chain-decision.sh"), newest, ...earlier], process.cwd());
    expect(script.status, script.stderr).toBe(0);
    expect(failureStreak(runs).streak).toBe(Number(/streak=(\d+)/.exec(script.stdout)?.[1]));
  });
});

describe("issue text", () => {
  it("round-trips its keys through the hidden marker", () => {
    const body = alertBody({ now, dataCommit: "abc", runUrl: "https://example.test/run", alerts: [{ key: "restart", text: "a" }, { key: "unsealed-g1", text: "b" }] });
    expect(body).toContain("- a\n- b");
    expect(body).toContain("cc @bilguutei2k");
    expect([...reportedKeys(["unrelated", body, "<!-- live-watchdog: stale-x -->"])]).toEqual(["restart", "unsealed-g1", "stale-x"]);
    expect(reportedKeys([null, ""]).size).toBe(0);
  });
});
