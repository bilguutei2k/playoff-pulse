// Report only: how a team that has NOT YET SUBMITTED its injury report should count in
// a morning number. Replays 2024-25 and 2025-26 with the registered harness and, for
// every game where a team was unfiled at the morning point, compares the morning number
// under the old rule (the unfiled side counts nobody) and the new rule (the unfiled side
// counts its current absences, as the season simulation charges its next game) against
// the result (Brier) and against the game's final-point number. Writes nothing; changes
// nothing. The registered test (`evaluate-injury.ts`) excluded every game with an unfiled
// team at its final point, so none of its numbers depend on this rule.
//
// Run: corepack pnpm exec tsx scripts/live/evaluate-unfiled.ts

import {
  createTracker,
  expectedAbsence,
  replayInjuryModel,
  type ForecastRow,
  type ReportPoint,
} from "../../src/lib/season/injury-model";
import { nextGameAbsenceDetail, unfiledOn, type InjuryModel } from "../../src/lib/season/live-injury";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
  LIVE_PARAMS,
} from "../../src/lib/season/params";
import { predictGame, replayRatings, type FilterState } from "../../src/lib/season/ratings";
import type { SeasonGame } from "../../src/lib/season/types";
import { loadAvailabilityData } from "./availability-store";
import { brier, pairedDateBootstrap, round, type ScoredGame } from "./eval-metrics";
import { compareGames, loadHistory } from "./game-store";

const WARMUP_SEASON = 2021;
const FIT_SEASONS = [2022, 2023, 2024];
const SEASONS = [2025, 2026];

const MODEL: InjuryModel = {
  params: LIVE_PARAMS,
  injury: INJURY_PARAMS,
  statusTable: INJURY_STATUS_TABLE,
  survival: INJURY_SURVIVAL,
};

const allGames = loadHistory(SEASONS[SEASONS.length - 1]).sort(compareGames);
const baseGames = allGames.filter((game) => game.season < WARMUP_SEASON);
const games = allGames.filter((game) => game.season >= WARMUP_SEASON);
const base = replayRatings(baseGames, LIVE_PARAMS).state;
const data = loadAvailabilityData(
  [WARMUP_SEASON, ...FIT_SEASONS, ...SEASONS],
  [...FIT_SEASONS, ...SEASONS],
);

type Row = {
  game: SeasonGame;
  y: 0 | 1;
  old: number;
  updated: number;
  final: number | null;
  /** Points the unfiled side(s) now count, summed. */
  counted: number;
  /** Points the same side(s) counted at the final point. */
  countedAtFinal: number | null;
};

const rows: Row[] = [];
const state: FilterState = { mean: Float64Array.from(base.mean), cov: Float64Array.from(base.cov) };
const tracker = createTracker();
const noName = () => undefined;

function sideAbsence(point: ReportPoint, teamId: string): number {
  return unfiledOn(point, teamId)
    ? nextGameAbsenceDetail(point, teamId, tracker, MODEL, noName).absence
    : expectedAbsence(point, teamId, tracker.book, MODEL.statusTable, MODEL.injury);
}

replayInjuryModel({
  games,
  // The replay mutates both; holding them lets each forecast see exactly its own inputs.
  state,
  tracker,
  stateSeason: WARMUP_SEASON - 1,
  params: LIVE_PARAMS,
  injury: INJURY_PARAMS,
  statusTable: INJURY_STATUS_TABLE,
  boxScores: data.boxScores,
  availability: data.availability,
  onForecast: (row: ForecastRow) => {
    if (!SEASONS.includes(row.game.season)) return;
    const morning = row.availability?.morning ?? null;
    if (!morning || morning.notSubmitted.length === 0) return;
    const home = sideAbsence(morning, row.game.homeId);
    const away = sideAbsence(morning, row.game.awayId);
    const updated = predictGame(state, row.context, LIVE_PARAMS, -INJURY_PARAMS.beta * (home - away));
    const final = row.availability?.final ?? null;
    const unfiledIds = [row.game.homeId, row.game.awayId].filter((id) => unfiledOn(morning, id));
    const atFinal = final
      ? unfiledIds.reduce(
          (sum, id) => sum + expectedAbsence(final, id, tracker.book, MODEL.statusTable, MODEL.injury),
          0,
        )
      : null;
    rows.push({
      game: row.game,
      y: (row.game.homeScore as number) > (row.game.awayScore as number) ? 1 : 0,
      old: row.morning.homeWinProbability,
      updated: updated.homeWinProbability,
      final: final ? row.final.homeWinProbability : null,
      counted: INJURY_PARAMS.beta * unfiledIds.reduce((sum, id) => sum + sideAbsence(morning, id), 0),
      countedAtFinal: atFinal === null ? null : INJURY_PARAMS.beta * atFinal,
    });
  },
});

const scored = (subset: readonly Row[], pick: (row: Row) => number): ScoredGame[] =>
  subset.map((row) => ({ id: row.game.id, season: row.game.season, p: pick(row), y: row.y }));
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function summary(label: string, subset: readonly Row[]) {
  const withFinal = subset.filter((row) => row.final !== null);
  const dates = new Map(subset.map((row) => [row.game.id, row.game.etDate]));
  const paired = pairedDateBootstrap(
    scored(subset, (row) => row.updated),
    scored(subset, (row) => row.old),
    (id) => dates.get(id) as string,
    `unfiled-morning-${label}`,
  );
  const gap = (pick: (row: Row) => number) =>
    round(mean(withFinal.map((row) => Math.abs(pick(row) - (row.final as number)))), 4);
  return {
    label,
    games: subset.length,
    brier: {
      oldRule: round(brier(scored(subset, (row) => row.old)), 4),
      newRule: round(brier(scored(subset, (row) => row.updated)), 4),
      newMinusOld: round(paired.difference, 4),
      interval95: [round(paired.lower, 4), round(paired.upper, 4)],
      dateClusters: paired.clusters,
    },
    againstFinalPoint: {
      games: withFinal.length,
      finalBrier: round(brier(scored(withFinal, (row) => row.final as number)), 4),
      meanAbsGapOldRule: gap((row) => row.old),
      meanAbsGapNewRule: gap((row) => row.updated),
      closerUnderNewRule: withFinal.filter(
        (row) => Math.abs(row.updated - (row.final as number)) < Math.abs(row.old - (row.final as number)),
      ).length,
      fartherUnderNewRule: withFinal.filter(
        (row) => Math.abs(row.updated - (row.final as number)) > Math.abs(row.old - (row.final as number)),
      ).length,
      unfiledSidePoints: {
        newRuleMean: round(mean(withFinal.map((row) => row.counted)), 3),
        atFinalPointMean: round(mean(withFinal.map((row) => row.countedAtFinal as number)), 3),
      },
    },
  };
}

const output = {
  note: "Report only. Morning points where a team was NOT YET SUBMITTED, 2024-25 and 2025-26. Old rule: that side counts nobody. New rule: that side counts current absences, as the season simulation charges its next game. Brier difference is new minus old, 95% interval from a bootstrap over game dates.",
  all: summary("all", rows),
  regularSeason: summary("regular", rows.filter((row) => row.game.kind === "regular")),
  perSeason: SEASONS.map((season) => summary(String(season), rows.filter((row) => row.game.season === season))),
};
console.log(JSON.stringify(output, null, 2));
const worse = output.all.brier.newRule > output.all.brier.oldRule;
console.log(
  worse
    ? "[unfiled] The new rule is WORSE than counting nobody on Brier over these games."
    : "[unfiled] The new rule is not worse than counting nobody on Brier over these games.",
);
