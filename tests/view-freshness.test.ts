// The page-level freshness decisions (src/lib/view/freshness.ts) behind FreshnessGuard.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_REFRESHES,
  RETRY_MS,
  UNVERIFIED_AFTER_MS,
  afterCheck,
  initialGuardState,
  readHealth,
  serverIsNewer,
  type GuardState,
  type HealthReading,
} from "@/lib/view/freshness";
import { HEALTH_TIMEOUT_MS, startFreshnessChecks } from "@/lib/view/freshness-checks";
import { OUT_DEFINITION, TILE_DEFINITION, tileHelp } from "@/lib/view/how-to-read";

const rendered = "2026-11-09T07:00:00.000Z";
const at = (minutesLater: number) => new Date(Date.parse(rendered) + minutesLater * 60_000).toISOString();
const now = (minutesLater: number) => Date.parse(rendered) + minutesLater * 60_000;
const ok = (generatedAt: string): HealthReading => ({ kind: "answer", status: "ok", generatedAt });
const stale = (generatedAt: string | null): HealthReading => ({ kind: "answer", status: "stale", generatedAt });
const unreachable: HealthReading = { kind: "unreachable" };

/**
 * Runs checks in order on one copy, as the guard does, and returns every step. Each check
 * after the first comes `gapMs` later (by default the retry deadline, as the follow-up does).
 */
function run(readings: HealthReading[], nowMs: number, from: GuardState = initialGuardState(rendered), copy = rendered, gapMs = RETRY_MS) {
  const steps = [];
  let state = from;
  for (const [index, reading] of readings.entries()) {
    const step = afterCheck(state, copy, reading, nowMs + index * gapMs);
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
      expect(step).toEqual({ action: "none", state: { renderedAt: rendered, target: rendered, refreshes: 0, retryAt: null, notice: null }, checkAt: null });
    }
    // A server a few seconds ahead, within the material gap, also matches.
    expect(run([ok(at(0.5))], now(45))[0].state.notice).toBeNull();
  });

  it("refreshes silently when newer, then is quiet once the new copy has caught up", () => {
    const [first] = run([ok(at(30))], now(31));
    expect(first).toEqual({
      action: "refresh",
      state: { renderedAt: rendered, target: at(30), refreshes: 1, retryAt: now(31) + RETRY_MS, notice: null },
      checkAt: now(31) + RETRY_MS,
    });
    // The refresh brought the new copy: its own check finds it matching.
    const caught = afterCheck(first.state, at(30), ok(at(30)), now(31));
    expect(caught).toEqual({ action: "none", state: { renderedAt: at(30), target: at(30), refreshes: 0, retryAt: null, notice: null }, checkAt: null });
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
    const next = afterCheck(stuck.state, rendered, ok(at(40)), now(42));
    expect(next).toEqual({
      action: "refresh",
      state: { renderedAt: rendered, target: at(40), refreshes: 1, retryAt: now(42) + RETRY_MS, notice: "behind" },
      checkAt: now(42) + RETRY_MS,
    });
  });

  it("resets the counts when the copy shown changes, even if it is still behind", () => {
    const [, second] = run([ok(at(30)), ok(at(30))], now(41));
    // A new copy may refresh at once: the deadline belonged to the old one.
    const moved = afterCheck(second.state, at(20), ok(at(30)), now(41) + RETRY_MS + 1);
    expect(moved).toEqual({
      action: "refresh",
      state: { renderedAt: at(20), target: at(30), refreshes: 1, retryAt: now(41) + 2 * RETRY_MS + 1, notice: null },
      checkAt: now(41) + 2 * RETRY_MS + 1,
    });
  });

  it("shows the pipeline notice at once when health says stale, and clears it once health is ok", () => {
    const [step] = run([stale(rendered)], now(13 * 60));
    expect(step).toEqual({
      action: "none",
      state: { renderedAt: rendered, target: rendered, refreshes: 0, retryAt: null, notice: "stale" },
      checkAt: null,
    });
    // Stale with no readable stamp still says so.
    expect(run([stale(null)], now(5))[0].state.notice).toBe("stale");
    // Stale and newer than the copy: the notice shows while the copy is refreshed.
    expect(run([stale(at(30))], now(13 * 60))[0]).toMatchObject({ action: "refresh", state: { notice: "stale" } });
    expect(afterCheck(step.state, rendered, ok(rendered), now(13 * 60)).state.notice).toBeNull();
  });

  it("says nothing when health is unreachable and the copy is young", () => {
    expect(run([unreachable], now(30))[0]).toEqual({ action: "none", state: initialGuardState(rendered), checkAt: null });
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
      state: { renderedAt: "garbage", target: rendered, refreshes: 0, retryAt: null, notice: "unverified" },
      checkAt: null,
    });
  });

  it("drops a reload notice when a new copy arrives, and keeps a pipeline notice until health clears it", () => {
    const [, , stuck] = run([ok(at(30)), ok(at(30)), ok(at(30))], now(31));
    expect(afterCheck(stuck.state, at(30), unreachable, now(31)).state.notice).toBeNull();
    const [pipeline] = run([stale(rendered)], now(13 * 60));
    expect(afterCheck(pipeline.state, at(1), unreachable, now(13 * 60)).state.notice).toBe("stale");
  });
});

