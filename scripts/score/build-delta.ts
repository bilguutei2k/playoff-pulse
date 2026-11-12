// Writes data/score/delta-2026.json: every player's final δ at the end of 2025-26, the
// on-court correction the live 2026-27 season carries (src/lib/score/live-on-court.ts).
// It is the registered season walk (docs/score/registration-stage2.md) over the built
// games under data/historical/raw/score/games/, 2010-11 through 2025-26, loaded as the
// registered evaluation loads them (`loadSeasons`, stray teams dropped), with the frozen
// λ and ρ and Stage 1's frozen coefficients and book (src/lib/score/params.ts).
// Deterministic: athletes in ID order, fixed decimals.
//
// Run: corepack pnpm exec tsx scripts/score/build-delta.ts
// It never fits, freezes or evaluates anything. It reads docs/score/ only to check that
// both fits still have the hashes the parameters were copied under, and to compare its
// values with the 2025-26 record in docs/score/evaluation-stage2.json.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { walkOnCourt } from "../../src/lib/score/on-court";
import {
  carriedDeltaContent,
  readCarriedDelta,
  storeDelta,
  DELTA_DECIMALS,
  type CarriedDeltaFile,
} from "../../src/lib/score/live-on-court";
import {
  SCORE_BOOK,
  SCORE_CHECKPOINT_DAYS,
  SCORE_COEFFICIENTS,
  SCORE_DELTA_SEASON,
  SCORE_FIT_SHA256,
  SCORE_FIT_STAGE2_SHA256,
  SCORE_LIVE_SEASON,
  SCORE_MODEL_VERSION_S2,
  SCORE_ON_COURT,
} from "../../src/lib/score/params";
import { CHECKPOINT_DAYS } from "../../src/lib/score/on-court";
import type { ScoreGame } from "../../src/lib/score/types";
import { CARRIED_DELTA_PATH } from "../live/score-prior";
import { FIRST_SEASON, FIT_PATH, loadSeasons, range } from "./score-data";
import { EVALUATION_STAGE2_PATH, FIT_STAGE2_PATH } from "./stage2-data";

/** The carried δ file from the built games, 2010-11 through `SCORE_DELTA_SEASON`. Pure apart from the games passed in. */
export function buildCarriedDelta(games: readonly ScoreGame[]): CarriedDeltaFile {
  const seasons = [...new Set(games.map((game) => game.season))].sort((a, b) => a - b);
  if (seasons.at(-1) !== SCORE_DELTA_SEASON) throw new Error(`the walk must end with season ${SCORE_DELTA_SEASON}`);
  const held = walkOnCourt(games, SCORE_COEFFICIENTS, SCORE_BOOK, [SCORE_ON_COURT]);
  if (held.season !== SCORE_DELTA_SEASON || held.before !== null) throw new Error("the walk did not end at the season's end");
  const players: Record<string, number> = {};
  for (const athleteId of [...held.delta[0].keys()].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))) {
    players[athleteId] = storeDelta(held.delta[0].get(athleteId) as number);
  }
  return {
    version: 1,
    modelVersion: SCORE_MODEL_VERSION_S2,
    fitSha256: SCORE_FIT_SHA256,
    fitStage2Sha256: SCORE_FIT_STAGE2_SHA256,
    season: SCORE_DELTA_SEASON,
    forSeason: SCORE_LIVE_SEASON,
    lambda: SCORE_ON_COURT.lambda,
    rho: SCORE_ON_COURT.rho,
    walked: [seasons[0], seasons.at(-1) as number],
    decimals: DELTA_DECIMALS,
    players,
  };
}

type RecordLine = { athleteId: string; name: string; delta: number };

/** The 2025-26 record lists in docs/score/evaluation-stage2.json, to compare with. */
function recordedDeltas(): RecordLine[] {
  const evaluation = JSON.parse(fs.readFileSync(EVALUATION_STAGE2_PATH, "utf-8")) as {
    record: Array<{ season: number; positive: RecordLine[]; negative: RecordLine[] }>;
  };
  const record = evaluation.record.find((entry) => entry.season === SCORE_DELTA_SEASON);
  if (!record) throw new Error(`docs/score/evaluation-stage2.json has no record for ${SCORE_DELTA_SEASON}`);
  return [...record.positive, ...record.negative];
}

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function main(): void {
  if (sha256(FIT_PATH) !== SCORE_FIT_SHA256) throw new Error("docs/score/fit.json is not the frozen Stage 1 fit");
  if (sha256(FIT_STAGE2_PATH) !== SCORE_FIT_STAGE2_SHA256) throw new Error("docs/score/fit-stage2.json is not the frozen Stage 2 fit");
  if (CHECKPOINT_DAYS !== SCORE_CHECKPOINT_DAYS) throw new Error("the engine's checkpoint cadence is not the frozen one");
  const started = Date.now();
  const games = loadSeasons(range(FIRST_SEASON, SCORE_DELTA_SEASON));
  const file = buildCarriedDelta(games);
  const content = carriedDeltaContent(file);
  const carried = readCarriedDelta(JSON.parse(content), SCORE_LIVE_SEASON);

  // Against the evaluation's record of 2025-26 (the same walk, run once by the registered test).
  let worst = 0;
  for (const line of recordedDeltas()) {
    const value = carried.get(line.athleteId);
    if (value === undefined) throw new Error(`${line.name} (${line.athleteId}) is in the record but not in the walk`);
    worst = Math.max(worst, Math.abs(value - line.delta));
  }
  if (worst > 1e-5) throw new Error(`δ differs from the evaluation's 2025-26 record by up to ${worst}`);

  fs.mkdirSync(path.dirname(CARRIED_DELTA_PATH), { recursive: true });
  fs.writeFileSync(CARRIED_DELTA_PATH, content);
  const values = [...carried.values()];
  console.log(
    `[delta] ${path.relative(process.cwd(), CARRIED_DELTA_PATH)}: ${carried.size} players, seasons ${file.walked.join(" to ")}, ` +
      `${Buffer.byteLength(content)} bytes, δ from ${Math.min(...values).toFixed(3)} to ${Math.max(...values).toFixed(3)}; ` +
      `matches the evaluation's ${SCORE_DELTA_SEASON} record to ${worst.toExponential(1)}; ` +
      `Jokic ${carried.get("3112335")?.toFixed(3)}, Harden ${carried.get("3992")?.toFixed(3)}; ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
}

if (process.argv[1]?.endsWith("build-delta.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`[delta] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
