import { loadSeries, loadSnapshots } from "./build-snapshots";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const series = loadSeries(2024);
const snapshots = loadSnapshots(2024);

const finals = series.find((row) => row.round === "NBA Finals");
assert(Boolean(finals), "NBA Finals series was not found.");
assert(finals?.winner === "BOS", `Expected BOS to win Finals, got ${finals?.winner}.`);
assert(finals?.gamesPlayed === 5, `Expected Finals to last 5 games, got ${finals?.gamesPlayed}.`);
assert(
  (finals?.teamA === "BOS" && finals.winsA === 4) ||
    (finals?.teamB === "BOS" && finals.winsB === 4),
  "Expected BOS to have 4 wins in the Finals.",
);

for (const row of series) {
  assert(
    row.gamesPlayed >= 4 && row.gamesPlayed <= 7,
    `${row.id} has invalid gamesPlayed=${row.gamesPlayed}.`,
  );
}

const snapshotsByTeam = new Map(snapshots.map((snapshot) => [snapshot.teamId, snapshot]));
for (const row of series) {
  for (const teamId of [row.teamA, row.teamB]) {
    const snapshot = snapshotsByTeam.get(teamId);
    assert(Boolean(snapshot), `Missing snapshot for ${teamId}.`);
    assert(
      snapshot!.snapshot_as_of < row.seriesStartDate,
      `Leakage violation for ${teamId} in ${row.id}: ${snapshot!.snapshot_as_of} >= ${row.seriesStartDate}.`,
    );
  }
}

console.log("2024 backtest sanity checks passed.");
