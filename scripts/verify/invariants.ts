// Model invariant checks.
//
// Everything in this file must hold for ANY valid playoff configuration and
// any series state. It must NOT assert specific scores, rosters, or dates from
// the current manual snapshot — those belong in scripts/verify/data-snapshot.ts.
// This split exists because the data-refresh workflow legitimately changes
// series scores and then runs verification: snapshot-specific assertions in
// this step would block every real update (see docs/CODEBASE_HANDOVER.md,
// finding P0-2).
//
// Run standalone: corepack pnpm verify:invariants

import { strict as assert } from "node:assert";
import { defaultModelSettings } from "../../src/lib/data/model-settings";
import { playoffConfig } from "../../src/lib/data/playoff-config";
import {
  assessBracketCoverage,
  estimateBracketForecast,
} from "../../src/lib/model/bracket-simulator";
import { normalizeEspnScoreboard } from "../../src/lib/live-data/espn-scoreboard";
import {
  gameWinProbability,
  marginToWinProbability,
  playerMinuteWeightedImpact,
} from "../../src/lib/model/probability";
import {
  createSeededRandom,
  estimateSeriesProbability,
  nextGameForecast,
  simulateSeriesOutcome,
} from "../../src/lib/model/simulator";
import type { Series, Team } from "../../src/lib/model/types";

function cloneTeam(team: Team): Team {
  return {
    ...team,
    players: team.players.map((player) => ({ ...player })),
  };
}

