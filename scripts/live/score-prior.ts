// Reads the 548 score's prior file (data/score/prior-2026.json, committed with the code,
// written by scripts/score/build-prior.ts) for the live job and `verify:live`. A missing
// or unreadable file is never an error here: it comes back as a problem, the job then
// publishes the player index with every score null and reports `scoreProblem` in
// health.json, and no seal or other view is affected.

import * as fs from "node:fs";
import * as path from "node:path";
import { readScorePrior, type PriorPiece } from "../../src/lib/score/live";
import { SCORE_PRIOR_SEASONS } from "../../src/lib/score/params";

export const SCORE_PRIOR_PATH = path.join(process.cwd(), "data", "score", `prior-${SCORE_PRIOR_SEASONS.at(-1)}.json`);

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
