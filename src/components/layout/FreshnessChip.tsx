"use client";

import { useSyncExternalStore } from "react";
import { formatAgeShort } from "@/lib/utils/format";

const TICK_MS = 30_000;
/** Matches the slate's stale threshold: beyond this the line turns amber. */
const STALE_AFTER_MS = 12 * 3_600_000;

function subscribe(onTick: () => void): () => void {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
}

const tickNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noTickOnServer = () => null;

/**
 * "Updated 4 min ago" on the masthead: the real age of the published state, with the
 * model version from 1280 px. Before hydration it shows the fixed ET stamp, because
 * the server cannot know "now". `stored` means the live data could not be read and
 * the page shows the copy bundled with the deployment, which can be days old; the
 * line then says so and is always amber.
 */
export function FreshnessChip({
  iso,
  stamp,
  modelVersion,
  stored = false,
}: {
  iso: string;
  stamp: string;
  modelVersion: string;
  stored?: boolean;
}) {
  const now = useSyncExternalStore(subscribe, tickNow, noTickOnServer);
  const age = now === null ? null : now - Date.parse(iso);
  const stale = stored || (age !== null && age > STALE_AFTER_MS);
  const when = age === null ? stamp : formatAgeShort(age);
  return (
    <p
      className={`flex items-center gap-2 whitespace-nowrap text-[13px] leading-none ${stale ? "text-[#f5c26b]" : "text-masthead-2"}`}
      title={
        stored
          ? `Live data could not be read. Showing the copy stored with this version of the site, published ${stamp}, model ${modelVersion}`
          : `Forecast published ${stamp}, model ${modelVersion}`
      }
    >
      {stale ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 bg-[#f5c26b]" /> : null}
      <span>
        {stored ? <span className="font-semibold">Stored copy · </span> : null}
        <time dateTime={iso}>{stored ? "updated" : "Updated"} {when}</time>
        <span className="hidden xl:inline">
          <span aria-hidden className="mx-1.5">·</span>
          <span className="num">{modelVersion}</span>
        </span>
      </span>
    </p>
  );
}
