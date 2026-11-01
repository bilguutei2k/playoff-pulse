// Checks the forecast ledger. Committed rows must never change: the current file
// must extend the version at the base ref. Git already provides the tamper-evident
// history, so no separate hash chain is kept.
//
// Run: corepack pnpm verify:ledger [baseRef]   (baseRef defaults to HEAD)

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { seasonLabel } from "../../src/lib/season/formats";
import type { LedgerRow } from "../../src/lib/season/types";
import { LIVE_SEASON } from "./game-store";

const RELATIVE_PATH = `data/live/ledger/${seasonLabel(LIVE_SEASON)}.jsonl`;

function fail(message: string): never {
  console.error(`[verify-ledger] ${message}`);
  process.exit(1);
}

export function ledgerProblems(rows: readonly LedgerRow[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, "seal" | "missed">();
  for (const row of rows) {
    if (row.type === "result") {
      if (!seen.has(row.gameId)) problems.push(`result for unknown game ${row.gameId}`);
      continue;
    }
    if (seen.has(row.gameId)) {
      problems.push(`second ${row.type} row for game ${row.gameId}`);
    }
    seen.set(row.gameId, row.type);
    if (row.type === "seal") {
      if (Date.parse(row.issuedAt) >= Date.parse(row.tipUtc)) {
        problems.push(`seal for ${row.gameId} issued at or after tip`);
      }
      if (!(row.homeWinProbability >= 0 && row.homeWinProbability <= 1)) {
        problems.push(`seal for ${row.gameId} has probability ${row.homeWinProbability}`);
      }
      if (row.inputsIncomplete && row.missingGameIds.length === 0) {
        problems.push(`seal for ${row.gameId} is incomplete but names no missing game`);
      }
    }
  }
  return problems;
}

function main(): void {
  const baseRef = process.argv[2] ?? "HEAD";
  const file = path.join(process.cwd(), RELATIVE_PATH);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";

  let committed = "";
  try {
    committed = execFileSync("git", ["show", `${baseRef}:${RELATIVE_PATH}`], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024 * 200,
    });
  } catch {
    committed = "";
  }
  if (!current.startsWith(committed)) {
    fail(`committed rows changed compared with ${baseRef}. The ledger is append-only.`);
  }

  const rows = current
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerRow);
  const problems = ledgerProblems(rows);
  if (problems.length > 0) fail(problems.join("; "));
  console.log(`[verify-ledger] ${rows.length} row(s) valid; history intact against ${baseRef}.`);
}

if (process.argv[1]?.endsWith("verify-ledger.ts")) main();
