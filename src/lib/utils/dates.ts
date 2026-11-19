// Date and time display for the live pages. Every time a reader sees is Pacific
// (America/Los_Angeles), labeled with its own abbreviation: PST, or PDT in summer.
// The server and the browser print the same text, so nothing changes on hydration.
// Underneath, slates, seals and the NBA's report stamps stay on the Eastern calendar
// (src/lib/season/dates.ts). Every NBA tip falls on the same calendar date in both
// zones, so a slate's ET date is also its Pacific date.

import { etWallClockOf } from "@/lib/season/dates";

const PACIFIC = "America/Los_Angeles";

/**
 * "Nov 1, 9:28 PM PST" from a date-and-time format, joined the same way in every
 * engine. Engines disagree on the joiner (Safari's ICU prints "Nov 1 at 9:28 PM"), and a
 * client component that formats on both sides must print exactly what the server did,
 * or React's hydration fails.
 */
function joinDateTime(format: Intl.DateTimeFormat, date: Date): string {
  const parts = format.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part("month")} ${part("day")}, ${part("hour")}:${part("minute")} ${part("dayPeriod")}`;
}

const PT_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: PACIFIC });
const PT_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: PACIFIC,
});
const PT_ZONE = new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone: PACIFIC });
const PT_DATE = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: PACIFIC,
});

/** "PST", or "PDT" while daylight time is in force: the label for a Pacific time. */
export function pacificZone(iso: string): string {
  return PT_ZONE.formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "PT";
}

/** The label for every tip on an ET calendar date. Clocks change at 2 AM; tips are later. */
export function pacificZoneOfDay(etDate: string): string {
  return pacificZone(`${etDate}T20:00:00Z`);
}

/** One label for a set of times: "PST", "PDT", or "PT" when they straddle a change. */
export function pacificZoneOfAll(isos: string[]): string {
  const zones = new Set(isos.map(pacificZone));
  return zones.size === 1 ? [...zones][0] : "PT";
}

/** "7:30 PM": a clock where the zone is said once nearby. */
export function formatClockPt(iso: string): string {
  return PT_TIME.format(new Date(iso));
}

/** "7:30 PM PST". */
export function formatTimePt(iso: string): string {
  return `${formatClockPt(iso)} ${pacificZone(iso)}`;
}

/** "Nov 2, 6:12 AM PST". */
export function formatDateTimePt(iso: string): string {
  return `${joinDateTime(PT_DATE_TIME, new Date(iso))} ${pacificZone(iso)}`;
}

/**
 * The instant of an injury report's own stamp, which the NBA prints in Eastern
 * wall-clock time ("2026-11-01T14:15"). In the repeated hour when clocks fall back it
 * takes the later (standard-time) reading; a stamp inside the skipped spring hour
 * cannot occur and is read as standard time.
 */
export function reportInstant(at: string): string {
  const wall = at.slice(0, 16);
  const asUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall) ? Date.parse(`${wall}:00Z`) : NaN;
  if (Number.isNaN(asUtc)) throw new Error(`Bad report time "${at}".`);
  for (const hours of [5, 4]) {
    const candidate = new Date(asUtc + hours * 3_600_000);
    if (etWallClockOf(candidate) === wall) return candidate.toISOString();
  }
  return new Date(asUtc + 5 * 3_600_000).toISOString();
}

/**
 * An injury report's stamp in Pacific time: "11:15 AM PST", or "Nov 1, 11:15 AM PST"
 * when its Pacific date is not `sameDayAs` (an ET slate date). The overnight reports
 * land on the evening before in Pacific time, so they carry their date.
 */
export function formatReportTime(at: string, sameDayAs?: string): string {
  const iso = reportInstant(at);
  return sameDayAs && PT_DATE.format(new Date(iso)) !== sameDayAs ? formatDateTimePt(iso) : formatTimePt(iso);
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
