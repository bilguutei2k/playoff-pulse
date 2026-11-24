// The public record as a CSV file (`/record.csv`), built from the same rows and the same
// bookkeeping as the /record page (`versionLedger`, which scores final, else reissued,
// else the original morning seal), so the file cannot disagree with the page. One row
// per game and model version the page shows; the shadow model is not in these rows.
// Pure: no fetch. Tests: tests/record-csv.test.ts.

import { sealKindOf } from "@/lib/season/live-state";
import type { LedgerRow, ResultRow, SealRow } from "@/lib/season/types";
import { versionLedger } from "@/lib/view/record";
import { teamDisplay } from "@/lib/view/teams";

/** The file's columns, in order. The /record page lists them. */
export const RECORD_CSV_COLUMNS = [
  "game_id",
  "et_date",
  "tip_utc",
  "away",
  "home",
  "model_version",
  "seal_kind",
  "seal_issued_at",
  "policy_revision",
  "home_win_probability",
  "away_score",
  "home_score",
  "home_won",
  "brier",
  "status",
] as const;

export type RecordCsvStatus = "scored" | "no final seal" | "pending" | "missed";

/** Brier scores print with six places; probabilities as sealed. */
const BRIER_PLACES = 6;

type Cell = string | number | null;

function field(value: Cell): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const code = (teamId: string) => teamDisplay(teamId).code;

function sealCells(seal: SealRow): Cell[] {
  return [
    seal.gameId,
    seal.etDate,
    seal.tipUtc,
    code(seal.awayId),
    code(seal.homeId),
    seal.modelVersion,
    sealKindOf(seal),
    seal.issuedAt,
    seal.policyRevision ?? null,
    seal.homeWinProbability,
  ];
}

function resultCells(result: ResultRow | null): Cell[] {
  if (!result) return [null, null, null];
  return [result.awayScore, result.homeScore, result.homeScore > result.awayScore ? 1 : 0];
}

/** Rows (without the header) for each version, in the order given; each version's games by tip, then id. */
export function recordCsvRows(ledger: readonly LedgerRow[], versions: readonly string[]): Cell[][] {
  const results = new Map<string, ResultRow>();
  for (const row of ledger) if (row.type === "result") results.set(row.gameId, row);
  const out: Cell[][] = [];
  for (const version of versions) {
    const { scored, pending, missed } = versionLedger(ledger, version);
    const rows: Array<{ tip: string; id: string; cells: Cell[] }> = [
      ...scored.map((game) => ({
        tip: game.seal.tipUtc,
        id: game.seal.gameId,
        cells: [
          ...sealCells(game.seal),
          ...resultCells(game.result),
          game.brier.toFixed(BRIER_PLACES),
          (game.noFinalSeal ? "no final seal" : "scored") satisfies RecordCsvStatus,
        ],
      })),
      ...pending.map((seal) => ({
        tip: seal.tipUtc,
        id: seal.gameId,
        cells: [...sealCells(seal), null, null, null, null, "pending" satisfies RecordCsvStatus],
      })),
      ...missed.map((row) => ({
        tip: row.tipUtc,
        id: row.gameId,
        cells: [
          row.gameId,
          row.etDate,
          row.tipUtc,
          code(row.awayId),
          code(row.homeId),
          version,
          null,
          null,
          null,
          null,
          ...resultCells(results.get(row.gameId) ?? null),
          null,
          "missed" satisfies RecordCsvStatus,
        ],
      })),
    ];
    rows.sort((a, b) => a.tip.localeCompare(b.tip) || a.id.localeCompare(b.id));
    out.push(...rows.map((row) => row.cells));
  }
  return out;
}

/** The whole file: UTF-8 text, a header row, CRLF line ends (RFC 4180). */
export function recordCsv(ledger: readonly LedgerRow[], versions: readonly string[]): string {
  const lines = [RECORD_CSV_COLUMNS.map(field).join(","), ...recordCsvRows(ledger, versions).map((row) => row.map(field).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}
