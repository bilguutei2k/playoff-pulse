// The odds history on disk: the one guarded read of the snapshot directory and the one
// check of the published file, used both by the job (scripts/live/pipeline.ts) and by
// `verify:live` (scripts/verify/live-checks.ts).
//
// Why they share this file: the odds history is an optional view, and nothing about it may
// cost a seal. `verify:live` runs before the job's push, so if it could reject an odds
// history the job had just written, a display file would block a push that carries seals.
// The job therefore runs this same check on the same files straight after writing the view
// and withdraws the view if the check finds anything; `verify:live` then runs the identical
// code on the identical inputs and has nothing left to find. Nothing here throws.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildOddsHistory,
  ODDS_HISTORY_PROBABILITIES,
  oddsHistoryProblems,
  oddsHistoryStateProblems,
  parseOddsHistory,
  type OddsHistoryFile,
  type OddsHistorySkip,
  type OddsHistorySnapshot,
} from "../../src/lib/season/odds-history";
import { siteFileContent, siteOddsHistoryPath } from "../../src/lib/season/site-files";
import type { SeasonForecast, TeamHistoryPoint } from "../../src/lib/season/types";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Every entry of a snapshot directory with its text, or null and the error when it cannot
 * be read (an unreadable file, a directory, a broken link). A missing or unreadable
 * directory is no entries. Never throws.
 */
export function readSnapshotFiles(directory: string): OddsHistorySnapshot[] {
  let names: string[];
  try {
    if (!fs.existsSync(directory)) return [];
    names = fs.readdirSync(directory);
  } catch {
    return [];
  }
  return names.map((name) => {
    try {
      return { name, text: fs.readFileSync(path.join(directory, name), "utf-8") };
    } catch (error) {
      return { name, text: null, error: message(error) };
    }
  });
}

export type OddsHistoryDiskState = {
  season: number;
  slateEtDate: string;
  forecast: SeasonForecast;
  history: readonly TeamHistoryPoint[];
};

export type OddsHistoryDiskCheck =
  | { published: false }
  | {
      published: true;
      /** Empty when the file is exactly what the stored snapshots and the state produce and holds every invariant. */
      problems: string[];
      view: OddsHistoryFile | null;
      skipped: OddsHistorySkip[];
      bytes: number;
    };

/**
 * The published odds history under `liveDirectory` against the state and the stored
 * snapshots beside it: its own invariants, the slate date, the forecast's team order,
 * probabilities in [0, 1], title odds summing to 1 per date, playoff odds at least top-six
 * odds, agreement with the state's forecast and history, and byte equality with what
 * `buildOddsHistory` makes from the same snapshots. `published: false` when there is no
 * file. Never throws: anything unexpected is a problem.
 */
export function checkOddsHistoryOnDisk(liveDirectory: string, state: OddsHistoryDiskState, seasonLabel: string): OddsHistoryDiskCheck {
  const file = path.join(liveDirectory, siteOddsHistoryPath(seasonLabel));
  try {
    if (!fs.existsSync(file)) return { published: false };
  } catch (error) {
    return { published: true, problems: [`cannot look for the file: ${message(error)}`], view: null, skipped: [], bytes: 0 };
  }
  const problems: string[] = [];
  let view: OddsHistoryFile | null = null;
  let skipped: OddsHistorySkip[] = [];
  let bytes = 0;
  try {
    const text = fs.readFileSync(file, "utf-8");
    bytes = Buffer.byteLength(text);
    const raw: unknown = JSON.parse(text);
    problems.push(...oddsHistoryProblems(raw, { season: state.season, seasonLabel }));
    if (problems.length === 0) {
      view = parseOddsHistory(text, { season: state.season, seasonLabel });
      const parsed = view;
      if (parsed.dates.at(-1) !== state.slateEtDate) problems.push(`the last date is ${parsed.dates.at(-1)}, not the slate ${state.slateEtDate}`);
      if (parsed.teamIds.join(",") !== state.forecast.teams.map((team) => team.teamId).join(",")) {
        problems.push("teams are not in the forecast's order");
      }
      for (const metric of ODDS_HISTORY_PROBABILITIES) {
        if (!parsed[metric].every((row) => row.every((value) => value >= 0 && value <= 1))) problems.push(`${metric} is outside [0, 1]`);
      }
      parsed.champion.forEach((row, index) => {
        const sum = row.reduce((total, value) => total + value, 0);
        if (!(Math.abs(sum - 1) < 0.01)) problems.push(`title odds sum to ${sum.toFixed(4)} on ${parsed.dates[index]}`);
        if (!row.every((_, team) => parsed.makePlayoffs[index][team] >= parsed.topSix[index][team])) {
          problems.push(`playoff odds are below top-six odds on ${parsed.dates[index]}`);
        }
      });
      problems.push(...oddsHistoryStateProblems(parsed, state));
      const built = buildOddsHistory({
        season: state.season,
        seasonLabel,
        slate: state.slateEtDate,
        forecast: state.forecast,
        snapshots: readSnapshotFiles(path.join(liveDirectory, "snapshots", seasonLabel)),
      });
      skipped = built.skipped;
      if (text !== siteFileContent(built.file)) problems.push("the file is not what the stored snapshots and the state's forecast produce");
    }
  } catch (error) {
    problems.push(`the file could not be checked: ${message(error)}`);
  }
  return { published: true, problems, view, skipped, bytes };
}
