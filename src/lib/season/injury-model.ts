// The injury model: player values from box scores, expected and actual absences, and a
// replay of ratings on margins adjusted for who actually missed each game, so that
// ratings describe a team at full strength. Pure and deterministic.
//
// Everything here runs date by date. Forecasts for a date use only games before it, and
// every game on a date is forecast from the same state, as a seal would be.

import { absenceClass, type AbsenceClass, type StatusCode } from "@/lib/season/availability";
import type { StoredLine } from "@/lib/season/box-scores";
import { daysBetween } from "@/lib/season/dates";
import {
  advanceDays,
  isBackToBack,
  isRatable,
  predictGame,
  rollSeason,
  updateWithResult,
  type FilterState,
} from "@/lib/season/ratings";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { GameContext, GamePrediction, ModelParams, SeasonGame } from "@/lib/season/types";

export type InjuryParams = {
  /** Points of margin per unit of Game Score lost. */
  beta: number;
  /** Game Score per minute of a replacement-level player. */
  gRep: number;
  /** Pseudo-minutes that shrink a player's production toward replacement level. */
  k: number;
  /** Half-life of production, in minutes played. */
  lG: number;
  /** Half-life of expected minutes, in games played. */
  lM: number;
};

/** How often a player listed at each status at T-60 did not play. */
export type StatusTable = Record<StatusCode, number>;

const ROTATION_GAMES = 10;

// ---------------------------------------------------------------------------
// Player values
// ---------------------------------------------------------------------------

type PlayerTrack = {
  /** Decayed minutes behind production. */
  minutes: number;
  /** Decayed Game Score over those minutes. */
  score: number;
  /** Decayed minutes per game. */
  gameMinutes: number;
  gameWeight: number;
  lastTeamId: string | null;
};

export type PlayerBook = Map<string, PlayerTrack>;

/** Adds one game. Decay is by minutes for production and by games for minutes. */
export function recordPlayerGame(
  book: PlayerBook,
  teamId: string,
  lines: readonly StoredLine[],
  params: InjuryParams,
): void {
  const gameDecay = 0.5 ** (1 / params.lM);
  for (const [athleteId, minutes, gameScore] of lines) {
    const track = book.get(athleteId) ?? {
      minutes: 0,
      score: 0,
      gameMinutes: 0,
      gameWeight: 0,
      lastTeamId: null,
    };
    const decay = 0.5 ** (minutes / params.lG);
    track.minutes = track.minutes * decay + minutes;
    track.score = track.score * decay + gameScore;
    track.gameMinutes = track.gameMinutes * gameDecay + minutes;
    track.gameWeight = track.gameWeight * gameDecay + 1;
    track.lastTeamId = teamId;
    book.set(athleteId, track);
  }
}

/** What a team loses without this player, in Game Score. Never negative. */
export function lostValue(
  book: PlayerBook,
  athleteId: string,
  params: InjuryParams,
): number {
  const track = book.get(athleteId);
  if (!track || track.gameWeight === 0) return 0;
  const perMinute = (track.score + params.k * params.gRep) / (track.minutes + params.k);
  const expectedMinutes = track.gameMinutes / track.gameWeight;
  return Math.max(0, (perMinute - params.gRep) * expectedMinutes);
}

// ---------------------------------------------------------------------------
// Absences
// ---------------------------------------------------------------------------

export type ListedPlayer = {
  teamId: string;
  /** Null when the printed name matched nobody we can identify. */
  athleteId: string | null;
  status: StatusCode;
  reason: string;
};

export type ReportPoint = {
  /** The report's own timestamp, Eastern wall clock. */
  at: string;
  notSubmitted: readonly string[];
  rows: readonly ListedPlayer[];
};

/** Everything known about a game's availability, resolved to athlete IDs. */
export type GameAvailability = {
  morning: ReportPoint | null;
  final: ReportPoint | null;
};

/** Expected Game Score lost by a team, weighting each listed player by status. */
export function expectedAbsence(
  point: ReportPoint | null,
  teamId: string,
  book: PlayerBook,
  table: StatusTable,
  params: InjuryParams,
): number {
  if (!point) return 0;
  let total = 0;
  for (const row of point.rows) {
    if (row.teamId !== teamId || row.athleteId === null) continue;
    total += table[row.status] * lostValue(book, row.athleteId, params);
  }
  return total;
}

export type AvailabilityTracker = {
  book: PlayerBook;
  /** Rosters of each team's most recent games this season, newest last. */
  rosters: Map<string, string[][]>;
  /** Consecutive team games each player has missed, by `${teamId}:${athleteId}`. */
  missed: Map<string, number>;
  /** Most recent report rows seen for each team. */
  latestRows: Map<string, readonly ListedPlayer[]>;
};

