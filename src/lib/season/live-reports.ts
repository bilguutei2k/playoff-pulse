// The NBA injury reports the live job has seen, stored per slate date, and the rule for
// which one a run uses. Pure: the job does the fetching and the file access.
//
// Every report carries its own header timestamp (Eastern wall clock), and that, never
// the file name, decides which report was known when.

import type { StatusCode } from "@/lib/season/availability";
import type { GameAvailability, ListedPlayer, ReportPoint } from "@/lib/season/injury-model";
import { etWallClockOf } from "@/lib/season/dates";
import type { SeasonGame } from "@/lib/season/types";

/** One listed player: team ID, name as printed, status code, reason text. */
export type LiveReportRow = [teamId: string, player: string, status: StatusCode, reason: string];

/** A validated report, cut to one slate's games. */
export type LiveReport = {
  /** The file it came from, such as "2026-11-01_01_15PM". */
  file: string;
  /** Teams on the slate that had not filed yet. */
  notSubmitted: string[];
  rows: LiveReportRow[];
};

/** Everything the job has downloaded for one slate date. */
export type LiveReportDay = {
  etDate: string;
  /**
   * Each file downloaded for this slate, so no run downloads it twice: its header
   * timestamp (null if it could not be read), whether it passed validation, and why not.
   */
  files: Record<string, { at: string | null; usable: boolean; problem?: string }>;
  /** Usable reports, keyed by header timestamp. */
  reports: Record<string, LiveReport>;
};

export function emptyReportDay(etDate: string): LiveReportDay {
  return { etDate, files: {}, reports: {} };
}

/** The last good report is used for at most this long when a run cannot read a new one. */
export const STALE_REPORT_LIMIT_HOURS = 24;

function wallClockMs(at: string): number {
  return Date.parse(`${at}:00Z`);
}

/** Hours from one Eastern wall-clock stamp to another. */
export function wallClockHours(earlier: string, later: string): number {
  return (wallClockMs(later) - wallClockMs(earlier)) / 3_600_000;
}

/** The latest usable report with a header at or before `atOrBefore` (ET wall clock). */
export function latestReport(
  day: LiveReportDay | null,
  atOrBefore: string,
): { at: string; report: LiveReport } | null {
  if (!day) return null;
  let best: string | null = null;
  for (const at of Object.keys(day.reports)) {
    if (at <= atOrBefore && (best === null || at > best)) best = at;
  }
  return best === null ? null : { at: best, report: day.reports[best] };
}

export type ChosenReport = {
  at: string | null;
  report: LiveReport | null;
  /** This run could not confirm a current report and fell back to the last good one. */
  stale: boolean;
  /** Nothing usable under the age limit: every absence is zero. */
  missing: boolean;
};

/**
 * Which report a run uses. When the fetch found a usable report, it is the latest at or
 * before now. When the fetch failed, the last good one is used if it is under 24 hours
 * old and flagged stale; otherwise availability is missing.
 */
export function chooseReport(
  day: LiveReportDay | null,
  fetchSucceeded: boolean,
  nowIso: string,
): ChosenReport {
  const nowEt = etWallClockOf(nowIso);
  const latest = latestReport(day, nowEt);
  if (latest && wallClockHours(latest.at, nowEt) < STALE_REPORT_LIMIT_HOURS) {
    return { at: latest.at, report: latest.report, stale: !fetchSucceeded, missing: false };
  }
  return { at: null, report: null, stale: false, missing: true };
}

/** A stored report as the engine reads it, with printed names resolved to athletes. */
export function toReportPoint(
  report: LiveReport,
  at: string,
  resolve: (teamId: string, printed: string) => string | null,
): ReportPoint & { printed: string[] } {
  const rows: ListedPlayer[] = report.rows.map(([teamId, player, status, reason]) => ({
    teamId,
    athleteId: resolve(teamId, player),
    status,
    reason,
  }));
  return {
    at,
    notSubmitted: report.notSubmitted,
    rows,
    printed: report.rows.map((row) => row[1]),
  };
}

/**
 * A finished live game's availability for the replay: the latest stored report at or
 * before 06:00 ET on game day, and the latest at or before tip. Ratings learn from the
 * second, which is the closest the job came to what the final seal used.
 */
export function gameAvailabilityFromDay(
  day: LiveReportDay | null,
  game: Pick<SeasonGame, "etDate" | "tipUtc" | "homeId" | "awayId">,
  resolve: (teamId: string, printed: string) => string | null,
): GameAvailability | null {
  if (!day) return null;
  const teams = new Set([game.homeId, game.awayId]);
  const cut = (found: { at: string; report: LiveReport } | null): ReportPoint | null => {
    if (!found) return null;
    const point = toReportPoint(
      {
        ...found.report,
        notSubmitted: found.report.notSubmitted.filter((teamId) => teams.has(teamId)),
        rows: found.report.rows.filter((row) => teams.has(row[0])),
      },
      found.at,
      resolve,
    );
    return { at: point.at, notSubmitted: point.notSubmitted, rows: point.rows };
  };
  const morning = cut(latestReport(day, `${game.etDate}T06:00`));
  const final = cut(latestReport(day, etWallClockOf(game.tipUtc)));
  if (!morning && !final) return null;
  return { morning, final };
}
