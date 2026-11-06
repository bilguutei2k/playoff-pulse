// Policy labels within the single v2 record. Effective times are PR merge times.
// Historical ledger rows are never rewritten.
export const POLICY_MODEL_VERSION = "live-2026.27-v2";
export const POLICY_REVISIONS = Object.freeze([
  Object.freeze({ revision: 0, effectiveAt: "2026-11-02T06:57:24Z", description: "Registered policy as shipped (PR #6)." }),
  Object.freeze({ revision: 1, effectiveAt: "2026-11-02T16:27:31Z", description: "Half-slate report gate, reissued morning seals and report-problem alerts (PR #8)." }),
  Object.freeze({ revision: 2, effectiveAt: "2026-11-03T05:35:03Z", description: "Unfiled teams counted from current absences and complete driver lists (PR #9)." }),
  Object.freeze({ revision: 3, effectiveAt: "2026-11-04T06:13:03Z", description: "Next-slate evening reports stored and projections with the injury term (PR #15)." }),
] as const);

export function policyRevisionAt(issuedAt: string): number {
  const time = Date.parse(issuedAt);
  if (!Number.isFinite(time)) throw new Error("Invalid policy issue time");
  return POLICY_REVISIONS.findLast((row) => Date.parse(row.effectiveAt) <= time)?.revision ?? 0;
}

export function modelPolicyLabel(version: string | null, issuedAt?: string): string {
  if (version !== POLICY_MODEL_VERSION) return version ?? "Unknown model";
  return `${version}, policy revision ${issuedAt ? policyRevisionAt(issuedAt) : POLICY_REVISIONS.at(-1)!.revision}`;
}