export function createTracker(): AvailabilityTracker {
  return { book: new Map(), rosters: new Map(), missed: new Map(), latestRows: new Map() };
}

/** Who a team would have expected: recent rotation plus anyone on its latest report. */
function expectedPlayers(
  tracker: AvailabilityTracker,
  teamId: string,
  listed: readonly ListedPlayer[],
): Set<string> {
  const players = new Set<string>();
  for (const roster of tracker.rosters.get(teamId) ?? []) {
    for (const athleteId of roster) {
      // Traded or signed elsewhere since: no longer this team's absence.
      if (tracker.book.get(athleteId)?.lastTeamId === teamId) players.add(athleteId);
    }
  }
  for (const row of listed) {
    if (row.teamId === teamId && row.athleteId !== null) players.add(row.athleteId);
  }
  return players;
}

export type TeamAbsences = {
  /** Sum of lost values among players who missed the game. */
  actual: number;
  absent: Array<{ athleteId: string; lost: number; missedBefore: number; class: AbsenceClass }>;
};

function teamAbsences(
  tracker: AvailabilityTracker,
  teamId: string,
  lines: readonly StoredLine[],
  point: ReportPoint | null,
  params: InjuryParams,
): TeamAbsences {
  const listed = point?.rows ?? [];
  const appeared = new Set(lines.map((line) => line[0]));
  const absent: TeamAbsences["absent"] = [];
  let actual = 0;
  for (const athleteId of expectedPlayers(tracker, teamId, listed)) {
    if (appeared.has(athleteId)) continue;
    const lost = lostValue(tracker.book, athleteId, params);
    actual += lost;
    const row = listed.find((entry) => entry.athleteId === athleteId && entry.teamId === teamId);
    absent.push({
      athleteId,
      lost,
      missedBefore: tracker.missed.get(`${teamId}:${athleteId}`) ?? 0,
      class: absenceClass(row?.reason),
    });
  }
  return { actual, absent };
}

