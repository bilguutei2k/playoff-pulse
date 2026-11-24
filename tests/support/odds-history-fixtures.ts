// Synthetic season forecasts for the odds history tests: rounded as state.json rounds them,
// with the invariants a real forecast has (title odds summing to 1, playoff odds at least
// top-six odds) and full-width values so file sizes are realistic.
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonForecast, TeamForecast } from "@/lib/season/types";

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** A deterministic pseudo-random sequence in [0, 1). */
function sequence(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function syntheticForecast(season: number, seed: number): SeasonForecast {
  const next = sequence(seed);
  const weights = SEASON_TEAMS.map(() => 0.01 + next());
  const total = weights.reduce((sum, value) => sum + value, 0);
  const champion = weights.map((value) => round(value / total, 4));
  const rest = champion.slice(0, -1).reduce((sum, value) => sum + value, 0);
  champion[champion.length - 1] = round(1 - rest, 4);
  const teams: TeamForecast[] = SEASON_TEAMS.map((team, index) => {
    const topSix = round(0.05 + 0.6 * next(), 4);
    const playIn = round(0.3 * next(), 4);
    return {
      teamId: team.id,
      wins: 3,
      losses: 4,
      rating: round(-8 + 16 * next(), 3),
      ratingSd: 2.821,
      projectedWins: round(20 + 45 * next(), 2),
      projectedWinsP10: 30,
      projectedWinsP90: 55,
      seedProbabilities: [],
      topSix,
      playIn,
      makePlayoffs: round(Math.min(1, topSix + playIn * 0.5), 4),
      reachSemifinals: 0.2,
      reachConferenceFinals: 0.1,
      reachFinals: 0.05,
      champion: champion[index],
    };
  });
  return {
    season,
    phase: "regular-season",
    iterations: 20000,
    teams,
    series: [],
    sums: { champion: 1, makePlayoffs: 16, topSix: 12, playIn: 8 },
  };
}

/** ET dates from `first`, one a day. */
export function etDates(first: string, count: number): string[] {
  const start = Date.parse(`${first}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}
