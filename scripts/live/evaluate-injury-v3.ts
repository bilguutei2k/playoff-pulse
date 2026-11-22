// The registered regression check of `live-2026.27-v3` (docs/live/registration-v3.md), on
// 2024-25 and 2025-26. Abort-only: it never chooses between variants. Run once, after the
// registration commit and the lead's go; it refuses to run again once its output exists.
// Writes docs/live/evaluation-injury-v3.json and exits non-zero unless every gate holds:
//
// (c1) final point, the registered set (games with a qualifying final report): v3 Brier
//      minus v2 Brier within +-0.002; above 1e-9 in absolute value is a blocking bug
//      (D7 makes them equal).
// (c2) T4 as registered for v2: 4,000 iterations, Dec 1, Feb 1, Apr 1, both seasons
//      pooled: v3 make-playoffs Brier <= v1 + 0.005 and win RMSE <= v1 + 0.25 at every
//      checkpoint, forecast sums valid. The script's own v1 and v2 values must equal the
//      frozen ones in docs/live/evaluation-injury.json.
// (c3) the regular-season games with a team NOT YET SUBMITTED at the morning point: v3's
//      morning Brier <= v2's (revision 2 rule) + 0.004. v2's must reproduce the registered
//      745 games and 0.2093.
//
// Smoke mode, for development seasons only: V3_GATE_SMOKE_SEASONS=2022,2023,2024 and
// V3_GATE_OUT=<file outside docs>. It refuses any season after 2023-24, skips the frozen
// reproductions (they exist for the test seasons only) and never writes under docs.
//
// Run (Phase C only): corepack pnpm exec tsx scripts/live/evaluate-injury-v3.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { etWallClockOf } from "../../src/lib/season/dates";
import {
  createTracker,
  currentAbsences,
  expectedAbsence,
  replayInjuryModel,
  simulationAbsences,
  type AvailabilityTracker,
  type ForecastRow,
  type InjuryParams,
  type ReportPoint,
} from "../../src/lib/season/injury-model";
import {
  buildAbsenceSchedule,
  createGapTracker,
  currentAbsencesV3,
  gapHook,
  nextGameAbsenceDetailV3,
  V3_ALL_ON,
  type GapTracker,
  type HazardTable,
  type V3Model,
} from "../../src/lib/season/injury-v3";
import { nextGameAbsenceDetail, unfiledOn, type InjuryModel } from "../../src/lib/season/live-injury";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  INJURY_SURVIVAL,
  LIVE_PARAMS,
  SIMULATOR_UNCERTAINTY_SCALE,
} from "../../src/lib/season/params";
import { predictGame, replayRatings, type FilterState } from "../../src/lib/season/ratings";
import { assertForecastSums, simulateSeason, type SimulationInput } from "../../src/lib/season/simulate";
import { buildStandings } from "../../src/lib/season/standings";
import { SEASON_TEAMS } from "../../src/lib/season/teams";
import type { SeasonGame } from "../../src/lib/season/types";
import { loadAvailabilityData } from "./availability-store";
import { brier, round, type ScoredGame } from "./eval-metrics";
import { compareGames, loadHistory, loadSeasonGames } from "./game-store";

const WARMUP_SEASON = 2021;
const FIT_SEASONS = [2022, 2023, 2024];
const LAST_DEVELOPMENT_SEASON = 2024;
const REGISTERED_SEASONS = [2025, 2026];
const FINAL_WINDOW_MS = 3 * 3_600_000;
const ITERATIONS = 4000;
const CHECKPOINTS = ["dec1", "feb1", "apr1"] as const;
const C1_TOLERANCE = 0.002;
const C1_BUG = 1e-9;
const BRIER_TOLERANCE = 0.005;
const RMSE_TOLERANCE = 0.25;
const C3_TOLERANCE = 0.004;
const REGISTERED_GAMES = 2460;
const REGISTERED_UNFILED = { games: 745, v2MorningBrier: 0.2093 };

const smokeSeasons = process.env.V3_GATE_SMOKE_SEASONS;
const smoke = smokeSeasons !== undefined;
const SEASONS = smoke ? smokeSeasons.split(",").map(Number) : REGISTERED_SEASONS;
if (smoke && (SEASONS.length === 0 || SEASONS.some((season) => !(season >= 2022 && season <= LAST_DEVELOPMENT_SEASON)))) {
  throw new Error("Smoke runs may only use development seasons 2021-22 to 2023-24.");
}
const root = process.cwd();
const target = smoke
  ? (process.env.V3_GATE_OUT ?? "")
  : path.join(root, "docs/live/evaluation-injury-v3.json");
