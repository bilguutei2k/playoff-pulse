// v4, M3, M4 and S1: who is out, for how long, and the background rate of absence
// (docs/live/registration-v4.md). Pure. Survival and sampling are v3's (D4 to D6):
// `sampledDuration` and the bucket rule are imported unchanged; the hazard of a group is
// shrunk toward its v3 class cell.

import { absenceClass, type AbsenceClass, type StatusCode } from "@/lib/season/availability";
import { HAZARD_BUCKETS, hazardBucket, type HazardTable } from "@/lib/season/injury-v3";

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
