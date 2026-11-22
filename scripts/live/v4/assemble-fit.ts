// Writes docs/live/v4-fit.json from the fit parts (docs/live/v4-fit-parts/), with
// provenance: the commit the rating fit ran from, and the sha256 of every code and data file
// the fits read. params-v4.ts copies the frozen set by hand; a test pins the two together.
//
// Run: corepack pnpm exec tsx scripts/live/v4/assemble-fit.ts <rating-fit-commit>

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { V4_MODEL_VERSION } from "../../../src/lib/season/params-v4";

const root = process.cwd();
const part = (name: string) => JSON.parse(fs.readFileSync(path.join(root, "docs/live/v4-fit-parts", name), "utf-8"));
const sha = (file: string) => createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
const ratingCommit = process.argv[2];
if (!ratingCommit) throw new Error("Pass the commit the rating fit ran from.");

const ratings = part("ratings.json");
const background = part("background.json");
const status = part("status.json");
const hazards = part("hazards.json");
const ORIGINS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const origins: Record<string, unknown> = {};
for (const origin of ORIGINS) {
  const kappa = part(`kappa-${origin}.json`);
  origins[String(origin)] = {
    fitSeasons: [2011, origin - 1],
    ratings: { ...ratings.origins[String(origin)].params, kappa: kappa.kappa },
    ratingLogLoss: ratings.origins[String(origin)].logLoss,
    kappaGames: kappa.games,
    background: background.origins[String(origin)].params,
  };
}
const code = [
  "src/lib/season/roster-state.ts",
  "src/lib/season/minutes-v4.ts",
  "src/lib/season/forecast-v4.ts",
  "src/lib/season/availability-v4.ts",
  "src/lib/season/params-v4.ts",
  "src/lib/season/injury-v3.ts",
  "scripts/live/v4/dev-data.ts",
  "scripts/live/v4/season-files.ts",
  "scripts/live/v4/engine-run.ts",
  "scripts/live/v4/fit-status.ts",
  "scripts/live/v4/fit-ratings.ts",
  "scripts/live/v4/fit-worker.ts",
  "scripts/live/v4/fit-kappa.ts",
  "scripts/live/v4/fit-background.ts",
  "scripts/live/v4/fit-hazards.ts",
  "scripts/live/v4/hazard-data.ts",
  "scripts/live/v4/assemble-fit.ts",
];
const data = [
  ...Array.from({ length: 14 }, (_, i) => `data/season/player-games/${2011 + i}.json.gz`),
  ...Array.from({ length: 20 }, (_, i) => `data/season/games/${2005 + i}.json`),
  ...[2021, 2022, 2023, 2024].map((season) => `data/season/boxscores/${season}.json`),
  ...[2022, 2023, 2024].map((season) => `data/season/reports/${season}.json`),
];
const out = {
  version: V4_MODEL_VERSION,
  note:
    "Rolling-origin sets: origin S is fitted on seasons before S (2010-11 and 2011-12 warm the filter; scored from 2012-13). " +
    "Origin 2025 is the frozen set (2010-11 to 2023-24). Status weights and hazards: leave-one-season-out tables score a report season; " +
    "before-origin status tables serve the rating fits. No season after 2023-24 was read.",
  frozen: origins["2025"],
  origins,
  status: {
    frozen: status.frozen.table,
    frozenCounts: status.frozen.counts,
    leaveOneOut: Object.fromEntries(Object.entries(status.leaveOneOut).map(([season, row]) => [season, (row as { table: unknown }).table])),
    beforeOrigin: Object.fromEntries(Object.entries(status.beforeOrigin).map(([season, row]) => [season, (row as { table: unknown }).table])),
  },
  hazards: {
    observations: hazards.observations,
    groups: hazards.groups,
    shrinkageGrid: hazards.shrinkageGrid,
    shrinkage: hazards.shrinkage,
    frozen: hazards.frozen,
    leaveOneOut: hazards.leaveOneOut,
  },
  backgroundGrid: { halfLives: background.halfLives, shrinkages: background.shrinkages, widerHalfLives: background.widerHalfLives, widerShrinkages: background.widerShrinkages },
  ratingSearch: { start: ratings.start, levels: ratings.levels, traces: Object.fromEntries(Object.entries(ratings.origins).map(([origin, row]) => [origin, (row as { trace: unknown }).trace])) },
  s2: null,
  provenance: {
    ratingFitCommit: ratingCommit,
    assembledAt: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim(),
    code: Object.fromEntries(code.map((file) => [file, sha(file)])),
    data: Object.fromEntries(data.map((file) => [file, sha(file)])),
    parts: Object.fromEntries(fs.readdirSync(path.join(root, "docs/live/v4-fit-parts")).sort().map((file) => [file, sha(`docs/live/v4-fit-parts/${file}`)])),
  },
};
fs.writeFileSync(path.join(root, "docs/live/v4-fit.json"), `${JSON.stringify(out, null, 2)}\n`, "utf-8");
console.log(JSON.stringify(out.frozen, null, 1));
