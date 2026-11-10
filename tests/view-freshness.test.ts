// The page-level freshness decisions (src/lib/view/freshness.ts) behind FreshnessGuard.
import { describe, expect, it } from "vitest";
import {
  MAX_REFRESHES,
  UNVERIFIED_AFTER_MS,
  afterCheck,
  initialGuardState,
  readHealth,
  serverIsNewer,
  type GuardState,
  type HealthReading,
} from "@/lib/view/freshness";
import { OUT_DEFINITION, TILE_DEFINITION, tileHelp } from "@/lib/view/how-to-read";

const rendered = "2026-11-09T07:00:00.000Z";
const at = (minutesLater: number) => new Date(Date.parse(rendered) + minutesLater * 60_000).toISOString();
const now = (minutesLater: number) => Date.parse(rendered) + minutesLater * 60_000;
const ok = (generatedAt: string): HealthReading => ({ kind: "answer", status: "ok", generatedAt });
const stale = (generatedAt: string | null): HealthReading => ({ kind: "answer", status: "stale", generatedAt });
const unreachable: HealthReading = { kind: "unreachable" };

/** Runs checks in order on one copy, as the guard does, and returns every step. */
function run(readings: HealthReading[], nowMs: number, from: GuardState = initialGuardState(rendered), copy = rendered) {
  const steps = [];
  let state = from;
  for (const reading of readings) {
    const step = afterCheck(state, copy, reading, nowMs);
    steps.push(step);
    state = step.state;
  }
  return steps;
}

describe("server newer", () => {
  it("needs a material gap, and never counts a missing or unreadable stamp", () => {
    expect(serverIsNewer(rendered, at(1))).toBe(false);
    expect(serverIsNewer(rendered, at(1.01))).toBe(true);
    expect(serverIsNewer(rendered, at(-10))).toBe(false);
    expect(serverIsNewer(rendered, null)).toBe(false);
    expect(serverIsNewer(rendered, "garbage")).toBe(false);
    expect(serverIsNewer("garbage", at(10))).toBe(false);
  });
});

describe("reading the health answer", () => {
  it("reads a 503's body like a 200's: status and stamp", () => {
    // The 503 body /api/live/health sends when the pipeline is behind on a game day.
    const body = JSON.parse(JSON.stringify({ status: "stale", generatedAt: rendered, ageHours: 13.2, slate: "2026-11-09" }));
    expect(readHealth(body)).toEqual({ kind: "answer", status: "stale", generatedAt: rendered });
    expect(readHealth({ status: "ok", generatedAt: rendered })).toEqual(ok(rendered));
  });

  it("treats anything without a readable status, or an ok without a readable stamp, as unreachable", () => {
    expect(readHealth(null)).toEqual(unreachable);
    expect(readHealth("<html>")).toEqual(unreachable);
    expect(readHealth({ generatedAt: rendered })).toEqual(unreachable);
    expect(readHealth({ status: "degraded", generatedAt: rendered })).toEqual(unreachable);
    expect(readHealth({ status: "ok", generatedAt: "garbage" })).toEqual(unreachable);
    expect(readHealth({ status: "ok" })).toEqual(unreachable);
  });

  it("keeps a stale answer whose stamp is unreadable, without a stamp", () => {
    expect(readHealth({ status: "stale", generatedAt: "garbage" })).toEqual(stale(null));
  });
});

