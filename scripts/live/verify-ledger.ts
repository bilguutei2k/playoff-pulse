// Checks the forecast ledger. Committed rows must never change: the current file
// must extend the version at the base ref, byte for byte. Git already provides the
// tamper-evident history, so no separate hash chain is kept.
//
// Run: corepack pnpm verify:ledger [baseRef]   (baseRef defaults to HEAD)

import { etWallClockOf } from "../../src/lib/season/dates";
import { POLICY_MODEL_VERSION, policyRevisionAt } from "../../src/lib/season/policy-revisions";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { seasonLabel } from "../../src/lib/season/formats";
import {
  FINAL_SEAL_WINDOW_MS,
  missedVersionOf,
  sealKindOf,
} from "../../src/lib/season/live-state";
import type { LedgerRow, SealRow } from "../../src/lib/season/types";
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

/** Drivers stored per side on a v2 seal written before `driversComplete`, at most. */
const MAX_DRIVERS = 3;
/** How far a complete side's drivers may sum from its absence points: rounding only. */
export const DRIVER_SUM_TOLERANCE = 0.01;

/** Problems with a row's drivers. Rows with `driversComplete` list every player. */
function driverProblems(row: SealRow): string[] {
  const drivers = row.drivers;
  if (!drivers) return [`seal for ${row.gameId} has no drivers`];
  if (row.driversComplete === undefined) {
    return drivers.home.length > MAX_DRIVERS || drivers.away.length > MAX_DRIVERS
      ? [`seal for ${row.gameId} has too many drivers`]
      : [];
  }
  if (row.driversComplete !== true) return [`seal for ${row.gameId} has an invalid driversComplete flag`];
  const problems: string[] = [];
  for (const side of ["home", "away"] as const) {
    const list = drivers[side];
    const total = list.reduce((sum, driver) => sum + driver.points, 0);
    const points = row.absencePoints?.[side] ?? 0;
    if (Math.abs(total - points) > DRIVER_SUM_TOLERANCE) {
      problems.push(
        `seal for ${row.gameId}: ${side} drivers add to ${total.toFixed(3)}, absence points ${points}`,
      );
    }
    if (list.some((driver, index) => !(driver.points >= 0) || (index > 0 && driver.points > list[index - 1].points))) {
      problems.push(`seal for ${row.gameId}: ${side} drivers are not sorted largest first`);
    }
    if (!row.unfiled?.[side] && list.some((driver) => driver.status === null)) {
      problems.push(`seal for ${row.gameId}: a ${side} driver has no status on a side the report covers`);
    }
  }
  return problems;
}

/**
 * Row-level rules. Seals key on (game, model version, seal kind): v1 writes one seal
 * per game, v2 a morning and a final seal of different kinds, plus a reissued seal when
 * the morning seal had no report. A miss belongs to one version, and a version cannot both
 * seal and miss the same game.
 */
export function ledgerProblems(rows: readonly LedgerRow[]): string[] {
  const problems: string[] = [];
  const games = new Set<string>();
  const sealKeys = new Set<string>();
  const sealedByVersion = new Set<string>();
  const missedByVersion = new Set<string>();
  const morningWithoutReport = new Set<string>();
  for (const row of rows) {
    const fields = row.type === "seal" ? ["issuedAt", "tipUtc"] as const
      : row.type === "missed" ? ["recordedAt", "tipUtc"] as const : ["recordedAt"] as const;
    for (const field of fields) {
      const value = (row as unknown as Record<string, unknown>)[field];
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        problems.push(`${row.type} for ${row.gameId} has invalid ${field}`);
      }
    }
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
    if (row.reportAt != null) {
      const report = row.reportAt;
      const parsed = Date.parse(`${report}:00Z`);
      const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(report)
        && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 16) === report;
      if (!valid) problems.push(`seal for ${row.gameId} has invalid reportAt`);
      else if (Number.isFinite(issued) && report > etWallClockOf(issued)) {
        problems.push(`seal for ${row.gameId} reportAt is after issuedAt (ET)`);
      }
    }
    if (row.policyRevision !== undefined &&
      (row.modelVersion !== POLICY_MODEL_VERSION || !Number.isFinite(issued) ||
        row.policyRevision !== policyRevisionAt(row.issuedAt))) {
      problems.push(`seal for ${row.gameId} has inconsistent policyRevision`);
    }
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
    if (kind === "morning" && row.availabilityMissing) morningWithoutReport.add(versionKey);
    if (kind === "reissued") {
      if (tip - issued <= FINAL_SEAL_WINDOW_MS) {
        problems.push(`reissued seal for ${row.gameId} must be more than an hour before tip`);
      }
      if (!morningWithoutReport.has(versionKey)) {
        problems.push(`reissued seal for ${row.gameId} without a morning seal that lacked a report`);
      }
      if (sealKeys.has(`${versionKey}|final`)) {
        problems.push(`reissued seal for ${row.gameId} after its final seal`);
      }
      if (row.availabilityMissing || (row.reportAt ?? null) === null) {
        problems.push(`reissued seal for ${row.gameId} has no report`);
      }
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
    problems.push(...driverProblems(row));
    if (
      row.unfiled &&
      (row.unfiled.home || row.unfiled.away) &&
      (row.availabilityMissing || (row.reportAt ?? null) === null)
    ) {
      problems.push(`seal for ${row.gameId} has an unfiled side but no report`);
    }
  }
  return problems;
}

/**
 * Bootstrap only: a valid base commit with no ledger file may start an empty ledger.
 * A missing/unreadable ref always fails, including with the flag. Normal jobs use DATA_BASE.
 */
export function readBaseLedger(baseRef: string, bootstrap = false): string {
  const options = { encoding: "utf-8" as const, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], maxBuffer: 200 * 1024 * 1024 };
  try {
    execFileSync("git", ["rev-parse", "--verify", `${baseRef}^{commit}`], options);
  } catch {
    throw new Error(`Cannot read base ref ${baseRef}; refusing to waive append-only history.`);
  }
  const files = execFileSync("git", ["ls-tree", "--name-only", baseRef, "--", RELATIVE_PATH], options);
  if (!files.trim() && bootstrap) return "";
  try {
    return execFileSync("git", ["show", `${baseRef}:${RELATIVE_PATH}`], options);
  } catch {
    throw new Error(`Cannot read base ledger at ${baseRef}; use --bootstrap-empty-ledger only for a valid initial commit with no ledger file.`);
  }
}

function main(): void {
  const baseRef = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "HEAD";
  const file = path.join(process.cwd(), RELATIVE_PATH);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";

  let committed: string;
  try {
    committed = readBaseLedger(baseRef, process.argv.includes("--bootstrap-empty-ledger"));
  } catch (error) {
    fail(String(error));
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
