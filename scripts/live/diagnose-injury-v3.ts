// Development diagnostics of v3 (plan step A6), on 2021-22 to 2023-24 only. Report only:
// nothing here is fitted, chosen or written under docs.
//
// 1. Calibration of S(j) at j = 1, 2, 5, 10 by class, in-sample and leave-one-season-out
//    (hazards refitted on the other two seasons), on the hazard population of the fit. A
//    state is a spell after its k-th missed game; it is "still out at j" when at least j
//    more misses follow. A censored spell's states with fewer than j misses after them have
//    no outcome at j and are counted apart. S(j) here is the unlisted form, 1 - h(k) first.
// 2. The (c3) set on development seasons, decomposed: v2's morning rule against v3 (with
//    Amendment 1), v3 as first written, and v3 with one part switched off.
//
// Run: V3_DIAG_OUT=<file outside docs> corepack pnpm exec tsx scripts/live/diagnose-injury-v3.ts

import * as fs from "node:fs";
import * as path from "node:path";
import {
  createTracker,
  expectedAbsence,
  replayInjuryModel,
  type AvailabilityTracker,
  type ForecastRow,
  type ReportPoint,
} from "../../src/lib/season/injury-model";
import {
  createGapTracker,
  fitHazards,
  gapHook,
  hazard,
  nextGameAbsenceDetailV3,
  V3_ALL_ON,
  type GapTracker,
  type HazardTable,
  type V3Model,
} from "../../src/lib/season/injury-v3";
import { nextGameAbsenceDetail, unfiledOn, type InjuryModel } from "../../src/lib/season/live-injury";
import { INJURY_PARAMS, INJURY_STATUS_TABLE, INJURY_SURVIVAL, LIVE_PARAMS } from "../../src/lib/season/params";
import { predictGame, replayRatings } from "../../src/lib/season/ratings";
import type { SeasonGame } from "../../src/lib/season/types";
import { loadAvailabilityData } from "./availability-store";
import { brier, round } from "./eval-metrics";
import { compareGames, loadHistory } from "./game-store";
import { collectHazardObservations, LAST_DEVELOPMENT_SEASON, type HazardSpell } from "./v3-hazard-data";

const WARMUP_SEASON = 2021;
const SEASONS = [2022, 2023, 2024];
const HORIZONS = [1, 2, 5, 10];
const root = process.cwd();
const target = process.env.V3_DIAG_OUT ?? "";
if (!target || path.resolve(target).startsWith(path.join(root, "docs"))) {
  throw new Error("Set V3_DIAG_OUT to a file outside docs/.");
}

const allGames = loadHistory(LAST_DEVELOPMENT_SEASON).sort(compareGames);
if (allGames.some((game) => game.season > LAST_DEVELOPMENT_SEASON)) throw new Error("A season after 2023-24 reached the diagnostics.");
const base = replayRatings(allGames.filter((game) => game.season < WARMUP_SEASON), LIVE_PARAMS).state;
const games = allGames.filter((game) => game.season >= WARMUP_SEASON);
const data = loadAvailabilityData([WARMUP_SEASON, ...SEASONS], SEASONS);
const fitted = JSON.parse(fs.readFileSync(path.join(root, "docs/live/v3-fit.json"), "utf-8")) as { hazards: HazardTable };

// ---------------------------------------------------------------------------
// 1. Calibration
// ---------------------------------------------------------------------------

const run = collectHazardObservations(games, SEASONS, data, base, WARMUP_SEASON - 1);

function observationsOf(spells: readonly HazardSpell[]) {
  return spells.flatMap((spell) =>
    spell.classes
      .map((absenceClass, index) => ({
        k: index + 1,
        class: absenceClass,
        returned: spell.end === "returned" && index === spell.classes.length - 1,
      }))
      .slice(0, spell.end === "returned" ? spell.classes.length : spell.classes.length - 1),
  );
}

function calibration(spells: readonly HazardSpell[], table: HazardTable) {
  const out: Record<string, Record<string, { states: number; known: number; censoredBefore: number; observed: number; predicted: number; predictedAll: number }>> = {};
  for (const absenceClass of ["long", "short"] as const) {
    out[absenceClass] = {};
    for (const j of HORIZONS) {
      let states = 0;
      let known = 0;
      let outCount = 0;
      let predicted = 0;
      let predictedAll = 0;
      for (const spell of spells) {
        const n = spell.classes.length;
        spell.classes.forEach((stateClass, index) => {
          if (stateClass !== absenceClass) return;
          const k = index + 1;
          let s = 1;
          for (let m = 0; m < j; m += 1) s *= 1 - hazard(table, k + m, stateClass);
          states += 1;
          predictedAll += s;
          const after = n - k;
          if (after >= j) {
            known += 1;
            outCount += 1;
            predicted += s;
          } else if (spell.end === "returned") {
            known += 1;
            predicted += s;
          }
        });
      }
      out[absenceClass][`j${j}`] = {
        states,
        known,
        censoredBefore: states - known,
        observed: round(outCount / known, 4),
        predicted: round(predicted / known, 4),
        predictedAll: round(predictedAll / states, 4),
      };
    }
  }
  return out;
}

const inSample = calibration(run.spells, fitted.hazards);
const leaveOneOut = Object.fromEntries(
  SEASONS.map((held) => {
    const train = run.spells.filter((spell) => spell.season !== held);
    const table = fitHazards(observationsOf(train)).table;
    return [
      String(held),
      {
        hazards: { long: table.long.map((v) => round(v, 4)), short: table.short.map((v) => round(v, 4)), classUsed: table.classUsed },
        calibration: calibration(run.spells.filter((spell) => spell.season === held), table),
      },
    ];
  }),
);
const refit = fitHazards(run.observations).table;
const refitMatches = JSON.stringify(refit.long.map((v) => round(v, 6))) === JSON.stringify(fitted.hazards.long) &&
  JSON.stringify(refit.short.map((v) => round(v, 6))) === JSON.stringify(fitted.hazards.short);

