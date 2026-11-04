"use client";

import { useSyncExternalStore } from "react";
import { formatAgeShort } from "@/lib/utils/format";

const TICK_MS = 30_000;
/** Matches the slate's stale threshold: beyond this the chip turns amber. */
const STALE_AFTER_MS = 12 * 3_600_000;

function subscribe(onTick: () => void): () => void {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
}

const tickNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noTickOnServer = () => null;

/**
 * "Updated 4 min ago · live-2026.27-v2": the real age of the published state. Before
 * hydration it shows the fixed ET stamp, because the server cannot know "now". `stored`
 * means the live data could not be read and the page shows the copy bundled with the
 * deployment, which can be days old; the chip then says so and is always amber.
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
      className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] leading-none ${
        stale ? "border-warn-line bg-warn-wash text-warn" : "border-line bg-panel text-ink-2"
      }`}
      title={
        stored
          ? `Live data could not be read. Showing the copy stored with this version of the site, published ${stamp}, model ${modelVersion}`
          : `Forecast published ${stamp}, model ${modelVersion}`
      }
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${stale ? "bg-warn" : "bg-teal"}`} />
      <span className="whitespace-nowrap">
        {stored ? <span className="font-medium">Stored copy · </span> : null}
        <time dateTime={iso}>{stored ? "updated" : "Updated"} {when}</time>
        <span className="hidden lg:inline">
          <span aria-hidden className="mx-1.5 text-ink-4">·</span>
          <span className="num">{modelVersion}</span>
        </span>
      </span>
    </p>
  );
}
