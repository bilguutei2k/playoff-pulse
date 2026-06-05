import type {
  BracketCoverage,
  BracketForecast,
  BracketForecastRow,
  Conference,
  ModelSettings,
  PlayoffConfig,
  PlayoffRound,
  Series,
  SeriesConference,
  SeriesRound,
  Team,
} from "@/lib/model/types";
import {
  createSeededRandom,
  simulateSeriesOutcome,
} from "@/lib/model/simulator";
import { clampProbability, teamStrength } from "@/lib/model/probability";

const CONFERENCES: Conference[] = ["East", "West"];
const PLAYOFF_ROUNDS: PlayoffRound[] = [
  "First Round",
  "Conference Semifinal",
  "Conference Final",
];
const EXPECTED_SERIES_BY_ROUND: Record<PlayoffRound, number> = {
  "First Round": 4,
  "Conference Semifinal": 2,
  "Conference Final": 1,
};
const NBA_FINALS_HOME_PATTERN = ["A", "A", "B", "B", "A", "B", "A"];

type Counter = Record<string, number>;

function increment(counter: Counter, teamId: string): void {
  counter[teamId] = (counter[teamId] ?? 0) + 1;
}

function byBracketOrder(seriesA: Series, seriesB: Series): number {
  return seriesA.bracketOrder - seriesB.bracketOrder;
}

function bySeedThenStrength(teamsById: Record<string, Team>, settings: ModelSettings) {
  return (teamAId: string, teamBId: string) => {
    const teamA = teamsById[teamAId];
    const teamB = teamsById[teamBId];

    if (teamA.seed !== teamB.seed) {
      return teamA.seed - teamB.seed;
    }

    return teamStrength(teamB, settings) - teamStrength(teamA, settings);
  };
}

function homePatternFor(teamAId: string, teamBId: string): string[] {
  return NBA_FINALS_HOME_PATTERN.map((slot) =>
    slot === "A" ? teamAId : teamBId,
  );
}

function createFutureSeries(
  id: string,
  round: SeriesRound,
  conference: SeriesConference,
  bracketOrder: number,
  teamAId: string,
  teamBId: string,
  teamsById: Record<string, Team>,
  settings: ModelSettings,
): Series {
  const [teamA, teamB] = [teamAId, teamBId].sort(
    bySeedThenStrength(teamsById, settings),
  );

  return {
    id,
    round,
    conference,
    bracketOrder,
    teamA,
    teamB,
    winsA: 0,
    winsB: 0,
    homePattern: homePatternFor(teamA, teamB),
  };
}

function configuredTeams(seriesList: Series[]): Set<string> {
  return new Set(seriesList.flatMap((series) => [series.teamA, series.teamB]));
}

function hasSameTeams(seriesList: Series[], teamIds: string[]): boolean {
  const configured = configuredTeams(seriesList);

  if (configured.size !== teamIds.length) {
    return false;
  }

  return teamIds.every((teamId) => configured.has(teamId));
}

function hasSameTeamPair(series: Series, teamIds: string[]): boolean {
  if (teamIds.length !== 2) {
    return false;
  }

  const configured = new Set([series.teamA, series.teamB]);

  return configured.size === 2 && teamIds.every((teamId) => configured.has(teamId));
}

function configuredFinalsSeries(
  config: PlayoffConfig,
  notes: Set<string>,
): Series | null {
  const finalsSeries = config.series
    .filter((series) => series.round === "NBA Finals")
    .sort(byBracketOrder);

  if (finalsSeries.length > 1) {
    notes.add(
      `Multiple NBA Finals series are configured; ${finalsSeries[0].id} is used for championship simulation.`,
    );
  }

  return finalsSeries[0] ?? null;
}

