"use client";

import { useCallback, useEffect, useState } from "react";

/** Dispatched on window after each write, so other instances re-read the URL. */
const QUERY_EVENT = "pp:querystate";

/**
 * Filter state mirrored in the URL's query string. The server render does not read the
 * query (pages were static when this was written, and a filter change stays client-side),
 * so the server renders `initial` (the defaults); after hydration
 * the URL's state is applied, Back and Forward re-read it, and changes are written with
 * the History API, which Next's router follows without a server round trip. `parse` and
 * `serialize` must be stable (memoized), since the URL is re-read when they change.
 *
 * Several components on one page may share one query (the odds page's table, seeding
 * grid and chart): each write announces itself with QUERY_EVENT, and every instance
 * re-reads the URL, so they always agree and no write drops another component's keys.
 */
export function useQueryState<T>(
  initial: T,
  parse: (search: string) => T,
  serialize: (state: T) => string,
): [T, (next: T, history?: "push" | "replace") => void] {
  const [state, setState] = useState(initial);

  useEffect(() => {
    const read = () => setState(parse(window.location.search));
    read();
    window.addEventListener("popstate", read);
    window.addEventListener(QUERY_EVENT, read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener(QUERY_EVENT, read);
    };
  }, [parse]);

  const update = useCallback(
    (next: T, history: "push" | "replace" = "push") => {
      setState(next);
      const { pathname, search, hash } = window.location;
      const target = `${pathname}${serialize(next)}${hash}`;
      if (target === `${pathname}${search}${hash}`) return;
      if (history === "push") window.history.pushState(null, "", target);
      else window.history.replaceState(null, "", target);
      window.dispatchEvent(new Event(QUERY_EVENT));
    },
    [serialize],
  );

  return [state, update];
}