describe("the retry deadline", () => {
  it("lets an early check read the server but not spend a refresh or show the reload notice", () => {
    const [first] = run([ok(at(30))], now(31));
    expect(first.action).toBe("refresh");
    // A back-forward restore one second later: same copy, same target, before the deadline.
    const early = afterCheck(first.state, rendered, ok(at(30)), now(31) + 1_000);
    expect(early).toEqual({ action: "none", state: first.state, checkAt: first.state.retryAt });
    // At the deadline the second refresh goes ahead.
    const second = afterCheck(early.state, rendered, ok(at(30)), now(31) + RETRY_MS);
    expect(second.action).toBe("refresh");
    expect(second.state.refreshes).toBe(2);
    // The reload notice waits for the second refresh's deadline too.
    expect(afterCheck(second.state, rendered, ok(at(30)), now(31) + RETRY_MS + 1_000)).toMatchObject({ action: "none", state: { notice: null } });
    expect(afterCheck(second.state, rendered, ok(at(30)), now(31) + 2 * RETRY_MS).state.notice).toBe("behind");
  });

  it("shows the pipeline notice at once, even before the deadline", () => {
    const [first] = run([ok(at(30))], now(31));
    expect(afterCheck(first.state, rendered, stale(at(30)), now(31) + 1_000)).toMatchObject({ action: "none", state: { notice: "stale" } });
  });

  it("keeps the follow-up a refresh asked for when an early check cannot reach the server", () => {
    const [first] = run([ok(at(30))], now(31));
    expect(afterCheck(first.state, rendered, unreachable, now(31) + 1_000).checkAt).toBe(first.state.retryAt);
  });
});

describe("the checks over time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now(31));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A guard on the copy `rendered`, with every effect recorded. */
  function guard(read: (signal: AbortSignal) => Promise<HealthReading>, copy = rendered) {
    let state = initialGuardState(copy);
    const log = { refreshes: 0, notices: [] as Array<string | null>, signals: [] as AbortSignal[] };
    const checks = startFreshnessChecks({
      renderedAt: copy,
      read: (signal) => {
        log.signals.push(signal);
        return read(signal);
      },
      getState: () => state,
      setState: (next) => {
        state = next;
      },
      refresh: () => {
        log.refreshes += 1;
      },
      publish: (notice) => log.notices.push(notice),
    });
    return { checks, log, state: () => state };
  }

  it("spaces refreshes and the reload notice whatever triggers arrive in between", async () => {
    // The server stays newer: the refreshes never bring a newer copy.
    const { checks, log, state } = guard(async () => ok(at(30)));
    checks.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.refreshes).toBe(1);

    // pageshow, a tab coming back and the poll, all within the first six seconds.
    for (const later of [500, 1_500, 4_000]) {
      await vi.advanceTimersByTimeAsync(later - (Date.now() - now(31)));
      checks.check();
      await vi.advanceTimersByTimeAsync(0);
      expect(log.refreshes).toBe(1);
      expect(state().notice).toBeNull();
    }

    // The follow-up at the deadline spends the second refresh.
    await vi.advanceTimersByTimeAsync(RETRY_MS - 4_000);
    expect(log.refreshes).toBe(2);

    // Another early trigger: still no notice.
    await vi.advanceTimersByTimeAsync(1_000);
    checks.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().notice).toBeNull();

    // At the second deadline the copy is still behind: the reload notice, and no third refresh.
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(state().notice).toBe("behind");
    expect(log.refreshes).toBe(MAX_REFRESHES);
    // Nothing further is scheduled.
    await vi.advanceTimersByTimeAsync(10 * RETRY_MS);
    expect(log.refreshes).toBe(MAX_REFRESHES);
    checks.stop();
  });

  it("gives up on a request that never answers, says so on an old copy, and keeps checking", async () => {
    // A copy 37 hours old, and a health request that hangs.
    const old = new Date(now(31) - 37 * 3_600_000).toISOString();
    let answer = false;
    const { checks, log, state } = guard((signal) => (answer ? Promise.resolve(ok(old)) : new Promise<HealthReading>(() => void signal)), old);
    checks.check();
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS - 1);
    expect(state().notice).toBeNull();
    // A trigger while the request hangs is dropped, not queued behind it.
    checks.check();
    expect(log.signals).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(log.signals[0].aborted).toBe(true);
    expect(state().notice).toBe("unverified");

    // The hung request no longer blocks: the next trigger asks again and clears the notice.
    answer = true;
    checks.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.signals).toHaveLength(2);
    expect(state().notice).toBeNull();
    checks.stop();
  });

  it("treats a failed request as unreachable", async () => {
    const old = new Date(now(31) - 37 * 3_600_000).toISOString();
    const { checks, state } = guard(() => Promise.reject(new Error("offline")), old);
    checks.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().notice).toBe("unverified");
    checks.stop();
  });

  it("stops cleanly: the request in flight is aborted and no follow-up runs", async () => {
    let calls = 0;
    const { checks, log } = guard(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve(ok(at(30))) : new Promise<HealthReading>(() => {});
    });
    checks.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.refreshes).toBe(1);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(calls).toBe(2);
    checks.stop();
    expect(log.signals[1].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS + 10 * RETRY_MS);
    expect(calls).toBe(2);
    expect(log.refreshes).toBe(1);
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
