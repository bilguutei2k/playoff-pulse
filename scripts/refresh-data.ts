// Daily playoff data refresh script.
//
// Reads the current manual playoff snapshot, fetches the ESPN public scoreboard
// for the days since the snapshot timestamp, finds completed games between teams
// in active series, and updates `winsA`/`winsB` for each affected series.
//
// Used by .github/workflows/refresh-data.yml. Can also be run locally via
// `corepack pnpm refresh-data`.
//
// Conservative by design:
//   - Only counts games with status === "final".
//   - Only counts games played strictly after `dataLastUpdatedTimestamp`.
//   - Caps wins at 4 per team.
//   - Touches only `dataLastUpdated`, `dataLastUpdatedTimestamp`, the first
//     header-comment line, and each affected series' `winsA` / `winsB`.
//   - Leaves notes, ratings, projected minutes, injuries, and model settings alone.
//   - Exits cleanly with no file changes when nothing new is detected.

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import {
  playoffConfig,
  dataLastUpdated,
  dataLastUpdatedTimestamp,
} from "../src/lib/data/playoff-config";
import { fetchEspnNbaScoreboard } from "../src/lib/live-data/espn-scoreboard";
import { canonicalTeamAbbreviation } from "../src/lib/live-data/espn-abbreviations";
import type { Series, Team } from "../src/lib/model/types";
import type { LiveScoreboardGame } from "../src/lib/live-data/types";

const CONFIG_PATH = resolve("src/lib/data/playoff-config.ts");
const SUMMARY_PATH =
  process.env.REFRESH_SUMMARY_PATH ?? resolve("refresh-summary.md");

// Pacific Daylight Time during NBA playoffs (April-June) is UTC-7.
// This is a deliberately narrow assumption; the script runs during PT-PDT only.
const PT_OFFSET_HOURS = -7;

// If active series exist but the snapshot has not advanced in this many days,
// the refresh fails loudly instead of exiting green. NBA playoff series never
// go this long without a game, so a quiet stretch this size means the feed or
// the matching logic is broken — the June 2026 failure mode, where 30+ runs
// reported success while matching nothing (docs/CODEBASE_HANDOVER.md, P0-1).
const DEFAULT_STALE_DAYS = 4;
const STALE_DAYS = Number(process.env.REFRESH_STALE_DAYS ?? DEFAULT_STALE_DAYS);

export function isSnapshotStale(
  snapshotUtc: Date,
  now: Date,
  staleDays: number,
): boolean {
  return now.getTime() - snapshotUtc.getTime() > staleDays * 24 * 60 * 60 * 1000;
}

type SeriesUpdate = {
  series: Series;
  oldWinsA: number;
  oldWinsB: number;
  newWinsA: number;
  newWinsB: number;
  gamesAdded: GameRecord[];
};

type GameRecord = {
  date: string;
  winnerAbbr: string;
  winnerScore: string;
  loserAbbr: string;
  loserScore: string;
  homeAway: "home" | "away" | "unknown";
};

function activeRealSeries(): Series[] {
  return playoffConfig.series.filter(
    (s) => s.teamA !== s.teamB && s.winsA < 4 && s.winsB < 4,
  );
}

function teamsById(): Record<string, Team> {
  return Object.fromEntries(playoffConfig.teams.map((t) => [t.id, t]));
}

export function parseSnapshotTimestamp(stamp: string): Date {
  // Expected format: "YYYY-MM-DD HH:MM AM/PM PT"
  const match = stamp.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+PT$/i,
  );
  if (!match) {
    throw new Error(
      `Cannot parse dataLastUpdatedTimestamp: "${stamp}". Expected "YYYY-MM-DD HH:MM AM/PM PT".`,
    );
  }
  const [, y, mo, d, hRaw, m, ampm] = match;
  let h = Number(hRaw);
  if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
  if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
  // Treat as PT = UTC-7. Build a UTC Date by shifting forward 7 hours.
  return new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      h - PT_OFFSET_HOURS,
      Number(m),
      0,
      0,
    ),
  );
}

