// What a page says and does about the age of the copy it shows. Pure, so the client
// component (src/components/live/FreshnessGuard.tsx) is only wiring; tests in
// tests/view-freshness.test.ts.
//
// Every page renders at request time (src/app/layout.tsx), so a fresh load shows what the
// server has. Under incremental regeneration the CDN once served copies hours or days old
// (on 2026-11-09 a day page rendered 44 hours earlier; on 2026-11-14 to 16 the build-time
// copy). The guard remains for what request-time rendering does not cover: a tab left
// open, a back-forward restore and the browser's client router cache. The copy carries its
// state's `generatedAt`; /api/live/health, never cached, says what the server has now,
// whether it is behind (`status`, "stale" with a 503 when it is not keeping up) and which
// copy it is (`delivery`: "current", "older" or "stored"). The guard compares the two.
//
// The rule:
// - Server materially newer than the copy: refresh silently, at most twice, at least six
//   seconds apart; a check at or after that deadline that still finds the copy behind
//   shows the reload notice. A check that comes early (a tab coming back, a back-forward
//   restore, the poll) still reads the server and may show the pipeline notice, but waits
//   for the deadline before refreshing again or saying the copy cannot catch up.
// - Server says "stale" and its copy is the data branch's head (`delivery` "current", or
//   absent from an older deployment): the pipeline notice, at once.
// - Server says "stale" with `delivery` "older" or "stored": the server could not read the
//   latest publication and shows an older or stored copy, which is not the pipeline's
//   fault: the stored-copy notice, at once. With "ok", `delivery` changes nothing.
// - Server healthy and the copy matches it: nothing, however long since the last publish
//   (a quiet afternoon publishes nothing new, and that is not a fault).
// - Server unreachable or its answer unreadable: keep a notice already shown; otherwise
//   say freshness could not be verified only for a copy over 36 hours old or with an
//   unreadable stamp. Never claim that nothing newer exists.
// - Retry counts reset when the copy shown or the publication chased changes.

import type { Delivery } from "@/lib/live-data/published";

/** The server counts as newer when its state is more than this much younger. */
export const MATERIAL_MS = 60_000;
/** How many times a page asks the server for a newer copy of itself before saying so. */
export const MAX_REFRESHES = 2;
/** The least time between silent refreshes, and before the reload notice, for one copy and target. */
export const RETRY_MS = 6_000;
/** With no answer from the server, a copy older than this says it could not be verified. */
export const UNVERIFIED_AFTER_MS = 36 * 3_600_000;

/** What one call to /api/live/health told us. */
export type HealthReading =
  /**
   * A readable answer, whatever the HTTP status; `generatedAt` is null when unreadable,
   * `delivery` null when absent or unknown (a deployment from before it existed).
   */
  | { kind: "answer"; status: "ok" | "stale"; generatedAt: string | null; delivery: Delivery | null }
  /** The network failed, or the body was not the health JSON. */
  | { kind: "unreachable" };

const DELIVERIES: readonly Delivery[] = ["current", "older", "stored"];

/**
 * behind: the server has a newer copy that did not load here. stale: the server's own
 * data is behind (the pipeline has not published in time). stored: the server's data is
 * behind because it could not read the latest publication and shows an older or stored
 * copy. unverified: the server could not be asked and the copy is old or its stamp
 * unreadable.
 */
export type NoticeKind = "behind" | "stale" | "stored" | "unverified";

/** The stored-copy notice, word for word (the other notices are built in FreshnessGuard). */
export const STORED_NOTICE = "548 could not read the latest forecasts just now; this page shows a stored copy. Reload in a minute.";

export type GuardState = {
  /** `generatedAt` of the copy the counts below belong to. */
  renderedAt: string;
  /** The server publication the refreshes are chasing. */
  target: string | null;
  /** Refreshes asked for while chasing `target` on this copy. */
  refreshes: number;
  /**
   * The earliest time (ms) another silent refresh, or the reload notice, may follow for
   * this copy and target; null when no refresh is waiting to land.
   */
  retryAt: number | null;
  notice: NoticeKind | null;
};

/** After a check: what to do now, and the state to keep. */
export type GuardStep = {
  /** refresh: re-render from the server now. none: change nothing on the page. */
  action: "refresh" | "none";
  state: GuardState;
  /** When to check again on its own (ms), or null to wait for the next trigger. */
  checkAt: number | null;
};

