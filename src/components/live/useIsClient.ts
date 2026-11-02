"use client";

import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/** False during server rendering and hydration, true afterwards. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