if (smoke && (!target || path.resolve(target).startsWith(path.join(root, "docs")))) {
  throw new Error("Smoke runs need V3_GATE_OUT outside docs/.");
}
if (!smoke && fs.existsSync(target)) {
  throw new Error("docs/live/evaluation-injury-v3.json exists: the gate has run. It is never run again.");
}

type FitFile = { hazards: HazardTable };
const v3Fit = JSON.parse(fs.readFileSync(path.join(root, "docs/live/v3-fit.json"), "utf-8")) as FitFile;
const V3: V3Model = {
  injury: INJURY_PARAMS,
  statusTable: INJURY_STATUS_TABLE,
  hazards: v3Fit.hazards,
  v2Survival: INJURY_SURVIVAL,
  switches: V3_ALL_ON,
};
const V2: InjuryModel = {
  params: LIVE_PARAMS,
  injury: INJURY_PARAMS,
  statusTable: INJURY_STATUS_TABLE,
  survival: INJURY_SURVIVAL,
};
const plain: InjuryParams = { ...INJURY_PARAMS, beta: 0 };

const lastSeason = SEASONS[SEASONS.length - 1];
const allGames = loadHistory(lastSeason).sort(compareGames);
if (smoke && allGames.some((game) => game.season > LAST_DEVELOPMENT_SEASON)) {
  throw new Error("A season after 2023-24 reached a smoke run.");
}
const baseGames = allGames.filter((game) => game.season < WARMUP_SEASON);
const games = allGames.filter((game) => game.season >= WARMUP_SEASON);
const base = replayRatings(baseGames, LIVE_PARAMS).state;
const loadSeasons = [...new Set([...FIT_SEASONS, ...SEASONS])].sort();
const data = loadAvailabilityData([WARMUP_SEASON, ...loadSeasons], loadSeasons);
const seasonSet = new Set(SEASONS);

const copyState = (state: FilterState): FilterState => ({
  mean: Float64Array.from(state.mean),
  cov: Float64Array.from(state.cov),
});
const outcome = (game: SeasonGame): 0 | 1 => ((game.homeScore as number) > (game.awayScore as number) ? 1 : 0);

function qualifying(game: SeasonGame): boolean {
  if (game.kind !== "regular") return false;
  const final = data.availability(game.id)?.final;
  if (!final || final.notSubmitted.length > 0) return false;
  const tip = Date.parse(`${etWallClockOf(game.tipUtc)}:00Z`);
  return tip - Date.parse(`${final.at}:00Z`) <= FINAL_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// c1 and c3: game forecasts, v2 and v3 from one replay
// ---------------------------------------------------------------------------

/** A seal's side: the report's expected absence, or (unfiled) the engine's next-game charge. */
function v2Side(point: ReportPoint, teamId: string, tracker: AvailabilityTracker): number {
  return unfiledOn(point, teamId)
    ? nextGameAbsenceDetail(point, teamId, tracker, V2, () => undefined).absence
    : expectedAbsence(point, teamId, tracker.book, V2.statusTable, V2.injury);
}
function v3Side(point: ReportPoint, teamId: string, tracker: AvailabilityTracker, gaps: GapTracker, season: number): number {
  return unfiledOn(point, teamId)
    ? nextGameAbsenceDetailV3(point, teamId, tracker, gaps, season, V3).absence
    : expectedAbsence(point, teamId, tracker.book, V3.statusTable, V3.injury);
}

type GameRow = { game: SeasonGame; y: 0 | 1; v2: number; v3: number };
const finalRows: GameRow[] = [];
const morningRows: GameRow[] = [];
{
  const state = copyState(base);
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
      if (!seasonSet.has(row.game.season)) return;
      const price = (point: ReportPoint, side: (point: ReportPoint, teamId: string) => number) =>
        predictGame(state, row.context, LIVE_PARAMS, -INJURY_PARAMS.beta * (side(point, row.game.homeId) - side(point, row.game.awayId)))
          .homeWinProbability;
      const two = (point: ReportPoint, teamId: string) => v2Side(point, teamId, tracker);
      const three = (point: ReportPoint, teamId: string) => v3Side(point, teamId, tracker, gaps, row.game.season);
      const final = row.availability?.final ?? null;
      if (final && qualifying(row.game)) {
        const v2 = price(final, two);
        if (Math.abs(v2 - row.final.homeWinProbability) > 1e-12) {
          throw new Error(`v2's final number for ${row.game.id} does not reproduce the registered harness.`);
        }
        finalRows.push({ game: row.game, y: outcome(row.game), v2, v3: price(final, three) });
      }
      const morning = row.availability?.morning ?? null;
      if (row.game.kind === "regular" && morning && morning.notSubmitted.length > 0) {
        morningRows.push({ game: row.game, y: outcome(row.game), v2: price(morning, two), v3: price(morning, three) });
      }
    },
  });
}
const scoredAs = (rows: readonly GameRow[], pick: "v2" | "v3"): ScoredGame[] =>
  rows.map((row) => ({ id: row.game.id, season: row.game.season, p: row[pick], y: row.y }));

