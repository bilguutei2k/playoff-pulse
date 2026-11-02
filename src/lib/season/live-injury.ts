// The live path of the injury model (v2): full-strength ratings from the adjusted
// replay, seals that carry their availability and v1's number at the same instant, and
// the absences the season simulation and the pages use. Pure and deterministic.

import type { StoredLine } from "@/lib/season/box-scores";
import { daysBetween } from "@/lib/season/dates";
import {
  currentAbsences,
  expectedAbsence,
  lostValue,
  replayInjuryModel,
  simulationAbsences,
  type AvailabilityTracker,
  type CurrentAbsence,
  type GameAvailability,
  type InjuryParams,
  type ReportPoint,
  type StatusTable,
  type SurvivalTable,
} from "@/lib/season/injury-model";
import {
  backToBackFromDates,
  teamGameDatesAround,
  type SealDecision,
} from "@/lib/season/live-state";
import { fingerprint } from "@/lib/season/math";
import {
  advanceDays,
  createFilterState,
  isRatable,
  predictGame,
  ratingsHash,
  replayRatings,
  toRatingState,
  type FilterState,
} from "@/lib/season/ratings";
import type { SimulationAbsences } from "@/lib/season/simulate";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type {
  AbsenceDriver,
  GameContext,
  MarketReference,
  ModelParams,
  PublishedAbsence,
  SealKind,
  SealRow,
  SeasonGame,
} from "@/lib/season/types";

/** Drivers stored per side on a seal. */
export const DRIVERS_PER_SIDE = 3;

export type InjuryModel = {
  params: ModelParams;
  injury: InjuryParams;
  statusTable: StatusTable;
  survival: SurvivalTable;
};

/** Identifies every frozen input of the v2 model, as `paramsHash` does for v1. */
export function injuryModelHash(model: InjuryModel): string {
  return fingerprint(
    JSON.stringify({
      params: model.params,
      injury: model.injury,
      statusTable: model.statusTable,
      survival: model.survival,
    }),
  );
}

export type AvailabilitySource = {
  boxScores: (gameId: string) => Record<string, StoredLine[]> | undefined;
  /** Stored availability of a past game, for the replay. */
  availability: (gameId: string) => GameAvailability | null;
};

export type FullStrengthReplay = {
  state: FilterState;
  tracker: AvailabilityTracker;
  lastGameEtDate: Record<string, string | null>;
  ratingsThroughUtc: string | null;
};

/**
 * Replays every final game in `games` (chronological) with the injury model: margins
 * from 2020-21 on are adjusted for who missed each game, and earlier seasons, which
 * have no box scores, update unadjusted. `throughEtDate` stops before that date, as a
 * seal does; `asOfEtDate` keeps every final and advances time to that date, as the
 * published ratings do. The two are exclusive.
 */
export function replayFullStrength(
  games: readonly SeasonGame[],
  model: InjuryModel,
  source: AvailabilitySource,
  options: { throughEtDate?: string; asOfEtDate?: string } = {},
): FullStrengthReplay {
  if (options.throughEtDate && options.asOfEtDate) {
    throw new Error("Pass either throughEtDate or asOfEtDate, not both.");
  }
  const first = games.find(isRatable);
  const state = createFilterState(model.params);
  const replay = replayInjuryModel({
    games,
    state,
    // The first season starts from the prior, with no off-season roll, as v1 does.
    stateSeason: first?.season ?? 0,
    params: model.params,
    injury: model.injury,
    statusTable: model.statusTable,
    boxScores: source.boxScores,
    availability: source.availability,
    throughEtDate: options.throughEtDate,
  });
  const included = games.filter(
    (game) =>
      isRatable(game) &&
      (options.throughEtDate === undefined || game.etDate < options.throughEtDate),
  );
  const last = included.at(-1);
  if (options.asOfEtDate && last) {
    advanceDays(replay.state, daysBetween(last.etDate, options.asOfEtDate), model.params);
  }
  let ratingsThroughUtc: string | null = null;
  for (const game of included) {
    if (ratingsThroughUtc === null || game.tipUtc > ratingsThroughUtc) ratingsThroughUtc = game.tipUtc;
  }
  return {
    state: replay.state,
    tracker: replay.tracker,
    lastGameEtDate: replay.lastGameEtDate,
    ratingsThroughUtc,
  };
}

export type AbsenceDetail = {
  /** Expected Game Score lost, exactly as `expectedAbsence` computes it. */
  absence: number;
  /** Every listed player who adds to it, largest first, in points. */
  drivers: AbsenceDriver[];
};

