// v4's shadow wiring (registration-v4.md, W1 to W3): the cutover boundary and the checks.

import { describe, expect, it } from "vitest";
import { REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import { V4_FIRST_ET_DATE, V4_MODEL_VERSION } from "@/lib/season/params-v4";
import type { LedgerRow, SealRow } from "@/lib/season/types";
import { ledgerProblems } from "../scripts/live/verify-ledger";
import { isV4Row, shadowV4 } from "../scripts/live/v4/live-v4";
import { V4 } from "../scripts/live/watchdog-decision.mjs";

const seal = (overrides: Partial<SealRow> = {}): SealRow => ({
  type: "seal",
  gameId: "g1",
  etDate: "2026-12-01",
  tipUtc: "2026-12-02T00:30:00.000Z",
  issuedAt: "2026-12-01T15:00:00.000Z",
  modelVersion: V4_MODEL_VERSION,
  paramsHash: "x",
  ratingsHash: "y",
  homeId: "1",
  awayId: "2",
  homeWinProbability: 0.6,
  expectedMargin: 3,
  inputsIncomplete: false,
  missingGameIds: [],
  runId: "t",
  market: null,
  sealKind: "morning",
  reportAt: null,
  availabilityStale: false,
  availabilityMissing: true,
  absence: { home: 0, away: 0 },
  absencePoints: { home: 0, away: 0 },
  drivers: { home: [], away: [] },
  driversComplete: true,
  unfiled: { home: false, away: false },
  referenceModelVersion: REFERENCE_MODEL_VERSION,
  referenceHomeWinProbability: 0.55,
  ...overrides,
});

describe("v4 shadow wiring", () => {
  it("the watchdog's v4 constants equal params-v4.ts", () => {
    expect(V4.modelVersion).toBe(V4_MODEL_VERSION);
    expect(V4.firstEtDate).toBe(V4_FIRST_ET_DATE);
  });

  it("verify-ledger rejects a v4 seal before the cutover, without v1's reference, or with a policy revision", () => {
    const early = ledgerProblems([seal({ etDate: "2026-11-01" })]);
    expect(early.some((problem) => problem.includes("before v4's first ET date"))).toBe(true);
    expect(ledgerProblems([seal({ referenceModelVersion: "live-2026.27-v2" })]).some((p) => p.includes("v1's reference"))).toBe(true);
    expect(ledgerProblems([seal({ policyRevision: 3 })]).some((p) => p.includes("policy revision"))).toBe(true);
  });

  it("writes nothing before its first ET date", () => {
    const out = shadowV4({
      season: 2027,
      seasonLabel: "2026-27",
      slate: "2026-11-20",
      nowIso: "2026-11-20T15:00:00.000Z",
      runId: "t",
      phase: "regular-season",
      history: [],
      seasonGames: [],
      ledger: [],
      report: { point: null, stale: false, missing: true },
      source: { boxScores: () => undefined, availability: () => null },
      nameOf: () => undefined,
      playerDays: [],
      marketFor: () => null,
      priorHomeWinRate: 0.58,
      firstEtDate: "2026-11-25",
    });
    expect(out).toEqual({ seals: [], missed: [], shadow: null });
  });

  it("tells v4's rows apart from v1's and v2's", () => {
    const rows: LedgerRow[] = [
      seal(),
      seal({ modelVersion: "live-2026.27-v2" }),
      { type: "missed", gameId: "g", etDate: "2026-12-01", tipUtc: "2026-12-02T00:30:00.000Z", homeId: "1", awayId: "2", recordedAt: "2026-12-02T01:00:00.000Z", modelVersion: V4_MODEL_VERSION },
      { type: "result", gameId: "g1", homeScore: 100, awayScore: 90, recordedAt: "2026-12-02T03:00:00.000Z" },
    ];
    expect(rows.map(isV4Row)).toEqual([true, false, true, false]);
  });
});
