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

/**
 * A team's expected absence for its next game from current absences: exactly what the
 * season simulation charges it for that game. The report in use becomes the team's
 * latest word, as `applyLatestReport` makes it for the published state, so a team that
 * has not filed counts everyone `currentAbsences` carries for it (chiefly players who
 * missed its last game), each weighted by the share of the next game the survival table
 * expects him to miss. The tracker is not changed.
 */
export function nextGameAbsenceDetail(
  point: ReportPoint | null,
  teamId: string,
  tracker: AvailabilityTracker,
  model: InjuryModel,
  nameOf: (athleteId: string) => string | undefined,
): AbsenceDetail {
  const view: AvailabilityTracker = { ...tracker, latestRows: new Map(tracker.latestRows) };
  applyLatestReport(view, point, [teamId]);
  const rows = view.latestRows.get(teamId) ?? [];
  const current = currentAbsences(view, model.injury, model.survival).filter(
    (absence) => absence.teamId === teamId,
  );
  // One pending game: its charge is the simulation's charge for the team's next game,
  // regular season or postseason alike.
  const nextGame = (absences: readonly CurrentAbsence[]) =>
    simulationAbsences(absences, { [teamId]: 1 }).regular[teamId][0];
  const drivers: AbsenceDriver[] = current
    .map((absence) => ({
      athleteId: absence.athleteId,
      name: nameOf(absence.athleteId) ?? absence.athleteId,
      status: rows.find((row) => row.athleteId === absence.athleteId)?.status ?? null,
      points: nextGame([absence]),
    }))
    .filter((driver) => driver.points > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const points = nextGame(current);
  return { absence: model.injury.beta > 0 ? points / model.injury.beta : 0, drivers };
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

/**
 * Whether the report in use marks this team NOT YET SUBMITTED. A team that is simply
 * not on the report is not unfiled: it has nobody listed.
 */
export function unfiledOn(point: ReportPoint | null, teamId: string): boolean {
  return point !== null && point.notSubmitted.includes(teamId);
}

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
 * with the expected absences from the report in use. A side whose team the report marks
 * NOT YET SUBMITTED takes its expected absence for this game from current absences, the
 * charge the season simulation makes for the team's next game. Each row stores every
 * player behind either side's term, and also carries v1's number, recomputed from v1's
 * own plain replay at the same instant, never copied from a v1 row.
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
    const unfiled = {
      home: unfiledOn(point, game.homeId),
      away: unfiledOn(point, game.awayId),
    };
    const sideDetail = (teamId: string, notFiled: boolean) =>
      (notFiled ? nextGameAbsenceDetail : absenceDetail)(
        point,
        teamId,
        frozen.full.tracker,
        model,
        context.nameOf,
      );
    const home = sideDetail(game.homeId, unfiled.home);
    const away = sideDetail(game.awayId, unfiled.away);
    const gameContext = sealContext(game, context.seasonGames);
    // The number comes from the absence terms alone; drivers are only stored beside it.
    const prediction = predictGame(
      frozen.full.state,
      gameContext,
      model.params,
      -model.injury.beta * (home.absence - away.absence),
    );
    const reference = predictGame(frozen.plain, gameContext, model.params);
    const all = (detail: AbsenceDetail) =>
      detail.drivers.map((driver) => ({ ...driver, points: round(driver.points, 3) }));
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
      drivers: { home: all(home), away: all(away) },
      driversComplete: true,
      unfiled,
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