// ---------------------------------------------------------------------------
// 2. The c3 set on development seasons, decomposed
// ---------------------------------------------------------------------------

const V2: InjuryModel = { params: LIVE_PARAMS, injury: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE, survival: INJURY_SURVIVAL };
const model = (switches: Partial<V3Model["switches"]>): V3Model => ({
  injury: INJURY_PARAMS,
  statusTable: INJURY_STATUS_TABLE,
  hazards: fitted.hazards,
  v2Survival: INJURY_SURVIVAL,
  switches: { ...V3_ALL_ON, ...switches },
});
const V3 = model({});
const V3_NO_EXPIRY = model({ expiry: false });
const V3_NO_HAZARDS = model({ hazards: false });

/** v3 as first written (before Amendment 1): an unfiled team's expiry test reads empty rows. */
function asFirstWritten(point: ReportPoint, teamId: string, tracker: AvailabilityTracker, gaps: GapTracker, season: number): number {
  const before: GapTracker = { ...gaps, filedRows: new Map([...gaps.filedRows, [teamId, []]]) };
  return nextGameAbsenceDetailV3(point, teamId, tracker, before, season, V3).absence;
}

type Variant = "v2" | "v3" | "v3NoExpiry" | "v3NoHazards" | "v3AsFirstWritten" | "nobody";
const VARIANTS: Variant[] = ["v2", "v3", "v3NoExpiry", "v3NoHazards", "v3AsFirstWritten", "nobody"];
const rows: Array<{ game: SeasonGame; y: number; p: Record<Variant, number>; points: Record<Variant, number> }> = [];
{
  const state = { mean: Float64Array.from(base.mean), cov: Float64Array.from(base.cov) };
  const tracker = createTracker();
  const gaps = createGapTracker();
  replayInjuryModel({
    games,
    state,
    tracker,
    stateSeason: WARMUP_SEASON - 1,
    params: LIVE_PARAMS,
    injury: INJURY_PARAMS,
    statusTable: INJURY_STATUS_TABLE,
    boxScores: data.boxScores,
    availability: data.availability,
    onAbsences: gapHook(gaps, data),
    onForecast: (row: ForecastRow) => {
      const morning = row.availability?.morning ?? null;
      if (!SEASONS.includes(row.game.season) || row.game.kind !== "regular" || !morning || morning.notSubmitted.length === 0) return;
      const season = row.game.season;
      const unfiledSide = (variant: Variant, point: ReportPoint, teamId: string): number => {
        if (variant === "nobody") return 0;
        if (variant === "v2") return nextGameAbsenceDetail(point, teamId, tracker, V2, () => undefined).absence;
        if (variant === "v3AsFirstWritten") return asFirstWritten(point, teamId, tracker, gaps, season);
        const which = variant === "v3" ? V3 : variant === "v3NoExpiry" ? V3_NO_EXPIRY : V3_NO_HAZARDS;
        return nextGameAbsenceDetailV3(point, teamId, tracker, gaps, season, which).absence;
      };
      const side = (variant: Variant, teamId: string) =>
        unfiledOn(morning, teamId)
          ? unfiledSide(variant, morning, teamId)
          : expectedAbsence(morning, teamId, tracker.book, INJURY_STATUS_TABLE, INJURY_PARAMS);
      const p = {} as Record<Variant, number>;
      const points = {} as Record<Variant, number>;
      for (const variant of VARIANTS) {
        const home = side(variant, row.game.homeId);
        const away = side(variant, row.game.awayId);
        p[variant] = predictGame(state, row.context, LIVE_PARAMS, -INJURY_PARAMS.beta * (home - away)).homeWinProbability;
        points[variant] =
          INJURY_PARAMS.beta *
          [row.game.homeId, row.game.awayId].filter((id) => unfiledOn(morning, id)).reduce((sum, id) => sum + side(variant, id), 0);
      }
      rows.push({ game: row.game, y: (row.game.homeScore as number) > (row.game.awayScore as number) ? 1 : 0, p, points });
    },
  });
}
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const c3Decomposition = {
  games: rows.length,
  morningBrier: Object.fromEntries(
    VARIANTS.map((variant) => [variant, round(brier(rows.map((row) => ({ id: row.game.id, season: row.game.season, p: row.p[variant], y: row.y as 0 | 1 }))), 6)]),
  ),
  unfiledSidePointsMean: Object.fromEntries(VARIANTS.map((variant) => [variant, round(mean(rows.map((row) => row.points[variant])), 3)])),
  perSeason: SEASONS.map((season) => {
    const subset = rows.filter((row) => row.game.season === season);
    return {
      season,
      games: subset.length,
      morningBrier: Object.fromEntries(
        VARIANTS.map((variant) => [variant, round(brier(subset.map((row) => ({ id: row.game.id, season, p: row.p[variant], y: row.y as 0 | 1 }))), 6)]),
      ),
    };
  }),
};

const output = {
  note: "Development diagnostics of live-2026.27-v3 on 2021-22 to 2023-24. Report only.",
  hazardPopulation: { observations: run.observations.length, spells: run.spells.length, censored: run.censored },
  refitMatchesFrozenFit: refitMatches,
  calibrationInSample: inSample,
  calibrationLeaveOneSeasonOut: leaveOneOut,
  c3Decomposition,
};
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
console.log(JSON.stringify(output, null, 1));
