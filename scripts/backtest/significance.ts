// Paired bootstrap significance analysis for the full committed reconstruction.
//
// For every playoff_pulse-vs-baseline contrast this computes the observed
// Brier difference plus percentile confidence intervals from paired
// resampling. Two resampling units are reported:
//   - series: resample series with replacement (primary)
//   - season: resample seasons with replacement (robustness check,
//     matching the rolling-origin protocol in research-model.ts)
//
// A difference is only treated as conclusive when its 95% interval excludes
// zero under BOTH resampling units.

import fs from "node:fs";
import path from "node:path";

type PredictionRow = {
  seriesId: string;
  season: number;
  modelName: string;
  predictedProbabilityA: number;
  actualOutcome: number;
};

const ROOT = path.join(__dirname, "..", "..");
const PREDICTIONS_PATH = path.join(ROOT, "docs", "backtest", "predictions.json");
const OUTPUT_PATH = path.join(ROOT, "docs", "backtest", "significance.json");

const CANDIDATE = "playoff_pulse";
const BASELINES = [
  "srs_proxy_only",
  "net_rating_only",
  "higher_seed",
  "home_team",
  "coinflip",
];
const ITERATIONS = 10000;

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentileInterval(sorted: number[]): [number, number] {
  const lower = sorted[Math.floor(sorted.length * 0.025)];
  const upper = sorted[Math.ceil(sorted.length * 0.975) - 1];
  return [lower, upper];
}

function squaredError(row: PredictionRow): number {
  return (row.predictedProbabilityA - row.actualOutcome) ** 2;
}

type SeriesLoss = { seriesId: string; season: number; diff: number };

function bootstrap(
  losses: SeriesLoss[],
  unit: "series" | "season",
  seed: number,
) {
  const random = createRandom(seed);
  const seasons = [...new Set(losses.map((row) => row.season))].sort();
  const bySeason = new Map(
    seasons.map((season) => [season, losses.filter((row) => row.season === season)]),
  );
  const differences: number[] = [];

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    let sample: SeriesLoss[];
    if (unit === "series") {
      sample = Array.from(
        { length: losses.length },
        () => losses[Math.floor(random() * losses.length)],
      );
    } else {
      sample = Array.from(
        { length: seasons.length },
        () => bySeason.get(seasons[Math.floor(random() * seasons.length)])!,
      ).flat();
    }
    differences.push(mean(sample.map((row) => row.diff)));
  }

  differences.sort((a, b) => a - b);
  return {
    ci95: percentileInterval(differences),
    probabilityCandidateBetter:
      differences.filter((value) => value < 0).length / ITERATIONS,
  };
}

function main() {
  const rows: PredictionRow[] = JSON.parse(
    fs.readFileSync(PREDICTIONS_PATH, "utf-8"),
  );
  const byModel = new Map<string, Map<string, PredictionRow>>();
  for (const row of rows) {
    if (!byModel.has(row.modelName)) {
      byModel.set(row.modelName, new Map());
    }
    byModel.get(row.modelName)!.set(row.seriesId, row);
  }

  const candidateRows = byModel.get(CANDIDATE);
  if (!candidateRows) {
    throw new Error(`No predictions found for ${CANDIDATE}`);
  }
  const seriesIds = [...candidateRows.keys()].sort();

  const comparisons = BASELINES.map((baseline, index) => {
    const baselineRows = byModel.get(baseline);
    if (!baselineRows) {
      throw new Error(`No predictions found for ${baseline}`);
    }

    const losses: SeriesLoss[] = seriesIds.map((seriesId) => {
      const candidateRow = candidateRows.get(seriesId)!;
      const baselineRow = baselineRows.get(seriesId);
      if (!baselineRow) {
        throw new Error(`Missing ${baseline} prediction for ${seriesId}`);
      }
      return {
        seriesId,
        season: candidateRow.season,
        diff: squaredError(candidateRow) - squaredError(baselineRow),
      };
    });

    const observed = mean(losses.map((row) => row.diff));
    const bySeries = bootstrap(losses, "series", 0x51f15e + index);
    const bySeason = bootstrap(losses, "season", 0xa11ce + index);
    const conclusive =
      (bySeries.ci95[1] < 0 && bySeason.ci95[1] < 0) ||
      (bySeries.ci95[0] > 0 && bySeason.ci95[0] > 0);

    return {
      baseline,
      candidateMinusBaselineBrier: observed,
      seriesResampled: bySeries,
      seasonResampled: bySeason,
      conclusive,
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    candidate: CANDIDATE,
    n: seriesIds.length,
    iterations: ITERATIONS,
    method:
      "Paired bootstrap over per-series squared-error differences. Negative values favor playoff_pulse. 95% percentile intervals; 'conclusive' requires the interval to exclude zero under both series and season resampling.",
    comparisons,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`Wrote ${OUTPUT_PATH}`);
  for (const comparison of comparisons) {
    const [lo, hi] = comparison.seriesResampled.ci95;
    console.log(
      `${CANDIDATE} - ${comparison.baseline}: ${comparison.candidateMinusBaselineBrier.toFixed(6)} ` +
        `[series CI ${lo.toFixed(6)}, ${hi.toFixed(6)}] ` +
        `[season CI ${comparison.seasonResampled.ci95[0].toFixed(6)}, ${comparison.seasonResampled.ci95[1].toFixed(6)}] ` +
        `conclusive=${comparison.conclusive}`,
    );
  }
}

main();
