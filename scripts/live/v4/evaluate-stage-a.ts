// Stage A of `live-2026.27-v4` (docs/live/registration-v4.md): the registered development
// check under rolling origin, on open seasons only. All data comes through dev-data.ts,
// which refuses 2024-25 and 2025-26.
//
// Modes:
//   --design            A8, the season-level diagnostic before registration: Dec 1 and Feb 1
//                       on the design seasons 2015-16 to 2018-19 and 2021-22 only. It refuses
//                       2022-23 and 2023-24 at season level. Writes the file given by
//                       V4_A8_OUT (default docs/live/v4-a8.json), refusing to overwrite it.
//                       With --s2 it also runs S2's grid (H = 200, 400, 800 days) once and
//                       picks H by pooled win error on the design seasons.
//   (no flag)           Phase B, once, on the lead's go: reproductions, then A1 to A5 and A7,
//                       written to docs/live/evaluation-v4-stage-a.json. Refuses to run if
//                       that file exists; exits non-zero on any failure.
//
// Every v4 number for season S uses the parameter set fitted before S (rolling origin) and,
// for the availability layer, tables fitted without S (leave-one-season-out). Information
// set: reports from 2021-22 on, none before. Intervals: 10,000-draw bootstrap over game dates.
//
// Run (A8): corepack pnpm exec tsx scripts/live/v4/evaluate-stage-a.ts --design
// Run (Phase B): corepack pnpm exec tsx scripts/live/v4/evaluate-stage-a.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { buildV4Season, groupHazard, type BackgroundParams, type GroupHazardTable } from "../../../src/lib/season/availability-v4";
import { fitHazards, hazard, type HazardTable } from "../../../src/lib/season/injury-v3";
import { clampProbability, normalCdf } from "../../../src/lib/season/math";
import { LIVE_PARAMS } from "../../../src/lib/season/params";
import {
  advanceTo,
  copyRosterState,
  createRosterState,
  forecastGame,
  gameOffsets,
  replayRosterState,
  type RosterState,
  type StatusWeights,
  type V4GameLines,
  type V4RatingParams,
} from "../../../src/lib/season/roster-state";
import { mixtureProbability } from "../../../src/lib/season/forecast-v4";
import { simulateSeason } from "../../../src/lib/season/simulate";
import { createFilterState } from "../../../src/lib/season/ratings";
import { SEASON_TEAMS } from "../../../src/lib/season/teams";
import type { SeasonGame } from "../../../src/lib/season/types";
import { brier, calibrationFit, logLoss, pairedDateBootstrap, reliability, round, type ScoredGame } from "../eval-metrics";
import { devOpeningRosters, devSpreads } from "./dev-data";
import { finalPoint, FIRST_SCORED_SEASON, openData, REPORT_SEASONS } from "./engine-run";
import { collectGroupedObservations, type GroupedObservation } from "./hazard-data";
import {
  asOfDate,
  checkpointDate,
  seasonOutcome,
  v1GameRows,
  v1SeasonAt,
  v2FinalRows,
  type CheckpointName,
  type SeasonRead,
} from "./references";

