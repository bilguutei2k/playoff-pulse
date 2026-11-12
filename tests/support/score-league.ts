// A simulated league with known truth for the 548 score tests: players with true offence
// and defence effects (or true box-score rates and box coefficients that define them),
// games built from random stints, and box lines drawn from each player's rates over his
// on-court possessions. Seeded, so every run is identical.

import { createSeededRandom, type RandomSource } from "@/lib/model/random";
import type { PlayerBoxLine } from "@/lib/season/player-stats";
import { BOX_STATS, STAT_COUNT } from "@/lib/score/box-model";
import type { Five, ScoreGame, Stint } from "@/lib/score/types";

export type SimPlayer = {
  athleteId: string;
  teamId: string;
  position: "G" | "F" | "C";
  /** Points per 100 possessions on offence, against an average player. */
  offence: number;
  /** Points per 100 possessions prevented on defence. */
  defence: number;
  /** True per-100-on-court-possession rates, in `BOX_STATS` order. */
  rates: number[];
  /** Relative chance of being on the floor. */
  playing: number;
};

export type SimLeague = { players: SimPlayer[]; teamIds: string[]; games: ScoreGame[]; home: number };

/** League mean and spread of each rate, `BOX_STATS` order. FGA − ORB + TOV + 0.44 FTA ≈ 20. */
export const RATE_MEAN = [22, 16.8, 5, 2.5, 5, 3, 2, 6, 1.6, 1, 4];
export const RATE_SD = [6, 5, 2, 1.2, 2.5, 1, 1.2, 2.5, 0.6, 0.8, 1];

export function normal(random: RandomSource): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function poisson(random: RandomSource, mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 60) return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(random)));
  const limit = Math.exp(-mean);
  let count = 0;
  let product = random();
  while (product > limit) {
    count += 1;
    product *= random();
  }
  return count;
}

function binomial(random: RandomSource, trials: number, chance: number): number {
  let count = 0;
  for (let i = 0; i < trials; i += 1) if (random() < chance) count += 1;
  return count;
}

export type LeagueOptions = {
  seed: string;
  teams: number;
  playersPerTeam: number;
  /** Times each pair of teams meets (half at each home). */
  meetings: number;
  stintsPerGame: number;
  possessionsPerStint: number;
  season?: number;
  /** Home advantage in points per 100 possessions on offence. */
  home?: number;
  /** SD of true offence and defence when `boxBeta` is not given. */
  effectSd?: number;
  /** SD of a team-level shift added to every player's offence and defence (confounds raw plus-minus). */
  teamSd?: number;
  /** When given, each player's total effect is boxBeta · (rates − league mean), split evenly. */
  boxBeta?: readonly number[];
};

function sortedFive(ids: string[]): Five {
  return [...ids].sort() as Five;
}

function pickFive(random: RandomSource, roster: readonly SimPlayer[]): SimPlayer[] {
  const pool = [...roster];
  const chosen: SimPlayer[] = [];
  while (chosen.length < 5) {
    const total = pool.reduce((sum, player) => sum + player.playing, 0);
    let target = random() * total;
    let index = 0;
    while (index < pool.length - 1 && target >= pool[index].playing) {
      target -= pool[index].playing;
      index += 1;
    }
    chosen.push(pool[index]);
    pool.splice(index, 1);
  }
  return chosen;
}

export function teamId(index: number): string {
  return String(100 + index);
}

export function makePlayers(random: RandomSource, options: LeagueOptions): SimPlayer[] {
  const players: SimPlayer[] = [];
  for (let t = 0; t < options.teams; t += 1) {
    const shiftO = (options.teamSd ?? 0) * normal(random);
    const shiftD = (options.teamSd ?? 0) * normal(random);
    for (let p = 0; p < options.playersPerTeam; p += 1) {
      const rates = RATE_MEAN.map((mean, k) => Math.max(0.05, mean + RATE_SD[k] * normal(random)));
      let offence: number;
      let defence: number;
      if (options.boxBeta) {
        const total = options.boxBeta.reduce((sum, beta, k) => sum + beta * (rates[k] - RATE_MEAN[k]), 0);
        offence = total / 2;
        defence = total / 2;
      } else {
        offence = (options.effectSd ?? 2) * normal(random) + shiftO;
        defence = (options.effectSd ?? 2) * normal(random) + shiftD;
      }
      players.push({
        athleteId: String(1000 + t * 100 + p),
        teamId: teamId(t),
        position: (["G", "G", "F", "F", "C"] as const)[p % 5],
        offence,
        defence,
        rates,
        playing: 0.5 + random(),
      });
    }
  }
  return players;
}

