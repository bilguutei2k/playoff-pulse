"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the page from the server on an interval: every minute while a game is
 * live, every five otherwise. Live scores reach only the in-game estimate.
 */
export function AutoRefresh({ live }: { live: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, live ? 60_000 : 300_000);
    return () => clearInterval(timer);
  }, [live, router]);
  return null;
}
