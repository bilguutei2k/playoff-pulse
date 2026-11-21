// v4 fit, M1: the rating parameters, by coordinate (compass) search on regular-season log
// loss. One set per rolling origin S (2015-16 to 2023-24), fitted on the seasons before S
// (scored from 2012-13; 2010-11 and 2011-12 only warm the filter), and the frozen set on
// 2010-11 to 2023-24. Seasons with reports (2021-22 on) are forecast with the status table
// fitted on report seasons before the origin (docs/live/v4-fit-parts/status.json).
//
// Search, frozen before any run: from the start point, each round evaluates every
// coordinate one step up and one step down; if any improves, the combination of all
// improving moves is evaluated too, and the best of those is taken. When no move improves,
// the steps shrink (multiplicative 1.5 -> 1.22 -> 1.1; rho 0.05 -> 0.025 -> 0.0125; muNew
// 0.5 -> 0.25 -> 0.125); after the last level the search stops (at most 25 rounds). The
// first origin starts at the spike's values; each later origin starts at the previous
// origin's result, at the second step level.
//
// Run: corepack pnpm exec tsx scripts/live/v4/fit-ratings.ts [workers]

import { fork, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { StatusWeights, V4RatingParams } from "../../../src/lib/season/roster-state";
import { FIRST_SCORED_SEASON } from "./engine-run";

type Scores = Record<number, { n: number; logLoss: number; brier: number }>;
type Key = Exclude<keyof V4RatingParams, "kappa">;

export const ORIGINS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
const START: V4RatingParams = {
  sigma: 11,
  sBox: 13,
  qP: 0.004,
  qC: 0.006,
  qH: 0.0002,
  rhoP: 0.9,
  qOff: 0.2,
  rhoC: 0.75,
  tauC: 0.8,
  muNew: -1,
  tauNew: 2,
  alpha: 0.15,
  kappa: 1,
};
const MULTIPLICATIVE: Key[] = ["sigma", "sBox", "qP", "qC", "qH", "qOff", "tauC", "tauNew", "alpha"];
const RHO: Key[] = ["rhoP", "rhoC"];
const ADDITIVE: Key[] = ["muNew"];
const LEVELS = [
  { factor: 1.5, rho: 0.05, add: 0.5 },
  { factor: 1.22, rho: 0.025, add: 0.25 },
  { factor: 1.1, rho: 0.0125, add: 0.125 },
];
const MAX_ROUNDS = 25;
const KEYS: Key[] = [...MULTIPLICATIVE, ...RHO, ...ADDITIVE];

const root = process.cwd();
const status = JSON.parse(fs.readFileSync(path.join(root, "docs/live/v4-fit-parts/status.json"), "utf-8")) as {
  frozen: { table: StatusWeights };
  beforeOrigin: Record<string, { table: StatusWeights }>;
};
const statusForOrigin = (origin: number): Record<string, StatusWeights> => {
  const table = origin >= 2025 ? status.frozen.table : status.beforeOrigin[String(origin)]?.table;
  const out: Record<string, StatusWeights> = {};
  if (table) for (let season = 2022; season < origin; season += 1) out[String(season)] = table;
  return out;
};

const roundValue = (value: number) => Number(value.toPrecision(10));
function neighbour(params: V4RatingParams, key: Key, direction: 1 | -1, level: (typeof LEVELS)[number]): V4RatingParams | null {
  const value = params[key];
  let next: number;
  if (MULTIPLICATIVE.includes(key)) next = direction > 0 ? value * level.factor : value / level.factor;
  else if (RHO.includes(key)) next = value + direction * level.rho;
  else next = value + direction * level.add;
  if (RHO.includes(key) && (next < 0.3 || next > 1)) return null;
  return { ...params, [key]: roundValue(next) };
}

// --- the pool ---------------------------------------------------------------
const workers = Number(process.argv[2] ?? 6);
const pool: ChildProcess[] = [];
const idle: ChildProcess[] = [];
const waiting: Array<() => void> = [];
const pending = new Map<number, (scores: Scores) => void>();
let nextId = 0;
async function startPool() {
  await Promise.all(
    Array.from({ length: workers }, () =>
      new Promise<void>((resolve) => {
        const child = fork(path.join(root, "scripts/live/v4/fit-worker.ts"), [], { execArgv: ["--import", "tsx"] });
        child.on("message", (message: { ready?: boolean; id?: number; scores?: Scores }) => {
          if (message.ready) {
            pool.push(child);
            idle.push(child);
            resolve();
            return;
          }
          const done = pending.get(message.id as number);
          pending.delete(message.id as number);
          idle.push(child);
          waiting.shift()?.();
          done?.(message.scores as Scores);
        });
      }),
    ),
  );
}
async function evaluateRaw(ratings: V4RatingParams, lastSeason: number, statusMap: Record<string, StatusWeights>): Promise<Scores> {
  while (idle.length === 0) await new Promise<void>((resolve) => waiting.push(resolve));
  const child = idle.pop() as ChildProcess;
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.send({ id, ratings, lastSeason, status: statusMap });
  });
}

