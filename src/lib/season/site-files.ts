// Compact copies of the forecast ledger that the site fetches at request time. The
// ledger grows about 70 KB a day and passes the 2 MB data-cache item limit during the
// season, so the job also publishes, under data/live/site/:
//   - days/{etDate}.json: every seal row for games on that ET date, verbatim, for the
//     day and game pages;
//   - months/{yyyy-mm}.json: every ledger row for games in that ET month without the
//     seals' `drivers` lists, for the record and team pages;
//   - manifest.json: the SHA-256 of each file the site reads, which the site uses as
//     cache keys so a file is stored once per content rather than once per commit.
// They are derived from the ledger alone, never edited, and `verify:live` checks that
// they match it. Pure: no fetch, no file access.

import { etDateOf } from "@/lib/season/dates";
import type { LedgerRow, SealRow } from "@/lib/season/types";

export const SITE_MANIFEST_PATH = "site/manifest.json";

export type SiteManifest = {
  version: 1;
  season: number;
  seasonLabel: string;
  /** Rows in the ledger the site files were derived from. */
  ledgerRows: number;
  /** Path under data/live → SHA-256 (hex) of the file's exact bytes. */
  files: Record<string, string>;
};

export type DaySealsFile = { etDate: string; seals: SealRow[] };
export type MonthRowsFile = { month: string; rows: LedgerRow[] };

export function siteDayPath(seasonLabel: string, etDate: string): string {
  return `site/${seasonLabel}/days/${etDate}.json`;
}

export function siteMonthPath(seasonLabel: string, month: string): string {
  return `site/${seasonLabel}/months/${month}.json`;
}

/** The month files listed in a manifest, oldest first. */
export function manifestMonthPaths(manifest: SiteManifest): string[] {
  const prefix = `site/${manifest.seasonLabel}/months/`;
  return Object.keys(manifest.files)
    .filter((file) => file.startsWith(prefix))
    .sort();
}

/** A seal row without its `drivers` list; month files carry these. */
export function withoutDrivers(row: LedgerRow): LedgerRow {
  if (row.type !== "seal" || row.drivers === undefined) return row;
  const rest: SealRow = { ...row };
  delete rest.drivers;
  return rest;
}

/**
 * The ET month each row belongs to: its game's. Seal and missed rows carry the ET date;
 * a result takes the date of its game's first seal or miss, else the ET date it was
 * recorded on, so all of a game's rows land in one month.
 */
function monthOf(row: LedgerRow, gameDates: ReadonlyMap<string, string>): string {
  if (row.type !== "result") return row.etDate.slice(0, 7);
  return (gameDates.get(row.gameId) ?? etDateOf(row.recordedAt)).slice(0, 7);
}

/**
 * Day files (seal rows by ET date) and month files (all rows by their game's ET month,
 * without drivers), each in ledger order and keyed in ascending order.
 */
export function deriveSiteFiles(ledger: readonly LedgerRow[]): {
  days: Map<string, DaySealsFile>;
  months: Map<string, MonthRowsFile>;
} {
  const gameDates = new Map<string, string>();
  for (const row of ledger) {
    if (row.type !== "result" && !gameDates.has(row.gameId)) gameDates.set(row.gameId, row.etDate);
  }
  const days = new Map<string, SealRow[]>();
  const months = new Map<string, LedgerRow[]>();
  for (const row of ledger) {
    if (row.type === "seal") {
      const seals = days.get(row.etDate) ?? [];
      seals.push(row);
      days.set(row.etDate, seals);
    }
    const month = monthOf(row, gameDates);
    const rows = months.get(month) ?? [];
    rows.push(withoutDrivers(row));
    months.set(month, rows);
  }
  const sorted = <T>(map: Map<string, T>) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  return {
    days: new Map(sorted(days).map(([etDate, seals]) => [etDate, { etDate, seals }])),
    months: new Map(sorted(months).map(([month, rows]) => [month, { month, rows }])),
  };
}

/** The bytes a site file is published with: compact JSON and a newline, like the job's other files. */
export function siteFileContent(value: DaySealsFile | MonthRowsFile | SiteManifest): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Every derived file's path and exact content for one ledger. The manifest is not
 * included: it also hashes the state and games files, which the caller reads.
 */
export function siteFileContents(ledger: readonly LedgerRow[], seasonLabel: string): Map<string, string> {
  const { days, months } = deriveSiteFiles(ledger);
  const files = new Map<string, string>();
  for (const [etDate, file] of days) files.set(siteDayPath(seasonLabel, etDate), siteFileContent(file));
  for (const [month, file] of months) files.set(siteMonthPath(seasonLabel, month), siteFileContent(file));
  return files;
}
