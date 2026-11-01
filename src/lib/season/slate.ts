// Joins sealed forecasts with the live scoreboard into what /live displays. Pure,
// so the route and the page share it and it can be tested without a network.
//
// Sealed numbers are the record. A provisional number exists only so every game
// on the day has a forecast when the scheduled job runs late; it is never stored
// or scored, and it is replaced as soon as a seal exists.

import { IN_GAME_SIGMA } from "@/lib/season/params";
import { inGameHomeProbability } from "@/lib/season/in-game";
import { backToBackFromDates } from "@/lib/season/live-state";
import { predictGame } from "@/lib/season/ratings";
import type {
  GameKind,
  GameStatus,
  InjuryRow,
  LiveState,
  ScoreboardRow,
} from "@/lib/season/types";

/** Beyond this, the page says its season numbers are stale. */
export const STALE_AFTER_HOURS = 12;

export type GameForecastView = {
  homeWinProbability: number;
  expectedMargin: number;
  source: "sealed" | "provisional";
  issuedAt: string | null;
  inputsIncomplete: boolean;
};

export type SlateGameView = {
  id: string;
  tipUtc: string;
  etDate: string;
  kind: GameKind;
  homeId: string;
  awayId: string;
  neutral: boolean;
  status: GameStatus;
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
  seriesSummary: string | null;
  forecast: GameForecastView | null;
  inGameHomeProbability: number | null;
  /** Tipped without a seal after the record began, so it counts as a miss. */
  missed: boolean;
  /** Tipped before the first seal existed, so it was never in scope. */
  beforeRecord: boolean;
  /** Did the sealed favorite win? Null until final, or if nothing was sealed. */
  sealedFavoriteWon: boolean | null;
  injuries: { home: InjuryRow[]; away: InjuryRow[] };
};

export type SlateView = {
  etDate: string;
  fetchedAt: string;
  /** False when ESPN could not be reached and only sealed numbers are shown. */
  scoresAvailable: boolean;
  injuriesAvailable: boolean;
  generatedAt: string;
  stateAgeHours: number;
  stale: boolean;
  nextSlateEtDate: string | null;
  games: SlateGameView[];
};

function provisionalForecast(
  row: ScoreboardRow,
  state: LiveState,
): GameForecastView {
  const { game } = row;
  const prediction = predictGame(
    state.ratings,
    {
      homeId: game.homeId,
      awayId: game.awayId,
      neutral: game.neutral,
      playoff: game.kind === "playoff",
      homeOnBackToBack: backToBackFromDates(state.teamGameDates[game.homeId] ?? [], game.etDate),
      awayOnBackToBack: backToBackFromDates(state.teamGameDates[game.awayId] ?? [], game.etDate),
    },
    state.params,
  );
  return {
    homeWinProbability: prediction.homeWinProbability,
    expectedMargin: prediction.expectedMargin,
    source: "provisional",
    issuedAt: null,
    inputsIncomplete: false,
  };
}

function gameView(
  row: ScoreboardRow,
  state: LiveState,
  injuries: readonly InjuryRow[],
): SlateGameView {
  const { game } = row;
  const seal = state.seals[game.id];
  let forecast: GameForecastView | null = null;
  if (seal) {
    forecast = {
      homeWinProbability: seal.homeWinProbability,
      expectedMargin: seal.expectedMargin,
      source: "sealed",
      issuedAt: seal.issuedAt,
      inputsIncomplete: seal.inputsIncomplete,
    };
  } else if (game.status === "scheduled" || game.status === "in-progress") {
    // Not for finished games: published ratings may already include that result.
    forecast = provisionalForecast(row, state);
  }

  let inGame: number | null = null;
  if (
    game.status === "in-progress" &&
    forecast &&
    row.live &&
    game.homeScore !== null &&
    game.awayScore !== null
  ) {
    inGame = inGameHomeProbability({
      homeMargin: game.homeScore - game.awayScore,
      expectedMargin: forecast.expectedMargin,
      period: row.live.period,
      clockSeconds: row.live.clockSeconds,
      sigma: IN_GAME_SIGMA,
    });
  }

  const tipped = game.status === "in-progress" || game.status === "final";
  const beforeRecord =
    !seal &&
    tipped &&
    (state.ledgerStartedAt === null ||
      Date.parse(game.tipUtc) <= Date.parse(state.ledgerStartedAt));

  let sealedFavoriteWon: boolean | null = null;
  if (
    seal &&
    game.status === "final" &&
    game.homeScore !== null &&
    game.awayScore !== null
  ) {
    sealedFavoriteWon = seal.homeWinProbability > 0.5 === game.homeScore > game.awayScore;
  }

  return {
    id: game.id,
    tipUtc: game.tipUtc,
    etDate: game.etDate,
    kind: game.kind,
    homeId: game.homeId,
    awayId: game.awayId,
    neutral: game.neutral,
    status: game.status,
    statusDetail: row.statusDetail,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    seriesSummary: row.seriesSummary,
    forecast,
    inGameHomeProbability: inGame,
    missed: !seal && tipped && !beforeRecord,
    beforeRecord,
    sealedFavoriteWon,
    injuries: {
      home: injuries.filter((entry) => entry.teamId === game.homeId),
      away: injuries.filter((entry) => entry.teamId === game.awayId),
    },
  };
}

export function buildSlateView(input: {
  state: LiveState;
  etDate: string;
  nowIso: string;
  rows: readonly ScoreboardRow[] | null;
  injuries: readonly InjuryRow[] | null;
}): SlateView {
  const { state, etDate, nowIso, rows, injuries } = input;
  const ageHours = (Date.parse(nowIso) - Date.parse(state.generatedAt)) / 3_600_000;

  // ESPN unavailable: fall back to what was sealed for this date.
  const effectiveRows: readonly ScoreboardRow[] =
    rows ??
    Object.values(state.seals)
      .filter((seal) => seal.etDate === etDate)
      .map((seal) => ({
        game: {
          id: seal.gameId,
          season: state.season,
          kind: "regular" as const,
          tipUtc: seal.tipUtc,
          etDate: seal.etDate,
          homeId: seal.homeId,
          awayId: seal.awayId,
          neutral: false,
          status: "scheduled" as const,
          homeScore: null,
          awayScore: null,
        },
        live: null,
        statusDetail: "Live scores unavailable",
        market: null,
        homeLinescores: [],
        awayLinescores: [],
        seriesSummary: null,
      }));

  const games = effectiveRows
    .filter((row) => row.game.etDate === etDate)
    .map((row) => gameView(row, state, injuries ?? []))
    .sort((a, b) => Date.parse(a.tipUtc) - Date.parse(b.tipUtc));

  return {
    etDate,
    fetchedAt: nowIso,
    scoresAvailable: rows !== null,
    injuriesAvailable: injuries !== null,
    generatedAt: state.generatedAt,
    stateAgeHours: Math.max(0, ageHours),
    stale: ageHours > STALE_AFTER_HOURS,
    nextSlateEtDate: state.nextSlateEtDate,
    games,
  };
}
