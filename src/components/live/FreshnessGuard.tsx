"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { formatAgeShort } from "@/lib/utils/format";
import { afterCheck, initialGuardState, readHealth, type HealthReading, type NoticeKind } from "@/lib/view/freshness";

const TICK_MS = 30_000;
/** A tab hidden at least this long is checked against the server when it comes back. */
const HIDDEN_FOR_MS = 60_000;
/** While visible, every page asks the server for its stamp this often. */
const POLL_MS = 5 * 60_000;
/** After asking for a fresh copy, look again this soon: the copy may still be the old one. */
const RETRY_MS = 6_000;
const HEALTH_URL = "/api/live/health";
/** The frozen 2026 archive shows no live data, so it gets no freshness notice. */
const ARCHIVE_PATHS = ["/retrospective", "/snapshot", "/evidence", "/methodology", "/lab"];

// ---------------------------------------------------------------------------------------
// A tiny shared store. The layout is not re-rendered on client navigation, so its stamp
// can be older than the page below it; a page that renders <PageStamp> says which state
// it actually shows (or, with null, that it shows no live data). The guard publishes its
// verdict here too, so the masthead chip turns amber on the same rule as the notice.

type Snapshot = { page: { path: string; generatedAt: string | null } | null; notice: NoticeKind | null };
let snapshot: Snapshot = { page: null, notice: null };
const listeners = new Set<() => void>();

function update(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribeStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getStore = () => snapshot;
const SERVER_SNAPSHOT: Snapshot = { page: null, notice: null };
const getServerStore = () => SERVER_SNAPSHOT;

/**
 * The `generatedAt` this route's own content was rendered from: the page's stamp when it
 * rendered <PageStamp>, else the layout's. `null` when the page shows no live data.
 */
export function useShownStamp(layoutStamp: string): { stamp: string | null; notice: NoticeKind | null } {
  const pathname = usePathname() ?? "/";
  const store = useSyncExternalStore(subscribeStore, getStore, getServerStore);
  const page = store.page !== null && store.page.path === pathname ? store.page : null;
  return { stamp: page ? page.generatedAt : layoutStamp, notice: store.notice };
}

/**
 * Rendered by a page to say which published state its content came from. Pass the
 * `generatedAt` of the state the page itself read, or null for a page with no live data
 * (the 404, /about): the guard then stays silent there.
 */
export function PageStamp({ generatedAt }: { generatedAt: string | null }) {
  const pathname = usePathname() ?? "/";
  useEffect(() => {
    const entry = { path: pathname, generatedAt };
    update({ page: entry });
    return () => {
      if (snapshot.page === entry) update({ page: null });
    };
  }, [pathname, generatedAt]);
  return null;
}

// ---------------------------------------------------------------------------------------

function subscribeTick(onTick: () => void): () => void {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
}

const tickNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noTickOnServer = () => null;

/** What /api/live/health says, read from its JSON body on a 503 as on a 200. */
async function readServer(signal: AbortSignal): Promise<HealthReading> {
  try {
    const response = await fetch(HEALTH_URL, { cache: "no-store", signal });
    return readHealth(await response.json());
  } catch {
    return { kind: "unreachable" };
  }
}

/**
 * Mounted in the layout on every page. The copy a reader gets can lag the server: the CDN
 * serves a regenerated route's old copy for up to `expireTime` (next.config.ts), and before
 * that bound existed for days. On arrival, on return to the tab after a minute away, after
 * a back-forward restore and every five minutes while visible, this asks /api/live/health
 * what the server has and applies the rule in src/lib/view/freshness.ts: a newer copy is
 * loaded silently (twice at most, then a reload notice); a pipeline that is behind gets a
 * notice at once; a healthy server that matches the copy gets nothing, however old the
 * last publish. Nothing here touches seals or the record.
 */
export function FreshnessGuard({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const { stamp, notice } = useShownStamp(generatedAt);
  const archive = ARCHIVE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const watched = archive ? null : stamp;
  const now = useSyncExternalStore(subscribeTick, tickNow, noTickOnServer);
  const state = useRef(initialGuardState(watched ?? ""));

  useEffect(() => {
    if (watched === null) {
      update({ notice: null });
      return;
    }
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;
    let running = false;

    // One check at a time: a trigger while one is in flight is dropped, and a check
    // replaces any follow-up already scheduled.
    async function check() {
      if (running) return;
      running = true;
      if (retry) clearTimeout(retry);
      retry = null;
      const reading = await readServer(controller.signal);
      running = false;
      if (controller.signal.aborted) return;
      const step = afterCheck(state.current, watched as string, reading, Date.now());
      state.current = step.state;
      update({ notice: step.state.notice });
      if (step.action === "refresh") {
        router.refresh();
        retry = setTimeout(() => void check(), RETRY_MS);
      }
    }

    void check();
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= HIDDEN_FOR_MS) void check();
      hiddenAt = null;
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check();
    };
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      controller.abort();
      clearInterval(poll);
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
    // A new copy (a refresh, or navigation to a page with its own stamp) re-runs this with
    // its stamp; the helper resets the counts for it.
  }, [watched, router]);

  if (watched === null || notice === null || now === null) return null;
  const ageMs = now - Date.parse(watched);
  const age = Number.isFinite(ageMs) ? formatAgeShort(ageMs) : null;
  const reload = (
    <button type="button" className="pp-link inline-flex min-h-11 items-center font-semibold sm:min-h-0" onClick={() => window.location.reload()}>
      Reload the page
    </button>
  );
  return (
    <div className="pp-container pt-4">
      <p role="status" className="notice text-[13.5px]">
        {notice === "behind" ? <>A newer update is out, but this page has not loaded it. {reload}</> : null}
        {notice === "stale" ? (
          <>
            Updates are running late{age ? <>: the last one was <b>{age}</b></> : null}. Scores, injuries and odds may be behind
            until the next one.
          </>
        ) : null}
        {notice === "unverified" ? (
          <>
            {age ? (
              <>
                This page was last updated <b>{age}</b>, and we could not check for a newer update.
              </>
            ) : (
              "We could not check whether this page is up to date."
            )}{" "}
            {reload}
          </>
        ) : null}
      </p>
    </div>
  );
}
