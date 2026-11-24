// v5 step 3: s3, the noise scale of observation 3, per origin (docs/live/registration-v5.md).
//
// Every v4 parameter stays at its frozen per-origin value (docs/live/v4-fit.json; origin
// 2024-25 is v4's frozen set). For origin S, s3 is chosen from the registered grid
// {off, 80, 60, 45, 35, 25, 18, 13} by regular-season log loss on 2012-13 to S - 1, the span
// v4's own fits scored. Each job replays only the seasons before S: no held-out season is
// forecast, scored or stored here. Report seasons before S are forecast with v4's status
// table fitted before the origin (the frozen table for the frozen set), as v4's fits were.
//
// Modes:
//   --job ORIGIN S3     one grid point; writes docs/live/v5-fit-parts/{origin}-{s3}.json
//   --all [N]           every missing grid point, N jobs at a time (default 8)
//   --assemble          docs/live/v5-fit.json (losses, choices, provenance hashes)
// Run: corepack pnpm exec tsx scripts/live/v5/fit-s3.ts --all 10 && corepack pnpm exec tsx scripts/live/v5/fit-s3.ts --assemble

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRosterState, replayRosterState, type StatusWeights, type V4RatingParams } from "../../../src/lib/season/roster-state-v5";
import { V5_MODEL_VERSION, V5_S3_GRID, withOnCourt } from "../../../src/lib/season/params-v5";
import { devOpeningRosters, filesRead } from "../v4/dev-data";
import { finalPoint, FIRST_SCORED_SEASON, openData, REPORT_SEASONS } from "../v4/engine-run";
import { devPlusMinusLookup, plusMinusFilesRead } from "./dev-data-v5";

const root = process.cwd();
const PARTS = path.join(root, "docs/live/v5-fit-parts");
const OUTPUT = path.join(root, "docs/live/v5-fit.json");
/** Origins: the scored seasons 2015-16 to 2023-24, and 2025 = the frozen set (trained on 2010-11 to 2023-24). */
export const V5_ORIGINS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
const label = (s3: number | null) => (s3 === null ? "off" : String(s3));

type V4Fit = {
  origins: Record<string, { ratings: V4RatingParams }>;
  frozen: { ratings: V4RatingParams };
  status: { frozen: StatusWeights; beforeOrigin: Record<string, StatusWeights> };
};
const v4Fit = (): V4Fit => JSON.parse(fs.readFileSync(path.join(root, "docs/live/v4-fit.json"), "utf-8"));

function ratingsFor(fit: V4Fit, origin: number): V4RatingParams {
  return origin >= 2025 ? fit.frozen.ratings : fit.origins[String(origin)].ratings;
}
function statusFor(fit: V4Fit, origin: number): StatusWeights | null {
  if (origin >= 2025) return fit.status.frozen;
  return fit.status.beforeOrigin[String(origin)] ?? null;
}

export type FitPart = { origin: number; s3: string; trainSeasons: [number, number]; trainGames: number; trainLogLoss: number; bySeason: Record<string, { games: number; logLoss: number }> };

function job(origin: number, s3: number | null): FitPart {
  if (!(V5_ORIGINS as readonly number[]).includes(origin)) throw new Error(`Not an origin: ${origin}`);
  const fit = v4Fit();
  const lastTraining = origin - 1;
  const table = statusFor(fit, origin);
  const reportSeasons = new Set(REPORT_SEASONS.filter((season) => season <= lastTraining && table !== null));
  const fallback: StatusWeights = { O: 1, D: 1, Q: 1, P: 1, A: 1 };
  const { games, lines } = openData();
  const plusMinus = devPlusMinusLookup(2011, lastTraining);
  const params = withOnCourt(ratingsFor(fit, origin), { s3, plusMinus });
  const sums: Record<string, { games: number; logLoss: number }> = {};
  replayRosterState({
    games: games.filter((game) => game.season <= lastTraining),
    linesFor: lines,
    reportFor: (game) => (reportSeasons.has(game.season) ? finalPoint(game) : null),
    openingRosters: devOpeningRosters,
    params,
    statusTable: (season) => (reportSeasons.has(season) ? (table as StatusWeights) : fallback),
    state: createRosterState(),
    onForecast: ({ game, forecast, y }) => {
      if (game.kind !== "regular" || game.season < FIRST_SCORED_SEASON) return;
      if (game.season > lastTraining) throw new Error("fit-s3 never forecasts a held-out season.");
      const p = forecast.homeWinProbability;
      const row = (sums[String(game.season)] ??= { games: 0, logLoss: 0 });
      row.games += 1;
      row.logLoss -= y ? Math.log(p) : Math.log(1 - p);
    },
  });
  const trainGames = Object.values(sums).reduce((sum, row) => sum + row.games, 0);
  const total = Object.values(sums).reduce((sum, row) => sum + row.logLoss, 0);
  return {
    origin,
    s3: label(s3),
    trainSeasons: [FIRST_SCORED_SEASON, lastTraining],
    trainGames,
    trainLogLoss: total / trainGames,
    bySeason: Object.fromEntries(Object.entries(sums).map(([season, row]) => [season, { games: row.games, logLoss: row.logLoss / row.games }])),
  };
}

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
const partFile = (origin: number, s3: number | null) => path.join(PARTS, `${origin}-${label(s3)}.json`);

