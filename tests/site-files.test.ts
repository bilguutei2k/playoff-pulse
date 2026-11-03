import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveSiteFiles, manifestMonthPaths, siteFileContents, type SiteManifest } from "@/lib/season/site-files";
import { displayedSeal } from "@/lib/season/slate";
import { upgradeLiveState } from "@/lib/season/state-schema";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { LedgerRow, LiveState, ResultRow, SealRow, SeasonGame } from "@/lib/season/types";
import { versionLedger } from "@/lib/view/record";
import { mergeSealRows, mergeSeals } from "@/lib/view/seals";
import { teamSchedule } from "@/lib/view/team";

function seal(gameId: string, etDate: string, extra: Partial<SealRow> = {}): SealRow {
  return {
    type: "seal",
    gameId,
    etDate,
    tipUtc: `${etDate}T23:30:00.000Z`,
    issuedAt: `${etDate}T14:00:00.000Z`,
    modelVersion: "live-2026.27-v2",
    paramsHash: "p",
    ratingsHash: "r",
    homeId: "1",
    awayId: "2",
    homeWinProbability: 0.6,
    expectedMargin: 3,
    inputsIncomplete: false,
    missingGameIds: [],
    runId: "test",
    market: null,
    sealKind: "morning",
    drivers: { home: [], away: [] },
    ...extra,
  };
}

function result(gameId: string, recordedAt: string): ResultRow {
  return { type: "result", gameId, homeScore: 110, awayScore: 100, recordedAt };
}

describe("site files", () => {
  const ledger: LedgerRow[] = [
    seal("a", "2026-11-30"),
    seal("b", "2026-12-01"),
    seal("a", "2026-11-30", { sealKind: "final", homeWinProbability: 0.62 }),
    // A Nov 30 game finished after midnight UTC and recorded on Dec 1 stays in November.
    result("a", "2026-12-01T05:10:00.000Z"),
    { type: "missed", gameId: "c", etDate: "2026-12-01", tipUtc: "2026-12-02T00:00:00.000Z", homeId: "3", awayId: "4", recordedAt: "2026-12-02T01:00:00.000Z" },
    // A result whose game the ledger never sealed takes the ET date it was recorded on.
    result("z", "2026-12-02T04:00:00.000Z"),
  ];

  it("splits seals by ET date and every row by its game's month, in ledger order", () => {
    const { days, months } = deriveSiteFiles(ledger);
    expect([...days.keys()]).toEqual(["2026-11-30", "2026-12-01"]);
    expect(days.get("2026-11-30")!.seals.map((row) => row.sealKind)).toEqual(["morning", "final"]);
    expect(days.get("2026-11-30")!.seals[0].drivers).toBeDefined();
    expect([...months.keys()]).toEqual(["2026-11", "2026-12"]);
    expect(months.get("2026-11")!.rows.map((row) => `${row.type}:${row.gameId}`)).toEqual(["seal:a", "seal:a", "result:a"]);
    expect(months.get("2026-12")!.rows.map((row) => `${row.type}:${row.gameId}`)).toEqual(["seal:b", "missed:c", "result:z"]);
    for (const file of months.values()) {
      for (const row of file.rows) if (row.type === "seal") expect(row.drivers).toBeUndefined();
    }
    const total = [...months.values()].reduce((sum, file) => sum + file.rows.length, 0);
    expect(total).toBe(ledger.length);
  });

  it("writes stable bytes and lists month files from a manifest", () => {
    expect(siteFileContents(ledger, "2026-27")).toEqual(siteFileContents([...ledger], "2026-27"));
    const manifest: SiteManifest = {
      version: 1,
      season: 2027,
      seasonLabel: "2026-27",
      ledgerRows: ledger.length,
      files: Object.fromEntries([...siteFileContents(ledger, "2026-27").keys()].map((file) => [file, "0".repeat(64)])),
    };
    expect(manifestMonthPaths(manifest)).toEqual(["site/2026-27/months/2026-11.json", "site/2026-27/months/2026-12.json"]);
  });
});

describe("site files against the published ledger", () => {
  const live = path.join(process.cwd(), "data/live");
  const state = upgradeLiveState(JSON.parse(fs.readFileSync(path.join(live, "state.json"), "utf8"))) as LiveState;
  const ledgerFile = path.join(live, "ledger", `${state.seasonLabel}.jsonl`);
  const gamesFile = path.join(live, "games", `${state.season}.json`);
  const ledger: LedgerRow[] = fs.existsSync(ledgerFile)
    ? fs.readFileSync(ledgerFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as LedgerRow)
    : [];
  const games: SeasonGame[] = fs.existsSync(gamesFile) ? (JSON.parse(fs.readFileSync(gamesFile, "utf8")) as SeasonGame[]) : [];
  const monthRows = [...deriveSiteFiles(ledger).months.values()].flatMap((file) => file.rows);

  it("gives the record page the same record per version as the full ledger", () => {
    for (const version of [state.modelVersion, state.referenceModelVersion]) {
      const summary = (rows: readonly LedgerRow[]) => {
        const view = versionLedger(rows, version);
        return {
          scored: view.scored.map((game) => [game.seal.gameId, game.seal.sealKind, game.seal.homeWinProbability, game.brier, game.noFinalSeal]),
          pending: view.pending.map((row) => [row.gameId, row.sealKind]),
          missed: view.missed.map((row) => row.gameId),
        };
      };
      expect(summary(monthRows)).toEqual(summary(ledger));
    }
  });

  it("gives every team page the same schedule as the full ledger", () => {
    for (const team of SEASON_TEAMS) {
      const schedule = (rows: readonly LedgerRow[]) =>
        teamSchedule({ state, games, ledger: rows, teamId: team.id }).map((row) => [row.game.id, row.forecast, row.missed]);
      expect(schedule(monthRows)).toEqual(schedule(ledger));
    }
  });

  it("gives the day pages every seal row of each date, drivers included", () => {
    const { days } = deriveSiteFiles(ledger);
    const seals = ledger.filter((row): row is SealRow => row.type === "seal");
    expect([...days.values()].flatMap((day) => day.seals).length).toBe(seals.length);
    for (const [etDate, day] of days) expect(day.seals).toEqual(seals.filter((row) => row.etDate === etDate));
  });
});

describe("merging seals from copies a commit apart", () => {
  const state = { modelVersion: "live-2026.27-v2", referenceModelVersion: "live-2026.27-v1" } as LiveState;
  const morning = seal("g", "2026-11-03");
  const final = seal("g", "2026-11-03", { sealKind: "final", homeWinProbability: 0.7 });
  const reference = seal("g", "2026-11-03", { modelVersion: "live-2026.27-v1", sealKind: undefined });

  it("is the ledger's rows when the copies agree", () => {
    expect(mergeSealRows([reference, morning, final], [reference, morning, final])).toEqual([reference, morning, final]);
  });

  it("keeps a final seal the ledger copy does not have yet", () => {
    const merged = mergeSealRows([reference, morning], [reference, morning, final]);
    expect(merged).toEqual([reference, morning, final]);
    expect(displayedSeal(merged, state)).toBe(final);
  });

  it("keeps a seal the state does not mention yet", () => {
    const merged = mergeSeals({ g: [reference, morning] }, { g: [reference, morning, final], h: [seal("h", "2026-11-03")] });
    expect(displayedSeal(merged.g, state)).toBe(final);
    expect(merged.h).toHaveLength(1);
  });
});