/** A team's expected absence from one report, with the players behind it. */
export function absenceDetail(
  point: ReportPoint | null,
  teamId: string,
  tracker: AvailabilityTracker,
  model: InjuryModel,
  nameOf: (athleteId: string) => string | undefined,
): AbsenceDetail {
  const absence = expectedAbsence(point, teamId, tracker.book, model.statusTable, model.injury);
  const drivers: AbsenceDriver[] = [];
  for (const row of point?.rows ?? []) {
    if (row.teamId !== teamId || row.athleteId === null) continue;
    const lost = model.statusTable[row.status] * lostValue(tracker.book, row.athleteId, model.injury);
    if (lost <= 0) continue;
    drivers.push({
      athleteId: row.athleteId,
      name: nameOf(row.athleteId) ?? row.athleteId,
      status: row.status,
      points: model.injury.beta * lost,
    });
  }
  drivers.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return { absence, drivers };
}

export type ReportInUse = {
  point: ReportPoint | null;
  stale: boolean;
  missing: boolean;
};

export type InjurySealDecision = SealDecision & { kind: SealKind };

export type InjurySealContext = {
  /** Every earlier season, chronological. */
  history: readonly SeasonGame[];
  seasonGames: readonly SeasonGame[];
  model: InjuryModel;
  modelVersion: string;
  referenceModelVersion: string;
  runId: string;
  nowIso: string;
  source: AvailabilitySource;
  /** The report this run seals with. */
  report: ReportInUse;
  nameOf: (athleteId: string) => string | undefined;
  marketFor: (gameId: string) => MarketReference | null;
};

const round = (value: number, digits: number) => Number(value.toFixed(digits));

function sealContext(game: SeasonGame, seasonGames: readonly SeasonGame[]): GameContext {
  const dates = teamGameDatesAround(seasonGames, game.etDate);
  return {
    homeId: game.homeId,
    awayId: game.awayId,
    neutral: game.neutral,
    playoff: game.kind === "playoff",
    homeOnBackToBack: backToBackFromDates(dates[game.homeId], game.etDate),
    awayOnBackToBack: backToBackFromDates(dates[game.awayId], game.etDate),
  };
}

/**
 * Prices v2 seals from full-strength ratings frozen at the end of the previous ET date,
 * with the expected absences from the report in use. Each row also carries v1's number,
 * recomputed from v1's own plain replay at the same instant, never copied from a v1 row.
 */
export function sealInjuryGames(
  decisions: readonly InjurySealDecision[],
  context: InjurySealContext,
): SealRow[] {
  const rows: SealRow[] = [];
  const allGames = [...context.history, ...context.seasonGames];
  const byDate = new Map<string, { full: FullStrengthReplay; plain: FilterState }>();
  const hash = injuryModelHash(context.model);
  const { model, report } = context;
  for (const decision of decisions) {
    const { game } = decision;
    let frozen = byDate.get(game.etDate);
    if (!frozen) {
      frozen = {
        full: replayFullStrength(allGames, model, context.source, { throughEtDate: game.etDate }),
        plain: replayRatings(allGames, model.params, {
          isIncluded: (row) => row.etDate < game.etDate,
          asOfEtDate: game.etDate,
        }).state,
      };
      byDate.set(game.etDate, frozen);
    }
    const point = report.missing ? null : report.point;
    const home = absenceDetail(point, game.homeId, frozen.full.tracker, model, context.nameOf);
    const away = absenceDetail(point, game.awayId, frozen.full.tracker, model, context.nameOf);
    const gameContext = sealContext(game, context.seasonGames);
    const prediction = predictGame(
      frozen.full.state,
      gameContext,
      model.params,
      -model.injury.beta * (home.absence - away.absence),
    );
    const reference = predictGame(frozen.plain, gameContext, model.params);
    const top = (detail: AbsenceDetail) =>
      detail.drivers
        .slice(0, DRIVERS_PER_SIDE)
        .map((driver) => ({ ...driver, points: round(driver.points, 3) }));
    rows.push({
      type: "seal",
      gameId: game.id,
      etDate: game.etDate,
      tipUtc: game.tipUtc,
      issuedAt: context.nowIso,
      modelVersion: context.modelVersion,
      paramsHash: hash,
      ratingsHash: ratingsHash(toRatingState(frozen.full.state)),
      homeId: game.homeId,
      awayId: game.awayId,
      homeWinProbability: round(prediction.homeWinProbability, 6),
      expectedMargin: round(prediction.expectedMargin, 4),
      inputsIncomplete: decision.inputsIncomplete,
      missingGameIds: decision.missingGameIds,
      runId: context.runId,
      market: context.marketFor(game.id),
      sealKind: decision.kind,
      reportAt: point?.at ?? null,
      availabilityStale: report.stale,
      availabilityMissing: report.missing,
      absence: { home: round(home.absence, 4), away: round(away.absence, 4) },
      absencePoints: {
        home: round(model.injury.beta * home.absence, 3),
        away: round(model.injury.beta * away.absence, 3),
      },
      drivers: { home: top(home), away: top(away) },
      referenceModelVersion: context.referenceModelVersion,
      referenceHomeWinProbability: round(reference.homeWinProbability, 6),
    });
  }
  return rows;
}