/** Stints, then box lines drawn from rates over each player's on-court possessions. */
export function playGame(
  random: RandomSource,
  gameId: string,
  season: number,
  etDate: string,
  home: readonly SimPlayer[],
  away: readonly SimPlayer[],
  options: Pick<LeagueOptions, "stintsPerGame" | "possessionsPerStint"> & { home: number },
): ScoreGame {
  const stints: Stint[] = [];
  const seconds = new Map<string, number>();
  const possessions = new Map<string, number>();
  let homeScore = 0;
  let awayScore = 0;
  for (let s = 0; s < options.stintsPerGame; s += 1) {
    const homeFive = pickFive(random, home);
    const awayFive = pickFive(random, away);
    const homePossessions = Math.max(1, poisson(random, options.possessionsPerStint));
    const awayPossessions = Math.max(1, poisson(random, options.possessionsPerStint));
    const pointsPer = (offence: SimPlayer[], defence: SimPlayer[], bonus: number) =>
      (110 + bonus + offence.reduce((sum, p) => sum + p.offence, 0) - defence.reduce((sum, p) => sum + p.defence, 0)) / 200;
    const chanceHome = Math.min(0.95, Math.max(0.05, pointsPer(homeFive, awayFive, options.home)));
    const chanceAway = Math.min(0.95, Math.max(0.05, pointsPer(awayFive, homeFive, 0)));
    const homePoints = 2 * binomial(random, homePossessions, chanceHome);
    const awayPoints = 2 * binomial(random, awayPossessions, chanceAway);
    const length = ((homePossessions + awayPossessions) / 2) * 28.8;
    for (const player of [...homeFive, ...awayFive]) {
      seconds.set(player.athleteId, (seconds.get(player.athleteId) ?? 0) + length);
      possessions.set(player.athleteId, (possessions.get(player.athleteId) ?? 0) + (homePossessions + awayPossessions) / 2);
    }
    stints.push({
      period: 1 + Math.floor((4 * s) / options.stintsPerGame),
      seconds: length,
      home: sortedFive(homeFive.map((p) => p.athleteId)),
      away: sortedFive(awayFive.map((p) => p.athleteId)),
      homePossessions,
      awayPossessions,
      homePoints,
      awayPoints,
      startMargin: homeScore - awayScore,
    });
    homeScore += homePoints;
    awayScore += awayPoints;
  }
  const lines = (roster: readonly SimPlayer[]): PlayerBoxLine[] =>
    roster
      .filter((player) => (seconds.get(player.athleteId) ?? 0) > 0)
      .map((player) => {
        const on = possessions.get(player.athleteId) as number;
        const stat = BOX_STATS.map((_, k) => poisson(random, (player.rates[k] * on) / 100));
        const value = (name: (typeof BOX_STATS)[number]) => stat[BOX_STATS.indexOf(name)];
        const fga = value("fieldGoalsAttempted");
        const fta = value("freeThrowsAttempted");
        const threes = value("threePointersMade");
        return {
          athleteId: player.athleteId,
          name: `Player ${player.athleteId}`,
          position: player.position,
          starter: false,
          minutes: (seconds.get(player.athleteId) as number) / 60,
          points: value("points"),
          offensiveRebounds: value("offensiveRebounds"),
          defensiveRebounds: value("defensiveRebounds"),
          assists: value("assists"),
          steals: value("steals"),
          blocks: value("blocks"),
          turnovers: value("turnovers"),
          fouls: value("fouls"),
          fieldGoalsMade: binomial(random, fga, 0.46),
          fieldGoalsAttempted: fga,
          threePointersMade: threes,
          threePointersAttempted: threes + poisson(random, 2 * threes),
          freeThrowsMade: binomial(random, fta, 0.77),
          freeThrowsAttempted: fta,
          plusMinus: 0,
        };
      });
  const homeId = home[0].teamId;
  const awayId = away[0].teamId;
  return {
    gameId,
    season,
    etDate,
    homeId,
    awayId,
    homeScore,
    awayScore,
    box: { [homeId]: lines(home), [awayId]: lines(away) },
    stints,
    audit: {
      source: "substitutions",
      wrongCountPlays: 0,
      maxPlusMinusGap: 0,
      plusMinusMisses: 0,
      maxMinutesGap: 0,
      homePointsGap: 0,
      awayPointsGap: 0,
      rejected: null,
    },
  };
}