describe("the guard's rule", () => {
  it("shows nothing when the server is healthy and matches, however long since the last publish", () => {
    for (const hours of [0.1, 1, 6, 30, 100]) {
      const [step] = run([ok(rendered)], now(hours * 60));
      expect(step).toEqual({ action: "none", state: { renderedAt: rendered, target: rendered, refreshes: 0, notice: null } });
    }
    // A server a few seconds ahead, within the material gap, also matches.
    expect(run([ok(at(0.5))], now(45))[0].state.notice).toBeNull();
  });

  it("refreshes silently when newer, then is quiet once the new copy has caught up", () => {
    const [first] = run([ok(at(30))], now(31));
    expect(first).toEqual({ action: "refresh", state: { renderedAt: rendered, target: at(30), refreshes: 1, notice: null } });
    // The refresh brought the new copy: its own check finds it matching.
    const caught = afterCheck(first.state, at(30), ok(at(30)), now(31));
    expect(caught).toEqual({ action: "none", state: { renderedAt: at(30), target: at(30), refreshes: 0, notice: null } });
  });

  it("refreshes at most twice, then a further check still behind shows the reload notice", () => {
    const steps = run([ok(at(30)), ok(at(30)), ok(at(30))], now(31));
    expect(steps.map((step) => step.action)).toEqual(["refresh", "refresh", "none"]);
    expect(steps.map((step) => step.state.notice)).toEqual([null, null, "behind"]);
    expect(steps[2].state.refreshes).toBe(MAX_REFRESHES);
    // No 20-minute precondition: a copy two minutes old that cannot catch up says so too.
    expect(run([ok(at(2)), ok(at(2)), ok(at(2))], now(2))[2].state.notice).toBe("behind");
  });

  it("starts over when the publication chased changes, keeping the reload notice while it retries", () => {
    const [, , stuck] = run([ok(at(30)), ok(at(30)), ok(at(30))], now(41));
    const next = afterCheck(stuck.state, rendered, ok(at(40)), now(41));
    expect(next).toEqual({ action: "refresh", state: { renderedAt: rendered, target: at(40), refreshes: 1, notice: "behind" } });
  });

  it("resets the counts when the copy shown changes, even if it is still behind", () => {
    const [, second] = run([ok(at(30)), ok(at(30))], now(41));
    const moved = afterCheck(second.state, at(20), ok(at(30)), now(41));
    expect(moved).toEqual({ action: "refresh", state: { renderedAt: at(20), target: at(30), refreshes: 1, notice: null } });
  });

  it("shows the pipeline notice at once when health says stale, and clears it once health is ok", () => {
    const [step] = run([stale(rendered)], now(13 * 60));
    expect(step).toEqual({ action: "none", state: { renderedAt: rendered, target: rendered, refreshes: 0, notice: "stale" } });
    // Stale with no readable stamp still says so.
    expect(run([stale(null)], now(5))[0].state.notice).toBe("stale");
    // Stale and newer than the copy: the notice shows while the copy is refreshed.
    expect(run([stale(at(30))], now(13 * 60))[0]).toMatchObject({ action: "refresh", state: { notice: "stale" } });
    expect(afterCheck(step.state, rendered, ok(rendered), now(13 * 60)).state.notice).toBeNull();
  });

  it("says nothing when health is unreachable and the copy is young", () => {
    expect(run([unreachable], now(30))[0]).toEqual({ action: "none", state: initialGuardState(rendered) });
    expect(run([unreachable], Date.parse(rendered) + UNVERIFIED_AFTER_MS)[0].state.notice).toBeNull();
  });

  it("says freshness could not be verified when health is unreachable and the copy is over 36 hours old", () => {
    expect(run([unreachable], Date.parse(rendered) + UNVERIFIED_AFTER_MS + 60_000)[0].state.notice).toBe("unverified");
    expect(run([unreachable], now(44 * 60))[0].state.notice).toBe("unverified");
  });

  it("keeps a notice already shown when a later check cannot reach the server", () => {
    const [, , stuck] = run([ok(at(30)), ok(at(30)), ok(at(30))], now(31));
    expect(afterCheck(stuck.state, rendered, unreachable, now(36)).state.notice).toBe("behind");
    const [pipeline] = run([stale(rendered)], now(13 * 60));
    expect(afterCheck(pipeline.state, rendered, unreachable, now(13 * 60 + 5)).state.notice).toBe("stale");
  });

  it("never asserts the copy is current from an invalid stamp", () => {
    expect(run([unreachable], now(5), initialGuardState("garbage"), "garbage")[0].state.notice).toBe("unverified");
    expect(run([ok(rendered)], now(5), initialGuardState("garbage"), "garbage")[0]).toEqual({
      action: "none",
      state: { renderedAt: "garbage", target: rendered, refreshes: 0, notice: "unverified" },
    });
  });

  it("drops a reload notice when a new copy arrives, and keeps a pipeline notice until health clears it", () => {
    const [, , stuck] = run([ok(at(30)), ok(at(30)), ok(at(30))], now(31));
    expect(afterCheck(stuck.state, at(30), unreachable, now(31)).state.notice).toBeNull();
    const [pipeline] = run([stale(rendered)], now(13 * 60));
    expect(afterCheck(pipeline.state, at(1), unreachable, now(13 * 60)).state.notice).toBe("stale");
  });
});

describe("how-to-read copy is reused word for word", () => {
  it("keeps the published Tile and Out definitions", () => {
    expect(TILE_DEFINITION).toBe(
      "Solid: sealed before tip and scored. Outline: the live estimate, from the score and the clock. Dashed: never scored (a provisional number or a projection). Each game is sealed in the morning and again in the hour before tip; the final seal is the one scored.",
    );
    expect(OUT_DEFINITION).toBe(
      "Points of margin each side gives up to players on the NBA injury report, weighted by status. A team that has not filed counts the players who missed its last game. Unknown future injuries, minutes shifting to teammates and matchups are not modeled.",
    );
  });

  it("builds each tooltip from the same sentences", () => {
    expect(tileHelp("sealed")).toBe(
      "Sealed before tip and scored. Each game is sealed in the morning and again in the hour before tip; the final seal is the one scored.",
    );
    expect(tileHelp("live")).toBe("The live estimate, from the score and the clock.");
    expect(tileHelp("dash")).toBe("Never scored (a provisional number or a projection).");
  });
});
