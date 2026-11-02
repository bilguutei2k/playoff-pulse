// Season Monte Carlo: remaining regular season, seeding, play-in and playoffs.
//
// Each iteration draws team strengths from the rating posterior (so a team's
// results are correlated across a simulated season, which is what keeps playoff
// and title odds from being overconfident), then lets them drift as the Kalman
// time update assumes. Inside an iteration the rating uncertainty is already
// consumed by the draw, so a game's win chance is `Phi(mu_draw / sigma)`, never
// the wider pregame formula.

import { createSeededRandom, type RandomSource } from "@/lib/model/random";
import { daysBetween } from "@/lib/season/dates";
import { seasonFormat } from "@/lib/season/formats";
import { cholesky, fingerprint, normalCdf, quantileFromHistogram } from "@/lib/season/math";
import { isBackToBack, type FilterState } from "@/lib/season/ratings";
import {
  buildStandings,
  copyStandingsTable,
  createStandingsTable,
  hasHomeCourt,
  recordGame,
  seedConference,
  type StandingsTable,
} from "@/lib/season/standings";
import {
  HCA_INDEX,
  SEASON_TEAMS,
  STATE_SIZE,
  TEAM_COUNT,
  teamIndex,
} from "@/lib/season/teams";
import type {
  Conference,
  ModelParams,
  PlayoffRound,
  SeasonForecast,
  SeasonGame,
  SeasonPhase,
  SeriesForecast,
  TeamForecast,
} from "@/lib/season/types";

const DRIFT_STEP_DAYS = 14;
const WINS_NEEDED = 4;
// Home pattern from the higher seed's view: 2-2-1-1-1.
const HOME_GAMES = [true, true, false, false, true, false, true];
const CONFERENCES: Conference[] = ["East", "West"];
// Seed positions, zero-based: 1v8, 4v5, 3v6, 2v7.
const FIRST_ROUND_SLOTS = [
  [0, 7],
  [3, 4],
  [2, 5],
  [1, 6],
] as const;

type PendingGame = {
  home: number;
  away: number;
  hcaCoefficient: number;
  offset: number;
  driftStep: number;
};

