// Reads the 548 score's committed inputs for the live job and `verify:live`: the Stage 1
// prior (data/score/prior-2026.json, written by scripts/score/build-prior.ts) and Stage 2's
// carried δ (data/score/delta-2026.json, written by scripts/score/build-delta.ts). A
// missing or unreadable file is never an error here: it comes back as a problem. Without
// the prior the job publishes the player index with every score null; without the carried
// δ it publishes Stage 1 alone. Either way it reports `scoreProblem` in health.json, and no
// seal or other view is affected.

import * as fs from "node:fs";
import * as path from "node:path";
import { readScorePrior, type PriorPiece } from "../../src/lib/score/live";
import { readCarriedDelta } from "../../src/lib/score/live-on-court";
import { SCORE_DELTA_SEASON, SCORE_PRIOR_SEASONS } from "../../src/lib/score/params";

export const SCORE_PRIOR_PATH = path.join(process.cwd(), "data", "score", `prior-${SCORE_PRIOR_SEASONS.at(-1)}.json`);
export const CARRIED_DELTA_PATH = path.join(process.cwd(), "data", "score", `delta-${SCORE_DELTA_SEASON}.json`);

export type LoadedScorePrior =
  | { prior: Map<string, PriorPiece[]>; problem: null }
  | { prior: null; problem: string };

/** The prior's pieces for the live season `season`, or the reason they cannot be used. */
export function loadScorePrior(season: number, file: string = SCORE_PRIOR_PATH): LoadedScorePrior {
  try {
    if (!fs.existsSync(file)) return { prior: null, problem: `548 score prior ${path.basename(file)} is missing` };
    return { prior: readScorePrior(JSON.parse(fs.readFileSync(file, "utf-8")), season), problem: null };
  } catch (error) {
    return { prior: null, problem: `548 score prior ${path.basename(file)} unusable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export type LoadedCarriedDelta =
  | { carried: Map<string, number>; problem: null }
  | { carried: null; problem: string };

/** Stage 2's carried δ for the live season `season`, or the reason it cannot be used. */
export function loadCarriedDelta(season: number, file: string = CARRIED_DELTA_PATH): LoadedCarriedDelta {
  try {
    if (!fs.existsSync(file)) return { carried: null, problem: `548 score carried δ ${path.basename(file)} is missing` };
    return { carried: readCarriedDelta(JSON.parse(fs.readFileSync(file, "utf-8")), season), problem: null };
  } catch (error) {
    return {
      carried: null,
      problem: `548 score carried δ ${path.basename(file)} unusable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
