// v4, M3, M4 and S1: who is out, for how long, and the background rate of absence
// (docs/live/registration-v4.md). Pure. Survival and sampling are v3's (D4 to D6):
// `sampledDuration` and the bucket rule are imported unchanged; the hazard of a group is
// shrunk toward its v3 class cell.

import { absenceClass, type AbsenceClass, type StatusCode } from "@/lib/season/availability";
import { HAZARD_BUCKETS, hazardBucket, type HazardTable } from "@/lib/season/injury-v3";
import type { WeightTerm } from "@/lib/season/minutes-v4";
import { V4_FIXED } from "@/lib/season/params-v4";
import {
  fullHealthTerms,
  strengthDistribution,
  teamKey,
  weightsFromTerms,
  type RosterState,
  type SideWeights,
  type V4RatingParams,
} from "@/lib/season/roster-state";
import type { V4ScheduledAbsence, V4SimulationInput } from "@/lib/season/simulate";

export { sampledDuration } from "@/lib/season/injury-v3";

// ---------------------------------------------------------------------------
// M4: groups
// ---------------------------------------------------------------------------

export const REASON_KINDS = ["injury", "gleague", "protocols", "admin", "rest"] as const;
export type ReasonKind = (typeof REASON_KINDS)[number] | "unlisted";

/**
 * Diagnosis families, in order of precedence, each with its frozen keywords. Matched on the
 * lowercased text after the first semicolon of an "Injury/Illness" reason; no semicolon, or
 * no match, is "other".
 */
export const DIAGNOSIS_FAMILIES: ReadonlyArray<readonly [family: string, keywords: readonly string[]]> = [
  ["acl", ["acl"]],
  ["achilles", ["achilles"]],
  ["surgery", ["surgery", "surgical", "repair", "reconstruction", "procedure"]],
  ["fracture", ["fracture", "broken"]],
  ["tear", ["tear", "torn", "rupture"]],
  ["stress", ["stress"]],
  ["strain", ["strain"]],
  ["sprain", ["sprain"]],
  ["bruise", ["bruise", "contusion", "contused"]],
  ["soreness", ["sore", "tightness", "spasm", "inflammation", "tendin", "irritation", "pain", "discomfort", "stiffness"]],
  ["management", ["management", "maintenance", "recovery", "rehab", "reconditioning"]],
  ["concussion", ["concussion"]],
  ["illness", ["illness", "ilness", "covid", "flu", "sick"]],
];

export function reasonKind(reason: string | null | undefined): ReasonKind {
  if (reason === null || reason === undefined) return "unlisted";
  const text = reason.trim().toLowerCase();
  if (text.startsWith("injury/illness")) return "injury";
  if (text.includes("g league") || text.includes("two-way")) return "gleague";
  if (text.includes("health and safety")) return "protocols";
  if (text.startsWith("rest")) return "rest";
  return "admin";
}

export function diagnosisFamily(reason: string): string {
  const cut = reason.indexOf(";");
  if (cut < 0) return "other";
  const text = reason.slice(cut + 1).toLowerCase();
  for (const [family, keywords] of DIAGNOSIS_FAMILIES) {
    if (keywords.some((keyword) => text.includes(keyword))) return family;
  }
  return "other";
}

/** The group of an absence: its reason kind and, for injuries, the diagnosis family. */
export function absenceGroup(reason: string | null | undefined): string {
  const kind = reasonKind(reason);
  return kind === "injury" ? `injury:${diagnosisFamily(reason as string)}` : kind;
}

// ---------------------------------------------------------------------------
// M4: hazards
// ---------------------------------------------------------------------------

export type GroupHazardTable = {
  /** v3's class table fitted on the same observations: the parent cells. */
  classTable: HazardTable;
  /** Pseudo-count m. */
  shrinkage: number;
  /** Group to bucket counts. */
  cells: Record<string, { atRisk: number[]; returns: number[] }>;
};

export type GroupObservation = { k: number; group: string; class: AbsenceClass; returned: boolean };

export function countGroupCells(observations: readonly GroupObservation[]): GroupHazardTable["cells"] {
  const cells: GroupHazardTable["cells"] = {};
  for (const row of observations) {
    const cell = (cells[row.group] ??= {
      atRisk: new Array<number>(HAZARD_BUCKETS.length).fill(0),
      returns: new Array<number>(HAZARD_BUCKETS.length).fill(0),
    });
    const bucket = hazardBucket(row.k);
    cell.atRisk[bucket] += 1;
    if (row.returned) cell.returns[bucket] += 1;
  }
  return cells;
}

