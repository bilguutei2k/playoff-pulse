// Slates are US Eastern calendar dates. ESPN timestamps are UTC, and most games
// have a UTC date one day later than their ET date, so never slice a UTC string.

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  hourCycle: "h23",
});

export function etDateOf(instant: string | number | Date): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${String(instant)}`);
  }
  return ET_DATE.format(date);
}

export function etHourOf(instant: string | number | Date): number {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${String(instant)}`);
  }
  return Number(ET_PARTS.format(date));
}

export function addDays(etDate: string, days: number): string {
  const time = Date.parse(`${etDate}T12:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/** Whole calendar days from `earlier` to `later`. */
export function daysBetween(earlier: string, later: string): number {
  return Math.round(
    (Date.parse(`${later}T12:00:00Z`) - Date.parse(`${earlier}T12:00:00Z`)) /
      86_400_000,
  );
}

const ET_WALL_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Eastern wall-clock time as YYYY-MM-DDTHH:mm, the form injury reports are stamped in. */
export function etWallClockOf(instant: string | number | Date): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${String(instant)}`);
  }
  const parts = Object.fromEntries(
    ET_WALL_CLOCK.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
