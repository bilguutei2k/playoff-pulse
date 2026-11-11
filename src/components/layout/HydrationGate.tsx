"use client";

import { use } from "react";

/**
 * Holds hydration until the HTML document has finished parsing, when the scripts started
 * it early. Renders its children unchanged; on the server, and whenever the document has
 * already loaded (a first visit, a client navigation), it never waits.
 *
 * Why: a returning reader's browser runs the cached scripts while the page is still
 * streaming in, so React starts hydrating before every part of the server payload has
 * arrived. Where a part that has not arrived yet sits directly inside a DOM element, React
 * 19.2 suspends on it and, on resuming, claims that element a second time from a cursor
 * already inside it: hydration fails (#418) and the page is rebuilt on the client. The
 * payload is split at arbitrary points, so no single element can be guarded. Waiting here,
 * above every element, means the resume happens in this component, which claims nothing,
 * and by then the whole payload is in (Next closes it when the document has parsed).
 */
let parsed: Promise<void> | null = null;

function documentParsed(): Promise<void> | null {
  if (typeof document === "undefined" || document.readyState !== "loading") return null;
  parsed ??= new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
  return parsed;
}

export function HydrationGate({ children }: { children: React.ReactNode }) {
  const pending = documentParsed();
  if (pending) use(pending);
  return children;
}
