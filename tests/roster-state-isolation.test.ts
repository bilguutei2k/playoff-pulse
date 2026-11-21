// v4, section 0 of the plan: no v4 fit, diagnostic or gate can read 2024-25 or 2025-26.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { warmState, type RosterState } from "@/lib/season/roster-state";
import { assertOpen, devGames, devLines, devOpeningRosters, devSeasonGames, devStoredBoxScores, devAvailability } from "../scripts/live/v4/dev-data";

const directory = path.join(process.cwd(), "scripts/live/v4");
/** Modules that may touch season files directly, and why. */
const ALLOWED = new Set([
  "season-files.ts", // the raw loaders themselves
  "dev-data.ts", // refuses every season after 2023-24
  "warm-state.ts", // the pass through the closed seasons; returns a state only
  "build-player-games.ts", // writes the compact files from the raw store (step 1)
]);

describe("v4 data isolation", () => {
  it("dev-data refuses the closed seasons", () => {
    for (const season of [2025, 2026, 2027]) {
      expect(() => assertOpen(season)).toThrow(/closed/);
      expect(() => devSeasonGames(season)).toThrow(/closed/);
      expect(() => devLines(season)).toThrow(/closed/);
      expect(() => devGames(2011, season)).toThrow(/closed/);
      expect(() => devOpeningRosters(season)).toThrow(/closed/);
      expect(() => devStoredBoxScores(season)).toThrow(/closed/);
      expect(() => devAvailability([season])).toThrow(/closed/);
    }
    expect(() => assertOpen(2024)).not.toThrow();
  });

  it("no other file under scripts/live/v4 loads a season directly", () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".ts"))) {
      if (ALLOWED.has(file)) continue;
      const text = fs.readFileSync(path.join(directory, file), "utf-8");
      if (/from "\.\/season-files"/.test(text)) offenders.push(`${file}: imports season-files`);
      if (/from "\.\.\/(game-store|availability-store|v3-hazard-data)"/.test(text)) offenders.push(`${file}: imports a v1-v3 loader`);
      if (/data\/season|data\/live|readFileSync\([^)]*boxscores/.test(text)) offenders.push(`${file}: names a data directory`);
    }
    expect(offenders).toEqual([]);
  });

  it("warmState returns a state and nothing else, and takes no forecast callback", () => {
    expectTypeOf(warmState).returns.toEqualTypeOf<RosterState>();
    type Input = Parameters<typeof warmState>[0];
    expectTypeOf<"onForecast" extends keyof Input ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<"onDate" extends keyof Input ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<keyof RosterState>().toEqualTypeOf<
      | "season"
      | "lastEtDate"
      | "n"
      | "capacity"
      | "keys"
      | "slots"
      | "mean"
      | "cov"
      | "lastSeason"
      | "teamLastDate"
      | "minutes"
      | "scaleWindow"
      | "scale"
    >();
  });

  it("nothing under src/lib/season imports src/lib/score", () => {
    const season = path.join(process.cwd(), "src/lib/season");
    for (const file of fs.readdirSync(season).filter((name) => name.endsWith(".ts"))) {
      expect(fs.readFileSync(path.join(season, file), "utf-8")).not.toMatch(/from "[^"]*lib\/score/);
    }
  });
});