function rememberGame(
  tracker: AvailabilityTracker,
  teamId: string,
  lines: readonly StoredLine[],
  absences: TeamAbsences,
  point: ReportPoint | null,
  params: InjuryParams,
): void {
  for (const line of lines) tracker.missed.delete(`${teamId}:${line[0]}`);
  for (const entry of absences.absent) {
    tracker.missed.set(`${teamId}:${entry.athleteId}`, entry.missedBefore + 1);
  }
  const rosters = tracker.rosters.get(teamId) ?? [];
  rosters.push(lines.map((line) => line[0]));
  if (rosters.length > ROTATION_GAMES) rosters.shift();
  tracker.rosters.set(teamId, rosters);
  if (point) tracker.latestRows.set(teamId, point.rows.filter((row) => row.teamId === teamId));
  recordPlayerGame(tracker.book, teamId, lines, params);
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export type ForecastRow = {
  game: SeasonGame;
  context: GameContext;
  /** Using the report one hour before tip. */
  final: GamePrediction;
  /** Using the report at 06:00 ET on game day. */
  morning: GamePrediction;
  /** Without any absence adjustment, from these same ratings. */
  plain: GamePrediction;
  finalAbsence: { home: number; away: number };
  availability: GameAvailability | null;
};

export type ReplayInput = {
  /** Chronological. Unfinished games are ignored. */
  games: readonly SeasonGame[];
  /** Filter state at the end of the season before `games` starts. */
  state: FilterState;
  stateSeason: number;
  params: ModelParams;
  injury: InjuryParams;
  statusTable: StatusTable;
  boxScores: (gameId: string) => Record<string, StoredLine[]> | undefined;
  availability: (gameId: string) => GameAvailability | null;
  /** Stop before this ET date, and advance the state to it. */
  throughEtDate?: string;
  tracker?: AvailabilityTracker;
  onForecast?: (row: ForecastRow) => void;
  onAbsences?: (game: SeasonGame, teamId: string, absences: TeamAbsences) => void;
};

export type ReplayOutput = {
  state: FilterState;
  tracker: AvailabilityTracker;
  lastGameEtDate: Record<string, string | null>;
};

/** Mutates `input.state`. Pass a copy to keep the original. */
export function replayInjuryModel(input: ReplayInput): ReplayOutput {
  const { params, injury, statusTable, state } = input;
  const tracker = input.tracker ?? createTracker();
  const lastGameEtDate: Record<string, string | null> = {};
  for (const team of SEASON_TEAMS) lastGameEtDate[team.id] = null;
  let currentSeason = input.stateSeason;
  let lastEtDate: string | null = null;

  const ratable = input.games.filter(
    (game) =>
      isRatable(game) && (input.throughEtDate === undefined || game.etDate < input.throughEtDate),
  );
  let cursor = 0;
  while (cursor < ratable.length) {
    const etDate = ratable[cursor].etDate;
    let end = cursor;
    while (end < ratable.length && ratable[end].etDate === etDate) end += 1;
    const day = ratable.slice(cursor, end);
    cursor = end;

    if (day[0].season !== currentSeason) {
      rollSeason(state, params);
      currentSeason = day[0].season;
      lastEtDate = null;
      for (const team of SEASON_TEAMS) lastGameEtDate[team.id] = null;
      // Rotations restart each season, so retired or departed players do not linger.
      tracker.rosters.clear();
      tracker.missed.clear();
    }
    if (lastEtDate !== null) advanceDays(state, daysBetween(lastEtDate, etDate), params);
    lastEtDate = etDate;

    const contexts = day.map(
      (game): GameContext => ({
        homeId: game.homeId,
        awayId: game.awayId,
        neutral: game.neutral,
        playoff: game.kind === "playoff",
        homeOnBackToBack: isBackToBack(lastGameEtDate[game.homeId], etDate),
        awayOnBackToBack: isBackToBack(lastGameEtDate[game.awayId], etDate),
      }),
    );

    // Forecast the whole day from one state.
    if (input.onForecast) {
      day.forEach((game, index) => {
        const context = contexts[index];
        const availability = input.availability(game.id);
        const absenceAt = (point: ReportPoint | null) => ({
          home: expectedAbsence(point, game.homeId, tracker.book, statusTable, injury),
          away: expectedAbsence(point, game.awayId, tracker.book, statusTable, injury),
        });
        const finalAbsence = absenceAt(availability?.final ?? null);
        const morningAbsence = absenceAt(availability?.morning ?? null);
        input.onForecast?.({
          game,
          context,
          final: predictGame(
            state,
            context,
            params,
            -injury.beta * (finalAbsence.home - finalAbsence.away),
          ),
          morning: predictGame(
            state,
            context,
            params,
            -injury.beta * (morningAbsence.home - morningAbsence.away),
          ),
          plain: predictGame(state, context, params),
          finalAbsence,
          availability,
        });
      });
    }

    // Then learn from the day, valuing players as they stood before it.
    const pendingUpdates: Array<() => void> = [];
    day.forEach((game, index) => {
      const box = input.boxScores(game.id);
      const margin = (game.homeScore as number) - (game.awayScore as number);
      if (!box || !box[game.homeId] || !box[game.awayId]) {
        // No box score: who played is unknown, so nothing is adjusted or learned.
        updateWithResult(state, contexts[index], margin, params);
      } else {
        const point = input.availability(game.id)?.final ?? null;
        const home = teamAbsences(tracker, game.homeId, box[game.homeId], point, injury);
        const away = teamAbsences(tracker, game.awayId, box[game.awayId], point, injury);
        updateWithResult(
          state,
          contexts[index],
          margin + injury.beta * (home.actual - away.actual),
          params,
        );
        input.onAbsences?.(game, game.homeId, home);
        input.onAbsences?.(game, game.awayId, away);
        pendingUpdates.push(() => {
          rememberGame(tracker, game.homeId, box[game.homeId], home, point, injury);
          rememberGame(tracker, game.awayId, box[game.awayId], away, point, injury);
        });
      }
      lastGameEtDate[game.homeId] = etDate;
      lastGameEtDate[game.awayId] = etDate;
    });
    for (const update of pendingUpdates) update();
  }

  if (input.throughEtDate && lastEtDate !== null) {
    advanceDays(state, daysBetween(lastEtDate, input.throughEtDate), params);
  }
  return { state, tracker, lastGameEtDate };
}

// ---------------------------------------------------------------------------
// Survival table
// ---------------------------------------------------------------------------

/** Upper bound of each "games missed so far" bucket. */
export const SURVIVAL_BUCKETS = [0, 1, 3, 7, 15, 30, Number.POSITIVE_INFINITY] as const;

export type SurvivalTable = {
  /** Expected games still to miss, counting the next one, by class and bucket. */
  long: number[];
  short: number[];
  /** False if the fit seasons did not support separating long absences. */
  classUsed: boolean;
};

export function survivalBucket(missed: number): number {
  return SURVIVAL_BUCKETS.findIndex((upper) => missed <= upper);
}

export function expectedFurtherGames(
  table: SurvivalTable,
  missed: number,
  absence: AbsenceClass,
): number {
  const row = table.classUsed && absence === "long" ? table.long : table.short;
  return row[survivalBucket(missed)];
}

export type SurvivalObservation = { missedBefore: number; further: number; class: AbsenceClass };

const MIN_CELL = 30;

function poolCells(sums: number[], counts: number[]): number[] {
  const groups = sums.map((sum, index) => ({ sum, count: counts[index], members: [index] }));
  for (let index = groups.length - 1; index > 0; index -= 1) {
    if (groups[index].count < MIN_CELL) {
      groups[index - 1].sum += groups[index].sum;
      groups[index - 1].count += groups[index].count;
      groups[index - 1].members.push(...groups[index].members);
      groups.splice(index, 1);
    }
  }
  if (groups.length > 1 && groups[0].count < MIN_CELL) {
    groups[1].sum += groups[0].sum;
    groups[1].count += groups[0].count;
    groups[1].members.push(...groups[0].members);
    groups.shift();
  }
  const values = new Array<number>(sums.length).fill(1);
  for (const group of groups) {
    const value = group.count === 0 ? 1 : group.sum / group.count;
    for (const member of group.members) values[member] = value;
  }
  return values;
}

export function buildSurvivalTable(observations: readonly SurvivalObservation[]): SurvivalTable {
  const size = SURVIVAL_BUCKETS.length;
  const cells = {
    long: { sums: new Array<number>(size).fill(0), counts: new Array<number>(size).fill(0) },
    short: { sums: new Array<number>(size).fill(0), counts: new Array<number>(size).fill(0) },
  };
  for (const row of observations) {
    const bucket = survivalBucket(row.missedBefore);
    cells[row.class].sums[bucket] += row.further;
    cells[row.class].counts[bucket] += 1;
  }
  const long = poolCells(cells.long.sums, cells.long.counts);
  const short = poolCells(cells.short.sums, cells.short.counts);
  return { long, short, classUsed: long[0] > short[0] };
}

// ---------------------------------------------------------------------------
// Absences in the season simulation
// ---------------------------------------------------------------------------

export type CurrentAbsence = {
  teamId: string;
  athleteId: string;
  /** Points of margin the team loses while he is out. */
  points: number;
  gamesMissed: number;
  class: AbsenceClass;
  /** Team games he is expected to miss from here, a fraction allowed. */
  expectedGames: number;
};

/**
 * Who is out as of the tracker's latest report: anyone who missed the team's last game
 * and is not listed Probable or Available, plus anyone listed Out or Doubtful.
 */
export function currentAbsences(
  tracker: AvailabilityTracker,
  injury: InjuryParams,
  survival: SurvivalTable,
): CurrentAbsence[] {
  const output: CurrentAbsence[] = [];
  for (const team of SEASON_TEAMS) {
    const rows = tracker.latestRows.get(team.id) ?? [];
    const statusOf = new Map(rows.map((row) => [row.athleteId, row]));
    const players = new Set<string>();
    for (const row of rows) {
      if (row.athleteId !== null && (row.status === "O" || row.status === "D")) {
        players.add(row.athleteId);
      }
    }
    const prefix = `${team.id}:`;
    for (const [key, missed] of tracker.missed) {
      if (!key.startsWith(prefix) || missed <= 0) continue;
      const athleteId = key.slice(prefix.length);
      const status = statusOf.get(athleteId)?.status;
      if (status === "P" || status === "A") continue;
      // Someone who has since joined another team is that team's concern.
      if (tracker.book.get(athleteId)?.lastTeamId !== team.id && !statusOf.has(athleteId)) continue;
      players.add(athleteId);
    }
    for (const athleteId of players) {
      const lost = lostValue(tracker.book, athleteId, injury);
      if (lost <= 0) continue;
      const gamesMissed = tracker.missed.get(`${team.id}:${athleteId}`) ?? 0;
      const absence = absenceClass(statusOf.get(athleteId)?.reason);
      output.push({
        teamId: team.id,
        athleteId,
        points: injury.beta * lost,
        gamesMissed,
        class: absence,
        expectedGames: expectedFurtherGames(survival, gamesMissed, absence),
      });
    }
  }
  return output;
}

/** Spreads current absences over each team's coming games, then its postseason. */
export function simulationAbsences(
  absences: readonly CurrentAbsence[],
  pendingRegularGames: Record<string, number>,
): { regular: Record<string, number[]>; postseason: Record<string, number> } {
  const regular: Record<string, number[]> = {};
  const postseason: Record<string, number> = {};
  for (const team of SEASON_TEAMS) {
    regular[team.id] = new Array<number>(pendingRegularGames[team.id] ?? 0).fill(0);
    postseason[team.id] = 0;
  }
  const share = (value: number) => Math.max(0, Math.min(1, value));
  for (const absence of absences) {
    const games = regular[absence.teamId];
    for (let index = 0; index < games.length; index += 1) {
      games[index] += absence.points * share(absence.expectedGames - index);
    }
    postseason[absence.teamId] += absence.points * share(absence.expectedGames - games.length);
  }
  return { regular, postseason };
}