const c1Difference = brier(scoredAs(finalRows, "v3")) - brier(scoredAs(finalRows, "v2"));
const c1MaxGameDifference = Math.max(0, ...finalRows.map((row) => Math.abs(row.v3 - row.v2)));
const c1 = {
  games: finalRows.length,
  v2Brier: round(brier(scoredAs(finalRows, "v2"))),
  v3Brier: round(brier(scoredAs(finalRows, "v3"))),
  difference: c1Difference,
  maxGameDifference: c1MaxGameDifference,
  tolerance: C1_TOLERANCE,
  bugThreshold: C1_BUG,
  passed: Math.abs(c1Difference) <= C1_TOLERANCE && Math.abs(c1Difference) <= C1_BUG,
};

const c3V2 = brier(scoredAs(morningRows, "v2"));
const c3V3 = brier(scoredAs(morningRows, "v3"));
const c3 = {
  games: morningRows.length,
  v2MorningBrier: round(c3V2),
  v3MorningBrier: round(c3V3),
  difference: round(c3V3 - c3V2),
  tolerance: C3_TOLERANCE,
  passed: c3V3 <= c3V2 + C3_TOLERANCE,
};

// ---------------------------------------------------------------------------
// c2: T4, the simulator
// ---------------------------------------------------------------------------

function checkpointDate(season: number, checkpoint: (typeof CHECKPOINTS)[number]): string {
  if (checkpoint === "dec1") return `${season - 1}-12-01`;
  if (checkpoint === "feb1") return `${season}-02-01`;
  return `${season}-04-01`;
}

function seasonOutcome(season: number) {
  const seasonGames = loadSeasonGames(season);
  const made = new Set<string>();
  for (const game of seasonGames) {
    if (game.kind === "playoff" && game.status === "final") {
      made.add(game.homeId);
      made.add(game.awayId);
    }
  }
  return { seasonGames, made, finalWins: buildStandings(seasonGames).wins };
}

function asOfDate(seasonGames: readonly SeasonGame[], etDate: string): SeasonGame[] {
  return seasonGames
    .filter((game) => game.kind === "regular" || game.kind === "cup-final")
    .map((game) =>
      game.status === "final" && game.etDate >= etDate
        ? { ...game, status: "scheduled" as const, homeScore: null, awayScore: null }
        : game,
    );
}

type Version = "v1" | "v2" | "v3";
type Forecasts = Record<Version, { pMake: Map<string, number>; projected: Map<string, number> }>;

function simulateAt(season: number, etDate: string): Forecasts {
  const known = asOfDate(seasonOutcome(season).seasonGames, etDate);
  const replay = (params: InjuryParams, gaps?: GapTracker) =>
    replayInjuryModel({
      games,
      state: copyState(base),
      stateSeason: WARMUP_SEASON - 1,
      params: LIVE_PARAMS,
      injury: params,
      statusTable: INJURY_STATUS_TABLE,
      boxScores: data.boxScores,
      availability: data.availability,
      throughEtDate: etDate,
      onAbsences: gaps ? gapHook(gaps, data) : undefined,
    });
  const without = replay(plain);
  const gaps = createGapTracker();
  const injured = replay(INJURY_PARAMS, gaps);
  const pending: Record<string, number> = {};
  for (const game of known) {
    if (game.kind !== "regular" || game.status !== "scheduled") continue;
    pending[game.homeId] = (pending[game.homeId] ?? 0) + 1;
    pending[game.awayId] = (pending[game.awayId] ?? 0) + 1;
  }
  const common = (state: FilterState, lastGameEtDate: Record<string, string | null>): SimulationInput => ({
    season,
    phase: "regular-season",
    games: known,
    state,
    params: LIVE_PARAMS,
    asOfEtDate: etDate,
    lastGameEtDate,
    iterations: ITERATIONS,
    uncertaintyScale: SIMULATOR_UNCERTAINTY_SCALE,
  });
  const v2Absences = simulationAbsences(currentAbsences(injured.tracker, INJURY_PARAMS, INJURY_SURVIVAL), pending);
  const v3Schedule = buildAbsenceSchedule(currentAbsencesV3(injured.tracker, gaps, season, V3).current, V3);
  const run = (input: SimulationInput) => {
    const forecast = simulateSeason(input);
    assertForecastSums(forecast);
    return {
      pMake: new Map(forecast.teams.map((team) => [team.teamId, team.makePlayoffs])),
      projected: new Map(forecast.teams.map((team) => [team.teamId, team.projectedWins])),
    };
  };
  return {
    v1: run(common(without.state, without.lastGameEtDate)),
    v2: run({ ...common(injured.state, injured.lastGameEtDate), absences: v2Absences }),
    v3: run({ ...common(injured.state, injured.lastGameEtDate), absenceSchedule: v3Schedule }),
  };
}

