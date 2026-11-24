// Stage A' of `live-2026.27-v5` (docs/live/registration-v5.md): a registered reproduction on
// development seasons plus unseen season-level checks, against v4. Open seasons only: games,
// lines and reports through scripts/live/v4/dev-data.ts and plus/minus through
// scripts/live/v5/dev-data-v5.ts, all of which refuse 2024-25 and 2025-26.
//
// Run once, on the lead's go, in a fresh throwaway clone of the registered head:
//   corepack pnpm exec tsx scripts/live/v5/evaluate-stage-a.ts
// Writes docs/live/evaluation-v5-stage-a.json, refuses to run if it exists, exits non-zero on
// a failure (a failed gate is still written and committed as a failure).
//
// Blocking reproductions first: v4's registered per-season Brier (Stage A's
// reported.perSeason), v4's A3 figures and v4's A5 pooled season numbers at each checkpoint,
// with Stage A's seeds, iterations and checkpoint capture. Then, rolling origin with each
// origin's s3 from docs/live/v5-fit.json:
//   G1 (hard) standard information set, 2015-16 to 2023-24: pooled paired Brier v5 - v4 with
//      the 95% interval (10,000-draw bootstrap over game dates) wholly below zero; on the
//      3,690 report-era games the pooled difference negative and negative in >= 2 of 3 seasons.
//   G2 (hard) 2019-20 to 2023-24 in A3's form: slope 0.93 to 1.07, grouped reliability <= 0.002.
//   G3 (hard, non-inferiority at season level) 4,000 iterations, v4's A5 seasons, Dec 1, Feb 1,
//      Apr 1 pooled: make-playoffs Brier <= v4 + 0.003 and win RMSE <= v4 + 0.15; opening night
//      win RMSE <= v4 + 0.15. v5's state goes through v4's simulator input (buildV4Season).
//   G4 the v5 tests, run separately at the same commit (recorded by whoever runs the gate).
// Reported only: per-season table, games before Dec 1, the told-participation set, 7a's pooled
// and 28+ coefficients, the market gap on spread games, s3 by origin.

import * as fs from "node:fs";
import * as path from "node:path";
import { buildV4Season, type BackgroundParams, type GroupHazardTable } from "../../../src/lib/season/availability-v4";
import { mixtureProbability } from "../../../src/lib/season/forecast-v4";
import { normalCdf } from "../../../src/lib/season/math";
import { rescaleWeights } from "../../../src/lib/season/minutes-v4";
import { LIVE_PARAMS } from "../../../src/lib/season/params";
import { V4_FIXED } from "../../../src/lib/season/params-v4";
import { V5_MODEL_VERSION, withOnCourt } from "../../../src/lib/season/params-v5";
import { createFilterState } from "../../../src/lib/season/ratings";
import * as v4 from "../../../src/lib/season/roster-state";
import * as v5 from "../../../src/lib/season/roster-state-v5";
import { simulateSeason } from "../../../src/lib/season/simulate";
import { SEASON_TEAMS } from "../../../src/lib/season/teams";
import type { SeasonGame } from "../../../src/lib/season/types";
import { brier, calibrationFit, logLoss, pairedDateBootstrap, reliability, round, type ScoredGame } from "../eval-metrics";
import { devOpeningRosters, devSpreads } from "../v4/dev-data";
import { finalPoint, openData, REPORT_SEASONS } from "../v4/engine-run";
import { asOfDate, checkpointDate, seasonOutcome, v2FinalRows, type CheckpointName, type SeasonRead } from "../v4/references";
import { devPlusMinusLookup } from "./dev-data-v5";

const root = process.cwd();
const target = path.join(root, "docs/live/evaluation-v5-stage-a.json");
if (fs.existsSync(target)) throw new Error("docs/live/evaluation-v5-stage-a.json exists: Stage A' has run. It is never run again.");

const ITERATIONS = 4000;
const SCORED = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const A5_SEASONS = [2016, 2017, 2018, 2019, 2022, 2023, 2024];
const LIMITS = { g2Slope: [0.93, 1.07] as const, g2Reliability: 0.002, g3Brier: 0.003, g3Wins: 0.15 };

