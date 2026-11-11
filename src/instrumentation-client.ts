// Runs in the browser before the app starts (Next's instrumentation-client file).
//
// onRouterTransitionStart fires when the App Router begins a navigation. A push starts
// the masthead progress bar (src/components/layout/NavProgress.tsx), so navigations made
// with router.push (the date field, the finder) show it like a link click does. Replace
// (URL filters) and traverse (Back and Forward) never start it.

/** Must match NAV_START_EVENT in NavProgress.tsx. */
const NAV_START_EVENT = "pp:navstart";

export function onRouterTransitionStart(_url: string, navigationType: "push" | "replace" | "traverse") {
  if (navigationType === "push") window.dispatchEvent(new Event(NAV_START_EVENT));
}
