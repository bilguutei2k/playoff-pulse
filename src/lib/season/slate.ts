// Joins sealed forecasts with the live scoreboard into what the games page displays.
// Pure, so the route and the page share it and it can be tested without a network.
//
// Sealed numbers are the record. A v2 game shows its final seal once one exists and its
// morning seal until then. A provisional number exists only so every game on the day has
// a forecast when the scheduled job runs late; it applies the published absences, is
// never stored or scored, and is replaced as soon as a seal exists.

import { IN_GAME_SIGMA } from "@/lib/season/params";
import { inGameHomeProbability } from "@/lib/season/in-game";
import { backToBackFromDates, morningSeal, sealKindOf } from "@/lib/season/live-state";
import { impliedHomeProbability, providerName } from "@/lib/season/market";
import { predictGame } from "@/lib/season/ratings";
import type {
  AbsenceDriver,
  GameKind,
  GameStatus,
  InjuryRow,
  LiveState,
  MarketReference,
  PlayoffRound,
  ScoreboardRow,
  SealKind,
  SealRow,
} from "@/lib/season/types";

/** Beyond this, the page says its season numbers are stale. */
export const STALE_AFTER_HOURS = 12;

export type GameForecastView = {
  homeWinProbability: number;
  expectedMargin: number;
  source: "sealed" | "provisional";
  issuedAt: string | null;
  inputsIncomplete: boolean;
  /** The model behind this number. */
  modelVersion: string;
  /** Which seal this is. Null for a provisional number. */
  sealKind: SealKind | null;
  /**
   * Points each side gives up to expected absences, in this number. Null when the
   * number comes from a model without the injury term.
   */
  absencePoints: { home: number; away: number } | null;
  /** The players behind those points, largest first. */
  drivers: { home: AbsenceDriver[]; away: AbsenceDriver[] } | null;
  /**
   * False for a seal written before `driversComplete` existed, which stored only its three largest
   * drivers a side; the rest of the list has to come from the report it used.
   */
  driversComplete: boolean;
  /** Sides the report in use marked NOT YET SUBMITTED, when the seal records it. */
  unfiled: { home: boolean; away: boolean } | null;
  /** Header time of the NBA injury report used, ET wall clock. */
  reportAt: string | null;
  availabilityStale: boolean;
  availabilityMissing: boolean;
  /** The reference model's number for the same game at the same instant (v2 seals only). */
  referenceModelVersion: string | null;
  referenceHomeWinProbability: number | null;
};

/** The market's view of a game, shown beside the model's number for reference only. */
export type MarketView = {
  /** Who set the line, as the feed names it, e.g. "DraftKings". */
  provider: string;
  /** Home win probability implied by the moneylines, vig removed. */
  homeWinProbability: number;
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
  round: PlayoffRound | null;
  /** Current playoff series odds, from the latest season forecast. */
  series: { homeWins: number; awayWins: number; homeWinsSeries: number } | null;
  forecast: GameForecastView | null;
  inGameHomeProbability: number | null;
  /** Tipped without a seal after the record began, so it counts as a miss. */
  missed: boolean;
  /** Tipped before the first seal existed, so it was never in scope. */
  beforeRecord: boolean;
  /**
   * Tipped with a morning seal from the published model but no final seal, so it is
   * scored on the morning seal and counted as "no final seal".
   */
  noFinalSeal: boolean;
  /** Did the sealed favorite win? Null until final, or if nothing was sealed. */
  sealedFavoriteWon: boolean | null;
  /**
   * Market reference: the live scoreboard line when present, else the line stored
   * with the seal, else null. Never a model input and never scored.
   */
  market: MarketView | null;
  /** ESPN's injury list: shown only as a labeled fallback when no NBA report was used. */
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
  /** The published model, and the one sealing beside it. */
  modelVersion: string;
  referenceModelVersion: string;
  games: SlateGameView[];
};

/**
 * The seal a game page shows: the published model's final seal, else its morning
 * seal as reissued if it was, else the reference model's seal (only for games sealed
 * before v2 existed).
 */
export function displayedSeal(rows: readonly SealRow[] | undefined, state: LiveState): SealRow | null {
  if (!rows || rows.length === 0) return null;
  const own = rows.filter((row) => row.modelVersion === state.modelVersion);
  return (
    own.find((row) => sealKindOf(row) === "final") ??
    morningSeal(own) ??
    rows.find((row) => row.modelVersion === state.referenceModelVersion) ??
    rows[0]
  );
}