function classHazard(table: HazardTable, k: number, absence: AbsenceClass): number {
  const row = table.classUsed && absence === "long" ? table.long : table.short;
  return row[hazardBucket(k)];
}

/** h(group, bucket(k)) = (returns + m h_class) / (at-risk + m). */
export function groupHazard(table: GroupHazardTable, k: number, group: string, absence: AbsenceClass): number {
  const parent = classHazard(table.classTable, k, absence);
  const cell = table.cells[group];
  if (!cell) return parent;
  const bucket = hazardBucket(k);
  return (cell.returns[bucket] + table.shrinkage * parent) / (cell.atRisk[bucket] + table.shrinkage);
}

/**
 * v3 D4 with the group's hazard: S(1) is the status weight of his listing, S(j) =
 * S(j-1) (1 - h(k + j - 1)), k the team games he has missed so far. Every v4 absence is
 * listed, so S(1) is always a status weight (Probable and Available included).
 */
export function survivalCurveV4(
  status: StatusCode,
  reason: string,
  k: number,
  statusTable: Readonly<Record<StatusCode, number>>,
  table: GroupHazardTable,
  horizon: number,
): number[] {
  const group = absenceGroup(reason);
  const absence = absenceClass(reason);
  const curve = new Array<number>(horizon);
  let s = statusTable[status];
  for (let j = 1; j <= horizon; j += 1) {
    if (j > 1) s *= 1 - groupHazard(table, k + j - 1, group, absence);
    curve[j - 1] = s;
  }
  return curve;
}

// ---------------------------------------------------------------------------
// S1: background availability
// ---------------------------------------------------------------------------

/** Upper bounds of the minutes tiers (running-average minutes) for the league rate. */
export const S1_TIERS = [12, 20, 28, Number.POSITIVE_INFINITY] as const;

export type BackgroundParams = {
  /** Games for A(j) to fall halfway from 1 to the long-run rate. */
  halfLife: number;
  /** Pseudo-count pulling a player's own rate to his tier's. */
  shrinkage: number;
  /** League share of team games played, by tier. */
  tierRates: readonly number[];
};

export function minutesTier(averageMinutes: number): number {
  return S1_TIERS.findIndex((upper) => averageMinutes < upper);
}

/** a-bar: his share of team games played over the given games, shrunk to his tier's rate. */
export function longRunRate(games: number, played: number, tier: number, params: BackgroundParams): number {
  const prior = params.tierRates[tier];
  return (played + params.shrinkage * prior) / (games + params.shrinkage);
}

/** A(j) for the j-th next game (j from 1): 1 at j = 1, falling to a-bar with the half-life. */
export function availabilityAt(j: number, rate: number, params: BackgroundParams): number {
  return rate + (1 - rate) * 0.5 ** ((j - 1) / params.halfLife);
}

// ---------------------------------------------------------------------------
// M6: the season simulation's input from a roster state
// ---------------------------------------------------------------------------

export type V4SeasonOptions = {
  params: V4RatingParams;
  statusTable: Readonly<Record<StatusCode, number>>;
  hazards: GroupHazardTable;
  background: BackgroundParams;
  /** S1 on (the registered model) or off (ablation and property tests only). */
  backgroundOn: boolean;
  /** S2's H in days, or null (off). */
  horizonDays: number | null;
  /** Ordinals to cover per team; at least the simulator's horizon. */
  horizon?: number;
};

export type V4SeasonPlayer = {
  teamId: string;
  athleteId: string;
  listed: boolean;
  status: StatusCode | null;
  reason: string | null;
  /** Points of margin lost at regular-season and playoff weights when he does not play. */
  points: number;
  playoffPoints: number;
  longRunRate: number;
  gamesMissed: number;
};

const meanStrength = (state: RosterState, teamId: string, weights: SideWeights): number => {
  let total = state.mean[state.slots.get(teamKey(teamId)) as number] ?? 0;
  for (const [key, weight] of weights) total += weight * state.mean[state.slots.get(key) as number];
  return total;
};

/**
 * M6 and S1: the 61-value strength distribution at expected full-health minutes, each listed
 * player's sampled absence (v3 D4 to D6 with v4's hazards), and S1's expected charges for
 * everyone else, from the state at the simulation's date. Mutates `state` only by creating
 * prior slots it needs.
 */
