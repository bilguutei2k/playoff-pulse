// One ET date as the day pages show it: the slate view the home page has always
// used (sealed numbers, misses, the market reference), fed from ESPN when it answers
// and from the games store when it does not, with every seal in the ledger rather
// than only the published window. Future dates carry projections instead of the
// provisional number, which exists only for today's late-running job.

import type { GameExtras } from "@/lib/live-data/espn-extras";
import type { LiveReportDay } from "@/lib/season/live-reports";
import type { ProjectionsFile } from "@/lib/season/projections";
import { sealsByGame } from "@/lib/season/live-state";
import { providerName } from "@/lib/season/market";
import { buildSlateView, displayedSeal, type SlateGameView, type SlateView } from "@/lib/season/slate";
import type {
  InjuryRow,
  LedgerRow,
  LiveState,
  MarketReference,
  ScoreboardRow,
  SealRow,
  SeasonGame,
} from "@/lib/season/types";
import { absenceSides, type AbsenceSides } from "@/lib/view/injuries";
import {
  fromPublished,
  projectGame,
  publishedProjection,
  scheduleDates,
  withoutInjuries,
  type ShownProjection,
} from "@/lib/view/projection";
import { mergeSeals } from "@/lib/view/seals";

export type DayKind = "past" | "today" | "future";

export type DayGame = SlateGameView & {
  /**
   * Unsealed future games only: the published projection with the injury term, or the
   * fallback from ratings alone when it is not published for this game. Never scored,
   * never compared to the market.
   */
  projection: ShownProjection | null;
  extras: GameExtras | null;
  /** The line the market reference came from, with its spread. */
  marketLine: MarketReference | null;
  /** Every seal row for this game, all versions, in ledger order. */
  sealRows: SealRow[];
  /** Everyone behind each side's absence term in the shown number; null without the injury term. */
  absences: AbsenceSides | null;
};

export type DayView = Omit<SlateView, "games"> & {
  kind: DayKind;
  todayEtDate: string;
  games: DayGame[];
};

/** Store games for one date in the scoreboard's shape, for when ESPN cannot be reached. */
export function storeRows(games: readonly SeasonGame[], etDate: string): ScoreboardRow[] {
  return games
    .filter((game) => game.etDate === etDate)
    .map((game) => ({
      game,
      live: null,
      statusDetail: game.status === "final" ? "Final" : "",
      market: null,
      homeLinescores: [],
      awayLinescores: [],
      seriesSummary: null,
    }));
}

export function buildDayView(input: {
  state: LiveState;
  etDate: string;
  todayEtDate: string;
  nowIso: string;
  /** ESPN's scoreboard for the date, or null when it could not be read. */
  espnRows: readonly ScoreboardRow[] | null;
  storeGames: readonly SeasonGame[];
  ledger: readonly LedgerRow[];
  injuries: readonly InjuryRow[] | null;
  extras: Record<string, GameExtras>;
  /** The date's stored NBA reports, for seals that kept only three drivers a side. */
  reports?: LiveReportDay | null;
  /** The published projections with the injury term (`getProjections`); null when not published. */
  projections?: ProjectionsFile | null;
}): DayView {
  const { state, etDate, todayEtDate, nowIso, espnRows, storeGames, ledger, extras } = input;
  const kind: DayKind = etDate < todayEtDate ? "past" : etDate > todayEtDate ? "future" : "today";
  const rows = espnRows && espnRows.length > 0 ? espnRows : storeRows(storeGames, etDate);
  // The day's ledger rows and the state can be a commit apart; keep every seal from both.
  const seals: Record<string, SealRow[]> = mergeSeals(state.seals, sealsByGame(ledger, etDate, etDate));
  const slate = buildSlateView({
    state: { ...state, seals },
    etDate,
    nowIso,
    rows,
    injuries: kind === "today" ? input.injuries : [],
  });
  const dates = kind === "future" ? scheduleDates(state, storeGames) : {};
  const rowById = new Map(rows.map((row) => [row.game.id, row]));

  const games: DayGame[] = slate.games.map((game) => {
    let forecast = game.forecast;
    let projection: ShownProjection | null = null;
    if (forecast?.source === "provisional" && kind !== "today") {
      // A provisional number is today's stopgap only. Future games get the published
      // projection with the injury term, or the one from ratings alone where it is not
      // published; an unresolved past game gets nothing.
      forecast = null;
      if (kind === "future" && game.status === "scheduled") {
        const published = publishedProjection(input.projections ?? null, game.id);
        projection = published ? fromPublished(published) : withoutInjuries(projectGame(state, game, dates));
      }
    }
    const sealRows = seals[game.id] ?? [];
    // The shown seal's own line first, so the spread matches the market probability beside it.
    const storedLine =
      displayedSeal(sealRows, state)?.market ?? sealRows.find((row) => row.market)?.market ?? null;
    const line = rowById.get(game.id)?.market ?? storedLine;
    const report =
      forecast && !forecast.driversComplete && forecast.reportAt
        ? (input.reports?.reports[forecast.reportAt] ?? null)
        : null;
    return {
      ...game,
      forecast,
      projection,
      extras: extras[game.id] ?? null,
      marketLine: line ? { ...line, provider: providerName(line.provider) } : null,
      sealRows,
      absences: projection?.withInjuries
        ? absenceSides({
            forecast: {
              absencePoints: projection.absencePoints,
              drivers: projection.drivers,
              driversComplete: true,
              unfiled: projection.unfiled,
            },
            homeId: game.homeId,
            awayId: game.awayId,
            report: null,
          })
        : absenceSides({ forecast, homeId: game.homeId, awayId: game.awayId, report }),
    };
  });

  return {
    ...slate,
    // Live scores matter only today; other dates read final scores from the store.
    scoresAvailable: kind !== "today" || espnRows !== null,
    kind,
    todayEtDate,
    games,
  };
}
