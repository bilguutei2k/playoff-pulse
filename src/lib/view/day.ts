// One ET date as the day pages show it: the slate view the home page has always
// used (sealed numbers, misses, the market reference), fed from ESPN when it answers
// and from the games store when it does not, with every seal in the ledger rather
// than only the published window. Future dates carry projections instead of the
// provisional number, which exists only for today's late-running job.

import type { GameExtras } from "@/lib/live-data/espn-extras";
import { sealsByGame } from "@/lib/season/live-state";
import { buildSlateView, type SlateGameView, type SlateView } from "@/lib/season/slate";
import type {
  InjuryRow,
  LedgerRow,
  LiveState,
  MarketReference,
  ScoreboardRow,
  SealRow,
  SeasonGame,
} from "@/lib/season/types";
import { projectGame, scheduleDates, type Projection } from "@/lib/view/projection";

export type DayKind = "past" | "today" | "future";

export type DayGame = SlateGameView & {
  /** Unsealed future games only. Never scored, never compared to the market. */
  projection: Projection | null;
  extras: GameExtras | null;
  /** The line the market reference came from, with its spread. */
  marketLine: MarketReference | null;
  /** Every seal row for this game, all versions, in ledger order. */
  sealRows: SealRow[];
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
}): DayView {
  const { state, etDate, todayEtDate, nowIso, espnRows, storeGames, ledger, extras } = input;
  const kind: DayKind = etDate < todayEtDate ? "past" : etDate > todayEtDate ? "future" : "today";
  const rows = espnRows && espnRows.length > 0 ? espnRows : storeRows(storeGames, etDate);
  const ledgerSeals = sealsByGame(ledger, etDate, etDate);
  const seals: Record<string, SealRow[]> = { ...state.seals, ...ledgerSeals };
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
    let projection: Projection | null = null;
    if (forecast?.source === "provisional" && kind !== "today") {
      // A provisional number is today's stopgap only. Future games get a projection
      // without injuries; an unresolved past game gets nothing.
      forecast = null;
      if (kind === "future" && game.status === "scheduled") {
        projection = projectGame(state, game, dates);
      }
    }
    const sealRows = seals[game.id] ?? [];
    const storedLine = sealRows.find((row) => row.market)?.market ?? null;
    return {
      ...game,
      forecast,
      projection,
      extras: extras[game.id] ?? null,
      marketLine: rowById.get(game.id)?.market ?? storedLine,
      sealRows,
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