function standardNormal(random: RandomSource): number {
  // Box-Muller, one draw per call. Simple and fully determined by the seed.
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type ObservedSeries = {
  round: PlayoffRound;
  conference: Conference | "Finals";
  teamA: number;
  teamB: number;
  winsA: number;
  winsB: number;
  /** The team that hosted game 1, as observed. */
  homeCourt: number;
};

/** Facts about the postseason so far, derived from real games. */
export type ObservedPostseason = {
  /** Seeds 1-10 from the final regular-season standings, by conference. */
  seeds: Record<Conference, number[]>;
  /** Teams confirmed in a playoff slot by the play-in: seed 7 and 8 per conference. */
  playInFinal: Partial<Record<Conference, { seven?: number; eight?: number }>>;
  /** Finished play-in games, identified from ESPN notes. */
  playInResults: Partial<
    Record<Conference, { sevenEightWinner?: number; nineTenWinner?: number }>
  >;
  /** Every observed series, in any state. */
  series: ObservedSeries[];
};

export type SimulationInput = {
  season: number;
  phase: SeasonPhase;
  games: readonly SeasonGame[];
  state: FilterState;
  params: ModelParams;
  /** ET date the simulation stands on. */
  asOfEtDate: string;
  lastGameEtDate: Record<string, string | null>;
  iterations: number;
  /** Multiplier on rating covariance and drift. 1 unless disclosed otherwise. */
  uncertaintyScale?: number;
  observed?: ObservedPostseason;
  /** Points each team gives up to known absences. Absent means none. */
  absences?: SimulationAbsences;
};

export type SimulationAbsences = {
  /** By team ID, points lost in each of its next regular-season games, in order. */
  regular: Record<string, readonly number[]>;
  /** By team ID, points lost in every postseason game. */
  postseason: Record<string, number>;
};

function buildPendingGames(input: SimulationInput): {
  pending: PendingGame[];
  placeholders: Int32Array;
} {
  const { games, params, asOfEtDate, lastGameEtDate } = input;
  const format = seasonFormat(input.season);
  const scheduled = games
    .filter(
      (game) =>
        game.kind === "regular" &&
        (game.status === "scheduled" || game.status === "in-progress"),
    )
    .sort((a, b) => Date.parse(a.tipUtc) - Date.parse(b.tipUtc));

  const last: Record<string, string | null> = { ...lastGameEtDate };
  const pending: PendingGame[] = [];
  const teamGamesAhead = new Map<string, number>();
  const absencePoints = (teamId: string): number => {
    const ordinal = teamGamesAhead.get(teamId) ?? 0;
    teamGamesAhead.set(teamId, ordinal + 1);
    return input.absences?.regular[teamId]?.[ordinal] ?? 0;
  };
  for (const game of scheduled) {
    const day = Math.max(0, daysBetween(asOfEtDate, game.etDate));
    let offset = absencePoints(game.awayId) - absencePoints(game.homeId);
    if (isBackToBack(last[game.awayId] ?? null, game.etDate)) offset += params.b2b;
    if (isBackToBack(last[game.homeId] ?? null, game.etDate)) offset -= params.b2b;
    pending.push({
      home: teamIndex(game.homeId),
      away: teamIndex(game.awayId),
      hcaCoefficient: game.neutral ? 0 : 1,
      offset,
      driftStep: Math.floor(day / DRIFT_STEP_DAYS),
    });
    last[game.homeId] = game.etDate;
    last[game.awayId] = game.etDate;
  }

  // Slots the league has not scheduled yet (Cup knockout dates, postponed games
  // without a makeup) are played against an average opponent on a neutral floor.
  // Real games replace these as soon as a schedule refresh shows them.
  const known = new Int32Array(TEAM_COUNT);
  for (const game of games) {
    if (game.kind !== "regular") continue;
    if (game.status === "postponed" || game.status === "canceled") continue;
    known[teamIndex(game.homeId)] += 1;
    known[teamIndex(game.awayId)] += 1;
  }
  const placeholders = new Int32Array(TEAM_COUNT);
  for (let team = 0; team < TEAM_COUNT; team += 1) {
    placeholders[team] = Math.max(0, format.gamesPerTeam - known[team]);
  }
  return { pending, placeholders };
}

type Counters = {
  wins: Float64Array;
  winHistogram: Int32Array[];
  seeds: Int32Array[];
  topSix: Int32Array;
  playIn: Int32Array;
  makePlayoffs: Int32Array;
  reachSemifinals: Int32Array;
  reachConferenceFinals: Int32Array;
  reachFinals: Int32Array;
  champion: Int32Array;
};

function createCounters(): Counters {
  return {
    wins: new Float64Array(TEAM_COUNT),
    winHistogram: SEASON_TEAMS.map(() => new Int32Array(84)),
    seeds: SEASON_TEAMS.map(() => new Int32Array(15)),
    topSix: new Int32Array(TEAM_COUNT),
    playIn: new Int32Array(TEAM_COUNT),
    makePlayoffs: new Int32Array(TEAM_COUNT),
    reachSemifinals: new Int32Array(TEAM_COUNT),
    reachConferenceFinals: new Int32Array(TEAM_COUNT),
    reachFinals: new Int32Array(TEAM_COUNT),
    champion: new Int32Array(TEAM_COUNT),
  };
}

function winProbability(
  strengths: Float64Array,
  home: number,
  away: number,
  params: ModelParams,
  playoff: boolean,
): number {
  const spread = playoff ? params.playoffSpread : 1;
  const hca = strengths[HCA_INDEX] + (playoff ? params.hcaPlayoffDelta : 0);
  return normalCdf(
    (spread * (strengths[home] - strengths[away]) + hca) / params.sigma,
  );
}

/** Plays a series to the end from any score, returning the winner. */
export function playSeries(
  homeCourt: number,
  other: number,
  startHomeCourtWins: number,
  startOtherWins: number,
  strengths: Float64Array,
  params: ModelParams,
  random: RandomSource,
): number {
  let homeCourtWins = startHomeCourtWins;
  let otherWins = startOtherWins;
  const homeProbability = winProbability(strengths, homeCourt, other, params, true);
  const awayProbability = 1 - winProbability(strengths, other, homeCourt, params, true);
  while (homeCourtWins < WINS_NEEDED && otherWins < WINS_NEEDED) {
    const gameNumber = homeCourtWins + otherWins;
    const probability = HOME_GAMES[gameNumber] ? homeProbability : awayProbability;
    if (random() < probability) homeCourtWins += 1;
    else otherWins += 1;
  }
  return homeCourtWins >= WINS_NEEDED ? homeCourt : other;
}

function seriesKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function observedSeriesLookup(observed: ObservedPostseason | undefined) {
  const lookup = new Map<string, ObservedSeries>();
  for (const series of observed?.series ?? []) {
    lookup.set(seriesKey(series.teamA, series.teamB), series);
  }
  return lookup;
}

/**
 * The conference path: returns the conference champion and updates counters.
 * Real series scores replace simulation wherever they exist.
 */
function simulateBracket(
  seeded: number[],
  table: StandingsTable,
  strengths: Float64Array,
  params: ModelParams,
  random: RandomSource,
  counters: Counters,
  lookup: Map<string, ObservedSeries>,
  seriesWins: Map<string, number>,
): number {
  const play = (a: number, b: number): number => {
    const seen = lookup.get(seriesKey(a, b));
    const aHasCourt = seen ? seen.homeCourt === a : hasHomeCourt(a, b, table);
    const homeCourt = aHasCourt ? a : b;
    const other = aHasCourt ? b : a;
    const homeCourtWins = seen ? (seen.teamA === homeCourt ? seen.winsA : seen.winsB) : 0;
    const otherWins = seen ? (seen.teamA === homeCourt ? seen.winsB : seen.winsA) : 0;
    const winner = playSeries(
      homeCourt,
      other,
      homeCourtWins,
      otherWins,
      strengths,
      params,
      random,
    );
    if (seen) {
      const key = seriesKey(a, b);
      if (winner === homeCourt) seriesWins.set(key, (seriesWins.get(key) ?? 0) + 1);
    }
    return winner;
  };
  // Bracket order keeps 1/8 and 4/5 on one side, 3/6 and 2/7 on the other.
  const firstRound = [
    play(seeded[0], seeded[7]),
    play(seeded[3], seeded[4]),
    play(seeded[2], seeded[5]),
    play(seeded[1], seeded[6]),
  ];
  for (const team of firstRound) counters.reachSemifinals[team] += 1;
  const semifinals = [play(firstRound[0], firstRound[1]), play(firstRound[2], firstRound[3])];
  for (const team of semifinals) counters.reachConferenceFinals[team] += 1;
  const champion = play(semifinals[0], semifinals[1]);
  counters.reachFinals[champion] += 1;
  return champion;
}

function resolvePlayIn(
  conference: Conference,
  order: number[],
  strengths: Float64Array,
  params: ModelParams,
  random: RandomSource,
  observed: ObservedPostseason | undefined,
): { seven: number; eight: number } {
  const final = observed?.playInFinal[conference];
  const results = observed?.playInResults[conference];
  const [s7, s8, s9, s10] = [order[6], order[7], order[8], order[9]];
  const playGame = (home: number, away: number): number =>
    random() < winProbability(strengths, home, away, params, false) ? home : away;

  const sevenEightWinner =
    final?.seven ?? results?.sevenEightWinner ?? playGame(s7, s8);
  const sevenEightLoser = sevenEightWinner === s7 ? s8 : s7;
  if (final?.eight !== undefined) return { seven: sevenEightWinner, eight: final.eight };
  const nineTenWinner = results?.nineTenWinner ?? playGame(s9, s10);
  // The 7v8 loser always hosts the 9v10 winner.
  const eight = playGame(sevenEightLoser, nineTenWinner);
  return { seven: sevenEightWinner, eight };
}

export function simulateSeason(input: SimulationInput): SeasonForecast {
  const { params, state, observed } = input;
  const format = seasonFormat(input.season);
  const scale = input.uncertaintyScale ?? 1;
  const iterations = Math.max(1, Math.floor(input.iterations));
  const base = buildStandings(input.games);
  const { pending, placeholders } = buildPendingGames(input);
  const hasRemainingRegular =
    pending.length > 0 || placeholders.some((count) => count > 0);
  if (input.phase === "regular-season" && !hasRemainingRegular) {
    throw new Error("Regular season has no games left to simulate; phase is wrong.");
  }

  const scaledCov = new Float64Array(STATE_SIZE * STATE_SIZE);
  for (let index = 0; index < scaledCov.length; index += 1) {
    scaledCov[index] = state.cov[index] * scale;
  }
  const lower = cholesky(scaledCov, STATE_SIZE);
  const driftSd = Math.sqrt(params.q * DRIFT_STEP_DAYS * scale);
  const driftSteps = pending.reduce((max, game) => Math.max(max, game.driftStep), 0);

  const counters = createCounters();
  const table = createStandingsTable();
  const strengths = new Float64Array(STATE_SIZE);
  const noise = new Float64Array(STATE_SIZE);
  const lookup = observedSeriesLookup(observed);
  const seriesWins = new Map<string, number>();
  const firstRoundOpponent = new Map<number, number>();
  for (const series of observed?.series ?? []) {
    if (series.round !== "first-round") continue;
    firstRoundOpponent.set(series.teamA, series.teamB);
    firstRoundOpponent.set(series.teamB, series.teamA);
  }
  const random = createSeededRandom(
    fingerprint(
      JSON.stringify({
        season: input.season,
        asOf: input.asOfEtDate,
        iterations,
        params,
        mean: Array.from(state.mean).map((value) => value.toFixed(8)),
        games: input.games.length,
        observed: observed ?? null,
      }),
    ),
  );

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    // Draw this iteration's true strengths from the posterior.
    for (let index = 0; index < STATE_SIZE; index += 1) {
      noise[index] = standardNormal(random);
    }
    for (let row = 0; row < STATE_SIZE; row += 1) {
      let sum = state.mean[row];
      for (let column = 0; column <= row; column += 1) {
        sum += lower[row * STATE_SIZE + column] * noise[column];
      }
      strengths[row] = sum;
    }

    copyStandingsTable(base, table);
    let currentStep = 0;
    for (const game of pending) {
      while (currentStep < game.driftStep) {
        for (let team = 0; team < TEAM_COUNT; team += 1) {
          strengths[team] += driftSd * standardNormal(random);
        }
        currentStep += 1;
      }
      const mean =
        strengths[game.home] -
        strengths[game.away] +
        game.hcaCoefficient * strengths[HCA_INDEX] +
        game.offset;
      recordGame(
        table,
        game.home,
        game.away,
        mean + params.sigma * standardNormal(random) || 0.001,
      );
    }
    while (currentStep < driftSteps) {
      for (let team = 0; team < TEAM_COUNT; team += 1) {
        strengths[team] += driftSd * standardNormal(random);
      }
      currentStep += 1;
    }
    // Unscheduled slots against an average opponent, neutral floor.
    for (let team = 0; team < TEAM_COUNT; team += 1) {
      for (let slot = 0; slot < placeholders[team]; slot += 1) {
        const margin = strengths[team] + params.sigma * standardNormal(random);
        if (margin > 0) table.wins[team] += 1;
        else table.losses[team] += 1;
        table.pointDifferential[team] += margin;
      }
    }
    // Absences expected to last past the regular season. Strengths are redrawn each
    // iteration, so this never compounds.
    if (input.absences) {
      for (let team = 0; team < TEAM_COUNT; team += 1) {
        strengths[team] -= input.absences.postseason[SEASON_TEAMS[team].id] ?? 0;
      }
    }

    for (let team = 0; team < TEAM_COUNT; team += 1) {
      const wins = table.wins[team];
      counters.wins[team] += wins;
      counters.winHistogram[team][Math.min(wins, 83)] += 1;
    }

    const champions: number[] = [];
    for (const conference of CONFERENCES) {
      const order = observed ? observed.seeds[conference] : seedConference(conference, table);
      for (let seed = 0; seed < order.length && seed < 15; seed += 1) {
        counters.seeds[order[seed]][seed] += 1;
      }
      let seeded: number[];
      if (format.playIn) {
        for (let seed = 0; seed < 6; seed += 1) counters.topSix[order[seed]] += 1;
        for (let seed = 6; seed < 10; seed += 1) counters.playIn[order[seed]] += 1;
        const { seven, eight } = resolvePlayIn(
          conference,
          order,
          strengths,
          params,
          random,
          observed,
        );
        seeded = [...order.slice(0, 6), seven, eight];
      } else {
        for (let seed = 0; seed < 6; seed += 1) counters.topSix[order[seed]] += 1;
        seeded = order.slice(0, 8);
      }
      // Observed first-round pairings override anything simulated.
      for (const [high, low] of FIRST_ROUND_SLOTS) {
        const opponent = firstRoundOpponent.get(seeded[high]);
        if (opponent !== undefined) seeded[low] = opponent;
      }
      for (const team of seeded) counters.makePlayoffs[team] += 1;
      champions.push(
        simulateBracket(
          seeded,
          table,
          strengths,
          params,
          random,
          counters,
          lookup,
          seriesWins,
        ),
      );
    }
    const finalsWinner = (() => {
      const [east, west] = champions;
      const seen = lookup.get(seriesKey(east, west));
      const eastHasCourt = seen ? seen.homeCourt === east : hasHomeCourt(east, west, table);
      const homeCourt = eastHasCourt ? east : west;
      const other = eastHasCourt ? west : east;
      const homeCourtWins = seen ? (seen.teamA === homeCourt ? seen.winsA : seen.winsB) : 0;
      const otherWins = seen ? (seen.teamA === homeCourt ? seen.winsB : seen.winsA) : 0;
      const winner = playSeries(
        homeCourt,
        other,
        homeCourtWins,
        otherWins,
        strengths,
        params,
        random,
      );
      if (seen && winner === homeCourt) {
        const key = seriesKey(east, west);
        seriesWins.set(key, (seriesWins.get(key) ?? 0) + 1);
      }
      return winner;
    })();
    counters.champion[finalsWinner] += 1;
  }

  const teams: TeamForecast[] = SEASON_TEAMS.map((team, index) => ({
    teamId: team.id,
    wins: base.wins[index],
    losses: base.losses[index],
    rating: state.mean[index],
    ratingSd: Math.sqrt(Math.max(0, state.cov[index * STATE_SIZE + index])),
    projectedWins: counters.wins[index] / iterations,
    projectedWinsP10: quantileFromHistogram(counters.winHistogram[index], iterations, 0.1),
    projectedWinsP90: quantileFromHistogram(counters.winHistogram[index], iterations, 0.9),
    seedProbabilities: Array.from(counters.seeds[index], (count) => count / iterations),
    topSix: counters.topSix[index] / iterations,
    playIn: counters.playIn[index] / iterations,
    makePlayoffs: counters.makePlayoffs[index] / iterations,
    reachSemifinals: counters.reachSemifinals[index] / iterations,
    reachConferenceFinals: counters.reachConferenceFinals[index] / iterations,
    reachFinals: counters.reachFinals[index] / iterations,
    champion: counters.champion[index] / iterations,
  }));

  const series: SeriesForecast[] = (observed?.series ?? []).map((row) => {
    const homeCourtIsA = row.homeCourt === row.teamA;
    const homeCourt = homeCourtIsA ? row.teamA : row.teamB;
    const other = homeCourtIsA ? row.teamB : row.teamA;
    const key = seriesKey(row.teamA, row.teamB);
    const homeCourtWins = homeCourtIsA ? row.winsA : row.winsB;
    const otherWins = homeCourtIsA ? row.winsB : row.winsA;
    const finished = homeCourtWins >= WINS_NEEDED || otherWins >= WINS_NEEDED;
    return {
      id: `${input.season}-${row.round}-${SEASON_TEAMS[homeCourt].id}-${SEASON_TEAMS[other].id}`,
      round: row.round,
      conference: row.conference,
      homeCourtId: SEASON_TEAMS[homeCourt].id,
      otherId: SEASON_TEAMS[other].id,
      homeCourtWins,
      otherWins,
      homeCourtSeriesProbability: finished
        ? homeCourtWins >= WINS_NEEDED
          ? 1
          : 0
        : (seriesWins.get(key) ?? 0) / iterations,
    };
  });

  const sum = (key: "champion" | "makePlayoffs" | "topSix" | "playIn") =>
    teams.reduce((total, row) => total + row[key], 0);
  const forecast: SeasonForecast = {
    season: input.season,
    phase: input.phase,
    iterations,
    teams,
    series,
    sums: {
      champion: sum("champion"),
      makePlayoffs: sum("makePlayoffs"),
      topSix: sum("topSix"),
      playIn: sum("playIn"),
    },
  };
  assertForecastSums(forecast);
  return forecast;
}