function pairFutureRound(
  conference: Conference,
  round: PlayoffRound,
  incomingTeamIds: string[],
  teamsById: Record<string, Team>,
  settings: ModelSettings,
): Series[] {
  const seriesList: Series[] = [];

  for (let index = 0; index < incomingTeamIds.length; index += 2) {
    const teamAId = incomingTeamIds[index];
    const teamBId = incomingTeamIds[index + 1];

    if (!teamAId || !teamBId) {
      continue;
    }

    seriesList.push(
      createFutureSeries(
        `${conference.toLowerCase()}-${round.toLowerCase().replaceAll(" ", "-")}-${seriesList.length + 1}`,
        round,
        conference,
        seriesList.length + 1,
        teamAId,
        teamBId,
        teamsById,
        settings,
      ),
    );
  }

  return seriesList;
}

export function assessBracketCoverage(config: PlayoffConfig): BracketCoverage {
  const warnings: string[] = [];
  const conferences = CONFERENCES.map((conference) => {
    const rounds = PLAYOFF_ROUNDS.map((round) => {
      const configuredSeries = config.series.filter(
        (series) => series.conference === conference && series.round === round,
      ).length;
      const expectedSeries = EXPECTED_SERIES_BY_ROUND[round];
      const complete =
        round === "First Round"
          ? configuredSeries === expectedSeries
          : configuredSeries === 0 || configuredSeries === expectedSeries;

      if (!complete) {
        warnings.push(
          `${conference} ${round} has ${configuredSeries} of ${expectedSeries} paths configured.`,
        );
      }

      return {
        round,
        configuredSeries,
        expectedSeries,
        complete,
      };
    });

    return {
      conference,
      rounds,
      complete: rounds.every((round) => round.complete),
    };
  });

  return {
    conferences,
    complete: conferences.every((conference) => conference.complete),
    warnings,
  };
}

function selectRoundSeries(
  configuredSeries: Series[],
  incomingTeamIds: string[] | null,
  conference: Conference,
  round: PlayoffRound,
  teamsById: Record<string, Team>,
  settings: ModelSettings,
  notes: Set<string>,
): Series[] {
  if (!incomingTeamIds) {
    return configuredSeries;
  }

  if (configuredSeries.length && hasSameTeams(configuredSeries, incomingTeamIds)) {
    return configuredSeries;
  }

  if (configuredSeries.length) {
    notes.add(
      `${conference} ${round} was generated from earlier winners because configured teams did not match the simulated incoming teams.`,
    );
  }

  return pairFutureRound(conference, round, incomingTeamIds, teamsById, settings);
}

function selectFinalsSeries(
  configuredFinals: Series | null,
  conferenceChampions: string[],
  teamsById: Record<string, Team>,
  settings: ModelSettings,
  notes: Set<string>,
): Series {
  if (configuredFinals && hasSameTeamPair(configuredFinals, conferenceChampions)) {
    return configuredFinals;
  }

  if (configuredFinals) {
    notes.add(
      "NBA Finals was generated from conference champions because configured Finals teams did not match this simulated path.",
    );
  }

  return createFutureSeries(
    "nba-finals",
    "NBA Finals",
    "Finals",
    1,
    conferenceChampions[0],
    conferenceChampions[1],
    teamsById,
    settings,
  );
}

function simulateConferencePath(
  conference: Conference,
  config: PlayoffConfig,
  teamsById: Record<string, Team>,
  settings: ModelSettings,
  random: () => number,
  reachConferenceFinals: Counter,
  notes: Set<string>,
): string | null {
  let incomingTeamIds: string[] | null = null;

  for (const round of PLAYOFF_ROUNDS) {
    const configuredSeries = config.series
      .filter((series) => series.conference === conference && series.round === round)
      .sort(byBracketOrder);
    const roundSeries = selectRoundSeries(
      configuredSeries,
      incomingTeamIds,
      conference,
      round,
      teamsById,
      settings,
      notes,
    );

    if (!roundSeries.length) {
      if (incomingTeamIds?.length === 1) {
        notes.add(
          `${conference} has one remaining path, so that path is treated as the conference champion.`,
        );
        return incomingTeamIds[0];
      }

      notes.add(`${conference} bracket path is incomplete before ${round}.`);
      return null;
    }

    const winners: string[] = [];

    for (const series of roundSeries) {
      const outcome = simulateSeriesOutcome(series, teamsById, settings, random);

      if (round === "Conference Semifinal") {
        increment(reachConferenceFinals, outcome.winnerId);
      }

      winners.push(outcome.winnerId);
    }

    incomingTeamIds = winners;
  }

  return incomingTeamIds?.[0] ?? null;
}

