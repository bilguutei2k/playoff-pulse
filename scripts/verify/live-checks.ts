// Checks for the live forecast path: published state, NBA seeding rules against
// real seasons, and the ledger. Runs offline.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { LIVE_MODEL_VERSION, LIVE_PARAMS } from "../../src/lib/season/params";
import { paramsHash, predictGame } from "../../src/lib/season/ratings";
import { assertForecastSums } from "../../src/lib/season/simulate";
import { SEASON_TEAMS, STATE_SIZE } from "../../src/lib/season/teams";
import type { LedgerRow, LiveState } from "../../src/lib/season/types";
import { seasonLabel } from "../../src/lib/season/formats";
import { LIVE_SEASON } from "../live/game-store";
import { runSeedingCheck } from "../live/seeding-check";
import { ledgerProblems } from "../live/verify-ledger";

export function runLiveChecks(): void {
  const state = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data/live/state.json"), "utf-8"),
  ) as LiveState;

  assert.equal(state.schemaVersion, 1, "Unknown live state schema.");
  assert.equal(state.modelVersion, LIVE_MODEL_VERSION, "State comes from another model version.");
  assert.equal(state.paramsHash, paramsHash(LIVE_PARAMS), "State comes from other parameters.");
  assert.equal(state.ratings.mean.length, STATE_SIZE, "Rating vector has the wrong size.");
  assert.equal(state.ratings.cov.length, STATE_SIZE ** 2, "Covariance has the wrong size.");
  assert.equal(state.forecast.teams.length, SEASON_TEAMS.length, "Forecast must cover 30 teams.");
  assert.ok(!Number.isNaN(Date.parse(state.generatedAt)), "generatedAt must be a timestamp.");
  assertForecastSums({
    ...state.forecast,
    // Published values are rounded, so allow for rounding before re-checking sums.
    sums: { champion: 1, makePlayoffs: 16, topSix: 12, playIn: 8 },
  });
  const sumOf = (key: "champion" | "makePlayoffs" | "topSix" | "playIn") =>
    state.forecast.teams.reduce((total, team) => total + team[key], 0);
  assert.ok(Math.abs(sumOf("champion") - 1) < 0.01, "Title odds must sum to 1.");
  assert.ok(Math.abs(sumOf("makePlayoffs") - 16) < 0.01, "Playoff odds must sum to 16.");
  assert.ok(Math.abs(sumOf("topSix") - 12) < 0.01, "Top-six odds must sum to 12.");
  assert.ok(Math.abs(sumOf("playIn") - 8) < 0.01, "Play-in odds must sum to 8.");

  // Published state must price a game inside [0, 1], with home court helping.
  const [first, second] = SEASON_TEAMS;
  const atFirst = predictGame(
    state.ratings,
    {
      homeId: first.id,
      awayId: second.id,
      neutral: false,
      playoff: false,
      homeOnBackToBack: false,
      awayOnBackToBack: false,
    },
    state.params,
  );
  const neutral = predictGame(
    state.ratings,
    {
      homeId: first.id,
      awayId: second.id,
      neutral: true,
      playoff: false,
      homeOnBackToBack: false,
      awayOnBackToBack: false,
    },
    state.params,
  );
  assert.ok(atFirst.homeWinProbability >= 0 && atFirst.homeWinProbability <= 1);
  assert.ok(
    atFirst.homeWinProbability > neutral.homeWinProbability,
    "Home court must raise the home team's chance.",
  );

  const seeding = runSeedingCheck();
  assert.deepEqual(seeding.mismatches, [], "Computed seeds must match real seasons.");
  assert.equal(seeding.checked, 100, "Seeding check must cover five seasons of seeds 1-10.");

  const ledgerPath = path.join(
    process.cwd(),
    "data/live/ledger",
    `${seasonLabel(LIVE_SEASON)}.jsonl`,
  );
  if (fs.existsSync(ledgerPath)) {
    const rows = fs
      .readFileSync(ledgerPath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LedgerRow);
    assert.deepEqual(ledgerProblems(rows), [], "Ledger rows must be valid.");
  }
}

if (process.argv[1]?.endsWith("live-checks.ts")) {
  runLiveChecks();
  console.log("Live checks passed.");
}
