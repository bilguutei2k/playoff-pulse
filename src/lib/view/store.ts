// Server-side reads of the job's stored files: the season's games and the forecast
// ledger, and the NBA reports older seals need. The site is rebuilt on every publishing commit, so a build-time read is
// current; `next.config.ts` traces these files into the server bundle for ISR.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LiveReportDay } from "@/lib/season/live-reports";
import { liveState } from "@/lib/season/published";
import type { LedgerRow, SeasonGame } from "@/lib/season/types";

const LIVE_DIRECTORY = path.join(process.cwd(), "data", "live");

let gamesCache: SeasonGame[] | null = null;
let ledgerCache: LedgerRow[] | null = null;

/** Every game of the live season, in tip order. Empty if the store cannot be read. */
export function seasonGames(): SeasonGame[] {
  if (gamesCache) return gamesCache;
  try {
    const raw = readFileSync(path.join(LIVE_DIRECTORY, "games", `${liveState.season}.json`), "utf8");
    const games = (JSON.parse(raw) as SeasonGame[]).filter((game) => game.season === liveState.season);
    gamesCache = games.sort((a, b) => Date.parse(a.tipUtc) - Date.parse(b.tipUtc) || a.id.localeCompare(b.id));
  } catch (error) {
    console.error("[store] games unavailable", error);
    gamesCache = [];
  }
  return gamesCache;
}

/** The season's ledger rows in file order. Empty if the ledger cannot be read. */
export function ledgerRows(): LedgerRow[] {
  if (ledgerCache) return ledgerCache;
  try {
    const raw = readFileSync(path.join(LIVE_DIRECTORY, "ledger", `${liveState.seasonLabel}.jsonl`), "utf8");
    ledgerCache = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LedgerRow);
  } catch (error) {
    console.error("[store] ledger unavailable", error);
    ledgerCache = [];
  }
  return ledgerCache;
}

export function gameById(gameId: string): SeasonGame | null {
  return seasonGames().find((game) => game.id === gameId) ?? null;
}

/** Games per ET date, for the date strip. */
export function gameCountsByDate(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const game of seasonGames()) {
    if (game.status === "canceled") continue;
    counts[game.etDate] = (counts[game.etDate] ?? 0) + 1;
  }
  return counts;
}

const reportCache = new Map<string, LiveReportDay | null>();

/**
 * The NBA reports the job stored for one ET date, or null. Pages need them only for
 * seals written before `driversComplete`, which kept three drivers a side, so only early
 * November's files are traced into the server bundle (see `next.config.ts`).
 */
export function reportDay(etDate: string): LiveReportDay | null {
  if (reportCache.has(etDate)) return reportCache.get(etDate) ?? null;
  const file = path.join(LIVE_DIRECTORY, "reports", liveState.seasonLabel, `${etDate}.json`);
  let day: LiveReportDay | null = null;
  try {
    if (existsSync(file)) day = JSON.parse(readFileSync(file, "utf8")) as LiveReportDay;
  } catch (error) {
    console.error(`[store] reports unavailable for ${etDate}`, error);
  }
  reportCache.set(etDate, day);
  return day;
}