export function initialGuardState(renderedAt: string): GuardState {
  return { renderedAt, target: null, refreshes: 0, retryAt: null, notice: null };
}

const validStamp = (iso: string | null): iso is string => iso !== null && Number.isFinite(Date.parse(iso));

/** True when the server's state is materially younger than the one shown. */
export function serverIsNewer(renderedAt: string, serverAt: string | null): boolean {
  if (!validStamp(serverAt) || !validStamp(renderedAt)) return false;
  return Date.parse(serverAt) - Date.parse(renderedAt) > MATERIAL_MS;
}

/**
 * Reads the health route's body, which carries valid JSON on a 503 as well as a 200.
 * Anything without a readable `status` is unreachable; an "ok" without a readable
 * `generatedAt` is too, since it cannot be compared.
 */
export function readHealth(body: unknown): HealthReading {
  if (typeof body !== "object" || body === null) return { kind: "unreachable" };
  const { status, generatedAt, delivery } = body as { status?: unknown; generatedAt?: unknown; delivery?: unknown };
  if (status !== "ok" && status !== "stale") return { kind: "unreachable" };
  const stamp = typeof generatedAt === "string" && validStamp(generatedAt) ? generatedAt : null;
  if (status === "ok" && stamp === null) return { kind: "unreachable" };
  const known = DELIVERIES.find((value) => value === delivery) ?? null;
  return { kind: "answer", status, generatedAt: stamp, delivery: known };
}

/** The state to start a check from: counts reset when the copy shown has changed. */
export function forCopy(state: GuardState, renderedAt: string): GuardState {
  if (state.renderedAt === renderedAt) return state;
  // A new copy arrived: whether it is still behind is for this check to say. A
  // pipeline or unverified notice stays until an answer clears it.
  return { renderedAt, target: null, refreshes: 0, retryAt: null, notice: state.notice === "behind" ? null : state.notice };
}

/** One health check's outcome for the copy stamped `renderedAt`. */
export function afterCheck(previous: GuardState, renderedAt: string, reading: HealthReading, nowMs: number): GuardStep {
  const state = forCopy(previous, renderedAt);

  if (reading.kind === "unreachable") {
    // A follow-up a refresh was waiting for still happens.
    const checkAt = state.retryAt !== null && state.retryAt > nowMs ? state.retryAt : null;
    if (state.notice !== null) return { action: "none", state, checkAt };
    const age = nowMs - Date.parse(renderedAt);
    const unverified = !Number.isFinite(age) || age > UNVERIFIED_AFTER_MS;
    return { action: "none", state: { ...state, notice: unverified ? "unverified" : null }, checkAt };
  }

  const target = reading.generatedAt;
  const sameTarget = target === state.target;
  const refreshes = sameTarget ? state.refreshes : 0;
  const retryAt = sameTarget ? state.retryAt : null;
  const pipeline: NoticeKind | null =
    reading.status !== "stale" ? null : reading.delivery === "older" || reading.delivery === "stored" ? "stored" : "stale";

  if (serverIsNewer(renderedAt, target)) {
    // While refreshing or waiting, a notice already shown for this gap stays until it closes.
    const notice = state.notice === "behind" ? "behind" : pipeline;
    if (retryAt !== null && nowMs < retryAt) {
      // The last refresh may still be landing: look again at the deadline, not before.
      return { action: "none", state: { renderedAt, target, refreshes, retryAt, notice }, checkAt: retryAt };
    }
    if (refreshes < MAX_REFRESHES) {
      const next = nowMs + RETRY_MS;
      return { action: "refresh", state: { renderedAt, target, refreshes: refreshes + 1, retryAt: next, notice }, checkAt: next };
    }
    return { action: "none", state: { renderedAt, target, refreshes, retryAt, notice: "behind" }, checkAt: null };
  }

  // The copy matches the server (or the server has nothing comparable).
  const unreadable = !validStamp(renderedAt) && pipeline === null;
  return {
    action: "none",
    state: { renderedAt, target, refreshes: 0, retryAt: null, notice: pipeline ?? (unreadable ? "unverified" : null) },
    checkAt: null,
  };
}
