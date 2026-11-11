// The timing around the freshness rule (src/lib/view/freshness.ts): one health check at
// a time, each with its own time limit, and the follow-up check a refresh asks for. No
// React and no DOM, so FreshnessGuard only wires browser events to `check`, and
// tests/view-freshness.test.ts drives it with fake timers.

import { afterCheck, type GuardState, type HealthReading, type NoticeKind } from "@/lib/view/freshness";

/** A health request that has not answered after this long counts as unreachable. */
export const HEALTH_TIMEOUT_MS = 10_000;

export type FreshnessChecks = {
  /** Check now, unless a check is already in flight. Safe to call from any trigger. */
  check: () => void;
  /** Abort the request in flight and cancel the follow-up; later calls do nothing. */
  stop: () => void;
};

export function startFreshnessChecks(options: {
  /** `generatedAt` of the copy shown. */
  renderedAt: string;
  /** Asks the server; should honour the signal, but a request that never settles is cut off anyway. */
  read: (signal: AbortSignal) => Promise<HealthReading>;
  /** The guard's state, kept across copies by the caller. */
  getState: () => GuardState;
  setState: (state: GuardState) => void;
  /** Re-render the page from the server. */
  refresh: () => void;
  /** The notice to show (or null), after every check. */
  publish: (notice: NoticeKind | null) => void;
  now?: () => number;
  timeoutMs?: number;
}): FreshnessChecks {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  let stopped = false;
  let running = false;
  let inFlight: AbortController | null = null;
  let followUp: ReturnType<typeof setTimeout> | null = null;

  function schedule(at: number | null) {
    if (followUp !== null) clearTimeout(followUp);
    followUp = at === null ? null : setTimeout(() => void run(), Math.max(0, at - now()));
  }

  /** One request, settled within the time limit: a timeout or failure reads as unreachable. */
  async function ask(): Promise<HealthReading> {
    const controller = new AbortController();
    inFlight = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<HealthReading>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: "unreachable" });
      }, timeoutMs);
    });
    try {
      return await Promise.race([options.read(controller.signal).catch((): HealthReading => ({ kind: "unreachable" })), timedOut]);
    } finally {
      clearTimeout(timer);
      if (inFlight === controller) inFlight = null;
    }
  }

  async function run() {
    if (stopped || running) return;
    running = true;
    let reading: HealthReading;
    try {
      reading = await ask();
    } finally {
      running = false;
    }
    if (stopped) return;
    // The rule decides, from its own deadline, whether a refresh or the reload notice may
    // follow yet; an early trigger can only read the server and reschedule the follow-up.
    const step = afterCheck(options.getState(), options.renderedAt, reading, now());
    options.setState(step.state);
    options.publish(step.state.notice);
    if (step.action === "refresh") options.refresh();
    schedule(step.checkAt);
  }

  return {
    check: () => void run(),
    stop: () => {
      stopped = true;
      inFlight?.abort();
      schedule(null);
    },
  };
}
