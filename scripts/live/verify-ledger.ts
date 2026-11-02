// Checks the forecast ledger. Committed rows must never change: the current file
// must extend the version at the base ref, byte for byte. Git already provides the
// tamper-evident history, so no separate hash chain is kept.
//
// Run: corepack pnpm verify:ledger [baseRef]   (baseRef defaults to HEAD)

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { seasonLabel } from "../../src/lib/season/formats";
import {
  FINAL_SEAL_WINDOW_MS,
  missedVersionOf,
  sealKindOf,
} from "../../src/lib/season/live-state";
import type { LedgerRow } from "../../src/lib/season/types";
import { LIVE_SEASON } from "./game-store";

const RELATIVE_PATH = `data/live/ledger/${seasonLabel(LIVE_SEASON)}.jsonl`;

function fail(message: string): never {
  console.error(`[verify-ledger] ${message}`);
  process.exit(1);
}

/** The committed file must be a byte-for-byte prefix of the current one. */
export function historyIntact(committed: string, current: string): boolean {
  return current.startsWith(committed);
}

/** Drivers stored per side on a v2 seal, at most. */
const MAX_DRIVERS = 3;

/**
 * Row-level rules. Seals key on (game, model version, seal kind): v1 writes one seal
 * per game, v2 a morning and a final seal of different kinds. A miss belongs to one
 * version, and a version cannot both seal and miss the same game.
 */
export function ledgerProblems(rows: readonly LedgerRow[]): string[] {
  const problems: string[] = [];
  const games = new Set<string>();
  const sealKeys = new Set<string>();
  const sealedByVersion = new Set<string>();
  const missedByVersion = new Set<string>();
  for (const row of rows) {
    if (row.type === "result") {
      if (!games.has(row.gameId)) problems.push(`result for unknown game ${row.gameId}`);
      continue;
    }
    games.add(row.gameId);
    if (row.type === "missed") {
      const key = `${row.gameId}|${missedVersionOf(row)}`;
      if (missedByVersion.has(key)) {
        problems.push(`second missed row for game ${row.gameId} (${missedVersionOf(row)})`);
      }
      if (sealedByVersion.has(key)) {
        problems.push(`missed row for sealed game ${row.gameId} (${missedVersionOf(row)})`);
      }
      missedByVersion.add(key);
      continue;
    }
    const kind = sealKindOf(row);
    const versionKey = `${row.gameId}|${row.modelVersion}`;
    const key = `${versionKey}|${kind}`;
    if (sealKeys.has(key)) {
      problems.push(`second ${kind} seal row for game ${row.gameId} (${row.modelVersion})`);
    }
    if (missedByVersion.has(versionKey)) {
      problems.push(`seal for ${row.gameId} after it was recorded missed (${row.modelVersion})`);
    }
    sealKeys.add(key);
    sealedByVersion.add(versionKey);
    const tip = Date.parse(row.tipUtc);
    const issued = Date.parse(row.issuedAt);
    if (issued >= tip) {
      problems.push(`seal for ${row.gameId} issued at or after tip`);
    }
    if (!(row.homeWinProbability >= 0 && row.homeWinProbability <= 1)) {
      problems.push(`seal for ${row.gameId} has probability ${row.homeWinProbability}`);
    }
    if (row.inputsIncomplete && row.missingGameIds.length === 0) {
      problems.push(`seal for ${row.gameId} is incomplete but names no missing game`);
    }
    if (row.sealKind === undefined) continue;
    // v2 rows carry their availability and the reference number.
    if (kind === "final" && tip - issued > FINAL_SEAL_WINDOW_MS) {
      problems.push(`final seal for ${row.gameId} issued more than an hour before tip`);
    }
    const reference = row.referenceHomeWinProbability;
    if (reference === undefined || !(reference >= 0 && reference <= 1) || !row.referenceModelVersion) {
      problems.push(`seal for ${row.gameId} has no valid reference number`);
    }
    const absence = row.absence;
    const points = row.absencePoints;
    if (
      !absence ||
      !points ||
      !(absence.home >= 0 && absence.away >= 0 && points.home >= 0 && points.away >= 0)
    ) {
      problems.push(`seal for ${row.gameId} has a missing or negative absence term`);
    } else if (
      row.availabilityMissing &&
      (absence.home !== 0 || absence.away !== 0 || (row.reportAt ?? null) !== null)
    ) {
      problems.push(`seal for ${row.gameId} says availability is missing but uses a report`);
    }
    if (
      !row.drivers ||
      row.drivers.home.length > MAX_DRIVERS ||
      row.drivers.away.length > MAX_DRIVERS
    ) {
      problems.push(`seal for ${row.gameId} has no drivers or too many`);
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
  if (!historyIntact(committed, current)) {
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