const VERSIONS: Version[] = ["v1", "v2", "v3"];
const t4 = CHECKPOINTS.map((checkpoint) => {
  const squared = { brier: { v1: 0, v2: 0, v3: 0 }, wins: { v1: 0, v2: 0, v3: 0 } };
  let count = 0;
  for (const season of SEASONS) {
    const { made, finalWins } = seasonOutcome(season);
    const forecasts = simulateAt(season, checkpointDate(season, checkpoint));
    SEASON_TEAMS.forEach((team, index) => {
      const y = made.has(team.id) ? 1 : 0;
      for (const version of VERSIONS) {
        squared.brier[version] += ((forecasts[version].pMake.get(team.id) as number) - y) ** 2;
        squared.wins[version] += ((forecasts[version].projected.get(team.id) as number) - finalWins[index]) ** 2;
      }
      count += 1;
    });
  }
  const makePlayoffsBrier = Object.fromEntries(VERSIONS.map((v) => [v, round(squared.brier[v] / count)])) as Record<Version, number>;
  const winRmse = Object.fromEntries(VERSIONS.map((v) => [v, round(Math.sqrt(squared.wins[v] / count), 3)])) as Record<Version, number>;
  return {
    checkpoint,
    makePlayoffsBrier,
    winRmse,
    limits: { makePlayoffsBrier: round(makePlayoffsBrier.v1 + BRIER_TOLERANCE), winRmse: round(winRmse.v1 + RMSE_TOLERANCE, 3) },
    passed: makePlayoffsBrier.v3 <= makePlayoffsBrier.v1 + BRIER_TOLERANCE && winRmse.v3 <= winRmse.v1 + RMSE_TOLERANCE,
    teamSeasons: count,
  };
});
const c2 = { passed: t4.every((row) => row.passed), checks: t4, brierTolerance: BRIER_TOLERANCE, rmseTolerance: RMSE_TOLERANCE, iterations: ITERATIONS };

// ---------------------------------------------------------------------------
// Frozen reproductions (registered seasons only)
// ---------------------------------------------------------------------------

const reproductionProblems: string[] = [];
if (!smoke) {
  type Frozen = { gates: { T4: { checks: Array<{ checkpoint: string; makePlayoffsBrier: { injury: number; plain: number }; winRmse: { injury: number; plain: number } }> } } };
  const frozen = JSON.parse(fs.readFileSync(path.join(root, "docs/live/evaluation-injury.json"), "utf-8")) as Frozen;
  for (const row of t4) {
    const stored = frozen.gates.T4.checks.find((entry) => entry.checkpoint === row.checkpoint);
    if (
      !stored ||
      stored.makePlayoffsBrier.plain !== row.makePlayoffsBrier.v1 ||
      stored.makePlayoffsBrier.injury !== row.makePlayoffsBrier.v2 ||
      stored.winRmse.plain !== row.winRmse.v1 ||
      stored.winRmse.injury !== row.winRmse.v2
    ) {
      reproductionProblems.push(`T4 ${row.checkpoint}: v1 or v2 does not equal docs/live/evaluation-injury.json`);
    }
  }
  if (c1.games !== REGISTERED_GAMES) reproductionProblems.push(`c1 has ${c1.games} games, registered ${REGISTERED_GAMES}`);
  if (c3.games !== REGISTERED_UNFILED.games || round(c3V2, 4) !== REGISTERED_UNFILED.v2MorningBrier) {
    reproductionProblems.push(`c3: v2 gives ${c3.games} games and ${round(c3V2, 4)}, registered 745 and 0.2093`);
  }
}

const passed = c1.passed && c2.passed && c3.passed && reproductionProblems.length === 0;
const output = {
  note: smoke
    ? "SMOKE RUN on development seasons. Not a result of the registered check."
    : "Registered regression check of live-2026.27-v3 on 2024-25 and 2025-26. Abort-only; run once. The second v3-family look at these seasons (see registration-v3.md).",
  seasons: SEASONS,
  smoke,
  gates: { c1, c2, c3 },
  reproductionProblems,
  passed,
};
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
console.log(JSON.stringify(output, null, 1));
console.log(`[v3 gate] wrote ${target}`);
if (!passed) {
  console.error("[v3 gate] did not pass.");
  process.exit(2);
}
