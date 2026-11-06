import { summarizeRecord } from "@/lib/season/live-state";
import { revisionBreakdown } from "@/lib/view/record";
import { execFileSync } from "node:child_process";
import { POLICY_REVISIONS, policyRevisionAt } from "@/lib/season/policy-revisions";
import { describe, expect, it } from "vitest";
import { LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import type { LedgerRow, SealRow } from "@/lib/season/types";
import { historyIntact, ledgerProblems, readBaseLedger } from "../scripts/live/verify-ledger";

const TIP = "2026-11-01T23:00:00Z";

function v1(gameId: string, overrides: Partial<SealRow> = {}): SealRow {
  return {
    type: "seal",
    gameId,
    etDate: "2026-11-01",
    tipUtc: TIP,
    issuedAt: "2026-11-01T11:48:00Z",
    modelVersion: REFERENCE_MODEL_VERSION,
    paramsHash: "p",
    ratingsHash: "r",
    homeId: "1",
    awayId: "2",
    homeWinProbability: 0.6,
    expectedMargin: 3,
    inputsIncomplete: false,
    missingGameIds: [],
    runId: "1",
    market: null,
    ...overrides,
  };
}

function v2(gameId: string, kind: "morning" | "final", overrides: Partial<SealRow> = {}): SealRow {
  return v1(gameId, {
    modelVersion: LIVE_MODEL_VERSION,
    sealKind: kind,
    issuedAt: kind === "final" ? "2026-11-01T22:10:00Z" : "2026-11-01T11:48:00Z",
    reportAt: "2026-11-01T06:45",
    availabilityStale: false,
    availabilityMissing: false,
    absence: { home: 3, away: 0 },
    absencePoints: { home: 1.2, away: 0 },
    drivers: { home: [{ athleteId: "9", name: "A Player", status: "O", points: 1.2 }], away: [] },
    referenceModelVersion: REFERENCE_MODEL_VERSION,
    referenceHomeWinProbability: 0.62,
    ...overrides,
  });
}

const result: LedgerRow = { type: "result", gameId: "g", homeScore: 100, awayScore: 90, recordedAt: "2026-11-02T02:00:00Z" };

describe("ledger validation", () => {
  it("accepts a v1 seal plus a v2 morning and final seal for one game", () => {
    expect(ledgerProblems([v1("g"), v2("g", "morning"), v2("g", "final"), result])).toEqual([]);
  });

  it("rejects a second seal of the same version and kind", () => {
    expect(ledgerProblems([v2("g", "final"), v2("g", "final")])).toEqual([
      `second final seal row for game g (${LIVE_MODEL_VERSION})`,
    ]);
    expect(ledgerProblems([v1("g"), v1("g")])).toHaveLength(1);
  });

  it("rejects a final seal written more than an hour before tip, or after it", () => {
    expect(ledgerProblems([v2("g", "final", { issuedAt: "2026-11-01T21:30:00Z" })])).toEqual([
      "final seal for g issued more than an hour before tip",
    ]);
    expect(ledgerProblems([v2("g", "final", { issuedAt: TIP })])).toContain("seal for g issued at or after tip");
  });

  it("requires v2 rows to carry a valid reference and a non-negative absence term", () => {
    expect(ledgerProblems([v2("g", "morning", { referenceHomeWinProbability: undefined })])).toEqual([
      "seal for g has no valid reference number",
    ]);
    expect(ledgerProblems([v2("g", "morning", { absence: { home: -1, away: 0 } })])).toEqual([
      "seal for g has a missing or negative absence term",
    ]);
    expect(
      ledgerProblems([v2("g", "morning", { availabilityMissing: true, reportAt: null })]),
    ).toEqual(["seal for g says availability is missing but uses a report"]);
    expect(
      ledgerProblems([
        v2("g", "morning", {
          availabilityMissing: true,
          reportAt: null,
          absence: { home: 0, away: 0 },
          absencePoints: { home: 0, away: 0 },
          drivers: { home: [], away: [] },
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps misses per version, and a version cannot both seal and miss a game", () => {
    const missed = (modelVersion?: string): LedgerRow => ({
      type: "missed",
      gameId: "g",
      etDate: "2026-11-01",
      tipUtc: TIP,
      homeId: "1",
      awayId: "2",
      recordedAt: "2026-11-02T02:00:00Z",
      ...(modelVersion ? { modelVersion } : {}),
    });
    expect(ledgerProblems([v1("g"), missed(LIVE_MODEL_VERSION)])).toEqual([]);
    expect(ledgerProblems([v1("g"), missed()])).toEqual([
      `missed row for sealed game g (${REFERENCE_MODEL_VERSION})`,
    ]);
    expect(ledgerProblems([missed(LIVE_MODEL_VERSION), v2("g", "morning")])).toEqual([
      `seal for g after it was recorded missed (${LIVE_MODEL_VERSION})`,
    ]);
    expect(ledgerProblems([result])).toEqual(["result for unknown game g"]);
  });
});

describe("complete drivers and unfiled sides", () => {
  const player = (id: string, points: number, status: "O" | "Q" | null = "O") => ({
    athleteId: id,
    name: `Player ${id}`,
    status,
    points,
  });
  const many = [player("1", 2.653), player("2", 2.359), player("3", 1.643), player("4", 1.2), player("5", 0.9), player("6", 0.5)];
  const total = Number(many.reduce((sum, row) => sum + row.points, 0).toFixed(3));

  it("lets a flagged row list every driver, and requires them to add up to its points", () => {
    const row = v2("g", "final", {
      absence: { home: total / 0.4, away: 0 },
      absencePoints: { home: total, away: 0 },
      drivers: { home: many, away: [] },
      driversComplete: true,
      unfiled: { home: false, away: false },
    });
    expect(ledgerProblems([row])).toEqual([]);
    expect(ledgerProblems([{ ...row, absencePoints: { home: total + 0.02, away: 0 } }])).toEqual([
      `seal for g: home drivers add to ${total.toFixed(3)}, absence points ${total + 0.02}`,
    ]);
    // Rounding of each driver is allowed for.
    expect(ledgerProblems([{ ...row, absencePoints: { home: total + 0.009, away: 0 } }])).toEqual([]);
    expect(
      ledgerProblems([{ ...row, drivers: { home: [...many].reverse(), away: [] } }]),
    ).toEqual(["seal for g: home drivers are not sorted largest first"]);
  });

  it("keeps the three-driver cap, and no sum rule, on rows without the flag", () => {
    const old = v2("g", "final", { drivers: { home: many.slice(0, 3), away: [] }, absencePoints: { home: 12.2, away: 0 } });
    expect(ledgerProblems([old])).toEqual([]);
    expect(ledgerProblems([{ ...old, drivers: { home: many, away: [] } }])).toEqual(["seal for g has too many drivers"]);
    expect(ledgerProblems([{ ...old, drivers: undefined }])).toEqual(["seal for g has no drivers"]);
  });

  it("allows drivers without a status only on an unfiled side, and an unfiled side only with a report", () => {
    const unfiled = v2("g", "morning", {
      absence: { home: 1.5 / 0.4, away: 0 },
      absencePoints: { home: 1.5, away: 0 },
      drivers: { home: [player("1", 1.5, null)], away: [] },
      driversComplete: true,
      unfiled: { home: true, away: false },
    });
    expect(ledgerProblems([unfiled])).toEqual([]);
    expect(ledgerProblems([{ ...unfiled, unfiled: { home: false, away: false } }])).toEqual([
      "seal for g: a home driver has no status on a side the report covers",
    ]);
    expect(ledgerProblems([{ ...unfiled, reportAt: null }])).toEqual(["seal for g has an unfiled side but no report"]);
  });
});

describe("append-only history", () => {
  const committed = `${JSON.stringify(v1("a"))}\n${JSON.stringify(v1("b"))}\n`;

  it("accepts appended rows", () => {
    expect(historyIntact(committed, `${committed}${JSON.stringify(v2("a", "morning"))}\n`)).toBe(true);
    expect(historyIntact(committed, committed)).toBe(true);
  });

  it("rejects an edited or removed row", () => {
    expect(historyIntact(committed, committed.replace('"homeWinProbability":0.6', '"homeWinProbability":0.61'))).toBe(false);
    expect(historyIntact(committed, `${JSON.stringify(v1("b"))}\n`)).toBe(false);
    expect(historyIntact(committed, committed.replace("\n", " \n"))).toBe(false);
  });
});

describe("timestamp and policy enforcement", () => {
  it.each(["issuedAt", "tipUtc"] as const)("rejects invalid %s", (field) => {
    for (const value of ["garbage", "", "Infinity", "999999-01-01T00:00:00Z"]) {
      expect(ledgerProblems([v2("g", "final", { [field]: value })]).join(";")).toContain(`invalid ${field}`);
    }
  });
  it("rejects garbage recordedAt on results and misses", () => {
    expect(ledgerProblems([v1("g"), { ...result, recordedAt: "garbage" }]).join(";")).toContain("invalid recordedAt");
    expect(ledgerProblems([{ type: "missed", gameId: "x", etDate: "2026-11-01", tipUtc: "garbage", homeId: "1", awayId: "2", recordedAt: "garbage" }])).toHaveLength(2);
  });
  it("rejects the review counterexample and checks ET report chronology", () => {
    expect(ledgerProblems([v2("g", "final", { issuedAt: "garbage", reportAt: "2099-01-01T12:00" })])).not.toEqual([]);
    expect(ledgerProblems([v2("g", "final", { reportAt: "2099-01-01T12:00" })]).join(";")).toContain("after issuedAt");
    expect(ledgerProblems([v2("g", "final", { reportAt: "2026-11-01T17:10" })])).toEqual([]);
    expect(ledgerProblems([v2("g", "final", { reportAt: "2026-11-01T17:11" })]).join(";")).toContain("after issuedAt");
    expect(ledgerProblems([v2("g", "final", { reportAt: "2026-02-30T17:00" })]).join(";")).toContain("invalid reportAt");
  });
  it("compares report wall clocks in summer Eastern time too", () => {
    const seal = v2("g", "final", { tipUtc: "2026-07-01T23:00:00Z", issuedAt: "2026-07-01T22:10:00Z", reportAt: "2026-07-01T18:10" });
    expect(ledgerProblems([seal])).toEqual([]);
    expect(ledgerProblems([{ ...seal, reportAt: "2026-07-01T18:11" }]).join(";")).toContain("after issuedAt");
  });
  it("requires reissued seals strictly more than 60 minutes before tip", () => {
    const original = v2("g", "morning", { availabilityMissing: true, reportAt: null, absence: { home: 0, away: 0 }, absencePoints: { home: 0, away: 0 }, drivers: { home: [], away: [] } });
    for (const time of ["22:00:00", "22:00:01"]) {
      expect(ledgerProblems([original, v2("g", "morning", { sealKind: "reissued", issuedAt: `2026-11-01T${time}Z` })]).join(";")).toContain("more than an hour");
    }
    expect(ledgerProblems([original, v2("g", "morning", { sealKind: "reissued", issuedAt: "2026-11-01T21:59:59Z" })])).toEqual([]);
  });
  it("checks stored revisions without requiring historical rows to be rewritten", () => {
    expect(ledgerProblems([v2("g", "final", { policyRevision: 1 })]).join(";")).toContain("inconsistent policyRevision");
    expect(ledgerProblems([v2("g", "final", { policyRevision: 0 })])).toEqual([]);
    expect(ledgerProblems([v2("g", "final")])).toEqual([]);
  });
  it("fails closed on a missing ref even with the bootstrap flag", () => {
    expect(() => readBaseLedger("refs/heads/does-not-exist-review-test")).toThrow("Cannot read base ref");
    expect(() => readBaseLedger("refs/heads/does-not-exist-review-test", true)).toThrow("Cannot read base ref");
  });
});

it("permits bootstrap only when a valid commit has no ledger", () => {
  const root = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { encoding: "utf8" }).trim().split("\n")[0];
  expect(() => readBaseLedger(root)).toThrow("Cannot read base ledger");
  expect(readBaseLedger(root, true)).toBe("");
  expect(readBaseLedger("HEAD", true)).toBe(readBaseLedger("HEAD"));
});

it("uses exact immutable revision boundaries", () => {
  for (const row of POLICY_REVISIONS) {
    expect(policyRevisionAt(row.effectiveAt)).toBe(row.revision);
    expect(policyRevisionAt(new Date(Date.parse(row.effectiveAt) - 1).toISOString())).toBe(Math.max(0, row.revision - 1));
  }
  expect(() => policyRevisionAt("garbage")).toThrow();
});

it("keeps split samples and revision totals descriptive across a policy boundary", () => {
  const a = v2("g", "morning", { issuedAt: "2026-11-02T15:00:00Z", homeWinProbability: 0.6 });
  const reissued = { ...a, sealKind: "reissued" as const, issuedAt: "2026-11-02T17:00:00Z", homeWinProbability: 0.8 };
  const final = { ...a, sealKind: "final" as const, issuedAt: "2026-11-02T22:00:00Z", homeWinProbability: 0.7 };
  const b = v2("b", "morning", { issuedAt: "2026-11-04T12:00:00Z", homeWinProbability: 0.4 });
  const pending = { ...b, gameId: "pending" };
  const rows: LedgerRow[] = [a, reissued, final, b, pending, result, { ...result, gameId: "b" }];
  const summary = summarizeRecord(rows, LIVE_MODEL_VERSION, 0.55);
  expect(summary.morningCount).toBe(2);
  expect(summary.reissuedCount).toBe(1);
  expect(summary.latestPreFinalCount).toBe(2);
  expect(summary.morningBrier).toBeCloseTo((0.4 ** 2 + 0.6 ** 2) / 2);
  expect(summary.reissuedBrier).toBeCloseTo(0.2 ** 2);
  expect(summary.latestPreFinalBrier).toBeCloseTo((0.2 ** 2 + 0.6 ** 2) / 2);
  expect(summary.brier).toBeCloseTo((0.3 ** 2 + 0.6 ** 2) / 2);
  const revisions = revisionBreakdown(rows, LIVE_MODEL_VERSION);
  expect(revisions.map((row) => [row.sealed, row.scored])).toEqual([[0, 0], [1, 1], [0, 0], [2, 1]]);
  expect(revisions.reduce((sum, row) => sum + row.sealed, 0)).toBe(summary.sealed);
  expect(revisions[1].brier).toBeCloseTo(0.3 ** 2);
});
