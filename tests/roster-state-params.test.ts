// v4's frozen constants: Stage 1 coefficients pinned to docs/score/fit.json, the fitted set
// pinned to docs/live/v4-fit.json.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { V4_BOX_COEFFICIENTS, V4_BOX_STATS, V4_FROZEN, V4_MODEL_VERSION } from "@/lib/season/params-v4";

const read = (file: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf-8"));

describe("v4 parameters", () => {
  it("copies the 548 score's Stage 1 coefficients exactly", () => {
    const beta = read("docs/score/fit.json").primary.beta as Record<string, number>;
    expect(V4_BOX_STATS.map((stat) => beta[stat])).toEqual([...V4_BOX_COEFFICIENTS]);
  });

  it("copies the frozen fit exactly", () => {
    const fit = read("docs/live/v4-fit.json");
    expect(fit.version).toBe(V4_MODEL_VERSION);
    expect(V4_FROZEN.ratings).toEqual(fit.frozen.ratings);
    expect(V4_FROZEN.background).toEqual(fit.frozen.background);
    expect(V4_FROZEN.statusTable).toEqual(fit.status.frozen);
    expect(V4_FROZEN.hazards).toEqual(fit.hazards.frozen);
    expect(V4_FROZEN.horizonDays).toBe(fit.s2 === null ? null : fit.s2.horizonDays);
  });
});
