// Server-side assembly of the live slate: ESPN scoreboard plus published state.
// ESPN failures degrade to sealed numbers instead of breaking the page.

import {
  createFetchJson,
  fetchInjuries,
  fetchScoreboardRows,
} from "@/lib/live-data/espn-season";
import { slateDateAt } from "@/lib/season/live-state";
import { liveState } from "@/lib/season/published";
import { buildSlateView, type SlateView } from "@/lib/season/slate";
import type { InjuryRow, ScoreboardRow } from "@/lib/season/types";

const SCOREBOARD_CACHE_SECONDS = 30;
const INJURY_CACHE_SECONDS = 900;

export async function loadSlateView(): Promise<SlateView> {
  const nowIso = new Date().toISOString();
  const etDate = slateDateAt(nowIso);

  let rows: ScoreboardRow[] | null = null;
  try {
    rows = await fetchScoreboardRows(
      createFetchJson({ next: { revalidate: SCOREBOARD_CACHE_SECONDS } }),
      etDate,
      liveState.season,
    );
  } catch (error) {
    console.error("[live] scoreboard unavailable", error);
  }

  let injuries: InjuryRow[] | null = null;
  try {
    injuries = await fetchInjuries(
      createFetchJson({ next: { revalidate: INJURY_CACHE_SECONDS } }),
    );
  } catch (error) {
    console.error("[live] injury report unavailable", error);
  }

  return buildSlateView({ state: liveState, etDate, nowIso, rows, injuries });
}
