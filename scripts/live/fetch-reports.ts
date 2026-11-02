// Backfills injury reports for finished seasons: for every game, the report as it stood
// at 06:00 ET on game day and one hour before tip, chosen by each report's own timestamp.
//
// The host refuses bursts, and refuses a missing file the same way, so this runs slowly
// and tells them apart with a control file known to exist. Parsed reports are cached
// outside Git, so a restart repeats no downloads.
//
// Run: corepack pnpm exec tsx scripts/live/fetch-reports.ts 2022 2023 ...

import * as fs from "node:fs";
import * as path from "node:path";
import {
  reportFileName,
  reportUrl,
  type ParsedReport,
  type ReportRow,
} from "../../src/lib/live-data/nba-reports";
import { etWallClockOf } from "../../src/lib/season/dates";
import type { StoredPoint, StoredReports } from "../../src/lib/season/availability";
import { STATUS_CODES, teamIdFromReportName } from "../../src/lib/season/availability";
import type { SeasonGame } from "../../src/lib/season/types";
import { loadSeasonGames } from "./game-store";
import { parseReportPdf } from "./report-pdf";

const CACHE = path.join(process.cwd(), "data", "historical", "raw", "injury-reports");
const OUTPUT = path.join(process.cwd(), "data", "season", "reports");
const GAP_MS = 300;
const CONTROL = "2022-01-15_05PM";
const USER_AGENT = { "user-agent": "playoff-pulse-backfill" };
/** The switch to reports every 15 minutes happened during this date. */
const QUARTER_FROM = "2025-12-22";
const FINAL_WINDOW_HOURS = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const memory = new Map<string, ParsedReport | null>();
let downloads = 0;

async function fetchPdf(name: string): Promise<Uint8Array | null> {
  await wait(GAP_MS);
  downloads += 1;
  const response = await fetch(reportUrl(name), { headers: USER_AGENT });
  if (response.ok) return new Uint8Array(await response.arrayBuffer());
  await wait(1500);
  const retry = await fetch(reportUrl(name), { headers: USER_AGENT });
  if (retry.ok) return new Uint8Array(await retry.arrayBuffer());
  // Missing or throttled? Ask for a file that certainly exists.
  for (;;) {
    const control = await fetch(reportUrl(CONTROL), { method: "HEAD", headers: USER_AGENT });
    if (control.ok) break;
    console.log(`[reports] host is refusing requests, waiting 60s (${retry.status})`);
    await wait(60_000);
    const again = await fetch(reportUrl(name), { headers: USER_AGENT });
    if (again.ok) return new Uint8Array(await again.arrayBuffer());
  }
  const last = await fetch(reportUrl(name), { headers: USER_AGENT });
  return last.ok ? new Uint8Array(await last.arrayBuffer()) : null;
}

async function loadReport(name: string): Promise<ParsedReport | null> {
  if (memory.has(name)) return memory.get(name) ?? null;
  const parsedFile = path.join(CACHE, `${name}.json`);
  const missingFile = path.join(CACHE, `${name}.missing`);
  let report: ParsedReport | null = null;
  if (fs.existsSync(parsedFile)) {
    report = JSON.parse(fs.readFileSync(parsedFile, "utf-8")) as ParsedReport;
  } else if (!fs.existsSync(missingFile)) {
    const data = await fetchPdf(name);
    if (data) {
      try {
        report = await parseReportPdf(data);
        fs.writeFileSync(parsedFile, JSON.stringify(report), "utf-8");
      } catch (error) {
        console.log(`[reports] could not parse ${name}: ${String(error)}`);
        fs.writeFileSync(missingFile, `unparseable: ${String(error)}\n`, "utf-8");
      }
    } else {
      fs.writeFileSync(missingFile, "not found\n", "utf-8");
    }
  }
  memory.set(name, report);
  return report;
}

