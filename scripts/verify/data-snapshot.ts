// Manual-data snapshot checks.
//
// These assertions describe the CURRENT manual configuration (rosters, series
// scores, bracket state) and must be updated in the same commit as any
// deliberate manual data change. They are intentionally NOT run by the
// automated data-refresh workflow: that workflow changes series scores, so
// score assertions here would block every legitimate refresh PR
// (docs/CODEBASE_HANDOVER.md, finding P0-2). CI and humans run the full
// `corepack pnpm verify`, which includes both invariants and this file.
//
// Snapshot described here: 2026-07-12 — the 2026 playoffs are complete;
// NYK defeated SAS 4-1 in the NBA Finals.
//
// Run standalone: corepack pnpm verify:data

import { strict as assert } from "node:assert";
import { defaultModelSettings } from "../../src/lib/data/model-settings";
import { playoffConfig } from "../../src/lib/data/playoff-config";
import { estimateBracketForecast } from "../../src/lib/model/bracket-simulator";
import {
  estimateSeriesProbability,
  nextGameForecast,
} from "../../src/lib/model/simulator";

export function runDataSnapshotChecks(): void {
  const currentTeamsById = Object.fromEntries(
    playoffConfig.teams.map((team) => [team.id, team]),
  );

  const finalsRosterChecks = [
    {
      teamId: "nyk",
      requiredPlayers: [
        "Jalen Brunson",
        "Karl-Anthony Towns",
        "OG Anunoby",
        "Mikal Bridges",
        "Josh Hart",
        "Jordan Clarkson",
        "Miles McBride",
        "Pacome Dadiet",
        "Jose Alvarado",
        "Tyler Kolek",
        "Jeremy Sochan",
        "Mitchell Robinson",
        "Landry Shamet",
        "Mohamed Diawara",
        "Ariel Hukporti",
      ],
      activePlayers: [
        "Jalen Brunson",
        "Karl-Anthony Towns",
        "OG Anunoby",
        "Mikal Bridges",
        "Josh Hart",
        "Landry Shamet",
        "Miles McBride",
        "Mitchell Robinson",
        "Jose Alvarado",
        "Jordan Clarkson",
      ],
      stalePlayers: ["Precious Achiuwa"],
    },
    {
      teamId: "sas",
      requiredPlayers: [
        "Victor Wembanyama",
        "De'Aaron Fox",
        "Dylan Harper",
        "Keldon Johnson",
        "Luke Kornet",
        "Kelly Olynyk",
        "Bismack Biyombo",
        "Mason Plumlee",
        "Jordan McLaughlin",
        "Lindy Waters III",
        "Harrison Barnes",
        "Carter Bryant",
        "Stephon Castle",
        "Julian Champagnie",
        "Devin Vassell",
      ],
      activePlayers: [
        "Victor Wembanyama",
        "De'Aaron Fox",
        "Devin Vassell",
        "Stephon Castle",
        "Julian Champagnie",
        "Dylan Harper",
        "Harrison Barnes",
        "Luke Kornet",
        "Keldon Johnson",
        "Carter Bryant",
      ],
      stalePlayers: ["Zach Collins", "Malaki Branham"],
    },
  ];

  for (const rosterCheck of finalsRosterChecks) {
    const team = currentTeamsById[rosterCheck.teamId];
    assert(team, `Current Finals roster check requires team ${rosterCheck.teamId}.`);
    const playersByName = new Map(
      team.players.map((player) => [player.name, player]),
    );

    for (const playerName of rosterCheck.requiredPlayers) {
      assert(
        playersByName.has(playerName),
        `${team.name} Finals roster should include ${playerName}.`,
      );
    }

    for (const playerName of rosterCheck.activePlayers) {
      const player = playersByName.get(playerName);
      assert(
        player && player.projectedMinutes > 0 && player.injuryStatus !== "out",
        `${team.name} Finals rotation should keep ${playerName} active with projected minutes.`,
      );
    }

    for (const playerName of rosterCheck.stalePlayers) {
      assert(
        !playersByName.has(playerName),
        `${team.name} Finals roster should not include stale player ${playerName}.`,
      );
    }

    const activeMinutes = team.players.reduce(
      (sum, player) =>
        player.injuryStatus === "out" ? sum : sum + player.projectedMinutes,
      0,
    );
    assert(
      activeMinutes >= 235 && activeMinutes <= 245,
      `${team.name} active Finals rotation minutes should stay near 240; found ${activeMinutes}.`,
    );
  }

  const configuredFinals = playoffConfig.series.find(
    (series) => series.round === "NBA Finals",
  );
  assert(configuredFinals, "Current config should include a configured NBA Finals series.");
  assert(
    configuredFinals.teamA === "sas" &&
      configuredFinals.teamB === "nyk" &&
      configuredFinals.winsA === 1 &&
      configuredFinals.winsB === 4,
    "NBA Finals config should reflect the completed series: NYK defeated SAS 4-1.",
  );

  assert(
    nextGameForecast(configuredFinals, currentTeamsById, defaultModelSettings) === null,
    "A completed NBA Finals should have no next-game forecast.",
  );

  const currentFinalsForecast = estimateSeriesProbability(
    configuredFinals,
    currentTeamsById,
    defaultModelSettings,
  );
  assert(
    currentFinalsForecast.teamBSeriesWinProbability === 1 &&
      currentFinalsForecast.teamASeriesWinProbability === 0 &&
      currentFinalsForecast.expectedGamesRemaining === 0,
    "A completed Finals should report the winner at 100% with no games remaining.",
  );

  const hypotheticalFinalsForecast = estimateSeriesProbability(
    { ...configuredFinals, winsA: 0, winsB: 0 },
    currentTeamsById,
    defaultModelSettings,
  );
  assert(
    hypotheticalFinalsForecast.teamASeriesWinProbability > 0 &&
      hypotheticalFinalsForecast.teamASeriesWinProbability < 1,
    "A hypothetical 0-0 Finals between the configured teams should stay probabilistic.",
  );

  const currentBracketForecast = estimateBracketForecast(
    playoffConfig,
    defaultModelSettings,
  );
  const titleTeams = currentBracketForecast.rows
    .filter((row) => row.championshipProbability > 0)
    .map((row) => row.teamId);
  assert.deepEqual(
    titleTeams,
    ["nyk"],
    "With the Finals complete, only NYK should hold championship probability.",
  );
  const nykRow = currentBracketForecast.rows.find((row) => row.teamId === "nyk");
  assert(
    nykRow?.championshipProbability === 1,
    "NYK should be the confirmed 2026 champion at 100%.",
  );
  for (const teamId of ["nyk", "sas"]) {
    const row = currentBracketForecast.rows.find((item) => item.teamId === teamId);
    assert(
      row?.reachFinalsProbability === 1,
      `${currentTeamsById[teamId]?.name ?? teamId} should be locked into the NBA Finals.`,
    );
  }
  for (const teamId of ["cle", "okc"]) {
    const row = currentBracketForecast.rows.find((item) => item.teamId === teamId);
    assert(
      row && row.reachFinalsProbability === 0 && row.championshipProbability === 0,
      `${currentTeamsById[teamId]?.name ?? teamId} should have no active Finals or title probability after elimination.`,
    );
  }

  const activeConferenceSemifinalCount = playoffConfig.series.filter(
    (series) =>
      series.round === "Conference Semifinal" &&
      series.winsA < 4 &&
      series.winsB < 4,
  ).length;
  const completedConferenceSemifinalCount = playoffConfig.series.filter(
    (series) =>
      series.round === "Conference Semifinal" &&
      (series.winsA >= 4 || series.winsB >= 4),
  ).length;
  const expectedConferenceFinalsReachTotal =
    activeConferenceSemifinalCount + completedConferenceSemifinalCount;
  const conferenceFinalsReachTotal = currentBracketForecast.rows.reduce(
    (sum, row) => sum + row.reachConferenceFinalsProbability,
    0,
  );
  assert(
    conferenceFinalsReachTotal >= expectedConferenceFinalsReachTotal - 0.4 &&
      conferenceFinalsReachTotal <= expectedConferenceFinalsReachTotal + 0.4,
    `Conference finals reach probabilities sum correctly: actual ${conferenceFinalsReachTotal.toFixed(3)}, expected approximately ${expectedConferenceFinalsReachTotal.toFixed(1)}.`,
  );

  for (const row of currentBracketForecast.rows) {
    assert(
      row.reachConferenceFinalsProbability <= 1,
      `No team has reachConferenceFinalsProbability > 1.0: ${currentTeamsById[row.teamId]?.name ?? row.teamId} is ${row.reachConferenceFinalsProbability.toFixed(3)}.`,
    );
  }
}

if (typeof require !== "undefined" && require.main === module) {
  runDataSnapshotChecks();
  console.log("Data snapshot checks passed.");
}
