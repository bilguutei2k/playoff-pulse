import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summarizeRecord } from "@/lib/season/live-state";
import { LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import { POLICY_MODEL_VERSION, POLICY_REVISIONS, policyRevisionAt } from "@/lib/season/policy-revisions";
import type { LedgerRow, SealRow } from "@/lib/season/types";
import {
  appendedRowProblems,
  historyIntact,
  isUtcInstant,
  ledgerProblems,
  readBaseLedger,
} from "../scripts/live/verify-ledger";

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

describe("timestamps", () => {
  const BAD = [
    "garbage",
    "",
    "Infinity",
    "999999-01-01T00:00:00Z",
    "2026-02-30T00:00Z",
    "2026-11-01T23:00:00",
    "Nov 1 2026 23:00 UTC",
    "2026-11-01 23:00Z",
  ];

  it("accepts the two forms the job writes", () => {
    expect(isUtcInstant("2026-11-07T00:00Z")).toBe(true);
    expect(isUtcInstant("2026-11-06T05:00:12.345Z")).toBe(true);
    expect(isUtcInstant(1_762_038_000_000)).toBe(false);
    for (const value of BAD) expect(isUtcInstant(value)).toBe(false);
  });

  it.each(["issuedAt", "tipUtc"] as const)("rejects a seal whose %s is not a real UTC instant", (field) => {
    for (const value of BAD) {
      expect(ledgerProblems([v2("g", "final", { [field]: value })])).toContain(`seal for g has an invalid ${field}`);
    }
  });

  it("rejects bad times on results and misses", () => {
    expect(ledgerProblems([v1("g"), { ...result, recordedAt: "garbage" }])).toEqual(["result for g has an invalid recordedAt"]);
    const miss: LedgerRow = { type: "missed", gameId: "x", etDate: "2026-11-01", tipUtc: "garbage", homeId: "1", awayId: "2", recordedAt: "" };
    expect(ledgerProblems([miss])).toEqual(["missed for x has an invalid tipUtc", "missed for x has an invalid recordedAt"]);
  });

  it("catches the review's counterexample: garbage issue time and a report from 2099", () => {
    // A valid final row mutated this way used to produce no problems at all.
    const row = v2("g", "final", { issuedAt: "garbage", reportAt: "2099-01-01T12:00" });
    expect(ledgerProblems([v2("g", "morning"), row, result])).toEqual(["seal for g has an invalid issuedAt"]);
    expect(ledgerProblems([v2("g", "morning"), v2("g", "final", { reportAt: "2099-01-01T12:00" }), result])).toEqual([
      "seal for g uses a report from after its issue time",
    ]);
  });

  it("requires the report at or before the issue time on the ET wall clock", () => {
    // 22:10Z on Nov 1 is 17:10 EST.
    expect(ledgerProblems([v2("g", "final", { reportAt: "2026-11-01T17:10" })])).toEqual([]);
    expect(ledgerProblems([v2("g", "final", { reportAt: "2026-11-01T17:11" })])).toEqual([
      "seal for g uses a report from after its issue time",
    ]);
    // 22:10Z on Jul 1 is 18:10 EDT.
    const summer = { tipUtc: "2026-07-01T23:00Z", issuedAt: "2026-07-01T22:10:00.000Z" };
    expect(ledgerProblems([v2("g", "final", { ...summer, reportAt: "2026-07-01T18:10" })])).toEqual([]);
    expect(ledgerProblems([v2("g", "final", { ...summer, reportAt: "2026-07-01T18:11" })])).toHaveLength(1);
    for (const reportAt of ["2026-02-30T17:00", "2026-11-01 17:00", "17:00", "2026-11-01T17:00Z"]) {
      expect(ledgerProblems([v2("g", "final", { reportAt })])).toEqual(["seal for g has an invalid reportAt"]);
    }
  });
});

describe("the reissue window", () => {
  const original = v2("g", "morning", {
    availabilityMissing: true,
    reportAt: null,
    absence: { home: 0, away: 0 },
    absencePoints: { home: 0, away: 0 },
    drivers: { home: [], away: [] },
  });
  const reissue = (issuedAt: string) => v2("g", "morning", { sealKind: "reissued", issuedAt, reportAt: "2026-11-01T16:30" });

  it("requires a reissued seal more than an hour before tip, as decideReissues does", () => {
    // TIP is 23:00Z.
    expect(ledgerProblems([original, reissue("2026-11-01T21:59:59.999Z")])).toEqual([]);
    for (const issuedAt of ["2026-11-01T22:00:00.000Z", "2026-11-01T22:00:01.000Z", "2026-11-01T22:59:00.000Z"]) {
      expect(ledgerProblems([original, reissue(issuedAt)])).toEqual(["reissued seal for g issued within an hour of tip"]);
    }
  });
});

describe("policy revisions", () => {
  it("has four frozen revisions at the pull requests' merge times", () => {
    expect(POLICY_MODEL_VERSION).toBe(LIVE_MODEL_VERSION);
    expect(POLICY_REVISIONS.map((row) => [row.revision, row.effectiveAt, row.pullRequest])).toEqual([
      [0, "2026-11-02T06:57:24Z", 6],
      [1, "2026-11-02T16:27:31Z", 8],
      [2, "2026-11-03T05:35:03Z", 9],
      [3, "2026-11-04T06:13:03Z", 15],
    ]);
    expect(Object.isFrozen(POLICY_REVISIONS) && POLICY_REVISIONS.every(Object.isFrozen)).toBe(true);
  });

  it("derives a revision from the issue time, exactly at each boundary", () => {
    for (const row of POLICY_REVISIONS) {
      expect(policyRevisionAt(row.effectiveAt)).toBe(row.revision);
      expect(policyRevisionAt(new Date(Date.parse(row.effectiveAt) - 1).toISOString())).toBe(Math.max(0, row.revision - 1));
    }
    expect(policyRevisionAt("2026-11-06T12:00:00.000Z")).toBe(3);
    expect(() => policyRevisionAt("garbage")).toThrow();
  });

  it("accepts rows without a stored revision and checks a stored one against the derived one", () => {
    const at = { issuedAt: "2026-11-04T23:10:00.000Z", tipUtc: "2026-11-05T00:00Z", reportAt: "2026-11-04T17:30" };
    expect(ledgerProblems([v2("g", "final", at)])).toEqual([]);
    expect(ledgerProblems([v2("g", "final", { ...at, policyRevision: 3 })])).toEqual([]);
    expect(ledgerProblems([v2("g", "final", { ...at, policyRevision: 2 })])).toEqual([
      "seal for g stores policy revision 2, but its version and issue time give 3",
    ]);
    expect(ledgerProblems([v2("g", "final", { ...at, policyRevision: "3" as unknown as number })])).toHaveLength(1);
    expect(ledgerProblems([v1("g", { policyRevision: 0 })])).toEqual([
      "seal for g stores policy revision 0, but its version and issue time give none",
    ]);
    expect(ledgerProblems([v2("g", "final", { issuedAt: "garbage", policyRevision: 0 })])).toContain(
      "seal for g stores policy revision 0, but its version and issue time give none",
    );
  });

  it("requires the revision on v2 seals appended after the base, never on committed rows", () => {
    const line = (row: LedgerRow) => `${JSON.stringify(row)}\n`;
    const committed = line(v2("old", "morning"));
    expect(appendedRowProblems(committed, committed + line(v2("g", "final", { policyRevision: 0 })) + line(v1("g")) + line(result))).toEqual([]);
    expect(appendedRowProblems(committed, committed + line(v2("g", "final")))).toEqual([
      "new final seal for g does not store its policy revision",
    ]);
    expect(appendedRowProblems(committed, committed)).toEqual([]);
  });
});

describe("the base ref", () => {
  const ROOT = process.cwd();
  const LEDGER = "data/live/ledger/2026-27.jsonl";
  let repo = "";
  let empty = "";
  let withLedger = "";
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, encoding: "utf-8" }).trim();
  const cli = (...args: string[]) =>
    spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), ["--tsconfig", path.join(ROOT, "tsconfig.json"), path.join(ROOT, "scripts/live/verify-ledger.ts"), ...args], {
      cwd: repo,
      encoding: "utf-8",
    });

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "verify-ledger-"));
    git("init", "-q");
    fs.writeFileSync(path.join(repo, "README"), "no ledger yet\n");
    git("add", "README");
    git("commit", "-q", "-m", "no ledger");
    empty = git("rev-parse", "HEAD");
    fs.mkdirSync(path.join(repo, "data/live/ledger"), { recursive: true });
    fs.writeFileSync(path.join(repo, LEDGER), `${JSON.stringify(v1("g"))}\n`);
    git("add", LEDGER);
    git("commit", "-q", "-m", "ledger");
    withLedger = git("rev-parse", "HEAD");
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("fails closed on a ref that does not exist, even with the bootstrap flag", () => {
    for (const bootstrap of [false, true]) {
      expect(() => readBaseLedger("refs/heads/does-not-exist", { cwd: repo, bootstrap })).toThrow("cannot resolve base ref");
    }
  });

  it("lets only the flag stand a valid commit without a ledger for an empty ledger", () => {
    expect(() => readBaseLedger(empty, { cwd: repo })).toThrow("has no data/live/ledger/2026-27.jsonl");
    expect(readBaseLedger(empty, { cwd: repo, bootstrap: true })).toBe("");
    expect(readBaseLedger(withLedger, { cwd: repo })).toBe(`${JSON.stringify(v1("g"))}\n`);
    expect(readBaseLedger(withLedger, { cwd: repo, bootstrap: true })).toBe(readBaseLedger(withLedger, { cwd: repo }));
  });

  it("exits non-zero from the command line unless the base is readable", { timeout: 60_000 }, () => {
    const missing = cli("refs/heads/does-not-exist");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("cannot resolve base ref refs/heads/does-not-exist");
    expect(cli(empty).status).toBe(1);
    expect(cli("--bootsrap-empty-ledger").status).toBe(1);
    const ok = cli(withLedger);
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("1 row(s) valid, 0 new; history intact");
    expect(cli(empty, "--bootstrap-empty-ledger").status).toBe(0);
  });
});

