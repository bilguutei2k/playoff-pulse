// Date and time display for the live pages. Slates are ET calendar dates; times
// show in the viewer's zone after hydration and in ET before it, because the server
// cannot know the viewer's zone.

const ET = "America/New_York";

/** "Nov 1, 9:28 PM EST": a fixed stamp in ET, used before hydration and in tooltips. */
export function formatStampEt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: ET,
  }).format(new Date(iso));
}

/** "Nov 1" for an ET calendar date such as "2026-11-01". */
export function formatShortDay(etDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${etDate}T12:00:00Z`));
}

/** "Sunday, November 1" for an ET calendar date. */
export function formatLongDay(etDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${etDate}T12:00:00Z`));
}

/** "7:30 PM PST" in the viewer's zone, or in ET before hydration. */
export function formatClock(iso: string, viewerZone: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: viewerZone ? undefined : ET,
  }).format(new Date(iso));
}

/** "Nov 1, 6:48 AM PST" in the viewer's zone, or in ET before hydration. */
export function formatDateTime(iso: string, viewerZone: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: viewerZone ? undefined : ET,
  }).format(new Date(iso));
}
