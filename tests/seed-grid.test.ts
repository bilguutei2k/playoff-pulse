import { describe, expect, it } from "vitest";
import { SEED_BANDS, seedGrids, seedShade } from "@/lib/view/seed-grid";
import type { OddsRow } from "@/lib/view/odds";

const row = (teamId: string, conference: "East" | "West", seeds: number[], projectedWins = 41): OddsRow =>
  ({ teamId, conference, seeds, projectedWins, name: teamId }) as OddsRow;

const at = (seed: number, p = 1) => Array.from({ length: 15 }, (_, i) => (i === seed - 1 ? p : (1 - p) / 14));

describe("seeding grid", () => {
  it("groups by conference, East first, and orders by expected seed", () => {
    const grids = seedGrids([row("a", "West", at(3)), row("b", "East", at(9)), row("c", "East", at(1)), row("d", "West", at(1, 0.4))]);
    expect(grids.map((grid) => grid.conference)).toEqual(["East", "West"]);
    expect(grids[0].rows.map((r) => r.teamId)).toEqual(["c", "b"]);
    // d's mass is spread, so its mean seed (~5.2) is behind a's 3.
    expect(grids[1].rows.map((r) => r.teamId)).toEqual(["a", "d"]);
  });

  it("passes the published numbers through untouched", () => {
    const seeds = at(4, 0.3123);
    expect(seedGrids([row("a", "East", seeds)])[0].rows[0].seeds).toBe(seeds);
  });

  it("breaks ties on projected wins", () => {
    const grids = seedGrids([row("a", "East", at(5), 40), row("b", "East", at(5), 44)]);
    expect(grids[0].rows.map((r) => r.teamId)).toEqual(["b", "a"]);
  });

  it("covers seeds 1 to 15 in three bands", () => {
    expect(SEED_BANDS.map((band) => [band.from, band.to])).toEqual([[1, 6], [7, 10], [11, 15]]);
  });

  it("shades by probability, nothing under the 1% print threshold", () => {
    expect([0, 0.004, 0.005, 0.049, 0.05, 0.15, 0.3, 0.5, 1].map(seedShade)).toEqual([0, 0, 1, 1, 2, 3, 4, 5, 5]);
  });
});
