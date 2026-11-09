"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatAgeShort } from "@/lib/utils/format";
import { freshnessNotice, serverIsNewer, shouldRefresh } from "@/lib/view/freshness";

const TICK_MS = 30_000;
/** A tab hidden at least this long is checked against the server when it comes back. */
const HIDDEN_FOR_MS = 60_000;
/** While visible, every page asks the server for its stamp this often. */
const POLL_MS = 5 * 60_000;
/** After asking for a fresh copy, look again this soon: the copy may still be the old one. */
const RETRY_MS = 6_000;
const HEALTH_URL = "/api/live/health";

function subscribe(onTick: () => void): () => void {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
}

const tickNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noTickOnServer = () => null;

/** The server's `generatedAt` from the health route, which is never cached; null if unreadable. */
async function readServerStamp(signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(HEALTH_URL, { cache: "no-store", signal });
    const body = (await response.json()) as { generatedAt?: unknown };
    return typeof body.generatedAt === "string" && Number.isFinite(Date.parse(body.generatedAt)) ? body.generatedAt : null;
  } catch {
    return null;
  }
}

/**
 * Mounted in the layout on every page. The copy a reader gets can lag the server: the CDN
 * serves a regenerated route's old copy for up to `expireTime` (next.config.ts), and before
 * that bound existed for days. On arrival, on return to the tab after a minute away, after
 * a back-forward restore and every five minutes, this asks /api/live/health what the server
 * has and, when that is materially newer, re-renders the page from the server (twice at
 * most). A copy older than twenty minutes gets a line saying so and what is being done
 * about it. Nothing here touches seals, the record or the chip's own 12-hour rule.
 */
export function FreshnessGuard({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const now = useSyncExternalStore(subscribe, tickNow, noTickOnServer);
  const [serverAt, setServerAt] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;
    let asked = 0;

    // Ask the server what it has; when that is materially newer, re-render from it and
    // look again shortly, since the first answer can still be the old copy.
    async function check() {
      const stamp = await readServerStamp(controller.signal);
      if (controller.signal.aborted) return;
      setServerAt(stamp);
      setChecked(true);
      if (!serverIsNewer(generatedAt, stamp)) {
        asked = 0;
        setRefreshes(0);
        return;
      }
      if (!shouldRefresh({ renderedAt: generatedAt, serverAt: stamp, refreshes: asked })) return;
      asked += 1;
      setRefreshes(asked);
      router.refresh();
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => void check(), RETRY_MS);
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
    // A new copy from the server re-runs this with its stamp, which ends the retry loop
    // once the copy has caught up.
  }, [generatedAt, router]);

  const notice = now === null ? null : freshnessNotice({ renderedAt: generatedAt, serverAt, checked, refreshes, nowMs: now });
  if (!notice) return null;
  const age = formatAgeShort(notice.ageMs);
  return (
    <div className="pp-container pt-4">
      <p role="status" className="notice text-[13.5px]">
        This page shows data published <b>{age}</b>
        {notice.kind === "loading" ? ". A newer forecast has been published; loading it." : null}
        {notice.kind === "reload" ? (
          <>
            . A newer forecast has been published but did not load here.{" "}
            <button type="button" className="pp-link font-semibold" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </>
        ) : null}
        {notice.kind === "nothing-newer" ? "; the forecast job has published nothing newer." : null}
        {notice.kind === "unknown" ? "; whether anything newer exists could not be checked." : null}
      </p>
    </div>
  );
}
