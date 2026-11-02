// The game page's facts, assembled from a day view's game, its seal rows, the ledger
// and the published state. No new numbers: seals, results and the published forecast
// are read; the margin parts come from `marginBreakdown`; the Brier score is the
// record's own formula for one game.

import { sealKindOf, scoredSeal } from "@/lib/season/live-state";
import type { LiveState, SealRow, SeasonGame } from "@/lib/season/types";
import type { DayGame } from "@/lib/view/day";
import { marginBreakdown, type MarginBreakdown } from "@/lib/view/margin";
import { scheduleDates } from "@/lib/view/projection";
import { gameBrier } from "@/lib/view/record";
import { backToBackFromDates } from "@/lib/season/live-state";

export type VersionSeals = {
  modelVersion: string;
  /** The published model or the reference model beside it. */
  role: "published" | "reference" | "other";
  morning: SealRow | null;
  final: SealRow | null;
  /** The seal this version is scored on, once the game tips. */
  scored: SealRow | null;
};

export type VersionResult = {
  modelVersion: string;
  role: VersionSeals["role"];
  seal: SealRow;
  /** Probability this version gave the team that won. */
  winnerProbability: number;
  brier: number;
};

export type GameDetail = {
  breakdown: MarginBreakdown | null;
  /** Back-to-back flags behind the shown number. */
  homeOnBackToBack: boolean;
  awayOnBackToBack: boolean;
  versions: VersionSeals[];
  results: VersionResult[];
  homeWon: boolean | null;
};

export function buildGameDetail(input: {
  state: LiveState;
  game: DayGame;
  storeGames: readonly SeasonGame[];
}): GameDetail {
  const { state, game, storeGames } = input;
  const dates = scheduleDates(state, storeGames);
  const homeOnBackToBack = backToBackFromDates(dates[game.homeId] ?? [], game.etDate);
  const awayOnBackToBack = backToBackFromDates(dates[game.awayId] ?? [], game.etDate);
  const context = {
    homeId: game.homeId,
    awayId: game.awayId,
    neutral: game.neutral,
    playoff: game.kind === "playoff",
    homeOnBackToBack,
    awayOnBackToBack,
  };

  let breakdown: MarginBreakdown | null = null;
  if (game.forecast) {
    const shownSeal =
      game.forecast.source === "sealed"
        ? game.sealRows.find((row) => row.issuedAt === game.forecast?.issuedAt && row.modelVersion === game.forecast?.modelVersion)
        : undefined;
    breakdown = marginBreakdown({
      state,
      context,
      expectedMargin: game.forecast.expectedMargin,
      absencePoints: game.forecast.absencePoints,
      ratingsHash: shownSeal?.ratingsHash ?? null,
    });
  } else if (game.projection) {
    breakdown = marginBreakdown({
      state,
      context,
      expectedMargin: game.projection.expectedMargin,
      absencePoints: null,
      ratingsHash: null,
    });
  }

  const byVersion = new Map<string, SealRow[]>();
  for (const row of game.sealRows) {
    byVersion.set(row.modelVersion, [...(byVersion.get(row.modelVersion) ?? []), row]);
  }
  const role = (version: string): VersionSeals["role"] =>
    version === state.modelVersion ? "published" : version === state.referenceModelVersion ? "reference" : "other";
  const order = { published: 0, reference: 1, other: 2 };
  const tipped = game.status === "in-progress" || game.status === "final";
  const versions: VersionSeals[] = [...byVersion.entries()]
    .map(([modelVersion, rows]) => ({
      modelVersion,
      role: role(modelVersion),
      morning: rows.find((row) => sealKindOf(row) === "morning") ?? null,
      final: rows.find((row) => sealKindOf(row) === "final") ?? null,
      scored: tipped ? scoredSeal(rows) : null,
    }))
    .sort((a, b) => order[a.role] - order[b.role]);

  let homeWon: boolean | null = null;
  const results: VersionResult[] = [];
  if (game.status === "final" && game.homeScore !== null && game.awayScore !== null) {
    homeWon = game.homeScore > game.awayScore;
    for (const version of versions) {
      if (!version.scored) continue;
      const p = version.scored.homeWinProbability;
      results.push({
        modelVersion: version.modelVersion,
        role: version.role,
        seal: version.scored,
        winnerProbability: homeWon ? p : 1 - p,
        brier: gameBrier(p, homeWon),
      });
    }
  }
  return { breakdown, homeOnBackToBack, awayOnBackToBack, versions, results, homeWon };
}

/** The next scheduled game for a team after a given tip, from the store. */
export function nextGameFor(
  games: readonly SeasonGame[],
  teamId: string,
  afterTipUtc: string,
): SeasonGame | null {
  return (
    games.find(
      (game) =>
        (game.homeId === teamId || game.awayId === teamId) &&
        Date.parse(game.tipUtc) > Date.parse(afterTipUtc) &&
        game.status !== "canceled",
    ) ?? null
  );
}
