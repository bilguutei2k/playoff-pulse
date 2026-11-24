// v5's frozen constants: s3 and the grid pinned to docs/live/v5-fit.json; v4's parameters imported unchanged.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { V4_FROZEN } from "@/lib/season/params-v4";
import { V5_FROZEN, V5_MODEL_VERSION, V5_S3_GRID } from "@/lib/season/params-v5";

const fit = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/live/v5-fit.json"), "utf-8"));

describe("v5 parameters", () => {
  it("pins s3 and the grid to the fit", () => {
    expect(fit.version).toBe(V5_MODEL_VERSION);
    expect(fit.grid).toEqual(V5_S3_GRID.map((s3) => (s3 === null ? "off" : String(s3))));
    expect(V5_FROZEN.s3).toBe(fit.frozen.s3);
    for (const row of Object.values(fit.origins) as Array<{ chosen: string; s3: number | null; losses: Record<string, number> }>) {
      const best = Object.entries(row.losses).reduce((a, b) => (b[1] < a[1] ? b : a))[0];
      expect(row.chosen).toBe(best);
      expect(row.s3).toBe(best === "off" ? null : Number(best));
    }
  });

  it("takes v4's frozen parameters unchanged", () => {
    expect(V5_FROZEN.v4).toBe(V4_FROZEN);
  });
});
