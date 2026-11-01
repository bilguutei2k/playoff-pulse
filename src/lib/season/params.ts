import type { ModelParams } from "@/lib/season/types";

/**
 * Frozen model parameters. Fitted on seasons 2005-2015 only; see
 * docs/live/registration.md. Any change requires a new version, and the public
 * record is reported per version.
 */
export const LIVE_MODEL_VERSION = "live-2026.27-v1";

export const LIVE_PARAMS: ModelParams = {
  sigma: 10.5,
  q: 0.05,
  qHca: 0.0002,
  rho: 0.85,
  tau: 4.5,
  hca0: 1,
  hcaVar0: 1,
  b2b: 1.5,
  marginCap: 30,
  hcaPlayoffDelta: 1.5,
  playoffSpread: 1.1,
};

/**
 * In-game noise SD, in points. The registered default (`sigma`) failed at quarter
 * ends, so this is the one permitted refit: fitted on 2025 states and validated on
 * 2026 only. See docs/live/registration.md.
 */
export const IN_GAME_SIGMA = 18;

/** Published simulation size. Monte Carlo error on a 10% chance is about 0.2 points. */
export const LIVE_SIMULATION_ITERATIONS = 20_000;

/**
 * Multiplier on rating uncertainty in the simulator. The one permitted refit after
 * gate S2 failed, chosen on development seasons. See docs/live/registration.md.
 */
export const SIMULATOR_UNCERTAINTY_SCALE = 1.5;