export function estimateBracketForecast(
  config: PlayoffConfig,
  settings: ModelSettings,
  teams = config.teams,
  iterations = settings.simulationIterations,
): BracketForecast {
  const simulationCount = Math.max(1, Math.floor(iterations));
  const teamsById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const reachConferenceFinals: Counter = {};
  const reachFinals: Counter = {};
  const championships: Counter = {};
  const coverage = assessBracketCoverage(config);
  const notes = new Set<string>(coverage.warnings);
  const configuredFinals = configuredFinalsSeries(config, notes);
  const random = createSeededRandom(
    [
      "bracket",
      simulationCount,
      settings.homeCourtAdvantage,
      settings.logisticScale,
      teams
        .map((team) =>
          [
            team.id,
            team.eloRating,
            team.netRating,
            team.manualAdjustment,
            team.players
              .map((player) =>
                [
                  player.id,
                  player.impact,
                  player.projectedMinutes,
                  player.injuryStatus,
                ].join(":"),
              )
              .join("|"),
          ].join(";"),
        )
        .join("#"),
      config.series
        .map((series) =>
          [
            series.id,
            series.round,
            series.bracketOrder,
            series.teamA,
            series.teamB,
            series.winsA,
            series.winsB,
            series.homePattern.join(","),
          ].join(";"),
        )
        .join("#"),
    ].join(":"),
  );

  for (let iteration = 0; iteration < simulationCount; iteration += 1) {
    const conferenceChampions = CONFERENCES.map((conference) =>
      simulateConferencePath(
        conference,
        config,
        teamsById,
        settings,
        random,
        reachConferenceFinals,
        notes,
      ),
    ).filter((teamId): teamId is string => Boolean(teamId));

    for (const championId of conferenceChampions) {
      increment(reachFinals, championId);
    }

    if (conferenceChampions.length === 2) {
      const finals = selectFinalsSeries(
        configuredFinals,
        conferenceChampions,
        teamsById,
        settings,
        notes,
      );
      const outcome = simulateSeriesOutcome(finals, teamsById, settings, random);
      increment(championships, outcome.winnerId);
    }
  }

  const rows: BracketForecastRow[] = teams
    .map((team) => ({
      teamId: team.id,
      conference: team.conference,
      reachConferenceFinalsProbability: clampProbability(
        (reachConferenceFinals[team.id] ?? 0) / simulationCount,
      ),
      reachFinalsProbability: clampProbability(
        (reachFinals[team.id] ?? 0) / simulationCount,
      ),
      championshipProbability: clampProbability(
        (championships[team.id] ?? 0) / simulationCount,
      ),
    }))
    .sort((teamA, teamB) => {
      const titleDifference =
        teamB.championshipProbability - teamA.championshipProbability;

      if (titleDifference !== 0) {
        return titleDifference;
      }

      return teamsById[teamA.teamId].seed - teamsById[teamB.teamId].seed;
    });

  const titleProbabilityTotal = rows.reduce(
    (sum, row) => sum + row.championshipProbability,
    0,
  );
  const reachConferenceFinalsProbabilityTotal = rows.reduce(
    (sum, row) => sum + row.reachConferenceFinalsProbability,
    0,
  );

  if (
    coverage.complete &&
    (reachConferenceFinalsProbabilityTotal < 3.8 ||
      reachConferenceFinalsProbabilityTotal > 4.2)
  ) {
    throw new Error(
      `Conference finals reach probabilities sum to ${reachConferenceFinalsProbabilityTotal.toFixed(3)}, expected approximately 4.0.`,
    );
  }

  return {
    rows,
    iterations: simulationCount,
    titleProbabilityTotal,
    structurallyComplete: coverage.complete,
    notes: Array.from(notes),
  };
}
