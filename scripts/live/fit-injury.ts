// Fits the injury model on 2021-22 to 2023-24 and nothing later. Box scores from 2020-21
// warm up player values. Writes docs/live/injury-fit.json. The test seasons' results are
// never read here: only the name index touches them, for identity.
//
// Run: corepack pnpm exec tsx scripts/live/fit-injury.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { STATUS_CODES, type AbsenceClass, type StatusCode } from "../../src/lib/season/availability";
import { etWallClockOf } from "../../src/lib/season/dates";
import {
  buildSurvivalTable,
  createTracker,
  replayInjuryModel,
  SURVIVAL_BUCKETS,
  survivalBucket,
  type ForecastRow,
  type InjuryParams,
  type StatusTable,
  type SurvivalObservation,
} from "../../src/lib/season/injury-model";
import { LIVE_PARAMS } from "../../src/lib/season/params";
import { replayRatings, type FilterState } from "../../src/lib/season/ratings";
import type { SeasonGame } from "../../src/lib/season/types";
import { loadAvailabilityData } from "./availability-store";
import { accuracy, brier, calibrationFit, logLoss, round, type ScoredGame } from "./eval-metrics";
import { compareGames, loadHistory } from "./game-store";

const WARMUP_SEASON = 2021;
const FIT_SEASONS = [2022, 2023, 2024];
const LAST_FIT_SEASON = FIT_SEASONS[FIT_SEASONS.length - 1];
const FINAL_WINDOW_MS = 3 * 3_600_000;
const STATUS_ORDER: StatusCode[] = [
  STATUS_CODES.Out,
  STATUS_CODES.Doubtful,
  STATUS_CODES.Questionable,
  STATUS_CODES.Probable,
  STATUS_CODES.Available,
];

const GRIDS: Record<keyof InjuryParams, number[]> = {
  beta: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
  gRep: [0.1, 0.15, 0.2, 0.25, 0.3],
  k: [500, 1000, 2000, 4000],
  lG: [1000, 2000, 4000],
  lM: [5, 10, 20],
};
/** The one permitted widening, used only if the best value sits on a grid's edge. */
const WIDENED: Record<keyof InjuryParams, number[]> = {
  beta: [0.05, 0.9, 1.0, 1.1, 1.2],
  gRep: [0.05, 0.35, 0.4],
  k: [250, 8000],
  lG: [500, 8000],
  lM: [3, 40],
};

const allGames = loadHistory(LAST_FIT_SEASON).sort(compareGames);
if (allGames.some((game) => game.season > LAST_FIT_SEASON)) {
  throw new Error("A test season reached the fit.");
}
const baseGames = allGames.filter((game) => game.season < WARMUP_SEASON);
const fitGames = allGames.filter((game) => game.season >= WARMUP_SEASON);
const base = replayRatings(baseGames, LIVE_PARAMS).state;
const data = loadAvailabilityData([WARMUP_SEASON, ...FIT_SEASONS], FIT_SEASONS);
const fitSet = new Set(FIT_SEASONS);

function copyState(state: FilterState): FilterState {
  return { mean: Float64Array.from(state.mean), cov: Float64Array.from(state.cov) };
}

