import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeRecord } from "@/lib/season/live-state";
import { LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import type { LedgerRow, RecordSummary, SealKind, SealRow } from "@/lib/season/types";
import { RECORD_CSV_COLUMNS, recordCsv } from "@/lib/view/record-csv";

/** Parses the file (RFC 4180: quoted fields, CRLF) into objects keyed by column. */
function parse(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += c;
  }
  const [header, ...body] = rows;
  expect(header).toEqual([...RECORD_CSV_COLUMNS]);
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i]])));
}

/** What the file says about one version: the numbers the record summary also gives. */
function totals(rows: Array<Record<string, string>>, version: string) {
  const mine = rows.filter((row) => row.model_version === version);
  const scored = mine.filter((row) => row.status === "scored" || row.status === "no final seal");
  const brier = scored.length ? scored.reduce((sum, row) => sum + Number(row.brier), 0) / scored.length : null;
  return {
    scored: scored.length,
    missed: mine.filter((row) => row.status === "missed").length,
    pending: mine.filter((row) => row.status === "pending").length,
    noFinalSeal: mine.filter((row) => row.status === "no final seal").length,
    brier,
  };
}

function expectMatches(rows: Array<Record<string, string>>, summary: RecordSummary) {
  const found = totals(rows, summary.modelVersion!);
  expect(found.scored).toBe(summary.scored);
  expect(found.missed).toBe(summary.missed);
  expect(found.pending).toBe(summary.pending);
  if (summary.noFinalSeal !== null) expect(found.noFinalSeal).toBe(summary.noFinalSeal);
  if (summary.brier === null) expect(found.brier).toBeNull();
  // Six printed places per game: the mean is within half a millionth.
  else expect(Math.abs(found.brier! - summary.brier)).toBeLessThan(5e-7);
}

const seal = (gameId: string, version: string, kind: SealKind | undefined, p: number, tip: string): SealRow => ({
  type: "seal",
  gameId,
  etDate: tip.slice(0, 10),
  tipUtc: tip,
  issuedAt: "2026-11-02T11:00:00.000Z",
  modelVersion: version,
  paramsHash: "p",
  ratingsHash: "r",
  homeId: "2",
  awayId: "17",
  homeWinProbability: p,
  expectedMargin: 1,
  inputsIncomplete: false,
  missingGameIds: [],
  runId: "1",
  market: null,
  ...(kind ? { sealKind: kind, policyRevision: 2 } : {}),
});

describe("the record as a CSV file", () => {
  const ledger: LedgerRow[] = [
    // g1: v2 final and morning, v1 morning; home won.
    seal("g1", LIVE_MODEL_VERSION, "morning", 0.6, "2026-11-02T23:00Z"),
    seal("g1", LIVE_MODEL_VERSION, "final", 0.7, "2026-11-02T23:00Z"),
    seal("g1", REFERENCE_MODEL_VERSION, undefined, 0.65, "2026-11-02T23:00Z"),
    { type: "result", gameId: "g1", homeScore: 113, awayScore: 106, recordedAt: "2026-11-03T03:00:00.000Z" },
    // g2: v2 morning and reissued only (no final seal); home lost.
    seal("g2", LIVE_MODEL_VERSION, "morning", 0.4, "2026-11-02T20:00Z"),
    seal("g2", LIVE_MODEL_VERSION, "reissued", 0.45, "2026-11-02T20:00Z"),
    seal("g2", REFERENCE_MODEL_VERSION, undefined, 0.5, "2026-11-02T20:00Z"),
    { type: "result", gameId: "g2", homeScore: 99, awayScore: 101, recordedAt: "2026-11-03T01:00:00.000Z" },
    // g3: sealed, not final yet.
    seal("g3", LIVE_MODEL_VERSION, "morning", 0.55, "2026-11-04T00:00Z"),
    // g4: v2 missed it, v1 sealed it.
    { type: "missed", gameId: "g4", etDate: "2026-11-02", tipUtc: "2026-11-02T19:00Z", homeId: "2", awayId: "17", recordedAt: "x", modelVersion: LIVE_MODEL_VERSION },
    seal("g4", REFERENCE_MODEL_VERSION, undefined, 0.3, "2026-11-02T19:00Z"),
    { type: "result", gameId: "g4", homeScore: 90, awayScore: 100, recordedAt: "2026-11-02T22:00:00.000Z" },
  ];
  const versions = [LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION];
  const text = recordCsv(ledger, versions);
  const rows = parse(text);

  it("writes one row per game and version, published version first, by tip", () => {
    expect(rows.map((row) => [row.model_version === LIVE_MODEL_VERSION ? "v2" : "v1", row.game_id, row.status])).toEqual([
      ["v2", "g4", "missed"],
      ["v2", "g2", "no final seal"],
      ["v2", "g1", "scored"],
      ["v2", "g3", "pending"],
      ["v1", "g4", "scored"],
      ["v1", "g2", "scored"],
      ["v1", "g1", "scored"],
    ]);
  });

  it("scores the final seal, else the reissued one, as the claims ledger says", () => {
    const g1 = rows.find((row) => row.game_id === "g1" && row.model_version === LIVE_MODEL_VERSION)!;
    expect(g1).toMatchObject({ seal_kind: "final", home_win_probability: "0.7", home_score: "113", away_score: "106", home_won: "1", brier: "0.090000", policy_revision: "2" });
    const g2 = rows.find((row) => row.game_id === "g2" && row.model_version === LIVE_MODEL_VERSION)!;
    expect(g2).toMatchObject({ seal_kind: "reissued", home_won: "0", brier: "0.202500" });
    const v1 = rows.find((row) => row.game_id === "g1" && row.model_version === REFERENCE_MODEL_VERSION)!;
    expect(v1).toMatchObject({ seal_kind: "morning", policy_revision: "" });
    const missed = rows.find((row) => row.status === "missed")!;
    expect(missed).toMatchObject({ seal_kind: "", home_win_probability: "", brier: "", home_score: "90", home_won: "0" });
  });

  it("has the record summary's totals for each version", () => {
    for (const version of versions) expectMatches(rows, summarizeRecord(ledger, version, 0.55));
  });

  it("agrees with the bundled state's published record, from the bundled month files", () => {
    const live = path.join(process.cwd(), "data", "live");
    const state = JSON.parse(fs.readFileSync(path.join(live, "state.json"), "utf8"));
    const monthDir = path.join(live, "site", state.seasonLabel, "months");
    const months: LedgerRow[] = fs
      .readdirSync(monthDir)
      .sort()
      .flatMap((name) => (JSON.parse(fs.readFileSync(path.join(monthDir, name), "utf8")) as { rows: LedgerRow[] }).rows);
    const bundledVersions = [state.modelVersion, state.referenceModelVersion].filter((v, i, all) => all.indexOf(v) === i);
    const bundled = parse(recordCsv(months, bundledVersions));
    for (const version of bundledVersions) expectMatches(bundled, state.records[version]);
  });

  it("starts with the header and ends every line with CRLF", () => {
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.split("\r\n")[0]).toBe(RECORD_CSV_COLUMNS.join(","));
  });
});
