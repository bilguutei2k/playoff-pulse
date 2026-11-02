import type { InjuryParams, StatusTable, SurvivalTable } from "@/lib/season/injury-model";
import type { ModelParams } from "@/lib/season/types";

/**
 * The published model. `live-2026.27-v2` is v1 plus the injury adjustment registered
 * and tested in docs/live/registration.md. Any change requires a new version, and the
 * public record is reported per version.
 */
export const LIVE_MODEL_VERSION = "live-2026.27-v2";

/**
 * The model v2 replaced. It keeps sealing its own rows, so its record continues on the
 * same games, and each v2 row carries its number for a head-to-head.
 */
export const REFERENCE_MODEL_VERSION = "live-2026.27-v1";

/**
 * Frozen rating parameters, shared by v1 and v2. Fitted on seasons 2005-2015 only;
 * see docs/live/registration.md.
 */
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

// ---------------------------------------------------------------------------
// v2 injury model. Copied by hand from docs/live/injury-fit.json, which is frozen:
// fitted on 2021-22 to 2023-24 and tested once on 2024-25 and 2025-26
// (docs/live/evaluation-injury.json). Never refit; a test pins these to the file.
// ---------------------------------------------------------------------------

/** beta: points per unit of Game Score lost; gRep, k, lG, lM: player value. */
export const INJURY_PARAMS: InjuryParams = { beta: 0.4, gRep: 0.2, k: 1000, lG: 1000, lM: 3 };

/** Share of players listed at each status one hour before tip who did not play. */
export const INJURY_STATUS_TABLE: StatusTable = {
  O: 0.999,
  D: 0.9834,
  Q: 0.4827,
  P: 0.1863,
  A: 0.1863,
};

/** Expected further team games missed, by games missed so far (buckets 0, 1, 2-3, 4-7, 8-15, 16-30, 31+). */
export const INJURY_SURVIVAL: SurvivalTable = {
  long: [13.94, 19.89, 21.31, 22.24, 20.81, 23.75, 18.5],
  short: [3.66, 4.73, 5.82, 7.14, 9.49, 13.37, 13.66],
  classUsed: true,
};

/** Box-score seasons whose names resolve report rows; the live season's own are added as they arrive. */
export const NAME_INDEX_SEASONS = [2021, 2022, 2023, 2024, 2025, 2026] as const;

/** Seasons whose margins are adjusted for absences: box scores begin with 2020-21. */
export const FIRST_ADJUSTED_SEASON = 2021;
