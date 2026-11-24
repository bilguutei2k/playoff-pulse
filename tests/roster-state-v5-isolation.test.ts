// v5: no v5 fit, diagnostic or gate can read 2024-25 or 2025-26 (as v4's isolation test for
// scripts/live/v4, extended to scripts/live/v5).

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { devPlusMinus, devPlusMinusLookup } from "../scripts/live/v5/dev-data-v5";

const directory = path.join(process.cwd(), "scripts/live/v5");
/** Modules that may touch season files directly, and why. */
const ALLOWED = new Set([
  "build-player-pm.ts", // writes the plus/minus files from the raw store (step 1); closed seasons as counts and hashes only
  "dev-data-v5.ts", // the plus/minus loader; refuses every season after 2023-24
  "fit-s3.ts", // hashes open seasons' files for the fit's provenance; reads seasons only through the loaders
]);

describe("v5 data isolation", () => {
  it("the v5 loader refuses the closed seasons", () => {
    for (const season of [2025, 2026, 2027]) {
      expect(() => devPlusMinus(season)).toThrow(/closed/);
      expect(() => devPlusMinusLookup(2011, season)).toThrow(/closed/);
    }
    expect(() => devPlusMinus(2024)).not.toThrow();
  });

  it("no other file under scripts/live/v5 loads a season directly", () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".ts"))) {
      if (ALLOWED.has(file)) continue;
      const text = fs.readFileSync(path.join(directory, file), "utf-8");
      if (/from "\.\.\/v4\/season-files"/.test(text)) offenders.push(`${file}: imports season-files`);
      if (/from "\.\.\/v4\/warm-state"/.test(text)) offenders.push(`${file}: imports warm-state`);
      if (/data\/season|data\/live|player-pm/.test(text)) offenders.push(`${file}: names a data directory`);
    }
    expect(offenders).toEqual([]);
  });
});
