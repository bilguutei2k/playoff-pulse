// A team's season for its page: every game with the score, the sealed number where
// the ledger has one (the record starts at the first seal), a miss where the ledger
// records one, and a projection for unsealed games still to come: the published one
// with the injury term where it exists (the next seven days), else the fallback from
// ratings alone, before injuries.

import { sealKindOf } from "@/lib/season/live-state";
import { displayedSeal } from "@/lib/season/slate";
import type { LedgerRow, LiveState, SealKind, SealRow, SeasonGame } from "@/lib/season/types";
import type { ProjectionsFile } from "@/lib/season/projections";
import { isProjectable, projectGame, publishedProjection, scheduleDates } from "@/lib/view/projection";
import { mergeSealRows } from "@/lib/view/seals";

export type TeamGameRow = {
  game: SeasonGame;
  opponentId: string;
  home: boolean;
  result: { won: boolean; teamScore: number; opponentScore: number } | null;
  /** This team's chance: sealed, or a projection for an unsealed game to come. */
  forecast: {
    probability: number;
    source: "sealed" | "projection";
    modelVersion: string | null;
    sealKind: SealKind | null;
    /** Projections only: true for the published one with the injury term, false for ratings alone. */
    withInjuries: boolean;
  } | null;
  missed: boolean;
};

export function teamSchedule(input: {
  state: LiveState;
  games: readonly SeasonGame[];
  ledger: readonly LedgerRow[];
  teamId: string;
  /** The published projections with the injury term; null when not published. */
  projections?: ProjectionsFile | null;
}): TeamGameRow[] {
  const { state, games, ledger, teamId } = input;
  const seals = new Map<string, SealRow[]>();
  for (const [gameId, rows] of Object.entries(state.seals)) seals.set(gameId, [...rows]);
  const fromLedger = new Map<string, SealRow[]>();
  for (const row of ledger) {
    if (row.type === "seal") fromLedger.set(row.gameId, [...(fromLedger.get(row.gameId) ?? []), row]);
  }
  // The ledger's rows and the state's can be a commit apart; keep every seal from both.
  for (const [gameId, rows] of fromLedger) seals.set(gameId, mergeSealRows(rows, seals.get(gameId) ?? []));
  const missed = new Set(ledger.flatMap((row) => (row.type === "missed" ? [row.gameId] : [])));
  const dates = scheduleDates(state, games);

  return games
    .filter((game) => (game.homeId === teamId || game.awayId === teamId) && game.status !== "canceled")
    .map((game) => {
      const home = game.homeId === teamId;
      const final = game.status === "final" && game.homeScore !== null && game.awayScore !== null;
      const result = final
        ? {
            won: home ? game.homeScore! > game.awayScore! : game.awayScore! > game.homeScore!,
            teamScore: (home ? game.homeScore : game.awayScore)!,
            opponentScore: (home ? game.awayScore : game.homeScore)!,
          }
        : null;
      const seal = displayedSeal(seals.get(game.id), state);
      let forecast: TeamGameRow["forecast"] = null;
      const published = seal ? null : publishedProjection(input.projections ?? null, game.id);
      if (seal) {
        forecast = {
          probability: home ? seal.homeWinProbability : 1 - seal.homeWinProbability,
          source: "sealed",
          modelVersion: seal.modelVersion,
          sealKind: sealKindOf(seal),
          withInjuries: false,
        };
      } else if (published) {
        forecast = {
          probability: home ? published.homeWinProbability : published.awayWinProbability,
          source: "projection",
          modelVersion: null,
          sealKind: null,
          withInjuries: true,
        };
      } else if (isProjectable(game, state.slateEtDate)) {
        const projection = projectGame(state, game, dates);
        forecast = {
          probability: home ? projection.homeWinProbability : projection.awayWinProbability,
          source: "projection",
          modelVersion: null,
          sealKind: null,
          withInjuries: false,
        };
      }
      return {
        game,
        opponentId: home ? game.awayId : game.homeId,
        home,
        result,
        forecast,
        missed: !seal && missed.has(game.id),
      };
    });
}
