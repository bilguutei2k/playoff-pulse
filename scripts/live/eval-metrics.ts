// Scoring helpers for live-model evaluation.

import { createSeededRandom } from "../../src/lib/model/random";
import { clampProbability } from "../../src/lib/season/math";

export type ScoredGame = {
  id: string;
  season: number;
  p: number;
  y: 0 | 1;
};

export function brier(rows: readonly ScoredGame[]): number {
  let sum = 0;
  for (const row of rows) sum += (row.p - row.y) ** 2;
  return sum / rows.length;
}

export function logLoss(rows: readonly ScoredGame[]): number {
  let sum = 0;
  for (const row of rows) {
    const p = clampProbability(row.p);
    sum -= row.y * Math.log(p) + (1 - row.y) * Math.log(1 - p);
  }
  return sum / rows.length;
}

export function accuracy(rows: readonly ScoredGame[]): number {
  let correct = 0;
  for (const row of rows) if ((row.p > 0.5) === (row.y === 1)) correct += 1;
  return correct / rows.length;
}

export function summarize(rows: readonly ScoredGame[]) {
  return {
    n: rows.length,
    brier: brier(rows),
    logLoss: logLoss(rows),
    accuracy: accuracy(rows),
  };
}

/** Logistic recalibration `logit(y) = a + b*logit(p)`, fitted by Newton's method. */
export function calibrationFit(rows: readonly ScoredGame[]): {
  intercept: number;
  slope: number;
} {
  let a = 0;
  let b = 1;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    let ga = 0;
    let gb = 0;
    let haa = 0;
    let hab = 0;
    let hbb = 0;
    for (const row of rows) {
      const p = clampProbability(row.p);
      const x = Math.log(p / (1 - p));
      const q = 1 / (1 + Math.exp(-(a + b * x)));
      const w = q * (1 - q);
      ga += row.y - q;
      gb += (row.y - q) * x;
      haa += w;
      hab += w * x;
      hbb += w * x * x;
    }
    const det = haa * hbb - hab * hab;
    if (det <= 0) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { intercept: a, slope: b };
}

/** Grouped Murphy reliability on equal-count bins: the repo's standard read. */
export function reliability(rows: readonly ScoredGame[], bins = 10): number {
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  let sum = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor((bin * sorted.length) / bins);
    const end = Math.floor(((bin + 1) * sorted.length) / bins);
    const slice = sorted.slice(start, end);
    if (slice.length === 0) continue;
    const meanP = slice.reduce((total, row) => total + row.p, 0) / slice.length;
    const meanY = slice.reduce((total, row) => total + row.y, 0) / slice.length;
    sum += (slice.length / sorted.length) * (meanP - meanY) ** 2;
  }
  return sum;
}

export type PairedInterval = {
  difference: number;
  lower: number;
  upper: number;
  draws: number;
  clusters: number;
};

/**
 * Paired Brier difference (candidate minus reference) with a season-clustered
 * bootstrap. Matches the repo's 10,000-draw deterministic convention.
 */
export function pairedSeasonBootstrap(
  candidate: readonly ScoredGame[],
  reference: readonly ScoredGame[],
  seed: string,
  draws = 10_000,
): PairedInterval {
  const referenceById = new Map(reference.map((row) => [row.id, row]));
  const totals = new Map<number, { sum: number; n: number }>();
  for (const row of candidate) {
    const match = referenceById.get(row.id);
    if (!match) continue;
    const entry = totals.get(row.season) ?? { sum: 0, n: 0 };
    entry.sum += (row.p - row.y) ** 2 - (match.p - match.y) ** 2;
    entry.n += 1;
    totals.set(row.season, entry);
  }
  const clusters = [...totals.values()];
  const totalSum = clusters.reduce((sum, row) => sum + row.sum, 0);
  const totalN = clusters.reduce((sum, row) => sum + row.n, 0);
  const random = createSeededRandom(seed);
  const samples = new Float64Array(draws);
  for (let draw = 0; draw < draws; draw += 1) {
    let sum = 0;
    let n = 0;
    for (let pick = 0; pick < clusters.length; pick += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      sum += cluster.sum;
      n += cluster.n;
    }
    samples[draw] = sum / n;
  }
  samples.sort();
  return {
    difference: totalSum / totalN,
    lower: samples[Math.floor(0.025 * draws)],
    upper: samples[Math.floor(0.975 * draws)],
    draws,
    clusters: clusters.length,
  };
}

/**
 * Paired Brier difference (candidate minus reference), bootstrapping whole game dates.
 * Used where too few seasons exist to cluster on seasons. Deterministic, like the rest.
 */
export function pairedDateBootstrap(
  candidate: readonly ScoredGame[],
  reference: readonly ScoredGame[],
  dateOf: (gameId: string) => string,
  seed: string,
  draws = 10_000,
): PairedInterval {
  const referenceById = new Map(reference.map((row) => [row.id, row]));
  const totals = new Map<string, { sum: number; n: number }>();
  for (const row of candidate) {
    const match = referenceById.get(row.id);
    if (!match) continue;
    const key = dateOf(row.id);
    const entry = totals.get(key) ?? { sum: 0, n: 0 };
    entry.sum += (row.p - row.y) ** 2 - (match.p - match.y) ** 2;
    entry.n += 1;
    totals.set(key, entry);
  }
  const clusters = [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);
  const totalSum = clusters.reduce((sum, row) => sum + row.sum, 0);
  const totalN = clusters.reduce((sum, row) => sum + row.n, 0);
  const random = createSeededRandom(seed);
  const samples = new Float64Array(draws);
  for (let draw = 0; draw < draws; draw += 1) {
    let sum = 0;
    let n = 0;
    for (let pick = 0; pick < clusters.length; pick += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      sum += cluster.sum;
      n += cluster.n;
    }
    samples[draw] = sum / n;
  }
  samples.sort();
  return {
    difference: totalSum / totalN,
    lower: samples[Math.floor(0.025 * draws)],
    upper: samples[Math.floor(0.975 * draws)],
    draws,
    clusters: clusters.length,
  };
}

export function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}
