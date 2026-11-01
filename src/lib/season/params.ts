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
 * In-game noise SD, in points. Defaults to `sigma` and may change only through
 * the disclosed refit rule in docs/live/registration.md.
 */
export const IN_GAME_SIGMA = LIVE_PARAMS.sigma;

/** Published simulation size. Monte Carlo error on a 10% chance is about 0.2 points. */
export const LIVE_SIMULATION_ITERATIONS = 20_000;

/** Multiplier on rating uncertainty in the simulator; 1 means none. */
export const SIMULATOR_UNCERTAINTY_SCALE = 1;
