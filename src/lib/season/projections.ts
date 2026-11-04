// Projections with the injury term for every scheduled game in the next seven days, and
// each team's injury list for its next game. Pure and deterministic.
//
// A projection is never a seal. It never enters the ledger or the record, is never
// scored, and is never compared to the market. The job publishes them in
// data/live/site/{seasonLabel}/projections.json and team-injuries.json; the site reads
// them through `src/lib/live-data/published.ts`.
//
// The number: the published full-strength ratings (`state.ratings`), home court and
// back-to-back exactly as a seal computes them, plus the injury term. The term, per side:
//   - for a game on a slate with a usable report (the current slate's report in use, or
//     the next ET date's latest usable report), exactly the seal rules: listed players by
//     status, and a side the report marks NOT YET SUBMITTED counts its current absences
//     for its next game (`absenceDetail` / `nextGameAbsenceDetail`, as `sealInjuryGames`);
//   - for every other game, the team's expected absence from current absences: the
//     season simulation's charge for that pending game (`simulationAbsences`).

import type { StatusCode } from "@/lib/season/availability";
import {
  lostValue,
  simulationAbsences,
  type AvailabilityTracker,
  type CurrentAbsence,
  type ReportPoint,
} from "@/lib/season/injury-model";
import {
  absenceDetail,
  nextGameAbsenceDetail,
  pendingRegularGames,
  unfiledOn,
  type InjuryModel,
} from "@/lib/season/live-injury";
import { backToBackFromDates, teamGameDatesAround } from "@/lib/season/live-state";
import { addDays } from "@/lib/season/dates";
import { predictGame } from "@/lib/season/ratings";
import type { AbsenceDriver, GameContext, LedgerRow, ModelParams, SeasonGame } from "@/lib/season/types";

/** Scheduled games from the slate's date through six days later are projected. */
export const PROJECTION_WINDOW_DAYS = 7;

export const PROJECTION_WITH_INJURIES_LABEL =
  "Projection, not a sealed forecast: current ratings, home court, rest and the injury term. Never scored.";

export type ProjectionBasis =
  /** The seal rules on a stored report: the current slate's report in use, or the next ET date's. */
  | { kind: "report"; reportAt: string; stale: boolean }
  /** The season simulation's charge for this pending game, from current absences. */
  | { kind: "current-absences" };

export type GameProjection = {
  gameId: string;
  etDate: string;
  tipUtc: string;
  homeId: string;
  awayId: string;
  neutral: boolean;
  kind: SeasonGame["kind"];
  /** Six decimals; the site shows one. */
  homeWinProbability: number;
  awayWinProbability: number;
  /** Expected home margin with the injury term, four decimals. */
  expectedMargin: number;
  homeOnBackToBack: boolean;
  awayOnBackToBack: boolean;
  basis: ProjectionBasis;
  /** Points of margin each side gives up to expected absences, three decimals. */
  absencePoints: { home: number; away: number };
  /** Sides the report in use marks NOT YET SUBMITTED; always false on `current-absences`. */
  unfiled: { home: boolean; away: boolean };
  /** Every player with positive points on each side, largest first; they add up to absencePoints. */
  drivers: { home: AbsenceDriver[]; away: AbsenceDriver[] };
  driversComplete: true;
};

export type ProjectionsFile = {
  version: 1;
  season: number;
  seasonLabel: string;
  modelVersion: string;
  label: string;
  /** The published state's slate: the first date projected. */
  fromEtDate: string;
  throughEtDate: string;
  /** The published ratings every projection uses: `state.ratingsHash`, `state.ratingsThroughUtc`. */
  ratingsHash: string;
  ratingsThroughUtc: string | null;
  /** Tip order. */
  games: GameProjection[];
};

/** A slate whose games are priced on a stored report, by the seal rules. */
export type SlateReport = {
  etDate: string;
  point: ReportPoint & { printed?: readonly string[] };
  /** The run could not confirm a newer report and used the last good one. */
  stale: boolean;
};

