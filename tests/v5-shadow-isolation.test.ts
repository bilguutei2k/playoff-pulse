// v5's live wiring (scripts/live/v5-shadow) and the closed seasons, the counterpart of the
// allow-list in tests/roster-state-isolation.test.ts that names v4's warm-state module. The
// registered test tests/roster-state-v5-isolation.test.ts covers scripts/live/v5 and stays as
// registered; the live modules sit in their own directory so it never has to change.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { RosterState } from "@/lib/season/roster-state-v5";
import { devPlusMinus } from "../scripts/live/v5/dev-data-v5";
import { warmStateV5Through } from "../scripts/live/v5-shadow/warm-state-v5";

const directory = path.join(process.cwd(), "scripts/live/v5-shadow");
/** Modules that may touch season or live data files directly, and why. */
const ALLOWED = new Set([
  "warm-state-v5.ts", // the pass through the closed seasons, with its own plus/minus reader; returns a state only
  "build-warm-checkpoint.ts", // runs warm-state-v5.ts and writes the state it returns, nothing else
  "checkpoint.ts", // the live job's loader of the committed warm checkpoint (a state) only
  "check.ts", // reads docs/live/v5-fit.json's frozen s3, no season or live data
]);

describe("v5 live wiring isolation", () => {
  it("the development loader still refuses the closed seasons", () => {
    for (const season of [2025, 2026]) expect(() => devPlusMinus(season)).toThrow(/closed/);
  });

  it("no other file under scripts/live/v5-shadow reads a season or live data file", () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".ts"))) {
      if (ALLOWED.has(file)) continue;
      const text = fs.readFileSync(path.join(directory, file), "utf-8");
      if (/from "\.\.\/v4\/season-files"/.test(text)) offenders.push(`${file}: imports season-files`);
      if (/from "\.\.\/v4\/warm-state"/.test(text)) offenders.push(`${file}: imports v4's warm-state`);
      if (/from "\.\/warm-state-v5"/.test(text)) offenders.push(`${file}: imports warm-state-v5`);
      if (/data\/season|data\/live|player-pm|readFileSync/.test(text)) offenders.push(`${file}: reads a data file`);
    }
    expect(offenders).toEqual([]);
  });

  it("only the checkpoint builder imports warm-state-v5 anywhere in scripts", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|mjs)$/.test(entry.name) && /warm-state-v5"/.test(fs.readFileSync(full, "utf-8"))) importers.push(path.relative(process.cwd(), full));
      }
    };
    walk(path.join(process.cwd(), "scripts"));
    expect(importers).toEqual(["scripts/live/v5-shadow/build-warm-checkpoint.ts"]);
  });

  it("warmStateV5Through returns a state and nothing else", () => {
    expectTypeOf(warmStateV5Through).returns.toEqualTypeOf<RosterState>();
    type Input = Parameters<typeof warmStateV5Through>[0];
    expectTypeOf<keyof Input>().toEqualTypeOf<"lastStoredSeason" | "throughEtDate">();
  });
});