type OriginSet = { ratings: v4.V4RatingParams; background: BackgroundParams };
type V4Fit = {
  origins: Record<string, OriginSet>;
  status: { frozen: v4.StatusWeights; leaveOneOut: Record<string, v4.StatusWeights>; beforeOrigin: Record<string, v4.StatusWeights> };
  hazards: { frozen: GroupHazardTable; leaveOneOut: Record<string, GroupHazardTable> };
};
const fit = JSON.parse(fs.readFileSync(path.join(root, "docs/live/v4-fit.json"), "utf-8")) as V4Fit;
const v5Fit = JSON.parse(fs.readFileSync(path.join(root, "docs/live/v5-fit.json"), "utf-8")) as { version: string; origins: Record<string, { s3: number | null; chosen: string }> };
if (v5Fit.version !== V5_MODEL_VERSION) throw new Error("docs/live/v5-fit.json is not v5's fit.");
const stageA = JSON.parse(fs.readFileSync(path.join(root, "docs/live/evaluation-v4-stage-a.json"), "utf-8"));

const originFor = (season: number): OriginSet => fit.origins[String(season)];
function statusMap(season: number): Record<number, v4.StatusWeights> {
  const out: Record<number, v4.StatusWeights> = {};
  for (const report of REPORT_SEASONS) {
    if (report < season) out[report] = fit.status.beforeOrigin[String(season)];
    if (report === season) out[report] = fit.status.leaveOneOut[String(season)];
  }
  return out;
}
const hazardsFor = (season: number): GroupHazardTable => fit.hazards.leaveOneOut[String(season)] ?? fit.hazards.frozen;
const s3For = (season: number): number | null => v5Fit.origins[String(season)].s3;

// ---------------------------------------------------------------------------
// Replays (Stage A's replaySeason, for either engine)
// ---------------------------------------------------------------------------

type Model = "v4" | "v5";
type Row = ScoredGame & {
  game: SeasonGame;
  muToldP: number | null;
  pToldP: number | null;
  /** Per side [home, away]: full-health strength minus told-participation strength (all), and minus full health with only one tier's absentees removed (tiers: 28+, 20 to 28, under 20 full-health expected minutes). */
  absence: { all: [number, number]; tiers: Array<[number, number]> } | null;
};

function paramsFor(model: Model, season: number): v4.V4RatingParams {
  const ratings = originFor(season).ratings;
  if (model === "v4") return ratings;
  return withOnCourt(ratings, { s3: s3For(season), plusMinus: devPlusMinusLookup(2011, season) });
}

type W = Array<[string, number]>;
function strength(state: v4.RosterState, ws: W): number | null {
  let s = 0;
  for (const [key, w] of ws) {
    const slot = state.slots.get(key);
    if (slot === undefined) return null;
    s += w * state.mean[slot];
  }
  return s;
}
function told(state: v4.RosterState, game: SeasonGame, lines: v4.V4GameLines | undefined, ratings: v4.V4RatingParams) {
  const sides = [game.homeId, game.awayId].map((teamId) => {
    const own = (lines?.[teamId] ?? []).filter((line) => line[1] > 0);
    if (own.reduce((sum, line) => sum + line[1], 0) < 200) return null;
    const played = new Set(own.map((line) => line[0]));
    const toldP = rescaleWeights(own.map((line) => [`p:${line[0]}`, state.minutes.players.get(line[0])?.average ?? V4_FIXED.newPlayerMinutes] as [string, number]));
    const terms = v4.fullHealthTerms(state, teamId);
    const full = rescaleWeights(terms.map((t) => [`p:${t.athleteId}`, t.raw] as [string, number]));
    const fullW = new Map(full);
    const tierOf = (minutes: number) => (minutes >= 28 ? 0 : minutes >= 20 ? 1 : 2);
    const tierOut = [0, 1, 2].map((k) =>
      rescaleWeights(
        terms.map((t) => {
          const key = `p:${t.athleteId}`;
          const minutes = 48 * (fullW.get(key) ?? 0);
          return [key, !played.has(t.athleteId) && minutes > 0 && tierOf(minutes) === k ? 0 : t.raw] as [string, number];
        }),
      ),
    );
    return { toldP, full, tierOut };
  });
  const [home, away] = sides;
  if (!home || !away) return { muToldP: null, pToldP: null, absence: null };
  const slots: number[] = [];
  const coefs: number[] = [];
  for (const [ws, sign] of [[home.toldP, 1], [away.toldP, -1]] as const) {
    for (const [key, w] of ws) {
      const slot = state.slots.get(key);
      if (slot === undefined) return { muToldP: null, pToldP: null, absence: null };
      slots.push(slot);
      coefs.push(sign * w);
    }
  }
  for (const [teamId, sign] of [[game.homeId, 1], [game.awayId, -1]] as const) {
    slots.push(state.slots.get(`t:${teamId}`) as number);
    coefs.push(sign);
  }
  const { offset, hcaCoefficient } = v4.gameOffsets(state, game);
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
  const pToldP = mixtureProbability([{ weight: 1, mu, sd: Math.sqrt(ratings.sigma * ratings.sigma + Math.max(0, variance)) }], state.scale);
  const pair = (side: NonNullable<typeof home>) => {
    const full = side.full.length > 0 ? strength(state, side.full) : null;
    const toldS = strength(state, side.toldP);
    const tiers = side.tierOut.map((ws) => strength(state, ws));
    if (full === null || toldS === null || tiers.some((value) => value === null)) return null;
    return { all: full - toldS, tiers: tiers.map((value) => full - (value as number)) };
  };
  const h = pair(home);
  const a = pair(away);
  return { muToldP: mu, pToldP, absence: h && a ? { all: [h.all, a.all] as [number, number], tiers: [0, 1, 2].map((k) => [h.tiers[k], a.tiers[k]] as [number, number]) } : null };
}

