// The candidate model `live-2026.27-v5` (docs/live/registration-v5.md): v4 unchanged plus
// observation 3, the on-court plus/minus (src/lib/season/roster-state-v5.ts). Not wired:
// nothing in the live job, the ledger or the site reads this file. v4's frozen parameters
// are imported, never copied; s3 is pinned to docs/live/v5-fit.json by
// tests/roster-state-v5-params.test.ts.

import { V4_FROZEN } from "@/lib/season/params-v4";
import type { V4RatingParams } from "@/lib/season/roster-state";

export const V5_MODEL_VERSION = "live-2026.27-v5";

/** The registered s3 grid (off, then descending). */
export const V5_S3_GRID: readonly (number | null)[] = [null, 80, 60, 45, 35, 25, 18, 13];

/** Observation 3's input: the noise scale (null = off) and the plus/minus of a team-game. */
export type V5OnCourt = {
  s3: number | null;
  plusMinus: (gameId: string, teamId: string) => ReadonlyMap<string, number> | null;
};

/** v4's rating parameters with observation 3 attached (the shape roster-state-v5.ts reads). */
export type V5RatingParams = V4RatingParams & { onCourt?: V5OnCourt };

export function withOnCourt(ratings: V4RatingParams, onCourt: V5OnCourt): V5RatingParams {
  return { ...ratings, onCourt };
}

/** The frozen set: v4's frozen parameters and s3 fitted on 2010-11 to 2023-24 (scored 2012-13 on). */
export const V5_FROZEN: { v4: typeof V4_FROZEN; s3: number | null } = {
  v4: V4_FROZEN,
  s3: 25,
};
