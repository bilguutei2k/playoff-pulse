// Server-side assembly of one ET date for the day and game pages: ESPN's scoreboard
// (one request gives the engine rows and the venue and broadcast), and the published
// state, games and the date's seal rows read at render time (published.ts). ESPN
// failures degrade to stored data.

import { parseScoreboardExtras, type GameExtras } from "@/lib/live-data/espn-extras";
import { createFetchJson, fetchInjuries, parseScoreboard } from "@/lib/live-data/espn-season";
import { slateDateAt } from "@/lib/season/live-state";
import type { InjuryRow, ScoreboardRow } from "@/lib/season/types";
import { getDaySeals, getLiveState, getReportDay, getSeasonGames } from "@/lib/live-data/published";
import { buildDayView, type DayView } from "@/lib/view/day";

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
  const [liveState, storeGames, daySeals, reports] = await Promise.all([
    getLiveState(),
    getSeasonGames(),
    getDaySeals(etDate),
    getReportDay(etDate),
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
  });
}