const cache = new Map<string, Promise<Scores>>();
let evaluations = 0;
function objective(ratings: V4RatingParams, origin: number): Promise<number> {
  const lastSeason = origin - 1;
  const key = JSON.stringify([ratings, origin]);
  let promise = cache.get(key);
  if (!promise) {
    evaluations += 1;
    promise = evaluateRaw(ratings, lastSeason, statusForOrigin(origin));
    cache.set(key, promise);
  }
  return promise.then((scores) => {
    let loss = 0;
    let n = 0;
    for (let season = FIRST_SCORED_SEASON; season < origin; season += 1) {
      loss += scores[season].logLoss;
      n += scores[season].n;
    }
    return loss / n;
  });
}

async function search(origin: number, start: V4RatingParams, firstLevel: number) {
  let current = start;
  let best = await objective(current, origin);
  const trace: Array<{ round: number; level: number; logLoss: number; moved: string[] }> = [];
  let level = firstLevel;
  for (let round = 0; round < MAX_ROUNDS && level < LEVELS.length; round += 1) {
    const moves = KEYS.flatMap((key) => ([1, -1] as const).map((direction) => ({ key, direction, params: neighbour(current, key, direction, LEVELS[level]) })))
      .filter((move): move is { key: Key; direction: 1 | -1; params: V4RatingParams } => move.params !== null);
    const values = await Promise.all(moves.map((move) => objective(move.params, origin)));
    const improving = new Map<Key, { params: V4RatingParams; value: number; direction: number }>();
    moves.forEach((move, index) => {
      const value = values[index];
      if (value < best && (!improving.has(move.key) || value < (improving.get(move.key) as { value: number }).value)) {
        improving.set(move.key, { params: move.params, value, direction: move.direction });
      }
    });
    if (improving.size === 0) {
      trace.push({ round, level, logLoss: best, moved: [] });
      level += 1;
      continue;
    }
    let candidate: V4RatingParams = current;
    let candidateValue = Infinity;
    let moved: string[] = [];
    for (const [key, entry] of improving) {
      if (entry.value < candidateValue) {
        candidate = entry.params;
        candidateValue = entry.value;
        moved = [key];
      }
    }
    if (improving.size > 1) {
      const combined = { ...current };
      for (const [key, entry] of improving) (combined as Record<string, number>)[key] = entry.params[key];
      const value = await objective(combined, origin);
      if (value < candidateValue) {
        candidate = combined;
        candidateValue = value;
        moved = [...improving.keys()];
      }
    }
    current = candidate;
    best = candidateValue;
    trace.push({ round, level, logLoss: best, moved });
    console.log(`[fit-ratings] origin ${origin} round ${round} level ${level} logLoss ${best.toFixed(6)} moved ${moved.join(",")} (${evaluations} evaluations)`);
  }
  return { params: current, logLoss: best, trace };
}

async function main() {
  await startPool();
  const target = path.join(root, "docs/live/v4-fit-parts/ratings.json");
  const results: Record<string, unknown> = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf-8")).origins ?? {} : {};
  let start = START;
  let firstLevel = 0;
  for (const origin of ORIGINS) {
    const done = results[String(origin)] as { params: V4RatingParams } | undefined;
    if (done) {
      start = done.params;
      firstLevel = 1;
      continue;
    }
    const started = Date.now();
    const result = await search(origin, start, firstLevel);
    results[String(origin)] = { ...result, fitSeasons: [2011, origin - 1], scoredFrom: FIRST_SCORED_SEASON, seconds: (Date.now() - started) / 1000 };
    fs.writeFileSync(target, `${JSON.stringify({ start: START, levels: LEVELS, origins: results }, null, 2)}\n`, "utf-8");
    console.log(`[fit-ratings] origin ${origin} done: ${JSON.stringify(result.params)} logLoss ${result.logLoss.toFixed(6)}`);
    start = result.params;
    firstLevel = 1;
  }
  for (const child of pool) child.kill();
}

main().catch((error) => {
  console.error(error);
  for (const child of pool) child.kill();
  process.exit(1);
});