export function buildV4Season(
  state: RosterState,
  season: number,
  teamIds: readonly string[],
  options: V4SeasonOptions,
): { input: V4SimulationInput; players: V4SeasonPlayer[] } {
  const horizon = options.horizon ?? 200;
  const { params } = options;
  const regularWeights: Array<[string, SideWeights]> = [];
  const playoffWeights: Array<[string, SideWeights]> = [];
  const backgroundRegular: Float64Array[] = [];
  const backgroundPlayoff: Float64Array[] = [];
  const scheduled: V4ScheduledAbsence[] = [];
  const players: V4SeasonPlayer[] = [];
  for (const teamId of teamIds) {
    const terms = fullHealthTerms(state, teamId);
    const regular = weightsFromTerms(state, teamId, terms, 1, params);
    const playoff = weightsFromTerms(state, teamId, terms, params.kappa, params);
    regularWeights.push([teamId, regular]);
    playoffWeights.push([teamId, playoff]);
    const fullRegular = meanStrength(state, teamId, regular);
    const fullPlayoff = meanStrength(state, teamId, playoff);
    const rows = new Map((state.minutes.filedRows.get(teamId) ?? []).map((row) => [row.athleteId, row]));
    const bgRegular = new Float64Array(horizon);
    const bgPlayoff = new Float64Array(horizon);
    for (const term of terms) {
      const player = state.minutes.players.get(term.athleteId);
      if (!player || term.raw <= 0) continue;
      const without = (other: WeightTerm) => (other.athleteId === term.athleteId ? 0 : 1);
      const points = fullRegular - meanStrength(state, teamId, weightsFromTerms(state, teamId, terms, 1, params, without));
      const playoffPoints = fullPlayoff - meanStrength(state, teamId, weightsFromTerms(state, teamId, terms, params.kappa, params, without));
      const now = player.participation.get(season) ?? { games: 0, played: 0 };
      const before = player.participation.get(season - 1) ?? { games: 0, played: 0 };
      const rate = longRunRate(
        now.games + before.games,
        now.played + before.played,
        minutesTier(player.average ?? V4_FIXED.newPlayerMinutes),
        options.background,
      );
      const row = player.listed ? rows.get(term.athleteId) : undefined;
      const curve = (j: number) => (options.backgroundOn ? 1 - availabilityAt(j, rate, options.background) : 0);
      players.push({
        teamId,
        athleteId: term.athleteId,
        listed: row !== undefined,
        status: row?.status ?? null,
        reason: row?.reason ?? null,
        points,
        playoffPoints,
        longRunRate: rate,
        gamesMissed: player.missed,
      });
      if (row) {
        scheduled.push({
          teamId,
          athleteId: term.athleteId,
          points,
          playoffPoints,
          survival: survivalCurveV4(row.status, row.reason, player.missed, options.statusTable, options.hazards, horizon),
          background: Array.from({ length: horizon }, (_, index) => curve(index + 1)),
        });
      } else {
        for (let index = 0; index < horizon; index += 1) {
          const share = curve(index + 1);
          bgRegular[index] += share * points;
          bgPlayoff[index] += share * playoffPoints;
        }
      }
    }
    backgroundRegular.push(bgRegular);
    backgroundPlayoff.push(bgPlayoff);
  }
  const joint = strengthDistribution(state, [...regularWeights, ...playoffWeights], params);
  // joint is [regular 30, playoff 30, hca]; the simulator reads [regular 30, hca, playoff 30].
  const count = teamIds.length;
  const order = [...Array.from({ length: count }, (_, i) => i), 2 * count, ...Array.from({ length: count }, (_, i) => count + i)];
  const size = order.length;
  const mean = new Float64Array(size);
  const cov = new Float64Array(size * size);
  for (let a = 0; a < size; a += 1) {
    mean[a] = joint.mean[order[a]];
    for (let b = 0; b < size; b += 1) cov[a * size + b] = joint.cov[order[a] * size + order[b]];
  }
  const dailyVariance = new Float64Array(count);
  regularWeights.forEach(([, weights], index) => {
    dailyVariance[index] = params.qC + weights.reduce((sum, [, weight]) => sum + weight * weight * params.qP, 0);
  });
  return {
    input: {
      mean,
      cov,
      dailyVariance,
      sigma: state.scale * params.sigma,
      backgroundRegular,
      backgroundPlayoff,
      players: scheduled,
      horizonDays: options.horizonDays,
    },
    players,
  };
}