function sealedForecast(seal: SealRow): GameForecastView {
  const modeled = seal.absencePoints !== undefined;
  return {
    homeWinProbability: seal.homeWinProbability,
    expectedMargin: seal.expectedMargin,
    source: "sealed",
    issuedAt: seal.issuedAt,
    inputsIncomplete: seal.inputsIncomplete,
    modelVersion: seal.modelVersion,
    sealKind: sealKindOf(seal),
    absencePoints: modeled ? (seal.absencePoints ?? null) : null,
    drivers: modeled ? (seal.drivers ?? { home: [], away: [] }) : null,
    driversComplete: seal.driversComplete === true,
    unfiled: seal.unfiled ?? null,
    reportAt: seal.reportAt ?? null,
    availabilityStale: seal.availabilityStale ?? false,
    availabilityMissing: modeled ? (seal.availabilityMissing ?? false) : false,
    referenceModelVersion: seal.referenceModelVersion ?? null,
    referenceHomeWinProbability: seal.referenceHomeWinProbability ?? null,
  };
}

function provisionalDrivers(state: LiveState, teamId: string): AbsenceDriver[] {
  return state.absences
    .filter((row) => row.teamId === teamId)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
    .map((row) => ({
      athleteId: row.athleteId,
      name: row.name,
      status: row.status,
      points: row.points,
    }));
}

function provisionalForecast(
  row: ScoreboardRow,
  state: LiveState,
): GameForecastView {
  const { game } = row;
  const modeled = state.injury !== null;
  const home = state.absencePoints[game.homeId] ?? 0;
  const away = state.absencePoints[game.awayId] ?? 0;
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
    // The published absences, so a late job never shows a silent no-injury number.
    -(home - away),
  );
  return {
    homeWinProbability: prediction.homeWinProbability,
    expectedMargin: prediction.expectedMargin,
    source: "provisional",
    issuedAt: null,
    inputsIncomplete: false,
    modelVersion: state.modelVersion,
    sealKind: null,
    absencePoints: modeled ? { home, away } : null,
    drivers: modeled
      ? { home: provisionalDrivers(state, game.homeId), away: provisionalDrivers(state, game.awayId) }
      : null,
    // Every published absence is listed, so the drivers are the whole of each side.
    driversComplete: true,
    unfiled: null,
    reportAt: state.availability.reportAt,
    availabilityStale: state.availability.stale,
    availabilityMissing: modeled && state.availability.missing,
    referenceModelVersion: null,
    referenceHomeWinProbability: null,
  };
}

function marketView(...sources: Array<MarketReference | null | undefined>): MarketView | null {
  for (const source of sources) {
    if (!source) continue;
    const homeWinProbability = impliedHomeProbability(source);
    if (homeWinProbability !== null) return { provider: providerName(source.provider), homeWinProbability };
  }
  return null;
}

function gameView(
  row: ScoreboardRow,
  state: LiveState,
  injuries: readonly InjuryRow[],
): SlateGameView {
  const { game } = row;
  const rows = state.seals[game.id];
  const seal = displayedSeal(rows, state);
  let forecast: GameForecastView | null = null;
  if (seal) {
    forecast = sealedForecast(seal);
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

  const seriesRow =
    game.kind === "playoff"
      ? state.forecast.series?.find(
          (row) =>
            (row.homeCourtId === game.homeId && row.otherId === game.awayId) ||
            (row.homeCourtId === game.awayId && row.otherId === game.homeId),
        )
      : undefined;
  const series = seriesRow
    ? seriesRow.homeCourtId === game.homeId
      ? {
          homeWins: seriesRow.homeCourtWins,
          awayWins: seriesRow.otherWins,
          homeWinsSeries: seriesRow.homeCourtSeriesProbability,
        }
      : {
          homeWins: seriesRow.otherWins,
          awayWins: seriesRow.homeCourtWins,
          homeWinsSeries: 1 - seriesRow.homeCourtSeriesProbability,
        }
    : null;

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
    round: game.round ?? null,
    series,
    forecast,
    inGameHomeProbability: inGame,
    missed: !seal && tipped && !beforeRecord,
    beforeRecord,
    noFinalSeal:
      tipped &&
      seal !== null &&
      seal.modelVersion === state.modelVersion &&
      sealKindOf(seal) !== "final",
    sealedFavoriteWon,
    market: marketView(row.market, seal?.market),
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
      .flatMap((sealRows) => {
        const seal = displayedSeal(sealRows, state);
        return seal && seal.etDate === etDate ? [seal] : [];
      })
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
    modelVersion: state.modelVersion,
    referenceModelVersion: state.referenceModelVersion,
    games,
  };
}