/** Season S under its origin set, states captured at the given ET dates (sorted), as Stage A captured them. */
function replaySeason(model: Model, season: number, captureAt: readonly string[], onRow?: (row: Row) => void): Map<string, v4.RosterState> {
  const engine = model === "v4" ? v4 : (v5 as unknown as typeof v4);
  const { games, lines } = openData();
  const params = paramsFor(model, season);
  const status = statusMap(season);
  const fallback: v4.StatusWeights = { O: 1, D: 1, Q: 1, P: 1, A: 1 };
  const statusFor = (s: number) => status[s] ?? fallback;
  const reportSet = new Set(Object.keys(status).map(Number));
  const list = games.filter((game) => game.season <= season);
  const captured = new Map<string, v4.RosterState>();
  const state = engine.createRosterState();
  let start = 0;
  const run = (through: string | undefined) => {
    let end = start;
    while (end < list.length && (through === undefined || list[end].etDate < through)) end += 1;
    engine.replayRosterState({
      games: list.slice(start, end),
      linesFor: lines,
      reportFor: (game) => (reportSet.has(game.season) ? finalPoint(game) : null),
      openingRosters: devOpeningRosters,
      params,
      statusTable: statusFor,
      state,
      onForecast: onRow
        ? (row, current) => {
            if (row.game.season !== season || row.game.kind !== "regular") return;
            onRow({ id: row.game.id, season, p: row.forecast.homeWinProbability, y: row.y, game: row.game, ...told(current, row.game, lines(row.game.id), params) });
          }
        : undefined,
    });
    start = end;
  };
  for (const date of captureAt) {
    run(date);
    const copy = engine.copyRosterState(state);
    engine.advanceTo(copy, season, date, params, devOpeningRosters);
    captured.set(date, copy);
  }
  if (onRow) run(undefined);
  return captured;
}

function seasonAt(season: number, state: v4.RosterState, etDate: string): SeasonRead {
  const origin = originFor(season);
  const status = statusMap(season)[season] ?? fit.status.frozen;
  const { input } = buildV4Season(v4.copyRosterState(state), season, SEASON_TEAMS.map((team) => team.id), {
    params: origin.ratings,
    statusTable: status,
    hazards: hazardsFor(season),
    background: origin.background,
    backgroundOn: true,
    horizonDays: null,
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
      brierSum += ((read.pMake.get(team.id) as number) - (made.has(team.id) ? 1 : 0)) ** 2;
      winSum += ((read.projected.get(team.id) as number) - finalWins[index]) ** 2;
      count += 1;
    });
  }
  return { teamSeasons: count, makePlayoffsBrier: round(brierSum / count), winRmse: round(Math.sqrt(winSum / count), 3) };
}