async function all(concurrency: number) {
  const pending: Array<[number, number | null]> = [];
  for (const origin of [...V5_ORIGINS].reverse()) for (const s3 of V5_S3_GRID) if (!fs.existsSync(partFile(origin, s3))) pending.push([origin, s3]);
  let failed = 0;
  const runOne = (origin: number, s3: number | null) =>
    new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [...process.execArgv, process.argv[1], "--job", String(origin), label(s3)], { stdio: "inherit" });
      child.on("exit", (code) => {
        if (code !== 0) failed += 1;
        resolve();
      });
    });
  const workers = Array.from({ length: concurrency }, async () => {
    while (pending.length > 0) {
      const [origin, s3] = pending.shift() as [number, number | null];
      await runOne(origin, s3);
    }
  });
  await Promise.all(workers);
  if (failed > 0) throw new Error(`${failed} fit jobs failed.`);
}

function assemble() {
  if (fs.existsSync(OUTPUT)) throw new Error("docs/live/v5-fit.json exists: the fit is frozen.");
  const origins: Record<string, { trainSeasons: [number, number]; trainGames: number; losses: Record<string, number>; chosen: string; s3: number | null }> = {};
  for (const origin of V5_ORIGINS) {
    const losses: Record<string, number> = {};
    let trainGames = 0;
    let trainSeasons: [number, number] = [0, 0];
    for (const s3 of V5_S3_GRID) {
      const part = JSON.parse(fs.readFileSync(partFile(origin, s3), "utf-8")) as FitPart;
      losses[label(s3)] = part.trainLogLoss;
      trainGames = part.trainGames;
      trainSeasons = part.trainSeasons;
    }
    // Ties (none expected) go to the earlier grid value: off first, then larger s3.
    const chosen = Object.entries(losses).reduce((best, entry) => (entry[1] < best[1] ? entry : best))[0];
    origins[String(origin)] = { trainSeasons, trainGames, losses, chosen, s3: chosen === "off" ? null : Number(chosen) };
  }
  const code = [
    "src/lib/season/roster-state-v5.ts",
    "src/lib/season/params-v5.ts",
    "scripts/live/v5/fit-s3.ts",
    "scripts/live/v5/dev-data-v5.ts",
    "scripts/live/v4/dev-data.ts",
    "scripts/live/v4/engine-run.ts",
    "docs/live/v4-fit.json",
  ];
  const data = [
    ...Array.from({ length: 14 }, (_, index) => `data/season/player-pm/${2011 + index}.json.gz`),
    ...Array.from({ length: 14 }, (_, index) => `data/season/player-games/${2011 + index}.json.gz`),
    ...Array.from({ length: 14 }, (_, index) => `data/season/games/${2011 + index}.json`),
    ...REPORT_SEASONS.map((season) => `data/season/reports/${season}.json`),
    ...REPORT_SEASONS.map((season) => `data/season/boxscores/${season}.json`),
    "data/season/boxscores/2021.json",
  ];
  const frozen = origins["2025"];
  const output = {
    version: V5_MODEL_VERSION,
    note: "s3 per origin by regular-season log loss on 2012-13 to S - 1 (training only; no held-out season is scored here). Every v4 parameter at its frozen per-origin value from docs/live/v4-fit.json; origin 2025 is the frozen set (2010-11 to 2023-24).",
    grid: V5_S3_GRID.map(label),
    gridNote: "The spike's grid {off, 80, 60, 45, 35, 25} extended downward by 18 and 13 before any frozen-set number existed, because the spike's last origin chose 25. A choice on the new lower edge stands; no further extension.",
    origins,
    frozen: { s3: frozen.s3, chosen: frozen.chosen },
    provenance: {
      code: Object.fromEntries(code.map((file) => [file, sha256(file)])),
      data: Object.fromEntries(data.filter((file) => fs.existsSync(path.join(root, file))).map((file) => [file, sha256(file)])),
    },
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(origins).map(([o, row]) => [o, row.chosen]))));
}

const argv = process.argv.slice(2);
if (argv[0] === "--job") {
  const origin = Number(argv[1]);
  const s3 = argv[2] === "off" ? null : Number(argv[2]);
  if (!V5_S3_GRID.includes(s3)) throw new Error(`s3 ${argv[2]} is not on the registered grid.`);
  const started = Date.now();
  const part = job(origin, s3);
  fs.mkdirSync(PARTS, { recursive: true });
  fs.writeFileSync(partFile(origin, s3), `${JSON.stringify({ ...part, filesRead: [...filesRead(), ...plusMinusFilesRead()] }, null, 2)}\n`);
  console.log(`[fit-s3] origin ${origin} s3 ${label(s3)}: ${part.trainGames} games, log loss ${part.trainLogLoss.toFixed(6)} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
} else if (argv[0] === "--all") {
  void all(Number(argv[1] ?? 8));
} else if (argv[0] === "--assemble") {
  assemble();
} else {
  console.error("usage: fit-s3.ts --job ORIGIN S3 | --all [N] | --assemble");
  process.exit(1);
}
