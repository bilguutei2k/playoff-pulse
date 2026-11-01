"use client";

import { useSyncExternalStore } from "react";
import { formatAge } from "@/lib/utils/format";

const TICK_MS = 30_000;

function subscribe(onTick: () => void): () => void {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
}

const tickNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noTickOnServer = () => null;

/** "Updated 12 minutes ago". Before hydration it shows only the fixed time. */
export function UpdatedAgo({ iso, stamp }: { iso: string; stamp: string }) {
  const now = useSyncExternalStore(subscribe, tickNow, noTickOnServer);
  return (
    <span title={stamp}>
      Updated {now === null ? stamp : formatAge(now - Date.parse(iso))}
    </span>
  );
}