function dateOf(season: number, day: number): string {
  const date = new Date(Date.UTC(season - 1, 9, 20 + day));
  return date.toISOString().slice(0, 10);
}

/** A season in which every pair of teams meets `meetings` times, one game per team per date. */
export function simulateLeague(options: LeagueOptions, players?: SimPlayer[]): SimLeague {
  const random = createSeededRandom(options.seed);
  const season = options.season ?? 2015;
  const roster = players ?? makePlayers(random, options);
  const teamIds = Array.from({ length: options.teams }, (_, t) => teamId(t));
  const byTeam = new Map(teamIds.map((id) => [id, roster.filter((player) => player.teamId === id)]));
  // Circle-method round robin: each round every team plays once.
  const rounds: Array<Array<[number, number]>> = [];
  const order = Array.from({ length: options.teams }, (_, t) => t);
  for (let r = 0; r < options.teams - 1; r += 1) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < options.teams / 2; i += 1) pairs.push([order[i], order[options.teams - 1 - i]]);
    rounds.push(pairs);
    order.splice(1, 0, order.pop() as number);
  }
  const games: ScoreGame[] = [];
  let day = 0;
  for (let meeting = 0; meeting < options.meetings; meeting += 1) {
    for (const pairs of rounds) {
      for (const [a, b] of pairs) {
        const [h, v] = meeting % 2 === 0 ? [a, b] : [b, a];
        games.push(
          playGame(
            random,
            `${season}${String(games.length).padStart(5, "0")}`,
            season,
            dateOf(season, day),
            byTeam.get(teamIds[h]) as SimPlayer[],
            byTeam.get(teamIds[v]) as SimPlayer[],
            { ...options, home: options.home ?? 3 },
          ),
        );
      }
      day += 1;
    }
  }
  return { players: roster, teamIds, games, home: options.home ?? 3 };
}

export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (a[i] - meanA) * (b[i] - meanB);
    varA += (a[i] - meanA) ** 2;
    varB += (b[i] - meanB) ** 2;
  }
  return cov / Math.sqrt(varA * varB);
}

export function rmse(a: readonly number[], b: readonly number[]): number {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
}

export const STATS = STAT_COUNT;

/**
 * Several seasons of one league: players persist, each season a share of them change
 * teams (swapped in pairs, so rosters keep their size) and one player per team is
 * replaced by a newcomer with a new ID. True effects come from `boxBeta` when given.
 */
export function simulateSeasons(seasons: readonly number[], options: LeagueOptions & { churn: number }): ScoreGame[] {
  const random = createSeededRandom(`${options.seed}-seasons`);
  let players = makePlayers(random, options);
  let newcomer = 0;
  const games: ScoreGame[] = [];
  for (const season of seasons) {
    const league = simulateLeague({ ...options, season, seed: `${options.seed}-${season}` }, players);
    games.push(...league.games);
    // Off-season: swaps, then one newcomer per team.
    const next = players.map((p) => ({ ...p }));
    const swaps = Math.round((options.churn * next.length) / 2);
    for (let s = 0; s < swaps; s += 1) {
      const a = Math.floor(random() * next.length);
      const b = Math.floor(random() * next.length);
      if (next[a].teamId === next[b].teamId) continue;
      [next[a].teamId, next[b].teamId] = [next[b].teamId, next[a].teamId];
    }
    for (const id of league.teamIds) {
      const index = next.findIndex((p) => p.teamId === id);
      const fresh = makePlayers(random, { ...options, teams: 1, playersPerTeam: 1 })[0];
      newcomer += 1;
      next[index] = { ...fresh, athleteId: `n${newcomer}`, teamId: id };
    }
    players = next;
  }
  return games;
}