/** Report file names that could be the latest one at or before an ET time, newest first. */
function candidates(targetEt: string): string[] {
  const names: string[] = [];
  const target = Date.parse(`${targetEt}:00Z`);
  // Stamped times are treated as UTC only to step through wall-clock time.
  const nameFor = (time: number, style: "hourly" | "quarter") => {
    const iso = new Date(time).toISOString();
    return reportFileName(iso.slice(0, 10), Number(iso.slice(11, 13)), Number(iso.slice(14, 16)), style);
  };
  const quarter = Math.floor(target / 900_000) * 900_000;
  if (targetEt.slice(0, 10) >= QUARTER_FROM) {
    for (let step = 0; step < 48; step += 1) {
      names.push(nameFor(quarter - step * 900_000, "quarter"));
    }
  }
  if (targetEt.slice(0, 10) <= QUARTER_FROM) {
    // Hourly files carry a stamp 30 minutes after the hour in their name.
    const hour = Math.floor((target - 1_800_000) / 3_600_000) * 3_600_000;
    for (let step = 0; step < 12; step += 1) {
      names.push(nameFor(hour - step * 3_600_000, "hourly"));
    }
  }
  return names;
}

async function reportAt(targetEt: string, gameDate: string): Promise<ParsedReport | null> {
  for (const name of candidates(targetEt)) {
    const report = await loadReport(name);
    if (!report || report.issuedEt > targetEt) continue;
    if (report.rows.some((row) => row.gameDate === gameDate)) return report;
  }
  return null;
}

function pointFor(
  report: ParsedReport | null,
  game: SeasonGame,
  intern: (reason: string) => number,
): StoredPoint | null {
  if (!report) return null;
  const point: StoredPoint = { at: report.issuedEt, notSubmitted: [], rows: [] };
  const teams = new Set([game.homeId, game.awayId]);
  for (const row of report.rows as ReportRow[]) {
    if (row.gameDate !== game.etDate) continue;
    const teamId = teamIdFromReportName(row.team);
    if (!teams.has(teamId)) continue;
    if (row.player === null || row.status === null) point.notSubmitted.push(teamId);
    else point.rows.push([teamId, row.player, STATUS_CODES[row.status], intern(row.reason)]);
  }
  return point;
}

async function collectSeason(season: number): Promise<void> {
  const games = loadSeasonGames(season).filter((game) => game.status === "final");
  const store: StoredReports = { season, reasons: [], games: {} };
  const reasonIndex = new Map<string, number>();
  const intern = (reason: string) => {
    let index = reasonIndex.get(reason);
    if (index === undefined) {
      index = store.reasons.length;
      store.reasons.push(reason);
      reasonIndex.set(reason, index);
    }
    return index;
  };
  let finalMissing = 0;
  let finalOld = 0;
  for (const [index, game] of games.entries()) {
    const morning = await reportAt(`${game.etDate}T06:00`, game.etDate);
    const finalTarget = etWallClockOf(Date.parse(game.tipUtc) - 3_600_000);
    const final = await reportAt(finalTarget, game.etDate);
    store.games[game.id] = {
      morning: pointFor(morning, game, intern),
      final: pointFor(final, game, intern),
    };
    if (!final) finalMissing += 1;
    else if (
      Date.parse(`${etWallClockOf(game.tipUtc)}:00Z`) - Date.parse(`${final.issuedEt}:00Z`) >
      FINAL_WINDOW_HOURS * 3_600_000
    ) {
      finalOld += 1;
    }
    if ((index + 1) % 100 === 0) {
      console.log(`[reports] ${season}: ${index + 1}/${games.length}, ${downloads} downloads so far`);
    }
  }
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, `${season}.json`), `${JSON.stringify(store)}\n`, "utf-8");
  console.log(
    `[reports] ${season}: ${games.length} games, ${finalMissing} with no final report, ${finalOld} with one over ${FINAL_WINDOW_HOURS}h before tip`,
  );
}

async function main(): Promise<void> {
  const seasons = process.argv.slice(2).map(Number);
  if (seasons.length === 0 || seasons.some((season) => !Number.isInteger(season))) {
    throw new Error("Pass the seasons to collect, by ending year.");
  }
  fs.mkdirSync(CACHE, { recursive: true });
  for (const season of seasons) await collectSeason(season);
  console.log("[reports] done");
}

main().catch((error) => {
  console.error(`[reports] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