const CHECKPOINTS: CheckpointName[] = ["opening", "dec1", "feb1", "apr1"];
function seasonReads(model: Model) {
  const out = Object.fromEntries(CHECKPOINTS.map((checkpoint) => [checkpoint, [] as Array<{ season: number; read: SeasonRead }>])) as Record<CheckpointName, Array<{ season: number; read: SeasonRead }>>;
  for (const season of A5_SEASONS) {
    const dates = CHECKPOINTS.map((checkpoint) => checkpointDate(season, checkpoint));
    const states = replaySeason(model, season, [...dates].sort());
    CHECKPOINTS.forEach((checkpoint, index) => out[checkpoint].push({ season, read: seasonAt(season, states.get(dates[index]) as v4.RosterState, dates[index]) }));
    console.log(`[stage-a'] ${model} season reads ${season} done`);
  }
  return Object.fromEntries(CHECKPOINTS.map((checkpoint) => [checkpoint, scoreSeasons(out[checkpoint])])) as Record<CheckpointName, SeasonScore>;
}

// ---------------------------------------------------------------------------
// Helpers for the reported-only regressions (OLS, HC1)
// ---------------------------------------------------------------------------

function ols(x: number[][], y: number[]): Array<{ coef: number; se: number }> {
  const n = y.length;
  const k = x[0].length + 1;
  const X = x.map((row) => [1, ...row]);
  const xtx = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => X.reduce((sum, row) => sum + row[a] * row[b], 0)));
  const inv = invert(xtx);
  const xty = Array.from({ length: k }, (_, a) => X.reduce((sum, row, i) => sum + row[a] * y[i], 0));
  const beta = inv.map((row) => row.reduce((sum, value, b) => sum + value * xty[b], 0));
  const e = X.map((row, i) => y[i] - row.reduce((sum, value, a) => sum + value * beta[a], 0));
  const meat = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => X.reduce((sum, row, i) => sum + row[a] * row[b] * e[i] * e[i], 0)));
  const cov = multiply(multiply(inv, meat), inv).map((row) => row.map((value) => (value * n) / (n - k)));
  return beta.slice(1).map((coef, index) => ({ coef: round(coef, 4), se: round(Math.sqrt(cov[index + 1][index + 1]), 4) }));
}
function multiply(a: number[][], b: number[][]): number[][] {
  return a.map((row) => b[0].map((_, j) => row.reduce((sum, value, t) => sum + value * b[t][j], 0)));
}
function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const p = a[c][c];
    for (let j = 0; j < 2 * n; j += 1) a[c][j] /= p;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j += 1) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}
