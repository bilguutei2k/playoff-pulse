// The frozen Stage 1 parameters of the 548 score, copied from docs/score/fit.json (version
// 2), whose SHA-256 is recorded in docs/score/freeze.json. tests/score-live.test.ts checks
// that every value here equals the file's exactly and that the file still has that hash.
//
// The score is shown on the site, labelled experimental and box-score only. It is not a
// forecast input. Changing a coefficient or a book parameter needs a new registration
// (docs/score/registration.md is frozen) and a new SCORE_MODEL_VERSION.

import type { BookParams } from "@/lib/score/book";
import { BOX_STATS, type BoxCoefficients, type BoxStat } from "@/lib/score/box-model";

export const SCORE_MODEL_VERSION = "score-2026.27-s1";

/** SHA-256 of docs/score/fit.json, as recorded in docs/score/freeze.json. */
export const SCORE_FIT_SHA256 = "5213d2cdf96f2fd6465829b1e1d1eb2b4e86c534ebc6f4f12943166de082ee1d";

/** The primary lineup regression's coefficients (`primary.beta`), per 100 on-court possessions. */
export const SCORE_BETA: Readonly<Record<BoxStat, number>> = {
  points: 0.48030929275536516,
  fieldGoalsAttempted: -0.41542755462374464,
  freeThrowsAttempted: 0.0697059087738173,
  threePointersMade: 0.7754914700092205,
  assists: 0.7385756414415388,
  turnovers: -0.8712462397697645,
  offensiveRebounds: 0.2530402697150996,
  defensiveRebounds: 0.21718030845939018,
  steals: 1.1669162279062186,
  blocks: 0.40488243606508434,
  fouls: -0.3537907611499167,
};

/** The coefficients in `BOX_STATS` order, the same for every position. */
export const SCORE_COEFFICIENTS: BoxCoefficients = { beta: BOX_STATS.map((stat) => SCORE_BETA[stat]) };

/** The book (`book.chosen`): φ 0.25, k 250 possessions, r −7 points per 100. */
export const SCORE_BOOK: BookParams = { decay: 0.25, pseudoPossessions: 250, replacement: -7 };

/** The live season by ending year (2026-27) the committed prior file serves. */
export const SCORE_LIVE_SEASON = 2027;

/** Completed seasons in the prior file, by ending year: 2023-24, 2024-25 and 2025-26. */
export const SCORE_PRIOR_SEASONS = [2024, 2025, 2026] as const;