/**
 * Regular-season games still to be simulated, per team, counted exactly as the
 * simulator orders them: scheduled or in progress (live scores never reach it).
 */
export function pendingRegularGames(games: readonly SeasonGame[]): Record<string, number> {
  const pending: Record<string, number> = {};
  for (const team of SEASON_TEAMS) pending[team.id] = 0;
  for (const game of games) {
    if (game.kind !== "regular") continue;
    if (game.status !== "scheduled" && game.status !== "in-progress") continue;
    pending[game.homeId] += 1;
    pending[game.awayId] += 1;
  }
  return pending;
}

/**
 * A report from an earlier season says nothing about who is out now, but the replay
 * keeps each team's latest rows across the off-season. Forgets them for any team that
 * has no finished game this season with both a box score and a report, which is where
 * the replay takes a team's latest rows from. Rotation-based absences (missed the last
 * game) are unaffected; those restart each season in the engine already.
 */
export function forgetEarlierSeasonReports(
  tracker: AvailabilityTracker,
  seasonGames: readonly SeasonGame[],
  source: AvailabilitySource,
): void {
  const current = new Set<string>();
  for (const game of seasonGames) {
    if (!isRatable(game) || !source.availability(game.id)?.final) continue;
    const box = source.boxScores(game.id);
    if (!box?.[game.homeId] || !box[game.awayId]) continue;
    current.add(game.homeId);
    current.add(game.awayId);
  }
  for (const team of SEASON_TEAMS) {
    if (!current.has(team.id)) tracker.latestRows.delete(team.id);
  }
}

/**
 * Makes the run's report the latest word on the teams it covers whose game has not
 * finished. Teams whose game is final already took that game's report in the replay.
 */
export function applyLatestReport(
  tracker: AvailabilityTracker,
  point: ReportPoint | null,
  teamIds: Iterable<string>,
): void {
  if (!point) return;
  for (const teamId of teamIds) {
    tracker.latestRows.set(
      teamId,
      point.rows.filter((row) => row.teamId === teamId),
    );
  }
}

export type SeasonAvailability = {
  current: CurrentAbsence[];
  simulation: SimulationAbsences;
  /** Points each team gives up in its next simulated game. */
  absencePoints: Record<string, number>;
};

/** Current absences, spread over each team's pending games and its postseason. */
export function seasonAvailability(
  tracker: AvailabilityTracker,
  model: InjuryModel,
  games: readonly SeasonGame[],
): SeasonAvailability {
  const current = currentAbsences(tracker, model.injury, model.survival);
  const pending = pendingRegularGames(games);
  const simulation = simulationAbsences(current, pending);
  const absencePoints: Record<string, number> = {};
  for (const team of SEASON_TEAMS) {
    absencePoints[team.id] =
      pending[team.id] > 0
        ? simulation.regular[team.id][0]
        : simulation.postseason[team.id];
  }
  return { current, simulation, absencePoints };
}

/**
 * Current absences with names, statuses and reasons, largest first within each team.
 * Players worth less than a thousandth of a point are left out of the list; they still
 * count, to the same rounding, in the team's published points and the simulation.
 */
export function publishAbsences(
  current: readonly CurrentAbsence[],
  tracker: AvailabilityTracker,
  nameOf: (athleteId: string) => string | undefined,
): PublishedAbsence[] {
  const order = new Map(SEASON_TEAMS.map((team, index) => [team.id, index]));
  return current
    .map((absence) => {
      const row = tracker.latestRows
        .get(absence.teamId)
        ?.find((entry) => entry.athleteId === absence.athleteId);
      return {
        teamId: absence.teamId,
        athleteId: absence.athleteId,
        name: nameOf(absence.athleteId) ?? absence.athleteId,
        status: row?.status ?? null,
        reason: row?.reason ?? null,
        class: absence.class,
        gamesMissed: absence.gamesMissed,
        expectedGames: round(absence.expectedGames, 2),
        points: round(absence.points, 3),
      };
    })
    .filter((absence) => absence.points > 0)
    .sort(
      (a, b) =>
        (order.get(a.teamId) ?? 0) - (order.get(b.teamId) ?? 0) ||
        b.points - a.points ||
        a.name.localeCompare(b.name),
    );
}
