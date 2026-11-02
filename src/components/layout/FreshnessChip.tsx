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
 * hydration it shows the fixed ET stamp, because the server cannot know "now".
 */
export function FreshnessChip({
  iso,
  stamp,
  modelVersion,
}: {
  iso: string;
  stamp: string;
  modelVersion: string;
}) {
  const now = useSyncExternalStore(subscribe, tickNow, noTickOnServer);
  const age = now === null ? null : now - Date.parse(iso);
  const stale = age !== null && age > STALE_AFTER_MS;
  const when = age === null ? stamp : formatAgeShort(age);
  return (
    <p
      className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] leading-none ${
        stale ? "border-warn-line bg-warn-wash text-warn" : "border-line bg-panel text-ink-2"
      }`}
      title={`Forecast published ${stamp}, model ${modelVersion}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${stale ? "bg-warn" : "bg-teal"}`} />
      <span className="whitespace-nowrap">
        <time dateTime={iso}>Updated {when}</time>
        <span className="hidden lg:inline">
          <span aria-hidden className="mx-1.5 text-ink-4">·</span>
          <span className="num">{modelVersion}</span>
        </span>
      </span>
    </p>
  );
}
