// v5's shadow wiring (registration-v5.md, "Wiring as built"): the first date, the stop switch,
// the ledger rules, the watchdog's constants and incidents, and the job's shared check.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import { V4_MODEL_VERSION } from "@/lib/season/params-v4";
import { V5_FROZEN, V5_MODEL_VERSION } from "@/lib/season/params-v5";
import { inV5Range, V5_FIRST_ET_DATE, V5_LAST_ET_DATE } from "@/lib/season/params-v5-live";
import type { PlayerGamesDay } from "@/lib/season/player-stats";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { LedgerRow, MissedRow, SealRow, SeasonGame } from "@/lib/season/types";
import { ledgerProblems } from "../scripts/live/verify-ledger";
import { isV4Row } from "../scripts/live/v4/live-v4";
import { shadowV5FileOnDiskProblems, shadowV5FileProblems, v5ParamsProblems } from "../scripts/live/v5-shadow/check";
import { loadWarmStateV5 } from "../scripts/live/v5-shadow/checkpoint";
import { isV5Row, livePlusMinus, shadowV5, type ShadowV5Input } from "../scripts/live/v5-shadow/live-v5";
import { checkedKeys, decideWatchdog, V5 } from "../scripts/live/watchdog-decision.mjs";

const FIRST = V5_FIRST_ET_DATE as string;
const seal = (overrides: Partial<SealRow> = {}): SealRow => ({
  type: "seal",
  gameId: "g1",
  etDate: "2026-12-01",
  tipUtc: "2026-12-02T00:30:00.000Z",
  issuedAt: "2026-12-01T15:00:00.000Z",
  modelVersion: V5_MODEL_VERSION,
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
const missed = (overrides: Partial<MissedRow> = {}): MissedRow => ({
  type: "missed",
  gameId: "g9",
  etDate: "2026-12-01",
  tipUtc: "2026-12-02T00:30:00.000Z",
  homeId: "1",
  awayId: "2",
  recordedAt: "2026-12-02T01:00:00.000Z",
  modelVersion: V5_MODEL_VERSION,
  ...overrides,
});

const has = (problems: string[], text: string) => problems.some((problem) => problem.includes(text));

describe("v5 shadow wiring", () => {
  it("keeps the watchdog's v5 constants equal to the params files", () => {
    expect(V5.modelVersion).toBe(V5_MODEL_VERSION);
    expect(V5.firstEtDate).toBe(V5_FIRST_ET_DATE);
    expect(V5.lastEtDate).toBe(V5_LAST_ET_DATE);
  });

  it("keeps s3 equal to docs/live/v5-fit.json", () => {
    expect(V5_FROZEN.s3).toBe(25);
    expect(v5ParamsProblems()).toEqual([]);
  });

  it("verify-ledger rejects a v5 seal before its first date, without v1's reference, without a seal kind, or with a policy revision", () => {
    expect(ledgerProblems([seal({ etDate: FIRST })])).toEqual([]);
    expect(has(ledgerProblems([seal({ etDate: "2026-11-24" })]), "outside v5's ET dates")).toBe(true);
    expect(has(ledgerProblems([seal({ referenceModelVersion: "live-2026.27-v2" })]), "v1's reference")).toBe(true);
    expect(has(ledgerProblems([seal({ sealKind: undefined })]), "v5 seal for g1 has no seal kind")).toBe(true);
    expect(has(ledgerProblems([seal({ policyRevision: 3 })]), "v5 seal for g1 stores a policy revision")).toBe(true);
  });

  it("the range: from the first ET date, and with the stop switch set, to the last inclusive", () => {
    expect(inV5Range("2026-11-24", "2026-11-25", null)).toBe(false);
    expect(inV5Range("2026-11-25", "2026-11-25", null)).toBe(true);
    expect(inV5Range("2027-04-01", "2026-11-25", null)).toBe(true);
    expect(inV5Range("2026-12-01", "2026-11-25", "2026-12-01")).toBe(true);
    expect(inV5Range("2026-12-02", "2026-11-25", "2026-12-01")).toBe(false);
    expect(inV5Range("2026-12-01", null, null)).toBe(false);
  });

  it("tells v5's rows apart from v1's, v2's and v4's", () => {
    const rows: LedgerRow[] = [
      seal(),
      seal({ modelVersion: "live-2026.27-v2" }),
      seal({ modelVersion: V4_MODEL_VERSION }),
      missed(),
      { type: "result", gameId: "g1", homeScore: 100, awayScore: 90, recordedAt: "2026-12-02T03:00:00.000Z" },
    ];
    expect(rows.map(isV5Row)).toEqual([true, false, false, true, false]);
    expect(rows.map(isV4Row)).toEqual([false, false, true, false, false]);
  });

  it("writes nothing before its first ET date, or with no first date", () => {
    const input = baseInput({ slate: "2026-11-20", nowIso: "2026-11-20T15:00:00.000Z" });
    expect(shadowV5({ ...input, firstEtDate: "2026-11-25" })).toEqual({ seals: [], missed: [], shadow: null });
    expect(shadowV5({ ...input, firstEtDate: null })).toEqual({ seals: [], missed: [], shadow: null });
  });

  it("reads the live plus/minus from the stored lines, players with minutes only", () => {
    const line = (id: string, minutes: number, pm: number) =>
      [id, 1, minutes, 10, 1, 2, 3, 1, 0, 2, 1, 4, 9, 1, 3, 1, 2, pm] as PlayerGamesDay["games"][string]["teams"][string]["lines"][number];
    const day: PlayerGamesDay = {
      version: 1,
      etDate: "2026-11-25",
      athletes: {},
      games: {
        g: {
          gameId: "g",
          etDate: "2026-11-25",
          homeId: "1",
          awayId: "2",
          homeScore: 100,
          awayScore: 90,
          teams: { "1": { lines: [line("a", 30, 12), line("b", 0, 0), line("c", 12.5, -3)], didNotPlay: [] } },
        },
      },
    };
    expect([...(livePlusMinus([day]).get("g")?.get("1") ?? [])]).toEqual([
      ["a", 12],
      ["c", -3],
    ]);
  });
});

// The stop switch through the model itself: a real warm state, a tiny slate.
const TEAM = (index: number) => SEASON_TEAMS[index].id;
const game = (id: string, etDate: string, tipUtc: string, status: SeasonGame["status"], home: number, away: number): SeasonGame => ({
  id,
  season: 2027,
  kind: "regular",
  tipUtc,
  etDate,
  homeId: TEAM(home),
  awayId: TEAM(away),
  neutral: false,
  status,
  homeScore: status === "final" ? 101 : null,
  awayScore: status === "final" ? 99 : null,
});
const GAMES: SeasonGame[] = [
  game("in-a", "2026-12-01", "2026-12-02T00:30:00.000Z", "final", 0, 1),
  game("in-b", "2026-12-01", "2026-12-02T01:00:00.000Z", "final", 2, 3),
  game("after-early", "2026-12-02", "2026-12-02T14:00:00.000Z", "final", 4, 5),
  game("after-late", "2026-12-02", "2026-12-03T00:30:00.000Z", "scheduled", 6, 7),
];
function baseInput(overrides: Partial<ShadowV5Input> = {}): ShadowV5Input {
  return {
    season: 2027,
    seasonLabel: "2026-27",
    slate: "2026-12-02",
    nowIso: "2026-12-02T15:00:00.000Z",
    runId: "t",
    phase: "regular-season",
    history: [],
    seasonGames: GAMES,
    ledger: [seal({ gameId: "in-a", homeId: TEAM(0), awayId: TEAM(1) })],
    report: { point: null, stale: false, missing: true },
    source: { boxScores: () => undefined, availability: () => null },
    nameOf: () => undefined,
    playerDays: [],
    marketFor: () => null,
    priorHomeWinRate: 0.58,
    firstEtDate: "2026-11-25",
    lastEtDate: null,
    iterations: 20,
    ...overrides,
  };
}

describe("v5's stop switch", () => {
  const warm = loadWarmStateV5();
  const warmState = () => structuredClone(warm);

  it("without a last date, the later game is sealed and the tipped ones are missed", () => {
    const out = shadowV5(baseInput({ warmState }));
    expect(out.seals.map((row) => [row.gameId, row.sealKind])).toEqual([["after-late", "morning"]]);
    expect(out.missed.map((row) => row.gameId).sort()).toEqual(["after-early", "in-b"]);
    expect(ledgerProblems([...baseInput().ledger, ...out.seals, ...out.missed]).filter((p) => p.includes("v5"))).toEqual([]);
  });

  it("with the last date set, a game after it gets no v5 seal and no missed row; one inside it is still missed", () => {
    const out = shadowV5(baseInput({ warmState, lastEtDate: "2026-12-01" }));
    expect(out.seals).toEqual([]);
    expect(out.missed.map((row) => row.gameId)).toEqual(["in-b"]);
    expect(out.shadow?.lastEtDate).toBe("2026-12-01");
    expect(out.shadow?.record.sealed).toBe(1);
  });

  it("the shared check accepts the file on its own ledger and rejects a corrupted sum or an overcounted record", () => {
    const ledger = [...baseInput().ledger];
    const out = shadowV5(baseInput({ warmState, firstEtDate: V5_FIRST_ET_DATE, lastEtDate: V5_LAST_ET_DATE }));
    const all = [...ledger, ...out.seals, ...out.missed];
    const file = JSON.parse(JSON.stringify(out.shadow));
    expect(shadowV5FileProblems(file, all)).toEqual([]);
    expect(has(shadowV5FileProblems({ ...file, teams: file.teams.map((t: { champion: number }, i: number) => (i === 0 ? { ...t, champion: t.champion + 0.5 } : t)) }, all), "title odds")).toBe(true);
    expect(has(shadowV5FileProblems(file, ledger.filter((row) => row.gameId !== "in-a")), "more than v5 sealed")).toBe(true);
    expect(has(shadowV5FileProblems({ ...file, modelVersion: V4_MODEL_VERSION }, all), "not v5's")).toBe(true);
  });

  it("checks the file already on disk the same way, without throwing: what the job runs when it writes no new file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v5-shadow-stored-"));
    try {
      const stored = path.join(directory, "shadow-v5.json");
      const ledger = [...baseInput().ledger];
      expect(shadowV5FileOnDiskProblems(stored, ledger)).toBeNull();

      const out = shadowV5(baseInput({ warmState, firstEtDate: V5_FIRST_ET_DATE, lastEtDate: V5_LAST_ET_DATE }));
      const all = [...ledger, ...out.seals, ...out.missed];
      fs.writeFileSync(stored, `${JSON.stringify(out.shadow)}\n`);
      expect(shadowV5FileOnDiskProblems(stored, all)).toEqual([]);

      // A file written before the stop switch was set: its last date is no longer the constant's.
      const stopped = shadowV5(baseInput({ warmState, firstEtDate: V5_FIRST_ET_DATE, lastEtDate: "2026-12-01" }));
      fs.writeFileSync(stored, `${JSON.stringify(stopped.shadow)}\n`);
      expect(has(shadowV5FileOnDiskProblems(stored, all) ?? [], "last ET date")).toBe(true);

      fs.writeFileSync(stored, "{ not json");
      expect(has(shadowV5FileOnDiskProblems(stored, all) ?? [], "could not be checked")).toBe(true);

      fs.rmSync(stored);
      fs.mkdirSync(stored);
      expect(has(shadowV5FileOnDiskProblems(stored, all) ?? [], "could not be checked")).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("verify-ledger and the watchdog under the stop switch", () => {
  it("rejects a v5 seal or missed row after the last date, accepts one inside it", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("@/lib/season/params-v5-live", async (original) => ({ ...(await original<object>()), V5_LAST_ET_DATE: "2026-12-01" }));
    const { ledgerProblems: stopped } = await import("../scripts/live/verify-ledger");
    expect(stopped([seal({ etDate: "2026-12-01" })])).toEqual([]);
    expect(has(stopped([seal({ etDate: "2026-12-02" })]), "outside v5's ET dates")).toBe(true);
    expect(has(stopped([seal({ gameId: "in", etDate: "2026-12-01" }), missed({ etDate: "2026-12-02" })]), "v5 missed row")).toBe(true);
    vi.doUnmock("@/lib/season/params-v5-live");
    vi.resetModules();
  });

  it("reports a missing v5 seal under its own key, only inside the range, and checks it for recovery", () => {
    const now = "2026-12-02T15:00:00.000Z";
    const games = [
      { id: "in-b", etDate: "2026-12-01", tipUtc: "2026-12-02T01:00:00.000Z", status: "final", homeId: "1", awayId: "2" },
      { id: "after", etDate: "2026-12-02", tipUtc: "2026-12-02T14:00:00.000Z", status: "final", homeId: "3", awayId: "4" },
    ];
    const ledger = games.flatMap((entry) => [
      { type: "seal", gameId: entry.id, modelVersion: "live-2026.27-v2", sealKind: "final" },
      { type: "seal", gameId: entry.id, modelVersion: V4_MODEL_VERSION, sealKind: "final" },
    ]);
    const keysWith = (v5: { modelVersion: string; firstEtDate: string | null; lastEtDate: string | null }) =>
      decideWatchdog({ now, workflowState: "active", runs: [], state: null, games, ledger, v5 })
        .alerts.map((alert: { key: string }) => alert.key)
        .filter((key: string) => key.includes("unsealed"));
    const open = { ...V5, firstEtDate: "2026-11-25", lastEtDate: null };
    expect(keysWith(open)).toEqual(["shadow-v5-unsealed-in-b", "shadow-v5-unsealed-after"]);
    expect(keysWith({ ...open, lastEtDate: "2026-12-01" })).toEqual(["shadow-v5-unsealed-in-b"]);
    expect(keysWith({ ...open, firstEtDate: null })).toEqual([]);
    const alert = decideWatchdog({ now, workflowState: "active", runs: [], state: null, games, ledger, v5: open }).alerts.find(
      (entry: { key: string }) => entry.key === "shadow-v5-unsealed-in-b",
    );
    expect(alert.kind).toBe("state");
    expect(alert.text).toMatch(/^Second shadow model v5 \(not published\): game in-b/);
    // An open key is checked (so it can recover) while its game is watched, retired after.
    const site = { enabled: false, health: null, publication: null, pages: [] };
    const checked = checkedKeys({ now, workflowState: "active", runs: [], state: null, games, ledger, attempted: [], site });
    expect(checked.has("shadow-v5-unsealed-in-b")).toBe(true);
    expect(checked.has("shadow-unsealed-in-b")).toBe(true);
    const later = checkedKeys({ now: "2026-12-05T15:00:00.000Z", workflowState: "active", runs: [], state: null, games, ledger, attempted: [], site });
    expect(later.retired("shadow-v5-unsealed-in-b")).toBe(true);
    expect(later.retired("shadow-unsealed-in-b")).toBe(true);
  });
});
