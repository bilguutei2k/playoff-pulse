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

/**
 * An injury report's own stamp, already Eastern wall-clock time ("2026-11-01T14:15"),
 * as "2:15 PM ET", or "Nov 1, 2:15 PM ET" when it is not from `sameDayAs`. No zone
 * conversion: the stamp is the NBA's, in ET.
 */
export function formatReportTime(at: string, sameDayAs?: string): string {
  const hour = Number(at.slice(11, 13));
  const minute = at.slice(14, 16);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const time = `${twelve}:${minute} ${hour >= 12 ? "PM" : "AM"} ET`;
  // A stale report can be from the day before; then the day is part of the time.
  return sameDayAs && at.slice(0, 10) !== sameDayAs ? `${formatShortDay(at.slice(0, 10))}, ${time}` : time;
}

const ET_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
const ET_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ET,
});

/** "7:30 PM ET": every time on the live pages is Eastern, labeled the same way. */
export function formatTimeEt(iso: string): string {
  return `${ET_TIME.format(new Date(iso))} ET`;
}

/** "Nov 2, 9:12 AM ET". */
export function formatDateTimeEt(iso: string): string {
  return `${ET_DATE_TIME.format(new Date(iso))} ET`;
}

/** "Mon" for an ET calendar date. */
export function formatWeekday(etDate: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${etDate}T12:00:00Z`),
  );
}

/** "Monday, November 2, 2026" for an ET calendar date. */
export function formatFullDay(etDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${etDate}T12:00:00Z`));
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isEtDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