describe("the record split", () => {
  // One game reissued, then final; one scored on its original morning seal; one pending.
  const day = { etDate: "2026-11-02", tipUtc: "2026-11-02T23:00Z" };
  const a = v2("a", "morning", { ...day, issuedAt: "2026-11-02T11:00:00.000Z", homeWinProbability: 0.6, availabilityMissing: true });
  const reissued = { ...a, sealKind: "reissued" as const, issuedAt: "2026-11-02T17:00:00.000Z", homeWinProbability: 0.8 };
  const final = { ...a, sealKind: "final" as const, issuedAt: "2026-11-02T22:10:00.000Z", homeWinProbability: 0.7 };
  const later = { etDate: "2026-11-04", tipUtc: "2026-11-05T00:00Z", issuedAt: "2026-11-04T12:00:00.000Z" };
  const b = v2("b", "morning", { ...later, homeWinProbability: 0.4, policyRevision: 3 });
  const pending = v2("p", "morning", { ...later, homeWinProbability: 0.5 });
  const won = (gameId: string): LedgerRow => ({ ...result, gameId, recordedAt: "2026-11-05T06:00:00.000Z" });
  const rows: LedgerRow[] = [a, reissued, final, b, pending, won("a"), won("b")];

  it("scores original morning, reissued and latest pre-final seals separately, with counts", () => {
    const summary = summarizeRecord(rows, LIVE_MODEL_VERSION, 0.55);
    expect(summary.brier).toBeCloseTo((0.3 ** 2 + 0.6 ** 2) / 2, 12);
    expect(summary.originalMorningCount).toBe(2);
    expect(summary.originalMorningBrier).toBeCloseTo((0.4 ** 2 + 0.6 ** 2) / 2, 12);
    expect(summary.reissuedCount).toBe(1);
    expect(summary.reissuedBrier).toBeCloseTo(0.2 ** 2, 12);
    expect(summary.latestPreFinalCount).toBe(2);
    expect(summary.latestPreFinalBrier).toBeCloseTo((0.2 ** 2 + 0.6 ** 2) / 2, 12);
    expect(summary.morningBrier).toBe(summary.latestPreFinalBrier);
  });

  it("files each game under its scored seal's revision, descriptively", () => {
    const summary = summarizeRecord(rows, LIVE_MODEL_VERSION, 0.55);
    // Game a: morning at revision 0, reissued and final at revision 1, scored on the final.
    expect(summary.policyRevisions).toEqual([
      { revision: 0, sealRows: 1, sealed: 0, scored: 0, brier: null },
      { revision: 1, sealRows: 2, sealed: 1, scored: 1, brier: expect.closeTo(0.3 ** 2, 12) },
      { revision: 2, sealRows: 0, sealed: 0, scored: 0, brier: null },
      { revision: 3, sealRows: 2, sealed: 2, scored: 1, brier: expect.closeTo(0.6 ** 2, 12) },
    ]);
    expect(summary.policyRevisions!.reduce((sum, row) => sum + row.sealed, 0)).toBe(summary.sealed);
  });

  it("leaves a version that seals once without the split or revisions", () => {
    const summary = summarizeRecord([v1("a", day), won("a")], REFERENCE_MODEL_VERSION, 0.55);
    expect(summary.morningBrier).toBeNull();
    expect(summary).not.toHaveProperty("originalMorningBrier");
    expect(summary).not.toHaveProperty("policyRevisions");
  });
});
