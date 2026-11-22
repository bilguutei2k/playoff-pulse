// The files the job publishes for the site under data/live/site/ (see
// src/lib/season/site-files.ts), computed from what is on disk. pipeline.ts writes them
// after every run; `verify:live` checks the committed copies against them.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  isModelViewPath,
  SITE_MANIFEST_PATH,
  siteFileContent,
  siteFileContents,
  type SiteManifest,
} from "../../src/lib/season/site-files";
import { V4_MODEL_VERSION } from "../../src/lib/season/params-v4";
import type { LedgerRow } from "../../src/lib/season/types";

/** v4's shadow file (registration-v4.md, W2), under data/live. */
export const shadowPath = (seasonLabel: string) => `site/${seasonLabel}/shadow-v4.json`;

export const SITE_DIRECTORY_NAME = "site";

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function readLedgerRows(file: string): LedgerRow[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerRow);
}

/**
 * Every site file's path under data/live and its exact content: the day and month files
 * derived from the season's ledger, and the manifest hashing them together with the
 * state and games files the site also reads and the model views on disk (projections,
 * team injury lists, player files), which the job writes before calling this.
 */
export function expectedSiteFiles(liveDirectory: string, season: number, seasonLabel: string): Map<string, string> {
  // v4's shadow rows stay out of the files the site reads (registration-v4.md, W2); the site
  // sees v4 only through its shadow file.
  const ledger = readLedgerRows(path.join(liveDirectory, "ledger", `${seasonLabel}.jsonl`)).filter(
    (row) => row.type === "result" || row.modelVersion !== V4_MODEL_VERSION,
  );
  const files = siteFileContents(ledger, seasonLabel);
  const hashes: Record<string, string> = {};
  for (const relative of ["state.json", `games/${season}.json`]) {
    const file = path.join(liveDirectory, relative);
    if (fs.existsSync(file)) hashes[relative] = sha256(fs.readFileSync(file));
  }
  for (const [relative, content] of files) hashes[relative] = sha256(content);
  for (const [relative, content] of publishedSiteFiles(liveDirectory)) {
    if (isModelViewPath(relative, seasonLabel) || relative === shadowPath(seasonLabel)) hashes[relative] = sha256(content);
  }
  const manifest: SiteManifest = {
    version: 1,
    season,
    seasonLabel,
    ledgerRows: ledger.length,
    files: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))),
  };
  files.set(SITE_MANIFEST_PATH, siteFileContent(manifest));
  return files;
}

/** Site files on disk under data/live/site, by path under data/live. */
export function publishedSiteFiles(liveDirectory: string): Map<string, string> {
  const root = path.join(liveDirectory, SITE_DIRECTORY_NAME);
  const files = new Map<string, string>();
  if (!fs.existsSync(root)) return files;
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(path.relative(liveDirectory, full).split(path.sep).join("/"), fs.readFileSync(full, "utf-8"));
    }
  };
  walk(root);
  return files;
}
