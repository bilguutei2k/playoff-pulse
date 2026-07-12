// Regression checks for scripts/refresh-data.ts.
//
// These encode the exact failure modes that silently froze the daily refresh
// for the whole June 2026 Finals (docs/CODEBASE_HANDOVER.md, findings P0-1 and
// P0-4): ESPN abbreviations (NY, SA) not matching config tricodes (NYK, SAS),
// and a forward-dated snapshot timestamp that would exclude same-evening games
// from every later run.
//
// Run standalone: corepack pnpm verify:refresh

import { strict as assert } from "node:assert";
import {
  computeUpdate,
  isSnapshotStale,
  parseSnapshotTimestamp,
  ptSnapshotStamp,
} from "../refresh-data";
import type { LiveScoreboardGame } from "../../src/lib/live-data/types";
import type { Series, Team } from "../../src/lib/model/types";

function fixtureTeam(id: string, abbreviation: string): Team {
  return {
    id,
    name: abbreviation,
    abbreviation,
    conference: "East",
    seed: 1,
    eloRating: 1500,
    netRating: 0,
    manualAdjustment: 0,
    players: [],
  };
}

function fixtureGame(
  id: string,
  date: string,
  home: { abbr: string; score: string; winner: boolean },
  away: { abbr: string; score: string; winner: boolean },
): LiveScoreboardGame {
  return {
    id,
    name: `${away.abbr} at ${home.abbr}`,
    shortName: `${away.abbr} @ ${home.abbr}`,
    date,
    status: "final",
    statusDetail: "Final",
    venue: null,
    homeTeam: {
      abbreviation: home.abbr,
      displayName: home.abbr,
      homeAway: "home",
      score: home.score,
      winner: home.winner,
    },
    awayTeam: {
      abbreviation: away.abbr,
      displayName: away.abbr,
      homeAway: "away",
      score: away.score,
      winner: away.winner,
    },
  };
}

export function runRefreshChecks(): void {
  const teams: Record<string, Team> = {
    sas: fixtureTeam("sas", "SAS"),
    nyk: fixtureTeam("nyk", "NYK"),
  };
  const series: Series = {
    id: "fixture-finals-sas-nyk",
    round: "NBA Finals",
    conference: "Finals",
    bracketOrder: 1,
    teamA: "sas",
    teamB: "nyk",
    winsA: 1,
    winsB: 2,
    homePattern: ["sas", "sas", "nyk", "nyk", "sas", "nyk", "sas"],
  };
  const snapshotUtc = parseSnapshotTimestamp("2026-06-08 09:18 PM PT");

  // The June 2026 scenario: ESPN reports the Knicks and Spurs as NY and SA.
  const games = [
    fixtureGame(
      "g4",
      "2026-06-11T00:30Z",
      { abbr: "NY", score: "107", winner: true },
      { abbr: "SA", score: "106", winner: false },
    ),
    fixtureGame(
      "g5",
      "2026-06-14T00:30Z",
      { abbr: "SA", score: "90", winner: false },
      { abbr: "NY", score: "94", winner: true },
    ),
  ];

  const update = computeUpdate(series, teams, games, snapshotUtc);
  assert(
    update,
    "ESPN alias abbreviations (NY, SA) must match config tricodes (NYK, SAS).",
  );
  assert.equal(update.newWinsA, 1, "SAS wins should be unchanged.");
  assert.equal(update.newWinsB, 4, "Both NYK wins should be counted.");
  assert.equal(update.gamesAdded.length, 2, "Both final games should be recorded.");

  // Games at or before the snapshot must not be double counted.
  const staleGame = fixtureGame(
    "g3",
    "2026-06-09T00:30Z",
    { abbr: "NY", score: "111", winner: false },
    { abbr: "SA", score: "115", winner: true },
  );
  const staleUpdate = computeUpdate(
    series,
    teams,
    [staleGame],
    parseSnapshotTimestamp("2026-06-09 09:00 PM PT"),
  );
  assert.equal(
    staleUpdate,
    null,
    "Games dated at or before the snapshot timestamp must be ignored.",
  );

  // Wins must cap at 4 even if the feed somehow over-reports.
  const overUpdate = computeUpdate(
    { ...series, winsB: 3 },
    teams,
    [...games, fixtureGame(
      "g6",
      "2026-06-17T00:30Z",
      { abbr: "NY", score: "100", winner: true },
      { abbr: "SA", score: "99", winner: false },
    )],
    snapshotUtc,
  );
  assert(overUpdate && overUpdate.newWinsB === 4, "Wins must cap at 4.");

  // Timestamp honesty: the stamp reflects the actual run moment (PT) and
  // round-trips through the parser. Forward-dating the snapshot would
  // permanently skip games played later the same day (finding P0-4).
  const runMoment = new Date("2026-07-12T17:52:12Z"); // 10:52 AM PDT
  const stamp = ptSnapshotStamp(runMoment);
  assert.equal(stamp.timestamp, "2026-07-12 10:52 AM PT");
  assert.equal(stamp.date, "2026-07-12");
  const reparsed = parseSnapshotTimestamp(stamp.timestamp);
  assert(
    Math.abs(reparsed.getTime() - runMoment.getTime()) < 60_000,
    "Snapshot timestamp must round-trip to the actual run moment (minute precision).",
  );
  assert(
    reparsed.getTime() <= runMoment.getTime(),
    "Snapshot timestamp must never be in the future of the run moment.",
  );

  // Midnight and noon PT edge cases for the 12-hour clock conversion.
  assert.equal(ptSnapshotStamp(new Date("2026-07-12T07:00:00Z")).timestamp, "2026-07-12 12:00 AM PT");
  assert.equal(ptSnapshotStamp(new Date("2026-07-12T19:00:00Z")).timestamp, "2026-07-12 12:00 PM PT");

  // Staleness guard: a snapshot that has not advanced in more than the
  // threshold while series are active must trip the alarm; anything at or
  // under the threshold must not (NBA series routinely pause 2-3 days).
  const staleSnapshot = parseSnapshotTimestamp("2026-06-08 09:18 PM PT"); // 2026-06-09T04:18Z
  assert.equal(
    isSnapshotStale(staleSnapshot, new Date("2026-06-13T04:18:00Z"), 4),
    false,
    "Exactly 4 days old must not be flagged stale.",
  );
  assert.equal(
    isSnapshotStale(staleSnapshot, new Date("2026-06-13T05:00:00Z"), 4),
    true,
    "More than 4 days old must be flagged stale.",
  );
  assert.equal(
    isSnapshotStale(staleSnapshot, new Date("2026-06-11T00:00:00Z"), 4),
    false,
    "A fresh snapshot must not be flagged stale.",
  );
}

if (typeof require !== "undefined" && require.main === module) {
  runRefreshChecks();
  console.log("Refresh regression checks passed.");
}
