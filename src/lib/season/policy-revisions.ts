// Policy revisions of live-2026.27-v2: labels within the single v2 record, never a new
// version or a separate record. Each revision is a behaviour change made after the
// registered test, effective at its pull request's merge time on GitHub (`mergedAt`).
// The table is frozen: rows are only ever appended, and ledger rows are never rewritten.
// A v2 seal stores `policyRevision` from 2026-11-06; an older row's revision is derived
// from its `issuedAt` through this table, and verify:ledger checks a stored value
// against the derived one. The registered injury test covers revision 0's final-point
// endpoint only.

import type { SealRow } from "@/lib/season/types";

/** The only version with policy revisions. Not LIVE_MODEL_VERSION: a v3 starts fresh. */
export const POLICY_MODEL_VERSION = "live-2026.27-v2";

export type PolicyRevision = {
  readonly revision: number;
  /** UTC merge time of the pull request that made the change. */
  readonly effectiveAt: string;
  readonly pullRequest: number;
  readonly description: string;
};

export const POLICY_REVISIONS: readonly PolicyRevision[] = Object.freeze([
  Object.freeze({
    revision: 0,
    effectiveAt: "2026-11-02T06:57:24Z",
    pullRequest: 6,
    description: "Registered policy as shipped.",
  }),
  Object.freeze({
    revision: 1,
    effectiveAt: "2026-11-02T16:27:31Z",
    pullRequest: 8,
    description: "Half-slate report gate, reissued morning seals and report-problem alerts.",
  }),
  Object.freeze({
    revision: 2,
    effectiveAt: "2026-11-03T05:35:03Z",
    pullRequest: 9,
    description: "Unfiled teams counted from current absences; complete driver lists.",
  }),
  Object.freeze({
    revision: 3,
    effectiveAt: "2026-11-04T06:13:03Z",
    pullRequest: 15,
    description: "Next-slate evening reports stored; projections with the injury term.",
  }),
]);

/** The revision in force at `issuedAt`. Times before revision 0 map to 0. Throws on a bad time. */
export function policyRevisionAt(issuedAt: string): number {
  const time = Date.parse(issuedAt);
  if (!Number.isFinite(time)) throw new Error(`Invalid policy issue time: ${issuedAt}`);
  let revision = POLICY_REVISIONS[0].revision;
  for (const row of POLICY_REVISIONS) if (Date.parse(row.effectiveAt) <= time) revision = row.revision;
  return revision;
}

/** A seal's revision: the stored value when present, else derived from its issue time. Null outside v2. */
export function sealPolicyRevision(row: Pick<SealRow, "modelVersion" | "issuedAt" | "policyRevision">): number | null {
  if (row.modelVersion !== POLICY_MODEL_VERSION) return null;
  return row.policyRevision ?? policyRevisionAt(row.issuedAt);
}

/** The revision a version is at when `atIso` was published (a state's generatedAt). Null outside v2. */
export function currentPolicyRevision(version: string, atIso: string): number | null {
  return version === POLICY_MODEL_VERSION && Number.isFinite(Date.parse(atIso)) ? policyRevisionAt(atIso) : null;
}

/** "live-2026.27-v2, policy revision 3"; any other version as it is. */
export function modelPolicyLabel(version: string, revision: number | null): string {
  return version === POLICY_MODEL_VERSION && revision !== null ? `${version}, policy revision ${revision}` : version;
}

/** "v2, revision 3" for the places that shorten the version. */
export function shortPolicyLabel(version: string, revision: number | null): string {
  const short = version.split("-").at(-1) ?? version;
  return version === POLICY_MODEL_VERSION && revision !== null ? `${short}, revision ${revision}` : short;
}
