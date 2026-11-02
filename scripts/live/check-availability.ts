// The registered coverage checks, by season. Either failing fails the build:
// (i) at least 98% of report rows, excluding G League and Two-Way, resolve to exactly one
// athlete through the production resolver: team-season roster, then a name unique across
// all loaded box-score seasons; (ii) at least 98% of box-score minutes belong to players
// whose normalized name is unique within their team-season.
// Also reports, as a separate void condition, games lacking a final report within 3 hours.
//
// Run: corepack pnpm exec tsx scripts/live/check-availability.ts

import {
  isDevelopmentLeagueReason,
  normalizePersonName,
  reportNameKey,
  resolvePlayer,
} from "../../src/lib/season/availability";
import { etWallClockOf } from "../../src/lib/season/dates";
import { buildNameIndex, loadBoxScores, loadReports, NAME_SEASONS } from "./availability-store";
import { loadSeasonGames } from "./game-store";

const REPORT_SEASONS = [2022, 2023, 2024, 2025, 2026];
const THRESHOLD = 0.98;
const MAX_LATE_SHARE = 0.05;
const FINAL_WINDOW_MS = 3 * 3_600_000;

const stores = NAME_SEASONS.map(loadBoxScores);
const index = buildNameIndex(stores);

let failed = false;
for (const season of REPORT_SEASONS) {
  const box = stores[NAME_SEASONS.indexOf(season)];
  const reports = loadReports(season);
  if (!reports) throw new Error(`No reports for ${season}.`);

  // (ii) Minutes held by players with a name unique on their team.
  const namesOnTeam = new Map<string, Set<string>>();
  for (const game of Object.values(box.games)) {
    for (const [teamId, lines] of Object.entries(game)) {
      for (const [athleteId] of lines) {
        const key = `${teamId}:${normalizePersonName(box.names[athleteId])}`;
        const entry = namesOnTeam.get(key) ?? new Set<string>();
        entry.add(athleteId);
        namesOnTeam.set(key, entry);
      }
    }
  }
  let minutes = 0;
  let uniqueMinutes = 0;
  for (const game of Object.values(box.games)) {
    for (const [teamId, lines] of Object.entries(game)) {
      for (const [athleteId, played] of lines) {
        minutes += played;
        const key = `${teamId}:${normalizePersonName(box.names[athleteId])}`;
        if (namesOnTeam.get(key)?.size === 1) uniqueMinutes += played;
      }
    }
  }

  // (i) Report rows resolving to exactly one athlete.
  let rows = 0;
  let onRoster = 0;
  let resolved = 0;
  const unmatched = new Map<string, number>();
  const games = loadSeasonGames(season).filter((game) => game.status === "final");
  let late = 0;
  let noFinal = 0;
  let notFiled = 0;
  for (const game of games) {
    const stored = reports.games[game.id];
    const final = stored?.final;
    if (!final) {
      noFinal += 1;
      continue;
    }
    const tip = Date.parse(`${etWallClockOf(game.tipUtc)}:00Z`);
    if (tip - Date.parse(`${final.at}:00Z`) > FINAL_WINDOW_MS) late += 1;
    if (final.notSubmitted.length > 0) notFiled += 1;
    for (const [teamId, player, , reason] of final.rows) {
      if (isDevelopmentLeagueReason(reports.reasons[reason])) continue;
      rows += 1;
      if (index.roster.get(`${season}:${teamId}:${reportNameKey(player)}`)?.size === 1) {
        onRoster += 1;
      }
      if (resolvePlayer(index, season, teamId, player) !== null) resolved += 1;
      else unmatched.set(player, (unmatched.get(player) ?? 0) + 1);
    }
  }
  const rowShare = resolved / rows;
  const minuteShare = uniqueMinutes / minutes;
  const unusable = (late + noFinal) / games.length;
  console.log(
    `${season}: rows ${rows}, resolved ${(rowShare * 100).toFixed(2)}%, on roster ${((onRoster / rows) * 100).toFixed(2)}% | minutes unique ${(minuteShare * 100).toFixed(2)}% | games ${games.length}, no final ${noFinal}, over 3h ${late}, a team not filed ${notFiled} (${(unusable * 100).toFixed(2)}% unusable)`,
  );
  const worst = [...unmatched.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  unresolved: ${worst.map(([name, count]) => `${name} (${count})`).join("; ")}`);
  if (rowShare < THRESHOLD || minuteShare < THRESHOLD) failed = true;
  if (unusable > MAX_LATE_SHARE) console.log(`  season is unusable: over ${MAX_LATE_SHARE * 100}% of games lack a qualifying report`);
}
if (failed) {
  console.error("Coverage gate failed.");
  process.exit(1);
}
console.log("Coverage gate passed.");
