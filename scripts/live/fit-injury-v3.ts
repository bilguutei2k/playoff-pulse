// Fits v3's return hazards (decision D3 of the 2026-11-20 plan) on the development seasons
// only: regular seasons 2021-22 to 2023-24, with 2020-21 as warm-up. Writes
// docs/live/v3-fit.json. No game, box score or report of 2024-25 or later is loaded as a
// result: box scores come from [2021, 2022, 2023, 2024] and reports from [2022, 2023,
// 2024], as v2's fit (`fit-injury.ts`) loads them; the name index spans the registered
// box-score seasons for identity only, exactly as v2's fit does.
//
// Population and spells are v2's: a spell opens when v2's replay first records a miss for
// a player with positive lost value (v2's frozen player values), and its class is read per
// game from the final-point report row's reason with the frozen stems. After the k-th
// missed game (k >= 1) there is one at-risk observation, resolved by the team's next
// regular-season game: he appears (a return) or he is absent again (k + 1). Right-censored,
// with no observation: the team's last regular-season game ("season-end"); a next game
// with no stored box score ("no-box-score", the rest of the spell is dropped); the player
// leaving the team's expected set without appearing ("left-rotation", or
// "appeared-elsewhere" when his last team is now another). Censoring is never a return.
//
// Run: corepack pnpm exec tsx scripts/live/fit-injury-v3.ts

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { FIRST_SEASON } from "../../src/lib/season/formats";
import { fitHazards, HAZARD_BUCKET_LABELS, MIN_AT_RISK, MIN_RETURNS } from "../../src/lib/season/injury-v3";
import { INJURY_PARAMS, INJURY_STATUS_TABLE, LIVE_PARAMS } from "../../src/lib/season/params";
import { replayRatings } from "../../src/lib/season/ratings";
import { loadAvailabilityData, NAME_SEASONS } from "./availability-store";
import { round } from "./eval-metrics";
import { compareGames, gamesPath, loadHistory } from "./game-store";
import { collectHazardObservations, LAST_DEVELOPMENT_SEASON } from "./v3-hazard-data";

const WARMUP_SEASON = 2021;
const FIT_SEASONS = [2022, 2023, 2024];
const LAST_FIT_SEASON = FIT_SEASONS[FIT_SEASONS.length - 1];
if (LAST_FIT_SEASON > LAST_DEVELOPMENT_SEASON) throw new Error("Fit seasons must be development seasons.");
const BOX_SEASONS = [WARMUP_SEASON, ...FIT_SEASONS];

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const allGames = loadHistory(LAST_FIT_SEASON).sort(compareGames);
if (allGames.some((game) => game.season > LAST_FIT_SEASON)) throw new Error("A test season reached the fit.");
const baseGames = allGames.filter((game) => game.season < WARMUP_SEASON);
const fitGames = allGames.filter((game) => game.season >= WARMUP_SEASON);
const base = replayRatings(baseGames, LIVE_PARAMS).state;
const data = loadAvailabilityData(BOX_SEASONS, FIT_SEASONS);

const run = collectHazardObservations(fitGames, FIT_SEASONS, data, base, WARMUP_SEASON - 1);
const fit = fitHazards(run.observations);
const cellsOut = (cells: (typeof fit.cells)["long"]) => ({
  atRisk: cells.atRisk,
  returns: cells.returns,
  pooledWith: cells.pools.map((members) => members.map((index) => HAZARD_BUCKET_LABELS[index])),
  hazard: cells.hazards.map((value) => round(value, 6)),
});

const root = process.cwd();
const rel = (file: string) => path.relative(root, file);
const dataFiles = [
  ...Array.from({ length: LAST_FIT_SEASON - FIRST_SEASON + 1 }, (_, index) => gamesPath(FIRST_SEASON + index)).filter(
    fs.existsSync,
  ),
  ...NAME_SEASONS.map((season) => path.join(root, "data/season/boxscores", `${season}.json`)),
  ...FIT_SEASONS.map((season) => path.join(root, "data/season/reports", `${season}.json`)),
];
const codeFiles = [
  "scripts/live/fit-injury-v3.ts",
  "scripts/live/v3-hazard-data.ts",
  "src/lib/season/injury-v3.ts",
  "src/lib/season/injury-model.ts",
  "src/lib/season/availability.ts",
  "src/lib/season/params.ts",
  "scripts/live/availability-store.ts",
];
const head = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
const dirty = execSync("git status --porcelain -- scripts src", { encoding: "utf-8" }).trim() !== "";

const output = {
  note: "v3 return hazards, fitted on 2021-22 to 2023-24 regular seasons with 2020-21 as warm-up. No 2024-25 or 2025-26 game, box score or report was read as a result; the name index spans the registered box-score seasons for identity only, as v2's fit.",
  modelVersion: "live-2026.27-v3",
  seasons: { warmup: WARMUP_SEASON, fit: FIT_SEASONS, boxScores: BOX_SEASONS, reports: FIT_SEASONS, nameIndex: NAME_SEASONS },
  buckets: HAZARD_BUCKET_LABELS,
  cellMinimum: { atRisk: MIN_AT_RISK, returns: MIN_RETURNS },
  hazards: {
    long: fit.table.long.map((value) => round(value, 6)),
    short: fit.table.short.map((value) => round(value, 6)),
    classUsed: fit.table.classUsed,
  },
  classRule: fit.classRule,
  cells: { long: cellsOut(fit.cells.long), short: cellsOut(fit.cells.short), oneTable: cellsOut(fit.cells.pooled) },
  observations: run.observations.length,
  returns: run.observations.filter((row) => row.returned).length,
  spellsOpened: run.spellsOpened,
  censored: run.censored,
  ignoredContinuations: run.ignoredContinuations,
  countMismatches: run.countMismatches,
  provenance: {
    headSha: head,
    workingTreeCleanForCode: !dirty,
    code: Object.fromEntries(codeFiles.map((file) => [file, sha256(path.join(root, file))])),
    data: Object.fromEntries(dataFiles.map((file) => [rel(file), sha256(file)])),
    frozenInputs: { injury: INJURY_PARAMS, statusTable: INJURY_STATUS_TABLE },
  },
};
const target = path.join(root, "docs", "live", "v3-fit.json");
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
console.log(JSON.stringify({ ...output, provenance: { headSha: head, workingTreeCleanForCode: !dirty } }, null, 1));
console.log(`[fit-v3] wrote ${target}`);