/** Structural invariants. Failure stops publication. */
export function assertForecastSums(forecast: SeasonForecast): void {
  const format = seasonFormat(forecast.season);
  const close = (value: number, target: number) => Math.abs(value - target) < 1e-9;
  const problems: string[] = [];
  if (!close(forecast.sums.champion, 1)) {
    problems.push(`title probabilities sum to ${forecast.sums.champion}`);
  }
  if (!close(forecast.sums.makePlayoffs, 16)) {
    problems.push(`playoff probabilities sum to ${forecast.sums.makePlayoffs}`);
  }
  if (!close(forecast.sums.topSix, 12)) {
    problems.push(`top-six probabilities sum to ${forecast.sums.topSix}`);
  }
  if (format.playIn && !close(forecast.sums.playIn, 8)) {
    problems.push(`play-in probabilities sum to ${forecast.sums.playIn}`);
  }
  for (const team of forecast.teams) {
    for (const key of [
      "topSix",
      "playIn",
      "makePlayoffs",
      "reachSemifinals",
      "reachConferenceFinals",
      "reachFinals",
      "champion",
    ] as const) {
      if (!(team[key] >= 0 && team[key] <= 1)) {
        problems.push(`${team.teamId} ${key} is ${team[key]}`);
      }
    }
    if (team.champion > team.reachFinals + 1e-9) {
      problems.push(`${team.teamId} title odds exceed Finals odds`);
    }
  }
  if (problems.length) {
    throw new Error(`Season forecast failed invariants: ${problems.join("; ")}`);
  }
}

