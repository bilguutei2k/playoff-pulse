"use client";

import { useSyncExternalStore } from "react";
import { useShownStamp } from "@/components/live/FreshnessGuard";
import { formatStampEt } from "@/lib/utils/dates";
import { formatAgeShort } from "@/lib/utils/format";

const TICK_MS = 30_000;

function subscribe(onTick: () => void): () => void {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
}

const tickNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noTickOnServer = () => null;

function stampEt(iso: string): string | null {
  return Number.isFinite(Date.parse(iso)) ? formatStampEt(iso) : null;
}

/**
 * "Updated 4 min ago" on the masthead, at every width: the age of the published state
 * this page shows (the page's own stamp when it renders <PageStamp>, else the layout's).
 * Before hydration it shows the fixed ET stamp, because the server cannot know "now";
 * the exact stamp is always in the tooltip. It turns amber on the freshness guard's
 * verdict (src/lib/view/freshness.ts), so the chip and the notice never disagree.
 * `stored` means the live data could not be read and the page shows the copy bundled
 * with the deployment, which can be days old; the line then says so and is always amber.
 * The model version and policy revision are in the footer. `data-state-stamp` marks the
 * stamp for the watchdog's page probe (scripts/live/watchdog.mjs), which reads it from
 * the served HTML.
 */
export function FreshnessChip({ iso, stored = false }: { iso: string; stored?: boolean }) {
  const now = useSyncExternalStore(subscribe, tickNow, noTickOnServer);
  const shown = useShownStamp(iso);
  const stamp = shown.stamp ?? iso;
  const fixed = stampEt(stamp);
  const ageMs = now === null ? NaN : now - Date.parse(stamp);
  const warn = stored || shown.notice !== null;
  const when = Number.isFinite(ageMs) ? formatAgeShort(ageMs) : fixed ? `${fixed}` : "time unknown";
  const title = stored
    ? `Live data could not be read. Showing the copy stored with this version of the site${fixed ? `, published ${fixed}` : ""}.`
    : fixed
      ? `Forecast data published ${fixed}`
      : undefined;
  return (
    <p
      className={`chip-fresh flex items-center justify-end gap-1.5 text-right text-[12px] leading-[1.15] sm:text-[13px] ${warn ? "text-warn-on-dark" : "text-masthead-2"}`}
      title={title}
    >
      {warn ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 bg-warn-on-dark" /> : null}
      <span>
        {stored ? <span className="font-semibold">Stored copy · </span> : null}
        <time dateTime={stamp} data-state-stamp="">
          {stored ? "updated" : "Updated"} <span className="whitespace-nowrap">{when}</span>
        </time>
      </span>
    </p>
  );
}