// Format a Date as the manual-snapshot timestamp strings, in PT (UTC-7).
// The timestamp MUST be the actual moment the data was fetched, never a
// point in the future: later runs skip games dated at or before this
// timestamp, so a forward-dated stamp would permanently drop games played
// between the fetch and the claimed time.
export function ptSnapshotStamp(date: Date): { date: string; timestamp: string } {
  const pt = new Date(date.getTime() + PT_OFFSET_HOURS * 60 * 60 * 1000);
  const y = pt.getUTCFullYear();
  const mo = String(pt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(pt.getUTCDate()).padStart(2, "0");
  let hours = pt.getUTCHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours %= 12;
  if (hours === 0) hours = 12;
  const hh = String(hours).padStart(2, "0");
  const mm = String(pt.getUTCMinutes()).padStart(2, "0");
  return {
    date: `${y}-${mo}-${d}`,
    timestamp: `${y}-${mo}-${d} ${hh}:${mm} ${ampm} PT`,
  };
}

function yyyymmdd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function daysFromTo(startUtc: Date, endUtc: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(
    Date.UTC(
      startUtc.getUTCFullYear(),
      startUtc.getUTCMonth(),
      startUtc.getUTCDate(),
    ),
  );
  const end = new Date(
    Date.UTC(
      endUtc.getUTCFullYear(),
      endUtc.getUTCMonth(),
      endUtc.getUTCDate(),
    ),
  );
  while (cursor.getTime() <= end.getTime()) {
    dates.push(yyyymmdd(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function pickWinner(game: LiveScoreboardGame): {
  winnerAbbr: string;
  winnerScore: string;
  loserAbbr: string;
  loserScore: string;
  homeAway: "home" | "away" | "unknown";
} | null {
  const home = game.homeTeam;
  const away = game.awayTeam;
  if (!home || !away) return null;

  const homeAbbr = home.abbreviation.toUpperCase();
  const awayAbbr = away.abbreviation.toUpperCase();
  const homeScore = home.score ?? "";
  const awayScore = away.score ?? "";

  if (home.winner === true) {
    return {
      winnerAbbr: homeAbbr,
      winnerScore: homeScore,
      loserAbbr: awayAbbr,
      loserScore: awayScore,
      homeAway: "home",
    };
  }
  if (away.winner === true) {
    return {
      winnerAbbr: awayAbbr,
      winnerScore: awayScore,
      loserAbbr: homeAbbr,
      loserScore: homeScore,
      homeAway: "away",
    };
  }

  // Fall back to score comparison if winner flag is missing.
  const homeNum = Number(homeScore);
  const awayNum = Number(awayScore);
  if (Number.isFinite(homeNum) && Number.isFinite(awayNum)) {
    if (homeNum > awayNum) {
      return {
        winnerAbbr: homeAbbr,
        winnerScore: homeScore,
        loserAbbr: awayAbbr,
        loserScore: awayScore,
        homeAway: "home",
      };
    }
    if (awayNum > homeNum) {
      return {
        winnerAbbr: awayAbbr,
        winnerScore: awayScore,
        loserAbbr: homeAbbr,
        loserScore: homeScore,
        homeAway: "away",
      };
    }
  }

  return null;
}

async function fetchAllGames(
  dates: string[],
  manualAbbrs: string[],
): Promise<Map<string, LiveScoreboardGame>> {
  const games = new Map<string, LiveScoreboardGame>();
  for (const date of dates) {
    try {
      const snapshot = await fetchEspnNbaScoreboard({
        date,
        manualTeamAbbreviations: manualAbbrs,
      });
      for (const game of snapshot.games) {
        games.set(game.id, game);
      }
    } catch (err) {
      console.warn(
        `[refresh-data] Skipping ${date}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return games;
}

// Exported for verification: this matching logic is where the June 2026
// abbreviation bug lived, so it must stay directly testable.
export function computeUpdate(
  series: Series,
  teams: Record<string, Team>,
  games: Iterable<LiveScoreboardGame>,
  snapshotUtc: Date,
): SeriesUpdate | null {
  const teamA = teams[series.teamA];
  const teamB = teams[series.teamB];
  if (!teamA || !teamB) return null;

  // ESPN abbreviations differ from config tricodes for several teams
  // (NY vs NYK, SA vs SAS, ...). Canonicalize both sides before comparing.
  const abbrA = canonicalTeamAbbreviation(teamA.abbreviation);
  const abbrB = canonicalTeamAbbreviation(teamB.abbreviation);
  const matched: GameRecord[] = [];
  let newWinsA = series.winsA;
  let newWinsB = series.winsB;

  for (const game of games) {
    if (game.status !== "final") continue;
    if (!game.date) continue;
    const gameDate = new Date(game.date);
    if (Number.isNaN(gameDate.getTime())) continue;
    if (gameDate.getTime() <= snapshotUtc.getTime()) continue;

    const home = game.homeTeam?.abbreviation
      ? canonicalTeamAbbreviation(game.homeTeam.abbreviation)
      : null;
    const away = game.awayTeam?.abbreviation
      ? canonicalTeamAbbreviation(game.awayTeam.abbreviation)
      : null;
    if (!home || !away) continue;
    const pair = new Set([home, away]);
    if (!pair.has(abbrA) || !pair.has(abbrB)) continue;

    const outcome = pickWinner(game);
    if (!outcome) continue;

    matched.push({
      date: game.date.slice(0, 10),
      winnerAbbr: outcome.winnerAbbr,
      winnerScore: outcome.winnerScore,
      loserAbbr: outcome.loserAbbr,
      loserScore: outcome.loserScore,
      homeAway: outcome.homeAway,
    });

    const winner = canonicalTeamAbbreviation(outcome.winnerAbbr);
    if (winner === abbrA) newWinsA++;
    else if (winner === abbrB) newWinsB++;
  }

  newWinsA = Math.min(4, newWinsA);
  newWinsB = Math.min(4, newWinsB);

  if (newWinsA === series.winsA && newWinsB === series.winsB) {
    return null;
  }

  return {
    series,
    oldWinsA: series.winsA,
    oldWinsB: series.winsB,
    newWinsA,
    newWinsB,
    gamesAdded: matched.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function applyUpdates(
  source: string,
  updates: SeriesUpdate[],
  newDate: string,
  newTimestamp: string,
): string {
  let next = source;

  // Header comment uses a plain ASCII hyphen; keep this regex in sync with
  // the first line of playoff-config.ts.
  const headerUpdated = next.replace(
    /\/\/ MANUAL DATA - Last updated [^\n]+/,
    `// MANUAL DATA - Last updated ${newTimestamp}`,
  );
  if (headerUpdated === next) {
    console.warn(
      "[refresh-data] Header 'MANUAL DATA - Last updated' comment not found; header timestamp was NOT updated.",
    );
  }
  next = headerUpdated;

  next = next.replace(
    /export const dataLastUpdated = "[^"]+";/,
    `export const dataLastUpdated = "${newDate}";`,
  );

  next = next.replace(
    /export const dataLastUpdatedTimestamp = "[^"]+";/,
    `export const dataLastUpdatedTimestamp = "${newTimestamp}";`,
  );

  for (const update of updates) {
    const seriesId = update.series.id;
    const blockRegex = new RegExp(
      `(id:\\s*"${seriesId}"[\\s\\S]*?winsA:\\s*)\\d+(,[\\s\\n]*winsB:\\s*)\\d+`,
    );
    const replaced = next.replace(
      blockRegex,
      `$1${update.newWinsA}$2${update.newWinsB}`,
    );
    if (replaced === next) {
      throw new Error(
        `Failed to update winsA/winsB for series "${seriesId}". Regex did not match.`,
      );
    }
    next = replaced;
  }

  return next;
}

function buildSummary(
  updates: SeriesUpdate[],
  refreshDate: string,
  snapshotTimestamp: string,
  teams: Record<string, Team>,
  mismatchWarnings: string[] = [],
): string {
  const lines: string[] = [];
  lines.push("# Daily playoff data refresh");
  lines.push("");
  lines.push(`Run date: ${refreshDate}`);
  lines.push(`Prior snapshot: ${snapshotTimestamp}`);
  lines.push("");

  if (mismatchWarnings.length > 0) {
    lines.push("## Possible abbreviation mismatches");
    lines.push("");
    for (const warning of mismatchWarnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  if (updates.length === 0) {
    lines.push("No new finalized games found in the active series window.");
    lines.push("");
    lines.push(
      "_The script ran cleanly but found no completed games between active-series teams that postdated the prior snapshot timestamp._",
    );
    return lines.join("\n");
  }

  lines.push("## Series updated");
  lines.push("");
  for (const u of updates) {
    const teamA = teams[u.series.teamA];
    const teamB = teams[u.series.teamB];
    const labelA = teamA?.abbreviation ?? u.series.teamA;
    const labelB = teamB?.abbreviation ?? u.series.teamB;
    lines.push(`### ${labelA} vs ${labelB} (\`${u.series.id}\`)`);
    lines.push("");
    lines.push(
      `- Before: ${labelA} ${u.oldWinsA}, ${labelB} ${u.oldWinsB}`,
    );
    lines.push(
      `- After: ${labelA} ${u.newWinsA}, ${labelB} ${u.newWinsB}`,
    );
    lines.push("- New games counted:");
    for (const game of u.gamesAdded) {
      lines.push(
        `  - ${game.date}: ${game.winnerAbbr} ${game.winnerScore}, ${game.loserAbbr} ${game.loserScore}`,
      );
    }
    lines.push("");
  }

  lines.push("## Source");
  lines.push("");
  lines.push(
    "Game outcomes from the ESPN public scoreboard endpoint (the same feed the read-only `/api/live-scoreboard` probe consumes). Used here as a manual reference, not piped into model inputs.",
  );
  lines.push("");
  lines.push("## What was NOT touched");
  lines.push("");
  lines.push(
    "- Injuries (still anchored to the May 11 manual verification).",
  );
  lines.push("- Team ratings, projected minutes, manual adjustments.");
  lines.push(
    "- `playoffConfig.notes` (kept static; prose updates remain a human task).",
  );
  lines.push(
    "- Header comment beyond the 'Last updated' line.",
  );
  lines.push("");
  lines.push(
    "_Review the diff carefully before merging. If a game was miscounted, close this PR and refresh manually._",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const seriesList = activeRealSeries();
  console.log(
    `[refresh-data] ${seriesList.length} active series under consideration.`,
  );
  if (seriesList.length === 0) {
    await fs.writeFile(
      SUMMARY_PATH,
      "No active series. Nothing to refresh.\n",
    );
    return;
  }

  const teams = teamsById();
  const abbrs = new Set<string>();
  for (const series of seriesList) {
    const a = teams[series.teamA]?.abbreviation;
    const b = teams[series.teamB]?.abbreviation;
    if (a) abbrs.add(a.toUpperCase());
    if (b) abbrs.add(b.toUpperCase());
  }

  const snapshotUtc = parseSnapshotTimestamp(dataLastUpdatedTimestamp);
  const now = new Date();
  // Use the snapshot's calendar day as the lower bound so same-day late games
  // (after the snapshot timestamp) are still picked up.
  const dates = daysFromTo(snapshotUtc, now);
  console.log(
    `[refresh-data] Fetching ESPN scoreboard for ${dates.length} day(s): ${dates.join(", ")}`,
  );

  const games = await fetchAllGames(dates, Array.from(abbrs));
  console.log(`[refresh-data] Retrieved ${games.size} game(s).`);

  const updates: SeriesUpdate[] = [];
  for (const series of seriesList) {
    const update = computeUpdate(series, teams, games.values(), snapshotUtc);
    if (update) {
      updates.push(update);
    }
  }

  // Warn loudly about final games where exactly one team matches an active
  // series: during the playoffs that pattern almost always means a feed/config
  // abbreviation mismatch (the failure mode that silently froze the June 2026
  // refresh). Off-season exhibition games can trigger false positives; the
  // warning is informational, not fatal.
  const activeAbbrs = new Set(Array.from(abbrs).map(canonicalTeamAbbreviation));
  const mismatchWarnings: string[] = [];
  for (const game of games.values()) {
    if (game.status !== "final") continue;
    const home = game.homeTeam?.abbreviation
      ? canonicalTeamAbbreviation(game.homeTeam.abbreviation)
      : null;
    const away = game.awayTeam?.abbreviation
      ? canonicalTeamAbbreviation(game.awayTeam.abbreviation)
      : null;
    if (!home || !away) continue;
    if (activeAbbrs.has(home) !== activeAbbrs.has(away)) {
      mismatchWarnings.push(
        `${game.date?.slice(0, 10) ?? "unknown date"}: ${game.shortName} matched only one active-series team - check ESPN abbreviation mapping in src/lib/live-data/espn-abbreviations.ts.`,
      );
    }
  }
  for (const warning of mismatchWarnings) {
    console.warn(`[refresh-data] ${warning}`);
  }

  // Stamp the actual run time. Never forward-date the snapshot: games played
  // later today must remain newer than the snapshot so tomorrow's run counts them.
  const stamp = ptSnapshotStamp(new Date());
  const refreshDate = stamp.date;
  const refreshTimestamp = stamp.timestamp;
  const summary = buildSummary(
    updates,
    refreshDate,
    dataLastUpdatedTimestamp,
    teams,
    mismatchWarnings,
  );

  if (updates.length === 0) {
    if (isSnapshotStale(snapshotUtc, now, STALE_DAYS)) {
      const staleMessage = `Active series exist but the snapshot (${dataLastUpdatedTimestamp}) is more than ${STALE_DAYS} day(s) old and no new finalized games matched. NBA playoff series do not pause this long - the feed, the abbreviation mapping, or the matching logic is likely broken. Investigate before trusting the dashboard.`;
      console.error(`[refresh-data] STALE: ${staleMessage}`);
      await fs.writeFile(
        SUMMARY_PATH,
        `${summary}\n\n## STALE DATA ALARM\n\n${staleMessage}\n`,
      );
      process.exitCode = 1;
      return;
    }

    console.log("[refresh-data] No new games detected. Exiting without changes.");
    await fs.writeFile(SUMMARY_PATH, summary);
    return;
  }

  const source = await fs.readFile(CONFIG_PATH, "utf-8");
  const next = applyUpdates(source, updates, refreshDate, refreshTimestamp);
  await fs.writeFile(CONFIG_PATH, next);
  await fs.writeFile(SUMMARY_PATH, summary);

  console.log(
    `[refresh-data] Wrote ${updates.length} series update(s) to ${CONFIG_PATH}.`,
  );
  console.log(
    `[refresh-data] Wrote refresh summary to ${SUMMARY_PATH}.`,
  );

  // Note: dataLastUpdated unused intentionally; the script uses
  // dataLastUpdatedTimestamp as the authoritative snapshot anchor.
  void dataLastUpdated;
}

// Only run when executed directly (corepack pnpm refresh-data). Importing the
// exported helpers for verification must never trigger a refresh.
if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error("[refresh-data] Failed:", err);
    process.exit(1);
  });
}
