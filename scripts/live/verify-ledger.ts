// Checks the forecast ledger. Committed rows must never change: the current file
// must extend the version at the base ref, byte for byte. Git already provides the
// tamper-evident history, so no separate hash chain is kept. The pipeline also runs
// `ledgerProblems` on every row before it writes anything.
//
// Run: corepack pnpm verify:ledger [baseRef] [--bootstrap-empty-ledger]
// baseRef defaults to HEAD. A base ref that cannot be read fails; the flag only lets a
// valid commit that has no ledger file yet stand for an empty ledger. The live job passes
// live-data's previous head (or main's HEAD when it bootstraps live-data, which carries
// main's frozen ledger), so it never needs the flag.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { etWallClockOf } from "../../src/lib/season/dates";
import { seasonLabel } from "../../src/lib/season/formats";
import {
  FINAL_SEAL_WINDOW_MS,
  missedVersionOf,
  sealKindOf,
} from "../../src/lib/season/live-state";
import { POLICY_MODEL_VERSION, policyRevisionAt } from "../../src/lib/season/policy-revisions";
import type { LedgerRow, SealRow } from "../../src/lib/season/types";
import { LIVE_SEASON } from "./game-store";

const RELATIVE_PATH = `data/live/ledger/${seasonLabel(LIVE_SEASON)}.jsonl`;
const BOOTSTRAP_FLAG = "--bootstrap-empty-ledger";

/**
 * A UTC instant as the job writes it: `2026-11-07T00:00Z` (ESPN's tips) or a full ISO
 * string with seconds and milliseconds (`toISOString`). The calendar fields must be real:
 * `2026-02-30T00:00Z` and anything `Date.parse` merely tolerates are rejected.
 */
export function isUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 16) === value.slice(0, 16);
}

/** An ET wall clock as reports are keyed: `2026-11-05T17:30`, with real calendar fields. */
export function isWallClock(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && isUtcInstant(`${value}Z`);
}

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
    const times = row.type === "seal" ? (["issuedAt", "tipUtc"] as const)
      : row.type === "missed" ? (["tipUtc", "recordedAt"] as const)
      : (["recordedAt"] as const);
    for (const field of times) {
      if (!isUtcInstant((row as unknown as Record<string, unknown>)[field])) {
        problems.push(`${row.type} for ${row.gameId} has an invalid ${field}`);
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
    // An invalid time is reported above; NaN makes this comparison false.
    if (issued >= tip) {
      problems.push(`seal for ${row.gameId} issued at or after tip`);
    }
    // The report in use is the latest at or before the issue time, compared on the ET
    // wall clock exactly as the pipeline chooses it (`latestReport` in live-reports.ts).
    if (row.reportAt != null) {
      if (!isWallClock(row.reportAt)) problems.push(`seal for ${row.gameId} has an invalid reportAt`);
      else if (Number.isFinite(issued) && row.reportAt > etWallClockOf(issued)) {
        problems.push(`seal for ${row.gameId} uses a report from after its issue time`);
      }
    }
    if (row.policyRevision !== undefined) {
      const derived = row.modelVersion === POLICY_MODEL_VERSION && Number.isFinite(issued)
        ? policyRevisionAt(row.issuedAt)
        : null;
      if (row.policyRevision !== derived) {
        problems.push(
          `seal for ${row.gameId} stores policy revision ${String(row.policyRevision)}, but its version and issue time give ${derived ?? "none"}`,
        );
      }
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
      // decideReissues leaves a game within the final seal's window to the final seal.
      if (!(tip - issued > FINAL_SEAL_WINDOW_MS)) {
        problems.push(`reissued seal for ${row.gameId} issued within an hour of tip`);
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
 * Rows appended since the base: every v2 seal the job writes now stores its policy
 * revision. Older committed rows are never rewritten, so this applies to new rows only.
 */
export function appendedRowProblems(committed: string, current: string): string[] {
  return current
    .slice(committed.length)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LedgerRow)
    .filter((row): row is SealRow => row.type === "seal" && row.modelVersion === POLICY_MODEL_VERSION)
    .filter((row) => row.policyRevision === undefined)
    .map((row) => `new ${sealKindOf(row)} seal for ${row.gameId} does not store its policy revision`);
}

/**
 * The ledger at `baseRef`. A ref that does not resolve to a commit, or a commit whose
 * ledger cannot be read, throws: the append-only check is never silently waived. Only
 * with `bootstrap` may a valid commit that has no ledger file stand for an empty one.
 */
export function readBaseLedger(baseRef: string, options: { bootstrap?: boolean; cwd?: string } = {}): string {
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: options.cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 200 * 1024 * 1024,
    });
  let commit: string;
  try {
    commit = git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]).trim();
  } catch {
    throw new Error(`cannot resolve base ref ${baseRef} to a commit; refusing to skip the append-only check.`);
  }
  const listed = git(["ls-tree", "--name-only", commit, "--", RELATIVE_PATH]).trim();
  if (listed === "") {
    if (options.bootstrap) return "";
    throw new Error(`base ${baseRef} has no ${RELATIVE_PATH}; pass ${BOOTSTRAP_FLAG} only when starting a new ledger.`);
  }
  try {
    return git(["show", `${commit}:${RELATIVE_PATH}`]);
  } catch {
    throw new Error(`cannot read ${RELATIVE_PATH} at ${baseRef}.`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== BOOTSTRAP_FLAG);
  const refs = args.filter((arg) => !arg.startsWith("--"));
  if (unknown.length > 0 || refs.length > 1) {
    fail(`usage: verify:ledger [baseRef] [${BOOTSTRAP_FLAG}]; got ${args.join(" ")}`);
  }
  const baseRef = refs[0] ?? "HEAD";
  const file = path.join(process.cwd(), RELATIVE_PATH);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";

  let committed = "";
  try {
    committed = readBaseLedger(baseRef, { bootstrap: args.includes(BOOTSTRAP_FLAG) });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!historyIntact(committed, current)) {
    fail(`committed rows changed compared with ${baseRef}. The ledger is append-only.`);
  }

  const rows = current
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerRow);
  const problems = [...ledgerProblems(rows), ...appendedRowProblems(committed, current)];
  if (problems.length > 0) fail(problems.join("; "));
  const appended = rows.length - committed.split("\n").filter(Boolean).length;
  console.log(`[verify-ledger] ${rows.length} row(s) valid, ${appended} new; history intact against ${baseRef}.`);
}

if (process.argv[1]?.endsWith("verify-ledger.ts")) main();
