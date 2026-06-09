import { strict as assert } from "node:assert";
import { defaultModelSettings } from "../src/lib/data/model-settings";
import { playoffConfig } from "../src/lib/data/playoff-config";
import {
  assessBracketCoverage,
  estimateBracketForecast,
} from "../src/lib/model/bracket-simulator";
import { normalizeEspnScoreboard } from "../src/lib/live-data/espn-scoreboard";
import {
  gameWinProbability,
  marginToWinProbability,
  playerMinuteWeightedImpact,
} from "../src/lib/model/probability";
import {
  createSeededRandom,
  estimateSeriesProbability,
  nextGameForecast,
  simulateSeriesOutcome,
} from "../src/lib/model/simulator";
import type { Series, Team } from "../src/lib/model/types";

function cloneTeam(team: Team): Team {
  return {
    ...team,
    players: team.players.map((player) => ({ ...player })),
  };
}

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
  "Expanded manual playoff config should be structurally complete.",
);

const currentBracketForecast = estimateBracketForecast(
  playoffConfig,
  defaultModelSettings,
);
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
    configuredFinals.winsB === 2,
  "NBA Finals config should reflect NYK leading SAS 2-1 with SAS as the home-court team.",
);
const finalsNextGame = nextGameForecast(
  configuredFinals,
  currentTeamsById,
  defaultModelSettings,
);
assert(
  finalsNextGame?.gameNumber === 4 && finalsNextGame.homeTeamId === "nyk",
  "NBA Finals home pattern should put Game 4 in New York after SAS won Game 3.",
);
const currentFinalsForecast = estimateSeriesProbability(
  configuredFinals,
  currentTeamsById,
  defaultModelSettings,
);
const preSeriesFinalsForecast = estimateSeriesProbability(
  { ...configuredFinals, winsA: 0, winsB: 0 },
  currentTeamsById,
  defaultModelSettings,
);
assert(
  currentFinalsForecast.teamBSeriesWinProbability >
    preSeriesFinalsForecast.teamBSeriesWinProbability,
  "NYK's 2-1 Finals lead should improve NYK's series probability versus a 0-0 Finals.",
);
const finalsBeforeGameThreeForecast = estimateSeriesProbability(
  { ...configuredFinals, winsA: 0, winsB: 2 },
  currentTeamsById,
  defaultModelSettings,
);
assert(
  currentFinalsForecast.teamASeriesWinProbability >
    finalsBeforeGameThreeForecast.teamASeriesWinProbability,
  "SAS winning Game 3 should improve SAS's series probability versus trailing 0-2.",
);
const titleLiveTeams = currentBracketForecast.rows
  .filter((row) => row.championshipProbability > 0)
  .map((row) => row.teamId)
  .sort();
assert.deepEqual(
  titleLiveTeams,
  ["nyk", "sas"],
  "Only NBA Finals teams should have non-zero championship probability.",
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

for (const row of currentBracketForecast.rows) {
  if (row.championshipProbability > 0.8) {
    console.warn(
      `Champion probabilities are mutually exclusive: ${currentTeamsById[row.teamId]?.name ?? row.teamId} has championship probability ${row.championshipProbability.toFixed(3)}.`,
    );
  }
}

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

const adjustedConfig = {
  ...playoffConfig,
  teams: playoffConfig.teams.map((team) =>
    team.id === "nyk"
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
const baseNykTitle = bracketForecast.rows.find((row) => row.teamId === "nyk")
  ?.championshipProbability;
const adjustedNykTitle = adjustedBracketForecast.rows.find((row) => row.teamId === "nyk")
  ?.championshipProbability;
assert(
  baseNykTitle !== adjustedNykTitle,
  "Changing injury status should affect bracket probabilities.",
);

const incompleteConfig = {
  ...playoffConfig,
  series: playoffConfig.series.filter((series) => series.id !== "east-sf-nyk-phi"),
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

console.log("Model verification passed.");