export function runInvariantChecks(): void {
  const equalA: Team = {
    id: "a",
    name: "Equal A",
    abbreviation: "A",
    conference: "East",
    seed: 1,
    eloRating: 1600,
    netRating: 4,
    manualAdjustment: 0,
    players: [
      { id: "a1", name: "A1", teamId: "a", impact: 5, projectedMinutes: 36, injuryStatus: "healthy" },
      { id: "a2", name: "A2", teamId: "a", impact: 3, projectedMinutes: 30, injuryStatus: "healthy" },
    ],
  };

  const equalB: Team = {
    ...equalA,
    id: "b",
    name: "Equal B",
    abbreviation: "B",
    players: equalA.players.map((player) => ({
      ...player,
      id: player.id.replace("a", "b"),
      teamId: "b",
    })),
  };

  const settings = { ...defaultModelSettings, simulationIterations: 3000 };
  const neutralProbability = gameWinProbability(equalA, equalB, null, settings);
  assert(Math.abs(neutralProbability - 0.5) < 0.01, "Equal teams on neutral court should be close to 50%.");

  const strongerA = cloneTeam(equalA);
  strongerA.manualAdjustment = 3;
  assert(
    gameWinProbability(strongerA, equalB, null, settings) > neutralProbability,
    "Stronger team should have higher win probability.",
  );

  assert(
    gameWinProbability(equalA, equalB, "a", settings) >
      gameWinProbability(equalA, equalB, null, settings),
    "Home team should receive a probability boost.",
  );

  assert(
    gameWinProbability(equalA, equalB, "a", { ...settings, homeCourtAdvantage: 3 }) >
      gameWinProbability(equalA, equalB, "a", { ...settings, homeCourtAdvantage: 1 }),
    "Changing home-court advantage should change game probabilities.",
  );

  assert(
    marginToWinProbability(Number.POSITIVE_INFINITY) <= 1 &&
      marginToWinProbability(Number.NEGATIVE_INFINITY) >= 0,
    "Probabilities should remain bounded between 0 and 1.",
  );

  const baseSeries: Series = {
    id: "test-series",
    round: "First Round",
    conference: "East",
    bracketOrder: 1,
    teamA: "a",
    teamB: "b",
    winsA: 0,
    winsB: 0,
    homePattern: ["a", "a", "b", "b", "a", "b", "a"],
  };

  const teamsById = { a: strongerA, b: equalB };
  const seriesForecast = estimateSeriesProbability(baseSeries, teamsById, settings, 3000);
  const repeatedSeriesForecast = estimateSeriesProbability(baseSeries, teamsById, settings, 3000);
  assert.equal(
    seriesForecast.teamASeriesWinProbability,
    repeatedSeriesForecast.teamASeriesWinProbability,
    "Exact series estimates must be deterministic.",
  );
  assert.equal(seriesForecast.computationMethod, "exact");
  assert(
    Math.abs(
      Object.values(seriesForecast.finalScoreProbabilities).reduce(
        (sum, probability) => sum + probability,
        0,
      ) - 1,
    ) < 1e-10,
    "Exact final-score probabilities must sum to one.",
  );
  assert(
    seriesForecast.uncertainty.lower <= seriesForecast.uncertainty.median &&
      seriesForecast.uncertainty.median <= seriesForecast.uncertainty.upper &&
      seriesForecast.uncertainty.lower >= 0 &&
      seriesForecast.uncertainty.upper <= 1,
    "Series uncertainty intervals must be ordered and bounded.",
  );
  const terminalOutcome = simulateSeriesOutcome(
    baseSeries,
    teamsById,
    settings,
    createSeededRandom("verify-terminal-outcome"),
  );
  assert(
    (terminalOutcome.winsA === 4 || terminalOutcome.winsB === 4) &&
      terminalOutcome.gamesPlayed <= 7,
    "Series simulation should stop when a team reaches four wins.",
  );

  const gameThreeForecast = nextGameForecast(
    { ...baseSeries, winsA: 1, winsB: 1 },
    teamsById,
    settings,
  );
  assert(
    gameThreeForecast?.homeTeamId === "b",
    "Home pattern should advance by games already played.",
  );

  const tiedSeriesProbability = seriesForecast.teamASeriesWinProbability;
  const leadingSeriesProbability = estimateSeriesProbability(
    { ...baseSeries, winsA: 3, winsB: 0 },
    teamsById,
    settings,
    3000,
  ).teamASeriesWinProbability;
  assert(
    leadingSeriesProbability > tiedSeriesProbability && leadingSeriesProbability > 0.85,
    "A team leading 3-0 should have a much higher series probability than at 0-0.",
  );

  const injuredA = cloneTeam(strongerA);
  const healthyImpact = playerMinuteWeightedImpact(injuredA);
  const healthyProbability = gameWinProbability(injuredA, equalB, null, settings);
  injuredA.players[0].injuryStatus = "out";
  assert(
    playerMinuteWeightedImpact(injuredA) < healthyImpact,
    "Changing injury status should affect player-minute impact.",
  );
  assert(
    gameWinProbability(injuredA, equalB, null, settings) < healthyProbability,
    "Changing injury status should affect probabilities.",
  );

  assert(
    gameWinProbability(strongerA, equalB, null, settings) !==
      gameWinProbability({ ...strongerA, manualAdjustment: 0 }, equalB, null, settings),
    "Changing manual adjustment should affect probability.",
  );

  const bracketForecast = estimateBracketForecast(playoffConfig, settings);
  assert(
    Math.abs(bracketForecast.titleProbabilityTotal - 1) < 0.01,
    "Title probabilities from full bracket simulation should sum to approximately 100%.",
  );
  assert(
    bracketForecast.structurallyComplete,
    "Configured playoff bracket should be structurally complete.",
  );

  const eastFinalsTotal = bracketForecast.rows
    .filter((row) => row.conference === "East")
    .reduce((sum, row) => sum + row.reachFinalsProbability, 0);
  const westFinalsTotal = bracketForecast.rows
    .filter((row) => row.conference === "West")
    .reduce((sum, row) => sum + row.reachFinalsProbability, 0);
  assert(
    Math.abs(eastFinalsTotal - 1) < 0.01 && Math.abs(westFinalsTotal - 1) < 0.01,
    "Conference winners should come from the correct conference.",
  );

  for (const row of bracketForecast.rows) {
    for (const probability of [
      row.reachConferenceFinalsProbability,
      row.reachFinalsProbability,
      row.championshipProbability,
    ]) {
      assert(
        probability >= 0 && probability <= 1,
        "No bracket output probability should be below 0 or above 1.",
      );
    }
  }

  for (const probability of [
    neutralProbability,
    seriesForecast.teamASeriesWinProbability,
    seriesForecast.teamBSeriesWinProbability,
    leadingSeriesProbability,
  ]) {
    assert(
      probability >= 0 && probability <= 1,
      "No series or game output probability should be below 0 or above 1.",
    );
  }

  // Injury sensitivity must be tested on a live (undecided) bracket. If the
  // configured Finals is already complete, the champion is fixed and injuries
  // correctly change nothing, so reset the Finals score for this check only.
  const liveConfig = {
    ...playoffConfig,
    series: playoffConfig.series.map((series) =>
      series.round === "NBA Finals" ? { ...series, winsA: 0, winsB: 0 } : series,
    ),
  };
  const injuryTargetTeam = liveConfig.series.find(
    (series) => series.round === "NBA Finals",
  )?.teamA;
  assert(injuryTargetTeam, "Config should include an NBA Finals series for the injury sensitivity check.");
  const liveBracketForecast = estimateBracketForecast(liveConfig, settings);
  const adjustedConfig = {
    ...liveConfig,
    teams: liveConfig.teams.map((team) =>
      team.id === injuryTargetTeam
        ? {
            ...team,
            players: team.players.map((player, index) =>
              index === 0 ? { ...player, injuryStatus: "out" as const } : player,
            ),
          }
        : team,
    ),
  };
  const adjustedBracketForecast = estimateBracketForecast(adjustedConfig, settings);
  const baseTitle = liveBracketForecast.rows.find((row) => row.teamId === injuryTargetTeam)
    ?.championshipProbability;
  const adjustedTitle = adjustedBracketForecast.rows.find(
    (row) => row.teamId === injuryTargetTeam,
  )?.championshipProbability;
  assert(
    baseTitle !== adjustedTitle,
    "Changing injury status should affect bracket probabilities.",
  );

  const removableSeriesId = playoffConfig.series.find(
    (series) => series.round === "Conference Semifinal" && series.conference === "East",
  )?.id;
  assert(removableSeriesId, "Config should include an East Conference Semifinal series.");
  const incompleteConfig = {
    ...playoffConfig,
    series: playoffConfig.series.filter((series) => series.id !== removableSeriesId),
  };
  const incompleteCoverage = assessBracketCoverage(incompleteConfig);
  const incompleteForecast = estimateBracketForecast(incompleteConfig, settings);
  assert(
    !incompleteCoverage.complete &&
      incompleteCoverage.warnings.some((warning) => warning.includes("East Conference Semifinal")),
    "Missing bracket paths should be detected by coverage assessment.",
  );
  assert(
    !incompleteForecast.structurallyComplete,
    "Missing bracket paths should be surfaced in bracket forecast output.",
  );

  const normalizedLiveScoreboard = normalizeEspnScoreboard(
    {
      season: { year: "2026" },
      day: { date: "2026-05-12" },
      events: [
        {
          id: "fixture-game",
          name: "Detroit Pistons at Cleveland Cavaliers",
          shortName: "DET @ CLE",
          date: "2026-05-12T00:00Z",
          competitions: [
            {
              id: "fixture-game",
              venue: { fullName: "Rocket Arena" },
              status: {
                type: {
                  state: "post",
                  completed: true,
                  shortDetail: "Final",
                },
              },
              competitors: [
                {
                  homeAway: "home",
                  winner: true,
                  score: "112",
                  team: {
                    abbreviation: "CLE",
                    displayName: "Cleveland Cavaliers",
                  },
                },
                {
                  homeAway: "away",
                  winner: false,
                  score: "103",
                  team: {
                    abbreviation: "DET",
                    displayName: "Detroit Pistons",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      endpoint: "fixture",
      fetchedAt: "2026-05-12T08:00:00.000Z",
      manualTeamAbbreviations: ["DET", "CLE", "NYK"],
    },
  );

  assert(
    normalizedLiveScoreboard.status === "connected" &&
      normalizedLiveScoreboard.games[0]?.homeTeam?.abbreviation === "CLE" &&
      normalizedLiveScoreboard.games[0]?.awayTeam?.score === "103",
    "Live scoreboard normalization should map game status, teams, and scores.",
  );
  assert(
    normalizedLiveScoreboard.manualTeamMatches === 2,
    "Live scoreboard normalization should count manual-team abbreviation matches.",
  );

  // ESPN alias handling: a feed "NY" game must match a manual "NYK" team.
  const aliasScoreboard = normalizeEspnScoreboard(
    {
      events: [
        {
          id: "alias-game",
          name: "New York Knicks at San Antonio Spurs",
          shortName: "NY @ SA",
          date: "2026-06-14T00:30Z",
          competitions: [
            {
              id: "alias-game",
              status: { type: { state: "post", completed: true, shortDetail: "Final" } },
              competitors: [
                { homeAway: "home", winner: false, score: "90", team: { abbreviation: "SA", displayName: "San Antonio Spurs" } },
                { homeAway: "away", winner: true, score: "94", team: { abbreviation: "NY", displayName: "New York Knicks" } },
              ],
            },
          ],
        },
      ],
    },
    {
      endpoint: "fixture",
      fetchedAt: "2026-06-14T08:00:00.000Z",
      manualTeamAbbreviations: ["NYK", "SAS"],
    },
  );
  assert(
    aliasScoreboard.manualTeamMatches === 2,
    "ESPN alias abbreviations (NY, SA) should match manual tricodes (NYK, SAS).",
  );
}

if (typeof require !== "undefined" && require.main === module) {
  runInvariantChecks();
  console.log("Model invariant checks passed.");
}