const root = process.cwd();
const design = process.argv.includes("--design");
const withS2 = process.argv.includes("--s2");
/** Code smoke test of design mode only: one season, 200 iterations, output outside docs, never read for a decision. */
const smoke = process.env.V4_SMOKE === "1";
const smokeOut = design ? process.env.V4_A8_OUT : process.env.V4_STAGE_A_OUT;
if (smoke && (!smokeOut || path.resolve(smokeOut).startsWith(path.join(process.cwd(), "docs")))) {
  throw new Error("V4_SMOKE needs its output (V4_A8_OUT or V4_STAGE_A_OUT) outside docs/.");
}
const ITERATIONS = smoke ? 200 : 4000;
const DESIGN_SEASONS = smoke ? [2016] : [2016, 2017, 2018, 2019, 2022];
const CONFIRMATION_SEASONS = [2023, 2024];
const A5_SEASONS = smoke ? [2022] : [...DESIGN_SEASONS, ...CONFIRMATION_SEASONS];
const SCORED_SEASONS = smoke ? [2022] : [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const S2_GRID = [200, 400, 800];
const LIMITS = {
  a1SeasonsNegative: 7,
  a2Margin: 0.002,
  a2Absolute: 0.2159,
  a2Upper: 0.004,
  a3Slope: [0.93, 1.07] as const,
  a3Reliability: 0.002,
  a5PooledBrier: 0.005,
  a5PooledWins: 0.25,
  a5ConfirmationBrier: 0.008,
  a5ConfirmationWins: 0.4,
  a8Brier: 0.005,
  a8Wins: 0.25,
};
const REPRODUCE = { v1DevLogLoss: 0.594511, v1DevGames: 12059, v1FinalBrier: 0.2192, v2FinalBrier: 0.2139, v2FinalLogLoss: 0.6168, finalGames: 3690 };
const REGISTERED_V2_T4 = { makePlayoffsBrier: [0.1429, 0.0958, 0.041], winRmse: [6.5, 3.76, 1.07] };

// ---------------------------------------------------------------------------
// The fit
// ---------------------------------------------------------------------------

type OriginSet = { ratings: V4RatingParams; background: BackgroundParams };
type Fit = {
  origins: Record<string, OriginSet>;
  status: { frozen: StatusWeights; leaveOneOut: Record<string, StatusWeights>; beforeOrigin: Record<string, StatusWeights> };
  hazards: { frozen: GroupHazardTable; leaveOneOut: Record<string, GroupHazardTable>; shrinkage: number };
};
const fitFile = smoke && process.env.V4_FIT_FILE ? path.resolve(process.env.V4_FIT_FILE) : path.join(root, "docs/live/v4-fit.json");
const fit = JSON.parse(fs.readFileSync(fitFile, "utf-8")) as Fit;

const originFor = (season: number): OriginSet => {
  const set = fit.origins[String(season)];
  if (!set) throw new Error(`No rolling-origin set for ${season}.`);
  return set;
};
/** Status tables while scoring season S: before-origin for earlier report seasons, leave-one-out for S. */
function statusMap(season: number): Record<number, StatusWeights> {
  const out: Record<number, StatusWeights> = {};
  for (const report of REPORT_SEASONS) {
    if (report < season) out[report] = fit.status.beforeOrigin[String(season)];
    if (report === season) out[report] = fit.status.leaveOneOut[String(season)];
  }
  return out;
}
const hazardsFor = (season: number): GroupHazardTable => fit.hazards.leaveOneOut[String(season)] ?? fit.hazards.frozen;

// ---------------------------------------------------------------------------
// v4 replays
// ---------------------------------------------------------------------------

type V4Row = ScoredGame & { game: SeasonGame; none: number | null; told: number | null; plugIn: number };

/** Season S under its origin set, with states captured at the given ET dates (sorted). */
function replaySeason(
  season: number,
  captureAt: readonly string[],
  ratingsOverride?: Partial<V4RatingParams>,
  onRow?: (row: V4Row) => void,
): Map<string, RosterState> {
  const { games, lines } = openData();
  const ratings = { ...originFor(season).ratings, ...ratingsOverride };
  const status = statusMap(season);
  const fallback: StatusWeights = { O: 1, D: 1, Q: 1, P: 1, A: 1 };
  const statusFor = (s: number) => status[s] ?? fallback;
  const reportSet = new Set(Object.keys(status).map(Number));
  const list = games.filter((game) => game.season <= season);
  const captured = new Map<string, RosterState>();
  const state = createRosterState();
  let start = 0;
  const run = (through: string | undefined) => {
    let end = start;
    while (end < list.length && (through === undefined || list[end].etDate < through)) end += 1;
    replayRosterState({
      games: list.slice(start, end),
      linesFor: lines,
      reportFor: (game) => (reportSet.has(game.season) ? finalPoint(game) : null),
      openingRosters: devOpeningRosters,
      params: ratings,
      statusTable: statusFor,
      state,
      onForecast: onRow
        ? (row, current) => {
            if (row.game.season !== season || row.game.kind !== "regular") return;
            const extra = season >= 2022;
            onRow({
              id: row.game.id,
              season,
              p: row.forecast.homeWinProbability,
              y: row.y,
              game: row.game,
              none: extra ? noneProbability(current, row.game, ratings, statusFor(season)) : null,
              told: extra ? toldProbability(current, row.game, lines(row.game.id), ratings) : null,
              plugIn: row.forecast.plugInProbability,
            });
          }
        : undefined,
    });
    start = end;
  };
  for (const date of captureAt) {
    run(date);
    const copy = copyRosterState(state);
    advanceTo(copy, season, date, ratings, devOpeningRosters);
    captured.set(date, copy);
  }
  if (onRow) run(undefined);
  return captured;
}

/** Information set "none" (reported only): no report rows, on a copy so the run is untouched. */
function noneProbability(state: RosterState, game: SeasonGame, ratings: V4RatingParams, status: StatusWeights): number {
  return forecastGame(copyRosterState(state), game, { home: null, away: null }, ratings, status).homeWinProbability;
}

/** "Told who plays" (an upper bound, reported only): weights from the game's actual minutes. */
function toldProbability(state: RosterState, game: SeasonGame, lines: V4GameLines | undefined, ratings: V4RatingParams): number | null {
  if (!lines) return null;
  const slots: number[] = [];
  const coefs: number[] = [];
  for (const [teamId, sign] of [[game.homeId, 1], [game.awayId, -1]] as const) {
    const own = (lines[teamId] ?? []).filter((line) => line[1] > 0);
    const total = own.reduce((sum, line) => sum + line[1], 0);
    if (total < 200) return null;
    for (const line of own) {
      const slot = state.slots.get(`p:${line[0]}`);
      if (slot === undefined) return null;
      slots.push(slot);
      coefs.push((sign * 5 * line[1]) / total);
    }
    const team = state.slots.get(`t:${teamId}`);
    if (team === undefined) return null;
    slots.push(team);
    coefs.push(sign);
  }
  const { offset, hcaCoefficient } = gameOffsets(state, game);
  if (hcaCoefficient !== 0) {
    slots.push(state.slots.get("h") as number);
    coefs.push(hcaCoefficient);
  }
  let mu = offset;
  let variance = 0;
  for (let a = 0; a < slots.length; a += 1) {
    mu += coefs[a] * state.mean[slots[a]];
    for (let b = 0; b < slots.length; b += 1) variance += coefs[a] * coefs[b] * state.cov[slots[a] * state.capacity + slots[b]];
  }
  return mixtureProbability([{ weight: 1, mu, sd: Math.sqrt(ratings.sigma * ratings.sigma + Math.max(0, variance)) }], state.scale);
}

// ---------------------------------------------------------------------------
// Season simulations (A5, A8)
// ---------------------------------------------------------------------------

function v4SeasonAt(season: number, state: RosterState, etDate: string, options: { backgroundOn: boolean; horizonDays: number | null }): SeasonRead {
  const origin = originFor(season);
  const status = statusMap(season)[season] ?? fit.status.frozen;
  const { input } = buildV4Season(copyRosterState(state), season, SEASON_TEAMS.map((team) => team.id), {
    params: origin.ratings,
    statusTable: status,
    hazards: hazardsFor(season),
    background: origin.background,
    backgroundOn: options.backgroundOn,
    horizonDays: options.horizonDays,
  });
  const known = asOfDate(seasonOutcome(season).seasonGames, etDate);
  const lastGameEtDate: Record<string, string | null> = {};
  for (const team of SEASON_TEAMS) lastGameEtDate[team.id] = state.teamLastDate.get(team.id) ?? null;
  const forecast = simulateSeason({
    season,
    phase: "regular-season",
    games: known,
    state: createFilterState(LIVE_PARAMS),
    params: LIVE_PARAMS,
    asOfEtDate: etDate,
    lastGameEtDate,
    iterations: ITERATIONS,
    v4: input,
  });
  return {
    pMake: new Map(forecast.teams.map((team) => [team.teamId, team.makePlayoffs])),
    projected: new Map(forecast.teams.map((team) => [team.teamId, team.projectedWins])),
  };
}

type SeasonScore = { teamSeasons: number; makePlayoffsBrier: number; winRmse: number };
function scoreSeasons(reads: ReadonlyArray<{ season: number; read: SeasonRead }>): SeasonScore {
  let brierSum = 0;
  let winSum = 0;
  let count = 0;
  for (const { season, read } of reads) {
    const { made, finalWins } = seasonOutcome(season);
    SEASON_TEAMS.forEach((team, index) => {
      const y = made.has(team.id) ? 1 : 0;
      brierSum += ((read.pMake.get(team.id) as number) - y) ** 2;
      winSum += ((read.projected.get(team.id) as number) - finalWins[index]) ** 2;
      count += 1;
    });
  }
  return { teamSeasons: count, makePlayoffsBrier: round(brierSum / count), winRmse: round(Math.sqrt(winSum / count), 3) };
}

type Variant = { backgroundOn: boolean; horizonDays: number | null };
function seasonReads(seasons: readonly number[], checkpoints: readonly CheckpointName[], variants: Record<string, Variant>) {
  const out: Record<string, Record<CheckpointName, Array<{ season: number; read: SeasonRead }>>> = { v1: {} as never };
  for (const name of Object.keys(variants)) out[name] = {} as never;
  for (const checkpoint of checkpoints) for (const name of Object.keys(out)) out[name][checkpoint] = [];
  for (const season of seasons) {
    if (design && CONFIRMATION_SEASONS.includes(season)) throw new Error("Design mode never reads 2022-23 or 2023-24 at season level.");
    const dates = checkpoints.map((checkpoint) => checkpointDate(season, checkpoint));
    const states = replaySeason(season, [...dates].sort());
    checkpoints.forEach((checkpoint, index) => {
      const date = dates[index];
      out.v1[checkpoint].push({ season, read: v1SeasonAt(season, date, ITERATIONS) });
      for (const [name, variant] of Object.entries(variants)) {
        out[name][checkpoint].push({ season, read: v4SeasonAt(season, states.get(date) as RosterState, date, variant) });
      }
    });
    console.log(`[stage-a] season reads ${season} done`);
  }
  return out;
}

function compare(reads: ReturnType<typeof seasonReads>, name: string, checkpoints: readonly CheckpointName[], seasons: readonly number[], brierLimit: number, winLimit: number) {
  return checkpoints.map((checkpoint) => {
    const pick = (model: string) => scoreSeasons(reads[model][checkpoint].filter((entry) => seasons.includes(entry.season)));
    const v1 = pick("v1");
    const v4 = pick(name);
    return {
      checkpoint,
      seasons,
      teamSeasons: v4.teamSeasons,
      v1,
      v4,
      limits: { makePlayoffsBrier: round(v1.makePlayoffsBrier + brierLimit), winRmse: round(v1.winRmse + winLimit, 3) },
      passed: v4.makePlayoffsBrier <= v1.makePlayoffsBrier + brierLimit && v4.winRmse <= v1.winRmse + winLimit,
    };
  });
}

function writeOnce(target: string, output: unknown) {
  if (fs.existsSync(target)) throw new Error(`${path.relative(root, target)} exists: it is never overwritten.`);
  fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// A8 (design mode)
// ---------------------------------------------------------------------------

if (design) {
  const target = process.env.V4_A8_OUT ? path.resolve(process.env.V4_A8_OUT) : path.join(root, "docs/live/v4-a8.json");
  if (fs.existsSync(target)) throw new Error(`${path.relative(root, target)} exists: A8 has run.`);
  const variants: Record<string, Variant> = { v4: { backgroundOn: true, horizonDays: null } };
  if (withS2) for (const days of S2_GRID) variants[`v4-s2-${days}`] = { backgroundOn: true, horizonDays: days };
  const reads = seasonReads(DESIGN_SEASONS, ["dec1", "feb1"], variants);
  const a8 = compare(reads, "v4", ["dec1", "feb1"], DESIGN_SEASONS, LIMITS.a8Brier, LIMITS.a8Wins);
  let s2: unknown = null;
  if (withS2) {
    const grid = S2_GRID.map((days) => {
      const checks = compare(reads, `v4-s2-${days}`, ["dec1", "feb1"], DESIGN_SEASONS, LIMITS.a8Brier, LIMITS.a8Wins);
      const pooled = Math.sqrt(checks.reduce((sum, row) => sum + row.v4.winRmse ** 2, 0) / checks.length);
      return { horizonDays: days, pooledWinRmse: round(pooled, 3), checks, passed: checks.every((row) => row.passed) };
    });
    const chosen = grid.reduce((a, b) => (b.pooledWinRmse < a.pooledWinRmse ? b : a));
    s2 = { grid, chosen: chosen.horizonDays, passed: chosen.passed };
  }
  const output = {
    note: "A8, the season-level diagnostic of v4 on the design seasons (2015-16 to 2018-19 and 2021-22). Not a gate; decides S2 only.",
    iterations: ITERATIONS,
    seasons: DESIGN_SEASONS,
    a8,
    passed: a8.every((row) => row.passed),
    s2,
  };
  writeOnce(target, output);
  if (!smoke) console.log(JSON.stringify(output, null, 1));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Phase B
// ---------------------------------------------------------------------------

const target = smoke ? path.resolve(smokeOut as string) : path.join(root, "docs/live/evaluation-v4-stage-a.json");
if (fs.existsSync(target)) throw new Error("docs/live/evaluation-v4-stage-a.json exists: Stage A has run. It is never run again.");
const s2Days: number | null = (fit as unknown as { s2?: { horizonDays: number } | null }).s2?.horizonDays ?? null;
const problems: string[] = [];

// Reproductions
const v1 = v1GameRows(2024);
const v1Dev = [...v1.values()].filter((row) => row.game.kind === "regular" && row.season > 2005 && row.season <= 2015);
const v2 = v2FinalRows();
const finalIds = [...v2.keys()];
const v1Final = finalIds.map((id) => v1.get(id) as ScoredGame);
const reproduction = {
  v1Dev: { games: v1Dev.length, logLoss: round(logLoss(v1Dev)) },
  v1Final: { games: v1Final.length, brier: round(brier(v1Final), 4) },
  v2Final: { games: finalIds.length, brier: round(brier([...v2.values()]), 4), logLoss: round(logLoss([...v2.values()]), 4) },
};
if (reproduction.v1Dev.games !== REPRODUCE.v1DevGames || reproduction.v1Dev.logLoss !== REPRODUCE.v1DevLogLoss) problems.push("v1 development figures do not reproduce");
if (reproduction.v1Final.games !== REPRODUCE.finalGames || reproduction.v1Final.brier !== REPRODUCE.v1FinalBrier) problems.push("v1 final-point figures do not reproduce");
if (reproduction.v2Final.brier !== REPRODUCE.v2FinalBrier || reproduction.v2Final.logLoss !== REPRODUCE.v2FinalLogLoss) problems.push("v2 fit-season figures do not reproduce");
if (problems.length > 0) {
  fs.writeFileSync(target, `${JSON.stringify({ reproduction, problems, passed: false }, null, 2)}\n`, "utf-8");
  console.error(`[stage-a] blocking: ${problems.join("; ")}`);
  process.exit(2);
}

// Game rows, rolling origin; A7's team-residual ablation in a second pass
const v4Rows: V4Row[] = [];
const noResidual: V4Row[] = [];
for (const season of SCORED_SEASONS) {
  replaySeason(season, [], undefined, (row) => v4Rows.push(row));
  replaySeason(season, [], { tauC: 0, qC: 0 }, (row) => noResidual.push(row));
  console.log(`[stage-a] game rows ${season} done`);
}
const v4ById = new Map(v4Rows.map((row) => [row.id, row]));
if (smoke) finalIds.splice(0, finalIds.length, ...finalIds.filter((id) => v4ById.has(id)));
const dateOf = (id: string) => (v4ById.get(id) as V4Row).game.etDate;
const pairedV1 = (rows: readonly ScoredGame[]) => rows.map((row) => v1.get(row.id) as ScoredGame);

// A1
const a1Interval = pairedDateBootstrap(v4Rows, pairedV1(v4Rows), dateOf, "v4-stage-a-a1");
const a1BySeason = SCORED_SEASONS.map((season) => {
  const rows = v4Rows.filter((row) => row.season === season);
  return { season, games: rows.length, v4: round(brier(rows)), v1: round(brier(pairedV1(rows))), difference: round(brier(rows) - brier(pairedV1(rows))) };
});
const a1 = {
  games: v4Rows.length,
  interval: a1Interval,
  bySeason: a1BySeason,
  seasonsNegative: a1BySeason.filter((row) => row.difference < 0).length,
  passed: a1Interval.upper < 0 && a1BySeason.filter((row) => row.difference < 0).length >= LIMITS.a1SeasonsNegative,
};

// A2
const finalV4 = finalIds.map((id) => v4ById.get(id) as V4Row);
const finalV2 = finalIds.map((id) => v2.get(id) as ScoredGame);
const a2Interval = pairedDateBootstrap(finalV4, finalV2, dateOf, "v4-stage-a-a2");
const a2 = {
  games: finalIds.length,
  v4Brier: round(brier(finalV4)),
  v2Brier: round(brier(finalV2)),
  interval: a2Interval,
  limits: { brier: Math.min(LIMITS.a2Absolute, round(brier(finalV2) + LIMITS.a2Margin)), upper: LIMITS.a2Upper },
  passed: brier(finalV4) <= brier(finalV2) + LIMITS.a2Margin && brier(finalV4) <= LIMITS.a2Absolute && a2Interval.upper <= LIMITS.a2Upper,
  wording: "not worse than v2 on development seasons (v2 was fitted on these games; v4 was not)",
};

// A3
const calibrationRows = v4Rows.filter((row) => row.season >= 2020);
const slope = calibrationFit(calibrationRows).slope;
const a3 = {
  games: calibrationRows.length,
  slope: round(slope, 4),
  reliability: round(reliability(calibrationRows), 6),
  passed: slope >= LIMITS.a3Slope[0] && slope <= LIMITS.a3Slope[1] && reliability(calibrationRows) <= LIMITS.a3Reliability,
};

// A4: injury listings, leave-one-season-out, still out ten team games later
function stillOutRows(observations: readonly GroupedObservation[]) {
  const bySpell = new Map<number, GroupedObservation[]>();
  for (const row of observations) bySpell.set(row.spell, [...(bySpell.get(row.spell) ?? []), row]);
  const out: Array<{ row: GroupedObservation; stillOut: 0 | 1 }> = [];
  for (const spell of bySpell.values()) {
    spell.forEach((row, index) => {
      if (!row.group.startsWith("injury")) return;
      const ahead = spell.slice(index, index + 10);
      if (ahead.some((entry) => entry.returned)) out.push({ row, stillOut: 0 });
      else if (ahead.length === 10) out.push({ row, stillOut: 1 });
    });
  }
  return out;
}
const observations = collectGroupedObservations();
const a4BySeason = REPORT_SEASONS.map((season) => {
  const train = observations.filter((row) => row.season !== season);
  const classTable: HazardTable = fitHazards(train.map((row) => ({ k: row.k, class: row.class, returned: row.returned }))).table;
  const groupTable = hazardsFor(season);
  let v3Loss = 0;
  let v4Loss = 0;
  const rows = stillOutRows(observations.filter((row) => row.season === season));
  for (const { row, stillOut } of rows) {
    let p3 = 1;
    let p4 = 1;
    for (let i = 0; i < 10; i += 1) {
      p3 *= 1 - hazard(classTable, row.k + i, row.class);
      p4 *= 1 - groupHazard(groupTable, row.k + i, row.group, row.class);
    }
    const ll = (p: number) => -(stillOut ? Math.log(clampProbability(p)) : Math.log(1 - clampProbability(p)));
    v3Loss += ll(p3);
    v4Loss += ll(p4);
  }
  return { season, listings: rows.length, v3LogLoss: round(v3Loss / rows.length), v4LogLoss: round(v4Loss / rows.length), v3Sum: v3Loss, v4Sum: v4Loss };
});
const a4Pooled = {
  listings: a4BySeason.reduce((sum, row) => sum + row.listings, 0),
  v3LogLoss: round(a4BySeason.reduce((sum, row) => sum + row.v3Sum, 0) / a4BySeason.reduce((sum, row) => sum + row.listings, 0)),
  v4LogLoss: round(a4BySeason.reduce((sum, row) => sum + row.v4Sum, 0) / a4BySeason.reduce((sum, row) => sum + row.listings, 0)),
};
const a4 = {
  bySeason: a4BySeason.map((row) => ({ season: row.season, listings: row.listings, v3LogLoss: row.v3LogLoss, v4LogLoss: row.v4LogLoss })),
  pooled: a4Pooled,
  passed: a4Pooled.v4LogLoss < a4Pooled.v3LogLoss && a4BySeason.filter((row) => row.v4LogLoss < row.v3LogLoss).length >= 2,
  note: "m was chosen by leave-one-season-out one-step log loss on these seasons (disclosed).",
};

// A5 and A7's S1 ablation
const variants: Record<string, Variant> = {
  v4: { backgroundOn: true, horizonDays: s2Days },
  "v4-no-s1": { backgroundOn: false, horizonDays: s2Days },
};
const reads = seasonReads(A5_SEASONS, ["opening", "dec1", "feb1", "apr1"], variants);
const a5Pooled = compare(reads, "v4", ["dec1", "feb1", "apr1"], A5_SEASONS, LIMITS.a5PooledBrier, LIMITS.a5PooledWins);
const a5Confirmation = compare(reads, "v4", ["dec1", "feb1", "apr1"], CONFIRMATION_SEASONS, LIMITS.a5ConfirmationBrier, LIMITS.a5ConfirmationWins);
const opening = compare(reads, "v4", ["opening"], A5_SEASONS, Infinity, 0)[0];
const a5Reported = compare(reads, "v4", ["dec1", "feb1", "apr1"], [2022, 2023, 2024], Infinity, Infinity).map((row, index) => ({
  ...row,
  v2Registered: { makePlayoffsBrier: REGISTERED_V2_T4.makePlayoffsBrier[index], winRmse: REGISTERED_V2_T4.winRmse[index] },
  passed: undefined,
}));
const a5 = {
  iterations: ITERATIONS,
  pooled: a5Pooled,
  confirmation: a5Confirmation,
  opening: { ...opening, passed: opening.v4.winRmse < opening.v1.winRmse },
  reported2022to2024: a5Reported,
  passed: a5Pooled.every((row) => row.passed) && a5Confirmation.every((row) => row.passed) && opening.v4.winRmse < opening.v1.winRmse,
};

// A7: components (reported; removal is a recommendation, never an edit)
const plugInRows = v4Rows.map((row) => ({ ...row, p: row.plugIn }));
const noS1 = compare(reads, "v4-no-s1", ["dec1", "feb1"], A5_SEASONS, Infinity, Infinity);
const withS1 = compare(reads, "v4", ["dec1", "feb1"], A5_SEASONS, Infinity, Infinity);
const a7 = {
  teamResidual: { metric: "game log loss", with: round(logLoss(v4Rows)), without: round(logLoss(noResidual)), earns: logLoss(noResidual) > logLoss(v4Rows) },
  diagnosisFamilies: { metric: "A4 log loss", with: a4Pooled.v4LogLoss, without: a4Pooled.v3LogLoss, earns: a4Pooled.v3LogLoss > a4Pooled.v4LogLoss },
  integration: { metric: "game log loss", with: round(logLoss(v4Rows)), without: round(logLoss(plugInRows)), earns: logLoss(plugInRows) > logLoss(v4Rows) },
  backgroundS1: {
    metric: "Dec 1 and Feb 1 win error",
    with: withS1.map((row) => row.v4.winRmse),
    without: noS1.map((row) => row.v4.winRmse),
    earns: noS1.every((row, index) => row.v4.winRmse > withS1[index].v4.winRmse),
  },
};

// Reported only
const informationSets = (() => {
  const rows = v4Rows.filter((row) => row.season >= 2022);
  const pick = (key: "p" | "none" | "told") => rows.filter((row) => row[key] !== null).map((row) => ({ ...row, p: row[key] as number }));
  return { games: rows.length, report: round(brier(pick("p"))), none: round(brier(pick("none"))), told: round(brier(pick("told"))), toldGames: pick("told").length };
})();
const beforeDec1 = (() => {
  const rows = v4Rows.filter((row) => row.game.etDate.slice(5) < "12-01" && row.game.etDate.slice(5) > "07-01");
  return { games: rows.length, v4: round(brier(rows)), v1: round(brier(pairedV1(rows))) };
})();
const market = (() => {
  const spreads = new Map<string, number>();
  for (const season of REPORT_SEASONS) for (const [id, value] of Object.entries(devSpreads(season) ?? {})) if (typeof value === "number") spreads.set(id, value);
  const rows = finalV4.filter((row) => spreads.has(row.id));
  let best = { scale: 0, logLoss: Infinity };
  for (let scale = 10; scale <= 16; scale += 0.5) {
    const value = logLoss(rows.map((row) => ({ ...row, p: normalCdf(-(spreads.get(row.id) as number) / scale) })));
    if (value < best.logLoss) best = { scale, logLoss: value };
  }
  const marketRows = rows.map((row) => ({ ...row, p: normalCdf(-(spreads.get(row.id) as number) / best.scale) }));
  return { games: rows.length, scale: best.scale, market: round(brier(marketRows)), v4: round(brier(rows)), v2: round(brier(rows.map((row) => v2.get(row.id) as ScoredGame))), note: "Benchmark read only; the scale is chosen on these games." };
})();

const passed = a1.passed && a2.passed && a3.passed && a4.passed && a5.passed;
const output = {
  note: "Stage A of live-2026.27-v4: a registered development check under rolling origin on seasons seen by the inquiry spike. Not an untouched test. A6 (property tests) is run separately at the same commit.",
  firstScoredSeason: FIRST_SCORED_SEASON,
  reproduction,
  gates: { a1, a2, a3, a4, a5 },
  a7,
  reported: { informationSets, beforeDec1, market, perSeason: a1BySeason },
  s2HorizonDays: s2Days,
  passed,
};
writeOnce(target, output);
if (smoke) process.exit(0);
console.log(JSON.stringify({ passed, a1: a1.passed, a2: a2.passed, a3: a3.passed, a4: a4.passed, a5: a5.passed }, null, 1));
if (!passed) process.exit(2);