export type ProjectionInput = {
  season: number;
  seasonLabel: string;
  modelVersion: string;
  /** The season's games in `compareGames` order (tip, then ID), as the simulator gets them. */
  games: readonly SeasonGame[];
  fromEtDate: string;
  ratings: { mean: ArrayLike<number>; cov: ArrayLike<number> };
  ratingsHash: string;
  ratingsThroughUtc: string | null;
  params: ModelParams;
  model: InjuryModel;
  /** The published replay's tracker, with the run's report applied as the state's is. */
  tracker: AvailabilityTracker;
  /** Current absences, as the published season simulation uses them. */
  current: readonly CurrentAbsence[];
  reports: readonly SlateReport[];
  nameOf: (athleteId: string) => string | undefined;
};

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/**
 * Each pending game's place among each team's pending regular-season games, counted
 * exactly as the season simulation orders them (scheduled or in progress, by tip, ties in
 * input order), which is the index of its charge in `simulationAbsences(...).regular`.
 */
export function pendingOrdinals(games: readonly SeasonGame[]): Map<string, { home: number; away: number }> {
  const pending = games
    .filter((game) => game.kind === "regular" && (game.status === "scheduled" || game.status === "in-progress"))
    .sort((a, b) => Date.parse(a.tipUtc) - Date.parse(b.tipUtc));
  const counts = new Map<string, number>();
  const next = (teamId: string) => {
    const ordinal = counts.get(teamId) ?? 0;
    counts.set(teamId, ordinal + 1);
    return ordinal;
  };
  const output = new Map<string, { home: number; away: number }>();
  for (const game of pending) {
    // The simulator charges the away side first; the order within a game does not matter.
    const away = next(game.awayId);
    const home = next(game.homeId);
    output.set(game.id, { home, away });
  }
  return output;
}

/** Home court and rest exactly as a seal sets them. */
export function projectionContext(game: SeasonGame, games: readonly SeasonGame[]): GameContext {
  const dates = teamGameDatesAround(games, game.etDate);
  return {
    homeId: game.homeId,
    awayId: game.awayId,
    neutral: game.neutral,
    playoff: game.kind === "playoff",
    homeOnBackToBack: backToBackFromDates(dates[game.homeId], game.etDate),
    awayOnBackToBack: backToBackFromDates(dates[game.awayId], game.etDate),
  };
}

/** One side's injury term with every player behind it, and why each is counted. */
export type SideTerm = {
  absencePoints: number;
  unfiled: boolean;
  drivers: AbsenceDriver[];
};

