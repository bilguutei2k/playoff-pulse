// Server-side assembly of one ET date for the day and game pages: ESPN's scoreboard
// (one request gives the engine rows and the venue and broadcast), and the published
// state, games and the date's seal rows read at render time (published.ts). ESPN
// failures degrade to stored data.

import { parseScoreboardExtras, type GameExtras } from "@/lib/live-data/espn-extras";
import { createFetchJson, fetchInjuries, parseScoreboard } from "@/lib/live-data/espn-season";
import { slateDateAt } from "@/lib/season/live-state";
import type { InjuryRow, ScoreboardRow } from "@/lib/season/types";
import { getDaySeals, getLiveState, getProjections, getReportDay, getSeasonGames } from "@/lib/live-data/published";
import { buildDayView, type DayView } from "@/lib/view/day";
import { daySummary, earlierGameDays, type DaySummary } from "@/lib/view/day-summary";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const TODAY_CACHE_SECONDS = 30;
const OTHER_DAY_CACHE_SECONDS = 1800;
const INJURY_CACHE_SECONDS = 900;

/** Today's ET slate date, rolled the way the job rolls it. */
export function todayEtDate(nowIso = new Date().toISOString()): string {
  return slateDateAt(nowIso);
}

export async function loadDayView(etDate: string): Promise<DayView> {
  const nowIso = new Date().toISOString();
  const today = todayEtDate(nowIso);
  const isToday = etDate === today;
  // Only future days show projections; today and past days never read that file.
  const [liveState, storeGames, daySeals, reports, projections] = await Promise.all([
    getLiveState(),
    getSeasonGames(),
    getDaySeals(etDate),
    getReportDay(etDate),
    etDate > today ? getProjections() : Promise.resolve(null),
  ]);

  let espnRows: ScoreboardRow[] | null = null;
  let extras: Record<string, GameExtras> = {};
  try {
    const fetchJson = createFetchJson({
      next: { revalidate: isToday ? TODAY_CACHE_SECONDS : OTHER_DAY_CACHE_SECONDS },
    });
    // The same URL the slate loader uses, so the two share one cached response.
    const payload = await fetchJson(`${SCOREBOARD}?dates=${etDate.replaceAll("-", "")}&limit=100`);
    espnRows = parseScoreboard(payload, liveState.season);
    extras = parseScoreboardExtras(payload);
  } catch (error) {
    console.error(`[day] scoreboard unavailable for ${etDate}`, error);
  }

  let injuries: InjuryRow[] | null = null;
  if (isToday) {
    try {
      injuries = await fetchInjuries(createFetchJson({ next: { revalidate: INJURY_CACHE_SECONDS } }));
    } catch (error) {
      console.error("[day] injury list unavailable", error);
    }
  }

  return buildDayView({
    state: liveState,
    etDate,
    todayEtDate: today,
    nowIso,
    espnRows,
    storeGames,
    ledger: daySeals,
    injuries,
    extras,
    reports,
    projections,
  });
}

/** How many earlier game days the home page tries for its last-results line. */
const LAST_DAY_TRIES = 3;

/**
 * The most recent game day before `before` whose sealed finals give the day sentence,
 * with that sentence (`daySummary`), or null. Stored data only: the published state,
 * the games store and the date's seal file, without ESPN, the reports or the season
 * ledger, so the home page pays one day file read for it (rarely more, when that day
 * had no scored final).
 */
export async function loadLastResults(
  counts: Record<string, number>,
  before: string,
): Promise<{ etDate: string; summary: DaySummary } | null> {
  const nowIso = new Date().toISOString();
  for (const etDate of earlierGameDays(counts, before, LAST_DAY_TRIES)) {
    const [state, storeGames, daySeals] = await Promise.all([getLiveState(), getSeasonGames(), getDaySeals(etDate)]);
    const view = buildDayView({
      state,
      etDate,
      todayEtDate: todayEtDate(nowIso),
      nowIso,
      espnRows: null,
      storeGames,
      ledger: daySeals,
      injuries: null,
      extras: {},
    });
    const summary = daySummary(view.games);
    if (summary.sentenceParts) return { etDate, summary };
  }
  return null;
}
