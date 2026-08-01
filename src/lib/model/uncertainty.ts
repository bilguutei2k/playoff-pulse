import type {
  ModelSettings,
  ProbabilityInterval,
  ScenarioImpact,
  Series,
  Team,
} from "@/lib/model/types";
import { gameWinProbability } from "@/lib/model/probability";
import { createSeededRandom, type RandomSource } from "@/lib/model/random";
import { solveSeriesExactly } from "@/lib/model/series-solver";

const TEAM_STRENGTH_STANDARD_DEVIATION = 0.75;
const HOME_COURT_STANDARD_DEVIATION = 0.4;
const LOGISTIC_SCALE_RELATIVE_STANDARD_DEVIATION = 0.08;
const QUESTIONABLE_PLAY_PROBABILITY = 0.55;
const UNCERTAINTY_SAMPLES = 800;

function standardNormal(random: RandomSource): number {
  const u = Math.max(Number.EPSILON, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleTeam(team: Team, random: RandomSource): Team {
  return {
    ...team,
    manualAdjustment:
      team.manualAdjustment + standardNormal(random) * TEAM_STRENGTH_STANDARD_DEVIATION,
    players: team.players.map((player) => {
      if (player.injuryStatus === "out") return { ...player };
      if (player.injuryStatus === "questionable") {
        return random() < QUESTIONABLE_PLAY_PROBABILITY
          ? { ...player, injuryStatus: "healthy" as const }
          : { ...player, projectedMinutes: 0, injuryStatus: "out" as const };
      }
      return { ...player };
    }),
  };
}

export function sampleUncertainModelInputs(
  teams: Team[],
  settings: ModelSettings,
  random: RandomSource,
): { teams: Team[]; settings: ModelSettings } {
  return {
    teams: teams.map((team) => sampleTeam(team, random)),
    settings: {
      ...settings,
      homeCourtAdvantage: Math.max(
        0,
        settings.homeCourtAdvantage + standardNormal(random) * HOME_COURT_STANDARD_DEVIATION,
      ),
      logisticScale: Math.max(
        1,
        settings.logisticScale *
          (1 + standardNormal(random) * LOGISTIC_SCALE_RELATIVE_STANDARD_DEVIATION),
      ),
    },
  };
}

function seriesProbability(
  series: Series,
  teamA: Team,
  teamB: Team,
  settings: ModelSettings,
): number {
  return solveSeriesExactly(
    series.winsA,
    series.winsB,
    (gameNumber) =>
      gameWinProbability(
        teamA,
        teamB,
        series.homePattern[gameNumber - 1] ?? null,
        settings,
      ),
    series.winsRequired ?? 4,
  ).teamAWinProbability;
}

function quantile(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function estimateSeriesUncertainty(
  series: Series,
  teamA: Team,
  teamB: Team,
  settings: ModelSettings,
  samples = UNCERTAINTY_SAMPLES,
): ProbabilityInterval {
  const winsRequired = series.winsRequired ?? 4;
  if (series.winsA >= winsRequired || series.winsB >= winsRequired) {
    const probability = series.winsA >= winsRequired ? 1 : 0;
    return { lower: probability, median: probability, upper: probability, samples: 0 };
  }
  const random = createSeededRandom(`uncertainty:${series.id}:${series.winsA}:${series.winsB}`);
  const probabilities = Array.from({ length: samples }, () => {
    const sampled = sampleUncertainModelInputs([teamA, teamB], settings, random);
    return seriesProbability(
      series,
      sampled.teams[0],
      sampled.teams[1],
      sampled.settings,
    );
  }).sort((a, b) => a - b);
  return {
    lower: quantile(probabilities, 0.1),
    median: quantile(probabilities, 0.5),
    upper: quantile(probabilities, 0.9),
    samples,
  };
}

export function estimateAvailabilityScenarios(
  series: Series,
  teamA: Team,
  teamB: Team,
  settings: ModelSettings,
): ScenarioImpact[] {
  return [teamA, teamB].flatMap((team) =>
    team.players
      .filter(
        (player) =>
          player.injuryStatus !== "healthy" &&
          (player.projectedMinutes > 0 || (player.healthyProjectedMinutes ?? 0) > 0),
      )
      .map((player) => {
        const minutes = player.healthyProjectedMinutes ?? player.projectedMinutes;
        const availableTeam = {
          ...team,
          players: team.players.map((row) =>
            row.id === player.id
              ? { ...row, projectedMinutes: minutes, injuryStatus: "healthy" as const }
              : row,
          ),
        };
        const outTeam = {
          ...team,
          players: team.players.map((row) =>
            row.id === player.id
              ? { ...row, projectedMinutes: 0, injuryStatus: "out" as const }
              : row,
          ),
        };
        const ifAvailableA = seriesProbability(
          series,
          team.id === teamA.id ? availableTeam : teamA,
          team.id === teamB.id ? availableTeam : teamB,
          settings,
        );
        const ifOutA = seriesProbability(
          series,
          team.id === teamA.id ? outTeam : teamA,
          team.id === teamB.id ? outTeam : teamB,
          settings,
        );
        const ifAvailable = team.id === teamA.id ? ifAvailableA : 1 - ifAvailableA;
        const ifOut = team.id === teamA.id ? ifOutA : 1 - ifOutA;
        return {
          label: player.name,
          teamId: team.id,
          playerId: player.id,
          ifAvailable,
          ifOut,
          swing: ifAvailable - ifOut,
        };
      }),
  );
}
