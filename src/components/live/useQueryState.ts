"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Filter state mirrored in the URL's query string. Pages are regenerated statically and
 * cannot read the query, so the server renders `initial` (the defaults); after hydration
 * the URL's state is applied, Back and Forward re-read it, and changes are written with
 * the History API, which Next's router follows without a server round trip. `parse` and
 * `serialize` must be stable (memoized), since the URL is re-read when they change.
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
    return () => window.removeEventListener("popstate", read);
  }, [parse]);

  const update = useCallback(
    (next: T, history: "push" | "replace" = "push") => {
      setState(next);
      const { pathname, search, hash } = window.location;
      const target = `${pathname}${serialize(next)}${hash}`;
      if (target === `${pathname}${search}${hash}`) return;
      if (history === "push") window.history.pushState(null, "", target);
      else window.history.replaceState(null, "", target);
    },
    [serialize],
  );

  return [state, update];
}
