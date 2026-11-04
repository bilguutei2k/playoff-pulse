// Projections for games that have no seal yet. The site shows the job's published
// projections with the injury term (`getProjections`, src/lib/season/projections.ts)
// for every game they cover: the next seven days. This file keeps the older number, the
// published full-strength ratings priced with `predictGame`, home court and back-to-back
// from the schedule and no injury term, only as the fallback for a game the published
// file does not cover (it is not published, or the game is more than a week away).
// Neither kind ever enters the ledger or the record, is scored or is compared to the
// market. `scripts/verify/live-checks.ts` checks every one the site can show.

import { backToBackFromDates } from "@/lib/season/live-state";
import type { GameProjection, ProjectionBasis, ProjectionsFile } from "@/lib/season/projections";
import { predictGame } from "@/lib/season/ratings";
import type { AbsenceDriver, LiveState, SeasonGame } from "@/lib/season/types";

export const PROJECTION_LABEL =
  "Projection from current ratings, before injuries. The sealed forecast is issued on game day.";

export type Projection = {
  homeWinProbability: number;
  awayWinProbability: number;
  /** Expected home margin in points. */
  expectedMargin: number;
  homeOnBackToBack: boolean;
  awayOnBackToBack: boolean;
};

/** A projection as the pages show it: the published one with the injury term, or the fallback without it. */
export type ShownProjection = Projection & {
  /** True for the job's published projection; false for the fallback from ratings alone, before injuries. */
  withInjuries: boolean;
  /** Null on the fallback. */
  basis: ProjectionBasis | null;
  absencePoints: { home: number; away: number } | null;
  unfiled: { home: boolean; away: boolean } | null;
  drivers: { home: AbsenceDriver[]; away: AbsenceDriver[] } | null;
};

/** The published projection for one game, or null when the file is missing or does not cover it. */
export function publishedProjection(file: ProjectionsFile | null, gameId: string): GameProjection | null {
  return file?.games.find((game) => game.gameId === gameId) ?? null;
}

export function fromPublished(projection: GameProjection): ShownProjection {
  return {
    homeWinProbability: projection.homeWinProbability,
    awayWinProbability: projection.awayWinProbability,
    expectedMargin: projection.expectedMargin,
    homeOnBackToBack: projection.homeOnBackToBack,
    awayOnBackToBack: projection.awayOnBackToBack,
    withInjuries: true,
    basis: projection.basis,
    absencePoints: projection.absencePoints,
    unfiled: projection.unfiled,
    drivers: projection.drivers,
  };
}

export function withoutInjuries(projection: Projection): ShownProjection {
  return { ...projection, withInjuries: false, basis: null, absencePoints: null, unfiled: null, drivers: null };
}

type ProjectableGame = Pick<SeasonGame, "homeId" | "awayId" | "neutral" | "kind" | "etDate">;

/**
 * Each team's scheduled ET dates, from the published state's window plus the games
 * store, so a back-to-back weeks ahead is still seen. Postponed and canceled games
 * are not dates a team plays.
 */
export function scheduleDates(
  state: Pick<LiveState, "teamGameDates">,
  games: readonly SeasonGame[],
): Record<string, string[]> {
  const dates: Record<string, Set<string>> = {};
  for (const [teamId, list] of Object.entries(state.teamGameDates)) {
    dates[teamId] = new Set(list);
  }
  for (const game of games) {
    if (game.status === "postponed" || game.status === "canceled") continue;
    (dates[game.homeId] ??= new Set()).add(game.etDate);
    (dates[game.awayId] ??= new Set()).add(game.etDate);
  }
  return Object.fromEntries(
    Object.entries(dates).map(([teamId, set]) => [teamId, [...set].sort()]),
  );
}

export function projectGame(
  state: Pick<LiveState, "ratings" | "params">,
  game: ProjectableGame,
  teamDates: Record<string, readonly string[]>,
): Projection {
  const homeOnBackToBack = backToBackFromDates(teamDates[game.homeId] ?? [], game.etDate);
  const awayOnBackToBack = backToBackFromDates(teamDates[game.awayId] ?? [], game.etDate);
  const prediction = predictGame(
    state.ratings,
    {
      homeId: game.homeId,
      awayId: game.awayId,
      neutral: game.neutral,
      playoff: game.kind === "playoff",
      homeOnBackToBack,
      awayOnBackToBack,
    },
    state.params,
  );
  return {
    homeWinProbability: prediction.homeWinProbability,
    awayWinProbability: 1 - prediction.homeWinProbability,
    expectedMargin: prediction.expectedMargin,
    homeOnBackToBack,
    awayOnBackToBack,
  };
}

/** Only games that have not started, from the published slate's date on, are projected. */
export function isProjectable(game: Pick<SeasonGame, "status" | "etDate">, firstEtDate: string): boolean {
  return game.status === "scheduled" && game.etDate >= firstEtDate;
}
