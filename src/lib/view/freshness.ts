// What a page says and does about the age of the copy it shows. Pure, so the client
// component (src/components/live/FreshnessGuard.tsx) is only wiring; tests in
// tests/view-freshness.test.ts.
//
// Every route is regenerated about once a minute, and the CDN may hand out a copy for up
// to `expireTime` (next.config.ts) past that. So a reader can arrive on a copy rendered a
// few minutes ago and, before that bound existed, on one rendered days ago: on 2026-11-09
// a day page was served as rendered 44 hours earlier, every game "upcoming", while the
// homepage was current. The copy carries its state's `generatedAt`; /api/live/health,
// never cached, says what the server has now and whether the pipeline is keeping up
// (`status`, "stale" with a 503 when it is not). The guard compares the two.
//
// The rule:
// - Server materially newer than the copy: refresh silently, at most twice, at least six
//   seconds apart; a check at or after that deadline that still finds the copy behind
//   shows the reload notice. A check that comes early (a tab coming back, a back-forward
//   restore, the poll) still reads the server and may show the pipeline notice, but waits
//   for the deadline before refreshing again or saying the copy cannot catch up.
// - Server says "stale": the pipeline notice, at once.
// - Server healthy and the copy matches it: nothing, however long since the last publish
//   (a quiet afternoon publishes nothing new, and that is not a fault).
// - Server unreachable or its answer unreadable: keep a notice already shown; otherwise
//   say freshness could not be verified only for a copy over 36 hours old or with an
//   unreadable stamp. Never claim that nothing newer exists.
// - Retry counts reset when the copy shown or the publication chased changes.

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
  /** A readable answer, whatever the HTTP status; `generatedAt` is null when unreadable. */
  | { kind: "answer"; status: "ok" | "stale"; generatedAt: string | null }
  /** The network failed, or the body was not the health JSON. */
  | { kind: "unreachable" };

/**
 * behind: the server has a newer copy that did not load here. stale: the server's own
 * data is behind (the pipeline has not published in time). unverified: the server could
 * not be asked and the copy is old or its stamp unreadable.
 */
export type NoticeKind = "behind" | "stale" | "unverified";

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
  const { status, generatedAt } = body as { status?: unknown; generatedAt?: unknown };
  if (status !== "ok" && status !== "stale") return { kind: "unreachable" };
  const stamp = typeof generatedAt === "string" && validStamp(generatedAt) ? generatedAt : null;
  if (status === "ok" && stamp === null) return { kind: "unreachable" };
  return { kind: "answer", status, generatedAt: stamp };
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
  const pipeline: NoticeKind | null = reading.status === "stale" ? "stale" : null;

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
