// The one check of v5's shadow file and parameters (docs/live/registration-v5.md, "Wiring as
// built"). `verify:live` runs it on what is committed, and the job runs it inside v5's guard on
// exactly the file and ledger it is about to write, so the verify step can never reject what
// the job just wrote (the lesson of PR #38): if it finds a problem, v5 writes nothing that run.

import * as fs from "node:fs";
import * as path from "node:path";
import { V5_FROZEN, V5_MODEL_VERSION } from "../../../src/lib/season/params-v5";
import { V5_FIRST_ET_DATE, V5_LAST_ET_DATE } from "../../../src/lib/season/params-v5-live";
import { SEASON_TEAMS } from "../../../src/lib/season/teams";
import type { LedgerRow } from "../../../src/lib/season/types";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** s3 equals docs/live/v5-fit.json's frozen value. */
export function v5ParamsProblems(root = process.cwd()): string[] {
  const fit = JSON.parse(fs.readFileSync(path.join(root, "docs/live/v5-fit.json"), "utf-8")) as { frozen?: { s3?: unknown } };
  return fit.frozen?.s3 === V5_FROZEN.s3 ? [] : [`v5's s3 (${String(V5_FROZEN.s3)}) does not equal docs/live/v5-fit.json's frozen value (${String(fit.frozen?.s3)})`];
}

/**
 * Problems with a v5 shadow file against the ledger it sits beside (every row, v5's included):
 * its version, dates and s3, 30 teams, title odds summing to 1 and playoff odds to 16, and a
 * record that counts no more games than v5 sealed.
 */
export function shadowV5FileProblems(shadow: unknown, ledgerRows: readonly LedgerRow[]): string[] {
  if (!isRecord(shadow)) return ["shadow-v5.json is not an object"];
  const problems: string[] = [];
  if (shadow.modelVersion !== V5_MODEL_VERSION) problems.push("shadow-v5.json is not v5's");
  if (shadow.firstEtDate !== V5_FIRST_ET_DATE) problems.push(`shadow-v5.json's first ET date (${String(shadow.firstEtDate)}) is not V5_FIRST_ET_DATE (${String(V5_FIRST_ET_DATE)})`);
  if (shadow.lastEtDate !== V5_LAST_ET_DATE) problems.push(`shadow-v5.json's last ET date (${String(shadow.lastEtDate)}) is not V5_LAST_ET_DATE (${String(V5_LAST_ET_DATE)})`);
  if (shadow.s3 !== V5_FROZEN.s3) problems.push(`shadow-v5.json's s3 (${String(shadow.s3)}) is not the frozen s3`);
  const teams = Array.isArray(shadow.teams) ? (shadow.teams as unknown[]) : null;
  if (!teams || teams.length !== SEASON_TEAMS.length || !teams.every(isRecord)) {
    problems.push("shadow-v5.json must cover 30 teams");
  } else {
    const sum = (key: string) => (teams as Array<Record<string, unknown>>).reduce((total, team) => total + Number(team[key]), 0);
    if (!(Math.abs(sum("champion") - 1) < 0.01)) problems.push("v5 title odds must sum to 1");
    if (!(Math.abs(sum("makePlayoffs") - 16) < 0.01)) problems.push("v5 playoff odds must sum to 16");
  }
  const sealed = new Set(ledgerRows.filter((row) => row.type === "seal" && row.modelVersion === V5_MODEL_VERSION).map((row) => row.gameId));
  const record = shadow.record;
  if (!isRecord(record) || typeof record.sealed !== "number") problems.push("shadow-v5.json has no record");
  else if (!(record.sealed <= sealed.size)) problems.push(`the v5 shadow record counts ${record.sealed} sealed games, more than v5 sealed (${sealed.size})`);
  return problems;
}

/**
 * The same check on the v5 shadow file already on disk, for a run that writes no new one (v5
 * failed, or nothing was due). That file goes to the push as it is, and `verify:live` checks it
 * against the run's ledger and today's constants, which may have changed since it was written
 * (the stop switch). Null when there is no file. Never throws: a file that cannot be read or
 * parsed is a problem.
 */
export function shadowV5FileOnDiskProblems(file: string, ledgerRows: readonly LedgerRow[]): string[] | null {
  try {
    if (!fs.existsSync(file)) return null;
    return shadowV5FileProblems(JSON.parse(fs.readFileSync(file, "utf-8")), ledgerRows);
  } catch (error) {
    return [`shadow-v5.json could not be checked: ${error instanceof Error ? error.message : String(error)}`];
  }
}
