import { describe, expect, it } from "vitest";
import { decideReissues, morningSeal, scoredSeal, summarizeRecord } from "@/lib/season/live-state";
import { emptyReportDay, reportProblem, type ChosenReport } from "@/lib/season/live-reports";
import { LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import { displayedSeal } from "@/lib/season/slate";
import type { LedgerRow, LiveState, SealKind, SealRow, SeasonGame } from "@/lib/season/types";
import { ledgerProblems } from "../scripts/live/verify-ledger";

const SLATE = "2026-11-02";
const TIP = "2026-11-03T01:00:00Z";
const NOW = "2026-11-02T16:30:00.000Z";

function game(overrides: Partial<SeasonGame> = {}): SeasonGame {
  return {
    id: "g",
    season: 2027,
    kind: "regular",
    tipUtc: TIP,
    etDate: SLATE,
    homeId: "16",
    awayId: "15",
    neutral: false,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

function seal(kind: SealKind, overrides: Partial<SealRow> = {}): SealRow {
  const missing = kind === "morning";
  return {
    type: "seal",
    gameId: "g",
    etDate: SLATE,
    tipUtc: TIP,
    issuedAt: kind === "final" ? "2026-11-03T00:10:00.000Z" : kind === "reissued" ? "2026-11-02T16:30:00.000Z" : "2026-11-02T11:00:00.000Z",
    modelVersion: LIVE_MODEL_VERSION,
    paramsHash: "p",
    ratingsHash: "r",
    homeId: "16",
    awayId: "15",
    homeWinProbability: kind === "morning" ? 0.93 : 0.88,
    expectedMargin: 3,
    inputsIncomplete: false,
    missingGameIds: [],
    runId: "1",
    market: null,
    sealKind: kind,
    reportAt: missing ? null : "2026-11-02T11:30",
    availabilityStale: false,
    availabilityMissing: missing,
    absence: missing ? { home: 0, away: 0 } : { home: 8, away: 0 },
    absencePoints: missing ? { home: 0, away: 0 } : { home: 3.4, away: 0 },
    drivers: { home: [], away: [] },
    referenceModelVersion: REFERENCE_MODEL_VERSION,
    referenceHomeWinProbability: 0.9,
    ...overrides,
  };
}

const decide = (games: SeasonGame[], ledger: LedgerRow[], now = NOW) =>
  decideReissues(games, ledger, now, LIVE_MODEL_VERSION, SLATE).map((decision) => decision.game.id);

describe("reissuing a morning seal made without a report", () => {
  it("reissues a morning seal that had no report", () => {
    expect(decide([game()], [seal("morning")])).toEqual(["g"]);
  });

  it("leaves a morning seal that had a report alone", () => {
    expect(decide([game()], [seal("morning", { availabilityMissing: false, reportAt: "2026-11-02T05:45" })])).toEqual([]);
  });

  it("reissues only once", () => {
    expect(decide([game()], [seal("morning"), seal("reissued")])).toEqual([]);
  });

  it("leaves a game inside the final seal's window to the final seal", () => {
    expect(decide([game()], [seal("morning")], "2026-11-03T00:30:00.000Z")).toEqual([]);
    expect(decide([game()], [seal("morning"), seal("final")], "2026-11-02T20:00:00.000Z")).toEqual([]);
  });

  it("never touches a game that started or another slate", () => {
    expect(decide([game({ status: "in-progress" })], [seal("morning")])).toEqual([]);
    expect(decide([game({ etDate: "2026-11-01" })], [seal("morning")])).toEqual([]);
  });

  it("ignores another model version's row", () => {
    expect(decide([game()], [seal("morning", { modelVersion: REFERENCE_MODEL_VERSION })])).toEqual([]);
  });
});

describe("which seal counts", () => {
  const morning = seal("morning");
  const reissued = seal("reissued");
  const final = seal("final");

  it("scores final, else reissued, else morning", () => {
    expect(scoredSeal([morning, reissued, final])).toBe(final);
    expect(scoredSeal([morning, reissued])).toBe(reissued);
    expect(scoredSeal([morning])).toBe(morning);
    expect(morningSeal([morning, reissued, final])).toBe(reissued);
  });

  it("shows the reissued number until the final seal", () => {
    const state = { modelVersion: LIVE_MODEL_VERSION, referenceModelVersion: REFERENCE_MODEL_VERSION } as LiveState;
    expect(displayedSeal([morning, reissued], state)).toBe(reissued);
    expect(displayedSeal([morning, reissued, final], state)).toBe(final);
  });

  it("counts a game once, on the reissued seal, as no final seal", () => {
    const result: LedgerRow = { type: "result", gameId: "g", homeScore: 100, awayScore: 90, recordedAt: "x" };
    const summary = summarizeRecord([morning, reissued, result], LIVE_MODEL_VERSION, 0.55);
    expect(summary.sealed).toBe(1);
    expect(summary.scored).toBe(1);
    expect(summary.noFinalSeal).toBe(1);
    expect(summary.brier).toBeCloseTo((1 - 0.88) ** 2, 10);
    // morningBrier keeps its published meaning, the latest pre-final seal; the split
    // reports the original morning seal and the reissued seal separately, with counts.
    expect(summary.morningBrier).toBeCloseTo((1 - 0.88) ** 2, 10);
    expect(summary.latestPreFinalBrier).toBe(summary.morningBrier);
    expect(summary.latestPreFinalCount).toBe(1);
    expect(summary.reissuedCount).toBe(1);
    expect(summary.reissuedBrier).toBeCloseTo((1 - reissued.homeWinProbability) ** 2, 10);
    expect(summary.originalMorningCount).toBe(1);
    expect(summary.originalMorningBrier).toBeCloseTo((1 - morning.homeWinProbability) ** 2, 10);
    expect(morning.homeWinProbability).not.toBe(reissued.homeWinProbability);
  });
});

describe("ledger rules for a reissued seal", () => {
  it("accepts morning, reissued and final in order", () => {
    expect(ledgerProblems([seal("morning"), seal("reissued"), seal("final")])).toEqual([]);
  });

  it("rejects one with no morning seal lacking a report", () => {
    expect(ledgerProblems([seal("reissued")])).toEqual([
      "reissued seal for g without a morning seal that lacked a report",
    ]);
    const hadReport = seal("morning", { availabilityMissing: false, reportAt: "2026-11-02T05:45" });
    expect(ledgerProblems([hadReport, seal("reissued")])).toHaveLength(1);
  });

  it("rejects one with no report of its own", () => {
    const noReport = seal("reissued", {
      availabilityMissing: true,
      reportAt: null,
      absence: { home: 0, away: 0 },
    });
    expect(ledgerProblems([seal("morning"), noReport])).toEqual(["reissued seal for g has no report"]);
  });

  it("rejects a second one, and one after the final seal", () => {
    expect(ledgerProblems([seal("morning"), seal("reissued"), seal("reissued")])).toHaveLength(1);
    expect(ledgerProblems([seal("morning"), seal("final"), seal("reissued")])).toEqual([
      "reissued seal for g after its final seal",
    ]);
  });
});

describe("noticing that injury reports are not reaching the forecasts", () => {
  const missing: ChosenReport = { at: null, report: null, stale: false, missing: true };
  const fresh: ChosenReport = {
    at: "2026-11-02T11:15",
    report: { file: "f", notSubmitted: [], rows: [] },
    stale: false,
    missing: false,
  };
  const names = { rows: 0, unresolved: 0 };
  const rejectedDay = {
    ...emptyReportDay(SLATE),
    files: Object.fromEntries(
      ["a", "b", "c"].map((name) => [name, { at: "2026-11-02T11:00", usable: false, problem: `bad ${name}` }]),
    ),
  };
  const check = (input: Partial<Parameters<typeof reportProblem>[0]>) =>
    reportProblem({ day: null, chosen: fresh, scheduledTips: [TIP], nowIso: NOW, names, ...input });

  it("stays quiet when a current report is in use", () => {
    expect(check({})).toBeNull();
  });

  it("stays quiet with nothing left to seal", () => {
    expect(check({ chosen: missing, day: rejectedDay, scheduledTips: [] })).toBeNull();
  });

  it("reports repeated rejections, which is how 2026-11-02 went unnoticed", () => {
    expect(check({ chosen: missing, day: rejectedDay })).toBe(
      "3 NBA injury reports were rejected and none is usable. Latest, c: bad c.",
    );
  });

  it("reports having no report only as the first tip nears", () => {
    expect(check({ chosen: missing })).toBeNull();
    expect(check({ chosen: missing, nowIso: "2026-11-02T23:00:00.000Z" })).toBe(
      "No usable NBA injury report, with the first tip 2.0 hours away.",
    );
  });

  it("reports a stale report once it is three hours old", () => {
    const stale = { ...fresh, stale: true };
    expect(check({ chosen: stale, nowIso: "2026-11-02T17:00:00.000Z" })).toBeNull();
    expect(check({ chosen: stale, nowIso: "2026-11-02T20:00:00.000Z" })).toBe(
      "The newest usable NBA injury report is 3.8 hours old.",
    );
  });

  it("reports names that stop matching players", () => {
    expect(check({ names: { rows: 80, unresolved: 11 } })).toBeNull();
    expect(check({ names: { rows: 80, unresolved: 50 } })).toBe(
      "Only 30 of 80 names on the NBA injury report matched a player.",
    );
  });
});