function sevenA(rows: readonly Row[]) {
  const usable = rows.filter((row) => row.muToldP !== null && row.absence !== null);
  const y = usable.map((row) => (row.game.homeScore as number) - (row.game.awayScore as number) - (row.muToldP as number));
  const absence = (row: Row) => row.absence as NonNullable<Row["absence"]>;
  const pooled = ols(usable.map((row) => [absence(row).all[1] - absence(row).all[0]]), y)[0];
  const tiers = ols(usable.map((row) => absence(row).tiers.map(([home, away]) => away - home)), y);
  return { games: usable.length, pooled, tiers: { "28+": tiers[0], "20-28": tiers[1], "under 20": tiers[2] }, note: "Told residual (final margin minus told-participation expected margin) on A_away - A_home, OLS with HC1 SE; tiers jointly, as the residual study's section 7a." };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const problems: string[] = [];
const rows: Record<Model, Row[]> = { v4: [], v5: [] };
for (const season of SCORED) {
  replaySeason("v4", season, [], (row) => rows.v4.push(row));
  replaySeason("v5", season, [], (row) => rows.v5.push(row));
  console.log(`[stage-a'] game rows ${season} done`);
}
const byId = (list: readonly Row[]) => new Map(list.map((row) => [row.id, row]));
const v4ById = byId(rows.v4);
const dateOf = (id: string) => (v4ById.get(id) as Row).game.etDate;

// Reproductions (blocking)
const perSeason = SCORED.map((season) => {
  const a = rows.v4.filter((row) => row.season === season);
  const b = rows.v5.filter((row) => row.season === season);
  return { season, games: a.length, v4: round(brier(a)), v5: round(brier(b)), difference: round(brier(b) - brier(a)), v4LogLoss: round(logLoss(a)), v5LogLoss: round(logLoss(b)) };
});
const registeredPerSeason = stageA.reported.perSeason as Array<{ season: number; games: number; v4: number }>;
for (const row of registeredPerSeason) {
  const mine = perSeason.find((entry) => entry.season === row.season);
  if (!mine || mine.games !== row.games || mine.v4 !== row.v4) problems.push(`v4 per-season Brier does not reproduce for ${row.season}`);
}
const calibrationRows = (list: readonly Row[]) => list.filter((row) => row.season >= 2020);
const v4Slope = round(calibrationFit(calibrationRows(rows.v4)).slope, 4);
const v4Reliability = round(reliability(calibrationRows(rows.v4)), 6);
if (v4Slope !== stageA.gates.a3.slope || v4Reliability !== stageA.gates.a3.reliability || calibrationRows(rows.v4).length !== stageA.gates.a3.games) problems.push("v4's A3 figures do not reproduce");
if (problems.length > 0) {
  fs.writeFileSync(target, `${JSON.stringify({ reproduction: { perSeason, v4Slope, v4Reliability }, problems, passed: false }, null, 2)}\n`);
  console.error(`[stage-a'] blocking: ${problems.join("; ")}`);
  process.exit(2);
}

// G1
const g1Interval = pairedDateBootstrap(rows.v5, rows.v4, dateOf, "v5-stage-a-g1");
const finalIds = [...v2FinalRows().keys()];
const v5ById = byId(rows.v5);
const reportV4 = finalIds.map((id) => v4ById.get(id) as Row);
const reportV5 = finalIds.map((id) => v5ById.get(id) as Row);
const reportBySeason = REPORT_SEASONS.map((season) => {
  const a = reportV4.filter((row) => row.season === season);
  const b = reportV5.filter((row) => row.season === season);
  return { season, games: a.length, v4: round(brier(a)), v5: round(brier(b)), difference: round(brier(b) - brier(a)) };
});
const reportDifference = brier(reportV5) - brier(reportV4);
const g1 = {
  games: rows.v5.length,
  v4: round(brier(rows.v4)),
  v5: round(brier(rows.v5)),
  logLoss: { v4: round(logLoss(rows.v4)), v5: round(logLoss(rows.v5)) },
  interval: g1Interval,
  seasonsNegative: perSeason.filter((row) => row.difference < 0).length,
  reportEra: { games: reportV5.length, difference: round(reportDifference), bySeason: reportBySeason, seasonsNegative: reportBySeason.filter((row) => row.difference < 0).length },
  passed: g1Interval.upper < 0 && reportDifference < 0 && reportBySeason.filter((row) => row.difference < 0).length >= 2,
};

// G2
const v5Slope = calibrationFit(calibrationRows(rows.v5)).slope;
const v5Reliability = reliability(calibrationRows(rows.v5));
const g2 = {
  games: calibrationRows(rows.v5).length,
  slope: round(v5Slope, 4),
  reliability: round(v5Reliability, 6),
  v4: { slope: v4Slope, reliability: v4Reliability },
  passed: v5Slope >= LIMITS.g2Slope[0] && v5Slope <= LIMITS.g2Slope[1] && v5Reliability <= LIMITS.g2Reliability,
};

// v4's A5 reproduction (blocking), then G3
const v4Season = seasonReads("v4");
const registeredA5 = stageA.gates.a5 as { pooled: Array<{ checkpoint: CheckpointName; v4: SeasonScore }>; opening: { v4: SeasonScore } };
for (const row of registeredA5.pooled) {
  const mine = v4Season[row.checkpoint];
  if (mine.makePlayoffsBrier !== row.v4.makePlayoffsBrier || mine.winRmse !== row.v4.winRmse) problems.push(`v4's A5 ${row.checkpoint} does not reproduce`);
}
if (v4Season.opening.winRmse !== registeredA5.opening.v4.winRmse) problems.push("v4's A5 opening night does not reproduce");
if (problems.length > 0) {
  fs.writeFileSync(target, `${JSON.stringify({ reproduction: { perSeason, v4Slope, v4Reliability, v4Season }, g1, g2, problems, passed: false }, null, 2)}\n`);
  console.error(`[stage-a'] blocking: ${problems.join("; ")}`);
  process.exit(2);
}
const v5Season = seasonReads("v5");
const g3Checks = (["dec1", "feb1", "apr1"] as const).map((checkpoint) => ({
  checkpoint,
  v4: v4Season[checkpoint],
  v5: v5Season[checkpoint],
  limits: { makePlayoffsBrier: round(v4Season[checkpoint].makePlayoffsBrier + LIMITS.g3Brier), winRmse: round(v4Season[checkpoint].winRmse + LIMITS.g3Wins, 3) },
  passed: v5Season[checkpoint].makePlayoffsBrier <= v4Season[checkpoint].makePlayoffsBrier + LIMITS.g3Brier && v5Season[checkpoint].winRmse <= v4Season[checkpoint].winRmse + LIMITS.g3Wins,
}));
const g3Opening = { v4: v4Season.opening, v5: v5Season.opening, limit: round(v4Season.opening.winRmse + LIMITS.g3Wins, 3), passed: v5Season.opening.winRmse <= v4Season.opening.winRmse + LIMITS.g3Wins };
const g3 = { iterations: ITERATIONS, seasons: A5_SEASONS, checks: g3Checks, opening: g3Opening, passed: g3Checks.every((row) => row.passed) && g3Opening.passed };

// Reported only
const beforeDec1 = (() => {
  const pick = (list: readonly Row[]) => list.filter((row) => row.game.etDate.slice(5) < "12-01" && row.game.etDate.slice(5) > "07-01");
  return { games: pick(rows.v5).length, v4: round(brier(pick(rows.v4))), v5: round(brier(pick(rows.v5))) };
})();
const toldSet = (() => {
  const ids = rows.v5.filter((row) => row.pToldP !== null && v4ById.get(row.id)?.pToldP != null).map((row) => row.id);
  const pick = (map: Map<string, Row>) => ids.map((id) => ({ ...(map.get(id) as Row), p: (map.get(id) as Row).pToldP as number }));
  return { games: ids.length, v4: round(brier(pick(v4ById))), v5: round(brier(pick(v5ById))), interval: pairedDateBootstrap(pick(v5ById), pick(v4ById), dateOf, "v5-stage-a-told") };
})();
const market = (() => {
  const spreads = new Map<string, number>();
  for (const season of REPORT_SEASONS) for (const [id, value] of Object.entries(devSpreads(season) ?? {})) if (typeof value === "number") spreads.set(id, value);
  const ids = finalIds.filter((id) => spreads.has(id));
  let best = { scale: 0, logLoss: Infinity };
  for (let scale = 10; scale <= 16; scale += 0.5) {
    const value = logLoss(ids.map((id) => ({ ...(v4ById.get(id) as Row), p: normalCdf(-(spreads.get(id) as number) / scale) })));
    if (value < best.logLoss) best = { scale, logLoss: value };
  }
  const marketBrier = brier(ids.map((id) => ({ ...(v4ById.get(id) as Row), p: normalCdf(-(spreads.get(id) as number) / best.scale) })));
  const a = brier(ids.map((id) => v4ById.get(id) as Row));
  const b = brier(ids.map((id) => v5ById.get(id) as Row));
  return { games: ids.length, scale: best.scale, market: round(marketBrier), v4: round(a), v5: round(b), gapV4: round(a - marketBrier), gapV5: round(b - marketBrier), note: "Benchmark read only; the scale is chosen on these games, as in v4's Stage A." };
})();

const passed = g1.passed && g2.passed && g3.passed;
const output = {
  note: "Stage A' of live-2026.27-v5: a registered reproduction on development seasons (the on-court result on these seasons was seen before registration) plus unseen season-level checks (G3). Not an untouched test. G4 (the v5 tests) is run separately at the same commit.",
  reproduction: { v4PerSeason: "exact", v4A3: { slope: v4Slope, reliability: v4Reliability }, v4A5: v4Season },
  s3ByOrigin: Object.fromEntries(SCORED.map((season) => [season, v5Fit.origins[String(season)].chosen])),
  gates: { g1, g2, g3 },
  reported: { perSeason, beforeDec1, told: toldSet, sevenA: { v4: sevenA(rows.v4), v5: sevenA(rows.v5) }, market },
  passed,
};
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
console.log(JSON.stringify({ passed, g1: g1.passed, g2: g2.passed, g3: g3.passed }, null, 1));
if (!passed) process.exit(2);