function isQualifying(game: SeasonGame): boolean {
  if (game.kind !== "regular" || !fitSet.has(game.season)) return false;
  const final = data.availability(game.id)?.final;
  if (!final || final.notSubmitted.length > 0) return false;
  const tip = Date.parse(`${etWallClockOf(game.tipUtc)}:00Z`);
  return tip - Date.parse(`${final.at}:00Z`) <= FINAL_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Status table
// ---------------------------------------------------------------------------

function buildStatusTable(): { table: StatusTable; counts: Record<StatusCode, number> } {
  const absent = Object.fromEntries(STATUS_ORDER.map((code) => [code, 0])) as Record<StatusCode, number>;
  const counts = Object.fromEntries(STATUS_ORDER.map((code) => [code, 0])) as Record<StatusCode, number>;
  for (const game of fitGames) {
    if (!isQualifying(game)) continue;
    const box = data.boxScores(game.id);
    const final = data.availability(game.id)?.final;
    if (!box || !final) continue;
    for (const row of final.rows) {
      if (row.athleteId === null || !box[row.teamId]) continue;
      counts[row.status] += 1;
      if (!box[row.teamId].some((line) => line[0] === row.athleteId)) absent[row.status] += 1;
    }
  }
  // Pool adjacent statuses until absence never rises as the status improves.
  const groups = STATUS_ORDER.map((code) => ({
    codes: [code],
    absent: absent[code],
    count: counts[code],
  }));
  for (let index = 1; index < groups.length; ) {
    const before = groups[index - 1];
    const after = groups[index];
    if (after.absent / after.count > before.absent / before.count) {
      before.codes.push(...after.codes);
      before.absent += after.absent;
      before.count += after.count;
      groups.splice(index, 1);
      index = Math.max(1, index - 1);
    } else {
      index += 1;
    }
  }
  const table = {} as StatusTable;
  for (const group of groups) {
    for (const code of group.codes) table[code] = group.absent / group.count;
  }
  return { table, counts };
}

const { table: statusTable, counts: statusCounts } = buildStatusTable();

// ---------------------------------------------------------------------------
// Objective
// ---------------------------------------------------------------------------

function score(params: InjuryParams): ScoredGame[] {
  const rows: ScoredGame[] = [];
  replayInjuryModel({
    games: fitGames,
    state: copyState(base),
    stateSeason: WARMUP_SEASON - 1,
    params: LIVE_PARAMS,
    injury: params,
    statusTable,
    boxScores: data.boxScores,
    availability: data.availability,
    onForecast: (row: ForecastRow) => {
      if (!isQualifying(row.game)) return;
      rows.push({
        id: row.game.id,
        season: row.game.season,
        p: row.final.homeWinProbability,
        y: (row.game.homeScore as number) > (row.game.awayScore as number) ? 1 : 0,
      });
    },
  });
  return rows;
}

const cache = new Map<string, number>();
function objective(params: InjuryParams): number {
  const key = JSON.stringify(params);
  const known = cache.get(key);
  if (known !== undefined) return known;
  const value = logLoss(score(params));
  cache.set(key, value);
  return value;
}

function descend(start: InjuryParams, grids: Record<keyof InjuryParams, number[]>): InjuryParams {
  const best = { ...start };
  for (let sweep = 0; sweep < 6; sweep += 1) {
    let changed = false;
    for (const key of Object.keys(grids) as Array<keyof InjuryParams>) {
      let bestValue = objective(best);
      for (const candidate of grids[key]) {
        const value = objective({ ...best, [key]: candidate });
        if (value < bestValue - 1e-9) {
          bestValue = value;
          best[key] = candidate;
          changed = true;
        }
      }
    }
    console.log(`[fit] sweep ${sweep + 1}: ${JSON.stringify(best)} log loss ${objective(best).toFixed(6)}`);
    if (!changed) break;
  }
  return best;
}

const START: InjuryParams = { beta: 0.4, gRep: 0.2, k: 1000, lG: 2000, lM: 10 };
let fitted = descend(START, GRIDS);
const widenedKeys: string[] = [];
const grids = { ...GRIDS };
for (const key of Object.keys(GRIDS) as Array<keyof InjuryParams>) {
  const grid = GRIDS[key];
  if (fitted[key] === grid[0] || fitted[key] === grid[grid.length - 1]) {
    widenedKeys.push(key);
    grids[key] = [...grid, ...WIDENED[key]].sort((a, b) => a - b);
  }
}
if (widenedKeys.length > 0) {
  console.log(`[fit] boundary hit, widening once: ${widenedKeys.join(", ")}`);
  fitted = descend(fitted, grids);
}

// ---------------------------------------------------------------------------
// Sensitivity, comparison and survival table
// ---------------------------------------------------------------------------

const sensitivity = Object.fromEntries(
  (Object.keys(grids) as Array<keyof InjuryParams>).map((key) => [
    key,
    grids[key].map((value) => ({
      value,
      logLoss: round(objective({ ...fitted, [key]: value }), 6),
    })),
  ]),
);

const noAbsences: InjuryParams = { ...fitted, beta: 0 };
const candidate = score(fitted);
const reference = score(noAbsences);
const fitComparison = {
  games: candidate.length,
  logLoss: { injury: round(logLoss(candidate), 6), plain: round(logLoss(reference), 6) },
  brier: { injury: round(brier(candidate), 6), plain: round(brier(reference), 6) },
  accuracy: { injury: round(accuracy(candidate), 4), plain: round(accuracy(reference), 4) },
  calibrationSlope: {
    injury: round(calibrationFit(candidate).slope, 3),
    plain: round(calibrationFit(reference).slope, 3),
  },
};

const observations: SurvivalObservation[] = [];
let censored = 0;
type Open = Array<{ missedBefore: number; class: AbsenceClass }>;
const open = new Map<string, Open>();
function closeSpell(key: string): void {
  const spell = open.get(key);
  if (!spell) return;
  spell.forEach((entry, index) => {
    observations.push({
      missedBefore: entry.missedBefore,
      further: spell.length - index,
      class: entry.class,
    });
  });
  open.delete(key);
}
let observedSeason: number | null = null;
replayInjuryModel({
  games: fitGames,
  state: copyState(base),
  stateSeason: WARMUP_SEASON - 1,
  params: LIVE_PARAMS,
  injury: fitted,
  statusTable,
  boxScores: data.boxScores,
  availability: data.availability,
  tracker: createTracker(),
  onAbsences: (game, teamId, absences) => {
    if (game.kind !== "regular" || !fitSet.has(game.season)) return;
    if (game.season !== observedSeason) {
      // An absence running to the end of a regular season counts the games left.
      censored += open.size;
      for (const key of [...open.keys()]) closeSpell(key);
      observedSeason = game.season;
    }
    const prefix = `${teamId}:`;
    const absentKeys = new Set(absences.absent.map((entry) => `${prefix}${entry.athleteId}`));
    for (const key of [...open.keys()]) {
      if (key.startsWith(prefix) && !absentKeys.has(key)) closeSpell(key);
    }
    for (const entry of absences.absent) {
      const key = `${prefix}${entry.athleteId}`;
      // Players with no value do not move any forecast, so they say nothing here.
      if (entry.lost <= 0 && !open.has(key)) continue;
      const spell = open.get(key) ?? [];
      spell.push({ missedBefore: entry.missedBefore, class: entry.class });
      open.set(key, spell);
    }
  },
});
censored += open.size;
for (const key of [...open.keys()]) closeSpell(key);

const survival = buildSurvivalTable(observations);
const cellCounts = {
  long: SURVIVAL_BUCKETS.map(() => 0),
  short: SURVIVAL_BUCKETS.map(() => 0),
};
for (const row of observations) cellCounts[row.class][survivalBucket(row.missedBefore)] += 1;

const output = {
  note: "Fitted on 2021-22 to 2023-24 regular seasons, with 2020-21 box scores as warm-up. No test-season result was read.",
  fitted,
  startingPoint: START,
  widenedOnce: widenedKeys,
  statusTable: Object.fromEntries(
    STATUS_ORDER.map((code) => [code, { absent: round(statusTable[code], 4), rows: statusCounts[code] }]),
  ),
  survival: {
    buckets: ["0", "1", "2-3", "4-7", "8-15", "16-30", "31+"],
    long: survival.long.map((value) => round(value, 2)),
    short: survival.short.map((value) => round(value, 2)),
    classUsed: survival.classUsed,
    observations: observations.length,
    spellsRunningToSeasonEnd: censored,
    cellCounts,
  },
  fitComparison,
  sensitivity,
};
const target = path.join(process.cwd(), "docs", "live", "injury-fit.json");
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
console.log(JSON.stringify({ fitted, statusTable: output.statusTable, survival: output.survival, fitComparison }, null, 1));
console.log(`[fit] wrote ${target}`);
