// v4 fit, M2: the playoff minutes power kappa, by playoff game log loss on the open seasons,
// one value per rolling origin S (playoffs of 2012-13 to S - 1, with S's rating set) and the
// frozen value (2012-13 to 2023-24, frozen rating set). Kappa changes playoff forecasts only,
// so every grid value is read from one replay per origin.
//
// Run: corepack pnpm exec tsx scripts/live/v4/fit-kappa.ts <origin> [<origin> ...]

import * as fs from "node:fs";
import * as path from "node:path";
import { forecastGame, type StatusWeights, type V4RatingParams } from "../../../src/lib/season/roster-state";
import { FIRST_SCORED_SEASON, runV4 } from "./engine-run";

export const KAPPA_GRID = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2, 2.5];
const root = process.cwd();
const ratingsFile = JSON.parse(fs.readFileSync(path.join(root, "docs/live/v4-fit-parts/ratings.json"), "utf-8")) as {
  origins: Record<string, { params: V4RatingParams }>;
};
const status = JSON.parse(fs.readFileSync(path.join(root, "docs/live/v4-fit-parts/status.json"), "utf-8")) as {
  frozen: { table: StatusWeights };
  beforeOrigin: Record<string, { table: StatusWeights }>;
};
const fallback: StatusWeights = { O: 1, D: 1, Q: 1, P: 1, A: 1 };

for (const origin of process.argv.slice(2).map(Number)) {
  const ratings = ratingsFile.origins[String(origin)].params;
  const table = origin >= 2025 ? status.frozen.table : status.beforeOrigin[String(origin)]?.table;
  const statusFor = (season: number) => (table && season >= 2022 && season < origin ? table : fallback);
  const losses = KAPPA_GRID.map(() => 0);
  let games = 0;
  runV4({
    lastSeason: origin - 1,
    ratings,
    statusFor,
    reportSeasons: [2022, 2023, 2024].filter((season) => season < origin),
    onForecast: (row, state, listing) => {
      if (row.game.kind !== "playoff" || row.game.season < FIRST_SCORED_SEASON) return;
      games += 1;
      KAPPA_GRID.forEach((kappa, index) => {
        const p = forecastGame(state, row.game, listing, { ...ratings, kappa }, statusFor(row.game.season)).homeWinProbability;
        losses[index] -= row.y ? Math.log(p) : Math.log(1 - p);
      });
    },
  });
  const grid = KAPPA_GRID.map((kappa, index) => ({ kappa, logLoss: losses[index] / games }));
  const best = grid.reduce((a, b) => (b.logLoss < a.logLoss ? b : a));
  const target = path.join(root, `docs/live/v4-fit-parts/kappa-${origin}.json`);
  fs.writeFileSync(target, `${JSON.stringify({ origin, games, grid, kappa: best.kappa }, null, 2)}\n`, "utf-8");
  console.log(`[fit-kappa] origin ${origin}: kappa ${best.kappa} on ${games} playoff games`);
}
