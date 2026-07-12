// Full model verification: generic invariants + refresh regression checks +
// current-snapshot checks.
//
// - scripts/verify/invariants.ts     — must hold for any valid config; safe to
//   run in CI and in the automated data-refresh workflow.
// - scripts/verify/refresh-checks.ts — regression checks for the daily
//   refresh script (abbreviation aliases, timestamp honesty, win capping).
// - scripts/verify/data-snapshot.ts  — describes the current manual data
//   snapshot; update it in the same commit as any manual data change. Not run
//   by the refresh workflow (which changes series scores by design).
//
// Run: corepack pnpm verify

import { runInvariantChecks } from "./verify/invariants";
import { runRefreshChecks } from "./verify/refresh-checks";
import { runDataSnapshotChecks } from "./verify/data-snapshot";

runInvariantChecks();
runRefreshChecks();
runDataSnapshotChecks();
console.log("Model verification passed.");
