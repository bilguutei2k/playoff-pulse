// v4 fit, M4: return hazards by group (reason kind and diagnosis family), each cell shrunk
// toward its v3 class cell: h = (returns + m h_class) / (at-risk + m), the class table fitted
// by v3's rule (`fitHazards`, imported unchanged) on the same observations. m from
// {10, 30, 100} by leave-one-season-out log loss over 2021-22 to 2023-24. Stored: the frozen
// table (all three seasons) and one leave-one-season-out table per season.
//
// Run: corepack pnpm exec tsx scripts/live/v4/fit-hazards.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { countGroupCells, groupHazard, type GroupHazardTable } from "../../../src/lib/season/availability-v4";
import { fitHazards } from "../../../src/lib/season/injury-v3";
import { collectGroupedObservations, HAZARD_SEASONS, type GroupedObservation } from "./hazard-data";

export const SHRINKAGE_GRID = [10, 30, 100] as const;

export function tableFor(observations: readonly GroupedObservation[], shrinkage: number): GroupHazardTable {
  const classTable = fitHazards(observations.map((row) => ({ k: row.k, class: row.class, returned: row.returned }))).table;
  return { classTable, shrinkage, cells: countGroupCells(observations) };
}

const observations = collectGroupedObservations();
const losses = SHRINKAGE_GRID.map((shrinkage) => {
  let loss = 0;
  for (const season of HAZARD_SEASONS) {
    const table = tableFor(observations.filter((row) => row.season !== season), shrinkage);
    for (const row of observations) {
      if (row.season !== season) continue;
      const p = Math.min(1 - 1e-9, Math.max(1e-9, groupHazard(table, row.k, row.group, row.class)));
      loss -= row.returned ? Math.log(p) : Math.log(1 - p);
    }
  }
  return { shrinkage, logLoss: loss / observations.length };
});
const best = losses.reduce((a, b) => (b.logLoss < a.logLoss ? b : a));
const groups: Record<string, number> = {};
for (const row of observations) groups[row.group] = (groups[row.group] ?? 0) + 1;
const out = {
  observations: observations.length,
  bySeason: Object.fromEntries(HAZARD_SEASONS.map((season) => [season, observations.filter((row) => row.season === season).length])),
  groups,
  shrinkageGrid: losses,
  shrinkage: best.shrinkage,
  frozen: tableFor(observations, best.shrinkage),
  leaveOneOut: Object.fromEntries(
    HAZARD_SEASONS.map((season) => [season, tableFor(observations.filter((row) => row.season !== season), best.shrinkage)]),
  ),
};
fs.writeFileSync(path.join(process.cwd(), "docs/live/v4-fit-parts/hazards.json"), `${JSON.stringify(out, null, 2)}\n`, "utf-8");
console.log(JSON.stringify({ observations: out.observations, shrinkageGrid: losses, shrinkage: best.shrinkage, groups }, null, 1));