function sortDrivers(drivers: AbsenceDriver[]): AbsenceDriver[] {
  return drivers.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

/** The seal rules on a report: listed players by status, an unfiled side by current absences. */
export function reportSideTerm(
  point: ReportPoint,
  teamId: string,
  tracker: AvailabilityTracker,
  model: InjuryModel,
  nameOf: (athleteId: string) => string | undefined,
): SideTerm {
  const unfiled = unfiledOn(point, teamId);
  const detail = (unfiled ? nextGameAbsenceDetail : absenceDetail)(point, teamId, tracker, model, nameOf);
  return { absencePoints: model.injury.beta * detail.absence, unfiled, drivers: detail.drivers };
}

/** The season simulation's charge for one pending game: regular-season ordinal, or a postseason game. */
export function currentAbsenceSideTerm(
  current: readonly CurrentAbsence[],
  teamId: string,
  pending: Record<string, number>,
  ordinal: number | "postseason",
  tracker: AvailabilityTracker,
  nameOf: (athleteId: string) => string | undefined,
): SideTerm {
  const team = current.filter((absence) => absence.teamId === teamId);
  const charge = (absences: readonly CurrentAbsence[]) => {
    const spread = simulationAbsences(absences, pending);
    return ordinal === "postseason" ? spread.postseason[teamId] : (spread.regular[teamId][ordinal] ?? 0);
  };
  const rows = tracker.latestRows.get(teamId) ?? [];
  const drivers = sortDrivers(
    team
      .map((absence) => ({
        athleteId: absence.athleteId,
        name: nameOf(absence.athleteId) ?? absence.athleteId,
        status: rows.find((row) => row.athleteId === absence.athleteId)?.status ?? null,
        points: charge([absence]),
      }))
      .filter((driver) => driver.points > 0),
  );
  return { absencePoints: charge(team), unfiled: false, drivers };
}

/** Everything both outputs need to price one side of one game. */
function sideTermFor(
  input: ProjectionInput,
  game: SeasonGame,
  teamId: string,
  ordinals: Map<string, { home: number; away: number }>,
  pending: Record<string, number>,
): { basis: ProjectionBasis; term: SideTerm; report: SlateReport | null } {
  const report = input.reports.find((entry) => entry.etDate === game.etDate) ?? null;
  if (report) {
    return {
      basis: { kind: "report", reportAt: report.point.at, stale: report.stale },
      term: reportSideTerm(report.point, teamId, input.tracker, input.model, input.nameOf),
      report,
    };
  }
  const place = ordinals.get(game.id);
  const ordinal: number | "postseason" =
    game.kind === "regular" && place ? (teamId === game.homeId ? place.home : place.away) : "postseason";
  return {
    basis: { kind: "current-absences" },
    term: currentAbsenceSideTerm(input.current, teamId, pending, ordinal, input.tracker, input.nameOf),
    report: null,
  };
}

/** Is this game projected: scheduled, and within the window from the slate's date? */
export function isInProjectionWindow(game: Pick<SeasonGame, "status" | "etDate">, fromEtDate: string): boolean {
  return (
    game.status === "scheduled" &&
    game.etDate >= fromEtDate &&
    game.etDate <= addDays(fromEtDate, PROJECTION_WINDOW_DAYS - 1)
  );
}

const roundDrivers = (drivers: readonly AbsenceDriver[]) =>
  drivers.map((driver) => ({ ...driver, points: round(driver.points, 3) }));

export function projectUpcomingGames(input: ProjectionInput): ProjectionsFile {
  const ordinals = pendingOrdinals(input.games);
  const pending = pendingRegularGames(input.games);
  const games: GameProjection[] = [];
  for (const game of input.games) {
    if (!isInProjectionWindow(game, input.fromEtDate)) continue;
    const home = sideTermFor(input, game, game.homeId, ordinals, pending);
    const away = sideTermFor(input, game, game.awayId, ordinals, pending);
    const absencePoints = { home: round(home.term.absencePoints, 3), away: round(away.term.absencePoints, 3) };
    const context = projectionContext(game, input.games);
    const prediction = predictGame(input.ratings, context, input.params, -(absencePoints.home - absencePoints.away));
    const homeWinProbability = round(prediction.homeWinProbability, 6);
    games.push({
      gameId: game.id,
      etDate: game.etDate,
      tipUtc: game.tipUtc,
      homeId: game.homeId,
      awayId: game.awayId,
      neutral: game.neutral,
      kind: game.kind,
      homeWinProbability,
      awayWinProbability: round(1 - homeWinProbability, 6),
      expectedMargin: round(prediction.expectedMargin, 4),
      homeOnBackToBack: context.homeOnBackToBack,
      awayOnBackToBack: context.awayOnBackToBack,
      basis: home.basis,
      absencePoints,
      unfiled: { home: home.term.unfiled, away: away.term.unfiled },
      drivers: { home: roundDrivers(home.term.drivers), away: roundDrivers(away.term.drivers) },
      driversComplete: true,
    });
  }
  return {
    version: 1,
    season: input.season,
    seasonLabel: input.seasonLabel,
    modelVersion: input.modelVersion,
    label: PROJECTION_WITH_INJURIES_LABEL,
    fromEtDate: input.fromEtDate,
    throughEtDate: addDays(input.fromEtDate, PROJECTION_WINDOW_DAYS - 1),
    ratingsHash: input.ratingsHash,
    ratingsThroughUtc: input.ratingsThroughUtc,
    games,
  };
}

// ---------------------------------------------------------------------------
// Team injury lists
// ---------------------------------------------------------------------------

export type TeamInjuryRow = {
  /** Null for a printed name that matched nobody; such a player counts zero. */
  athleteId: string | null;
  name: string;
  /**
   * "report": on the report covering the next game. "box-score": missed the team's last
   * game (consecutive games in `gamesMissed`) and is not on that report. "earlier-report":
   * listed Out or Doubtful on the team's latest earlier report and not on a covering one.
   */
  source: "report" | "box-score" | "earlier-report";
  /** Status on the covering report, or on the earlier report; null if never listed. */
  status: StatusCode | null;
  reason: string | null;
  /** Consecutive team games missed so far, from box scores. */
  gamesMissed: number;
  /** Points of margin the model charges for him in the next game, three decimals. */
  points: number;
};

export type TeamInjuryList = {
  teamId: string;
  nextGame: { gameId: string; etDate: string; tipUtc: string; opponentId: string; home: boolean } | null;
  /** How the next game's injury term is computed; the same basis as its projection. Null without a next game. */
  basis: ProjectionBasis | null;
  /** The report covering the next game, when its slate has a usable one. */
  report: { at: string; file: string; stale: boolean } | null;
  /**
   * On that report: "filed" (players listed), "not-yet-submitted", or "not-listed" (the
   * team is not on it, which means nobody listed). Null without a covering report.
   */
  filing: "filed" | "not-yet-submitted" | "not-listed" | null;
  /** The model's points for the next game; equal to that side of its projection. */
  absencePoints: number;
  /** Report rows first in report order, then everyone else the model counts or tracks, most points first. */
  rows: TeamInjuryRow[];
};

export type TeamInjuriesFile = {
  version: 1;
  season: number;
  seasonLabel: string;
  modelVersion: string;
  /** Every team, in `SEASON_TEAMS` order. */
  teams: TeamInjuryList[];
};

/**
 * Each team's list for its next scheduled game (from the slate's date on), priced by the
 * same rule as that game's projection. `files` maps a slate's report header time to the
 * file it came from.
 */
export function teamInjuryLists(
  input: ProjectionInput & { teamIds: readonly string[]; reportFile: (etDate: string) => string | null },
): TeamInjuriesFile {
  const ordinals = pendingOrdinals(input.games);
  const pending = pendingRegularGames(input.games);
  const book = input.tracker.book;
  const teams: TeamInjuryList[] = input.teamIds.map((teamId) => {
    const game =
      input.games.find(
        (entry) =>
          entry.status === "scheduled" &&
          entry.etDate >= input.fromEtDate &&
          (entry.homeId === teamId || entry.awayId === teamId),
      ) ?? null;
    if (!game) {
      return { teamId, nextGame: null, basis: null, report: null, filing: null, absencePoints: 0, rows: [] };
    }
    const home = game.homeId === teamId;
    const { basis, term, report } = sideTermFor(input, game, teamId, ordinals, pending);
    const driverPoints = new Map(term.drivers.map((driver) => [driver.athleteId, driver.points]));
    const missed = (athleteId: string) => input.tracker.missed.get(`${teamId}:${athleteId}`) ?? 0;
    const rows: TeamInjuryRow[] = [];
    const listed = new Set<string>();
    let filing: TeamInjuryList["filing"] = null;
    if (report) {
      const { point } = report;
      const teamRows = point.rows
        .map((row, index) => ({ row, printed: point.printed?.[index] ?? null }))
        .filter(({ row }) => row.teamId === teamId);
      filing = unfiledOn(point, teamId) ? "not-yet-submitted" : teamRows.length > 0 ? "filed" : "not-listed";
      for (const { row, printed } of teamRows) {
        if (row.athleteId !== null) listed.add(row.athleteId);
        rows.push({
          athleteId: row.athleteId,
          name: (row.athleteId !== null ? input.nameOf(row.athleteId) : undefined) ?? printed ?? row.athleteId ?? "Unknown",
          source: "report",
          status: row.status,
          reason: row.reason,
          gamesMissed: row.athleteId !== null ? missed(row.athleteId) : 0,
          points:
            row.athleteId === null
              ? 0
              : round(input.model.statusTable[row.status] * input.model.injury.beta * lostValue(book, row.athleteId, input.model.injury), 3),
        });
      }
    }
    // Everyone else the model counts for this game, then players who missed the last game
    // and are not on the covering report, who count zero when the team has filed.
    const others = new Map<string, TeamInjuryRow>();
    const earlier = input.tracker.latestRows.get(teamId) ?? [];
    for (const driver of term.drivers) {
      if (listed.has(driver.athleteId)) continue;
      const earlierRow = report ? undefined : earlier.find((row) => row.athleteId === driver.athleteId);
      others.set(driver.athleteId, {
        athleteId: driver.athleteId,
        name: driver.name,
        source: missed(driver.athleteId) > 0 ? "box-score" : "earlier-report",
        status: earlierRow?.status ?? null,
        reason: earlierRow?.reason ?? null,
        gamesMissed: missed(driver.athleteId),
        points: round(driverPoints.get(driver.athleteId) ?? 0, 3),
      });
    }
    const prefix = `${teamId}:`;
    for (const [key, games] of input.tracker.missed) {
      if (!key.startsWith(prefix) || games <= 0) continue;
      const athleteId = key.slice(prefix.length);
      if (listed.has(athleteId) || others.has(athleteId)) continue;
      if (book.get(athleteId)?.lastTeamId !== teamId) continue;
      if (lostValue(book, athleteId, input.model.injury) <= 0) continue;
      const earlierRow = report ? undefined : earlier.find((row) => row.athleteId === athleteId);
      others.set(athleteId, {
        athleteId,
        name: input.nameOf(athleteId) ?? athleteId,
        source: "box-score",
        status: earlierRow?.status ?? null,
        reason: earlierRow?.reason ?? null,
        gamesMissed: games,
        points: 0,
      });
    }
    rows.push(
      ...[...others.values()].sort((a, b) => b.points - a.points || b.gamesMissed - a.gamesMissed || a.name.localeCompare(b.name)),
    );
    return {
      teamId,
      nextGame: { gameId: game.id, etDate: game.etDate, tipUtc: game.tipUtc, opponentId: home ? game.awayId : game.homeId, home },
      basis,
      report: report ? { at: report.point.at, file: input.reportFile(game.etDate) ?? "", stale: report.stale } : null,
      filing,
      absencePoints: round(term.absencePoints, 3),
      rows,
    };
  });
  return {
    version: 1,
    season: input.season,
    seasonLabel: input.seasonLabel,
    modelVersion: input.modelVersion,
    teams,
  };
}

// ---------------------------------------------------------------------------
// Invariants, shared by the job (before it writes) and `verify:live` (after)
// ---------------------------------------------------------------------------

/** Keys only a projection carries. None may ever appear on a ledger row. */
export const PROJECTION_ONLY_KEYS = ["basis", "awayWinProbability", "fromEtDate", "throughEtDate"] as const;

/**
 * Every rule a published projections file must satisfy against the ratings, parameters
 * and games it was computed from, and the ledger it must stay out of. Empty when it does.
 */
export function projectionProblems(
  file: ProjectionsFile,
  context: {
    ratings: { mean: ArrayLike<number>; cov: ArrayLike<number> };
    params: ModelParams;
    games: readonly SeasonGame[];
    ledger: readonly LedgerRow[];
  },
): string[] {
  const problems: string[] = [];
  const byId = new Map(context.games.map((game) => [game.id, game]));
  for (const projection of file.games) {
    const id = projection.gameId;
    const p = projection.homeWinProbability;
    if (!(p > 0 && p < 1) || !(projection.awayWinProbability > 0 && projection.awayWinProbability < 1)) {
      problems.push(`projection ${id}: probabilities must be strictly between 0 and 1`);
    }
    if (Math.abs(p + projection.awayWinProbability - 1) > 1e-9) problems.push(`projection ${id}: home and away must sum to 1`);
    const { home, away } = projection.absencePoints;
    if (!(home >= 0 && away >= 0)) problems.push(`projection ${id}: absence points must be at least 0`);
    for (const side of ["home", "away"] as const) {
      const drivers = projection.drivers[side];
      const total = drivers.reduce((sum, driver) => sum + driver.points, 0);
      if (Math.abs(total - projection.absencePoints[side]) > 0.01) {
        problems.push(`projection ${id}: ${side} drivers add up to ${total.toFixed(3)}, not ${projection.absencePoints[side]}`);
      }
      if (drivers.some((driver) => !(driver.points >= 0))) problems.push(`projection ${id}: ${side} driver points must be at least 0`);
    }
    if (projection.driversComplete !== true) problems.push(`projection ${id}: drivers must be complete`);
    if (projection.basis.kind === "current-absences" && (projection.unfiled.home || projection.unfiled.away)) {
      problems.push(`projection ${id}: only a report can mark a side unfiled`);
    }
    const game = byId.get(id);
    if (!game) {
      problems.push(`projection ${id}: not a game of the season`);
      continue;
    }
    if (!isInProjectionWindow(game, file.fromEtDate)) problems.push(`projection ${id}: not a scheduled game in the window`);
    const contextFor = projectionContext(game, context.games);
    if (contextFor.homeOnBackToBack !== projection.homeOnBackToBack || contextFor.awayOnBackToBack !== projection.awayOnBackToBack) {
      problems.push(`projection ${id}: rest differs from the schedule`);
    }
    const priced = (adjustment: number) => predictGame(context.ratings, contextFor, context.params, adjustment).homeWinProbability;
    const recomputed = priced(-(home - away));
    if (Math.abs(recomputed - p) > 1e-6) problems.push(`projection ${id}: does not come from the published ratings and its injury term`);
    const healthy = priced(0);
    if (home > 0 && !(priced(-home) < healthy)) problems.push(`projection ${id}: home absences must lower the home chance`);
    if (away > 0 && !(priced(away) > healthy)) problems.push(`projection ${id}: away absences must lower the away chance`);
  }
  const expected = context.games.filter((game) => isInProjectionWindow(game, file.fromEtDate)).length;
  if (file.games.length !== expected) problems.push(`projections cover ${file.games.length} of ${expected} scheduled games in the window`);
  for (const row of context.ledger) {
    const keys = Object.keys(row);
    const leaked = PROJECTION_ONLY_KEYS.filter((key) => keys.includes(key));
    if (leaked.length > 0) problems.push(`ledger row for ${row.gameId} carries projection key(s) ${leaked.join(", ")}`);
    if ((row as { type: string }).type === "projection") problems.push(`ledger row for ${row.gameId} is a projection`);
  }
  return problems;
}

/** Team lists must match their projections, count only non-negative points, and cover every team. */
export function teamInjuryProblems(file: TeamInjuriesFile, projections: ProjectionsFile, teamIds: readonly string[]): string[] {
  const problems: string[] = [];
  if (file.teams.map((team) => team.teamId).join(",") !== teamIds.join(",")) problems.push("team injury lists must cover every team in order");
  const byGame = new Map(projections.games.map((game) => [game.gameId, game]));
  for (const team of file.teams) {
    const label = `team ${team.teamId} injury list`;
    if (team.rows.some((row) => !(row.points >= 0))) problems.push(`${label}: points must be at least 0`);
    if (!team.nextGame) {
      if (team.rows.length > 0 || team.absencePoints !== 0) problems.push(`${label}: rows without a next game`);
      continue;
    }
    const total = team.rows.reduce((sum, row) => sum + row.points, 0);
    if (Math.abs(total - team.absencePoints) > 0.01) problems.push(`${label}: rows add up to ${total.toFixed(3)}, not ${team.absencePoints}`);
    if ((team.basis?.kind === "report") !== (team.report !== null)) problems.push(`${label}: a report basis needs its report`);
    const projection = byGame.get(team.nextGame.gameId);
    if (projection) {
      const side = team.nextGame.home ? "home" : "away";
      if (Math.abs(projection.absencePoints[side] - team.absencePoints) > 1e-9) {
        problems.push(`${label}: ${team.absencePoints} points, its projection ${projection.absencePoints[side]}`);
      }
      if (JSON.stringify(projection.basis) !== JSON.stringify(team.basis)) problems.push(`${label}: basis differs from its projection`);
      if ((team.filing === "not-yet-submitted") !== projection.unfiled[side]) problems.push(`${label}: filing differs from its projection`);
    }
  }
  return problems;
}
