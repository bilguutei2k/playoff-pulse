import { describe, expect, it } from "vitest";
import { LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import type { LedgerRow, SealRow } from "@/lib/season/types";
import { historyIntact, ledgerProblems } from "../scripts/live/verify-ledger";

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

const result: LedgerRow = { type: "result", gameId: "g", homeScore: 100, awayScore: 90, recordedAt: "x" };

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
      recordedAt: "x",
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
