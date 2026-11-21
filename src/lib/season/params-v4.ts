// The roster-state model `live-2026.27-v4` (docs/live/registration-v4.md). Shadow only:
// v2 stays the published model (`LIVE_MODEL_VERSION` in params.ts). Nothing here is
// read by v1 or v2.
//
// Nothing under src/lib/season imports src/lib/score, so the 548 score's frozen Stage 1
// coefficients are copied here by hand; tests/roster-state-params.test.ts pins them to
// docs/score/fit.json (`primary.beta`) and the fitted values to docs/live/v4-fit.json.

export const V4_MODEL_VERSION = "live-2026.27-v4";

/** First ET date with v4 seals. Null until Phase C sets it by a commit. */
export const V4_FIRST_ET_DATE: string | null = null;

/** The Stage 1 box counts, in coefficient order (`BOX_STATS` of src/lib/score/box-model.ts). */
export const V4_BOX_STATS = [
  "points",
  "fieldGoalsAttempted",
  "freeThrowsAttempted",
  "threePointersMade",
  "assists",
  "turnovers",
  "offensiveRebounds",
  "defensiveRebounds",
  "steals",
  "blocks",
  "fouls",
] as const;

/** Stage 1's primary coefficients, per 100 on-court possessions, in `V4_BOX_STATS` order. */
export const V4_BOX_COEFFICIENTS: readonly number[] = [
  0.48030929275536516, -0.41542755462374464, 0.0697059087738173, 0.7754914700092205, 0.7385756414415388,
  -0.8712462397697645, 0.2530402697150996, 0.21718030845939018, 1.1669162279062186, 0.40488243606508434,
  -0.3537907611499167,
];

/** Fixed by the plan (M1), not fitted. */
export const V4_FIXED = {
  b2b: 1.5,
  hcaPlayoffDelta: 1.5,
  marginCap: 30,
  /** Team minutes below this: the team-game takes the pseudo-player path. */
  usableTeamMinutes: 200,
  /** Box observation only for lines with at least this many minutes. */
  minBoxMinutes: 5,
  /** Pseudo-player weight for a team-game without usable lines. */
  pseudoWeight: 5,
  /** Running-average minutes of a player with no minutes history (not fitted; disclosed). */
  newPlayerMinutes: 12,
  /** Starting home-court state and variance, as v1 (not fitted). */
  hca0: 1,
  hcaVar0: 1,
  /** M5: regular-season games in the probit-scale window, and the minimum before it is used. */
  scaleWindow: 3000,
  scaleMinimum: 1000,
  /** M5: exact enumeration up to this many Questionable or Doubtful players, else seeded draws. */
  enumerateUpTo: 6,
  enumerationDraws: 256,
} as const;
