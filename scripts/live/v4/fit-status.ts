// v4 fit, M3: status weights by v2's rule (engine-run.ts, `fitStatusTable`), on the report
// seasons 2021-22 to 2023-24. Tables: frozen (all three), leave-one-season-out (scoring a
// report season), and before-origin (the rating fits of origins 2022-23 and 2023-24).
//
// Run: corepack pnpm exec tsx scripts/live/v4/fit-status.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { fitStatusTable, REPORT_SEASONS } from "./engine-run";

const out = {
  frozen: fitStatusTable(REPORT_SEASONS),
  leaveOneOut: Object.fromEntries(
    REPORT_SEASONS.map((season) => [season, fitStatusTable(REPORT_SEASONS.filter((other) => other !== season))]),
  ),
  beforeOrigin: {
    2023: fitStatusTable([2022]),
    2024: fitStatusTable([2022, 2023]),
  },
};
const target = path.join(process.cwd(), "docs/live/v4-fit-parts/status.json");
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, "utf-8");
console.log(JSON.stringify(out.frozen));
