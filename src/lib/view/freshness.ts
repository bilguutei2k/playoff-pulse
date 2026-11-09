// What a page says and does about the age of the copy it shows. Pure, so the client
// component (src/components/live/FreshnessGuard.tsx) is only wiring; tests in
// tests/view-freshness.test.ts.
//
// Every route is regenerated about once a minute, and the CDN may hand out a copy for up
// to `expireTime` (next.config.ts) past that. So a reader can arrive on a copy rendered a
// few minutes ago and, before that bound existed, on one rendered days ago: on 2026-11-09
// a day page was served as rendered 44 hours earlier, every game "upcoming", while the
// homepage was current. The copy carries its state's `generatedAt`; /api/live/health,
// never cached, says what the server has now. The guard compares the two.

/** A copy older than this gets a line in the body saying so, whatever the chip shows. */
export const NOTICE_AFTER_MS = 20 * 60_000;
/** The server counts as newer when its state is at least this much younger. */
export const MATERIAL_MS = 60_000;
/** How many times a page asks the server for a newer copy of itself before giving up. */
export const MAX_REFRESHES = 2;

export type FreshnessInput = {
  /** `generatedAt` of the state the page was rendered from. */
  renderedAt: string;
  /** `generatedAt` from /api/live/health; null before a check answers or when it fails. */
  serverAt: string | null;
  /** Whether a health check has answered at all. */
  checked: boolean;
  /** Refreshes asked for since the page last matched the server. */
  refreshes: number;
  nowMs: number;
};

export type FreshnessNotice = {
  /**
   * loading: the server is newer and a refresh is under way. reload: the server is newer
   * and refreshing did not help, so the reader should reload. nothing-newer: the server
   * has nothing newer, so the age is the job's. unknown: the server could not be asked.
   */
  kind: "loading" | "reload" | "nothing-newer" | "unknown";
  ageMs: number;
};

/** True when the server's state is materially younger than the one shown. */
export function serverIsNewer(renderedAt: string, serverAt: string | null): boolean {
  if (serverAt === null) return false;
  const gap = Date.parse(serverAt) - Date.parse(renderedAt);
  return Number.isFinite(gap) && gap > MATERIAL_MS;
}

/** Whether to ask the server for a fresh copy now. */
export function shouldRefresh(input: Pick<FreshnessInput, "renderedAt" | "serverAt" | "refreshes">): boolean {
  return serverIsNewer(input.renderedAt, input.serverAt) && input.refreshes < MAX_REFRESHES;
}

/** The body notice for a copy past `NOTICE_AFTER_MS`, or null while it is young enough. */
export function freshnessNotice(input: FreshnessInput): FreshnessNotice | null {
  const ageMs = input.nowMs - Date.parse(input.renderedAt);
  if (!Number.isFinite(ageMs) || ageMs <= NOTICE_AFTER_MS) return null;
  if (serverIsNewer(input.renderedAt, input.serverAt)) {
    return { kind: input.refreshes < MAX_REFRESHES ? "loading" : "reload", ageMs };
  }
  return { kind: input.checked && input.serverAt !== null ? "nothing-newer" : "unknown", ageMs };
}
