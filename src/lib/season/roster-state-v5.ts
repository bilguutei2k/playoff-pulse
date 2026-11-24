// v4, M1: the roster-state filter (docs/live/registration-v4.md). Pure: no files, no
// clock, no network; nothing here imports src/lib/score or src/lib/live-data.
//
// State: player impacts theta_p (points per 100 possessions against an average player),
// team residuals c_T, team pseudo-players (one per team, standing for a team-game without
// usable box lines) and home court h, one Gaussian with mean m and covariance P.
//
// Dynamics. Daily within a season: theta += N(0, qP), pseudo += N(0, qP), c += N(0, qC),
// h += N(0, qH). Between seasons: theta <- rhoP theta + N(0, qOff) (pseudo alike),
// c <- rhoC c + N(0, (1 - rhoC^2) tauC^2); h unchanged. Players not seen in either of the
// last two seasons leave the state at the roll. A player enters on first appearance (or on
// an opening roster) with N(muNew, tauNew^2); a team residual with N(0, tauC^2).
//
// Observations, one joint update per game:
//  1. margin (home minus away, capped at 30): sum_home w theta - sum_away w theta + c_H - c_A
//     + h [not neutral] + offsets + N(0, sigma^2), w = 5 minutes / team minutes;
//  2. each player's box deviation (minutes >= 5, full lines): sum_k beta_k (x_pk - xbar_Tk)
//     = theta_p - sum_q (w_q / 5) theta_q + N(0, sBox^2 30 / minutes), x per 100 on-court
//     possessions with possessions as in the 548 score's Stage 1.
// A team-game with team minutes under 200 is one pseudo-player of weight 5, with no box
// observation.
//
// Forecasts for an ET date use the state after the previous ET date: every game of a date is
// priced before any of that date's results enter.

import { daysBetween } from "@/lib/season/dates";
import {
  availabilityConfigurations,
  estimateScale,
  mixtureProbability,
  type Component,
  type ScaleEntry,
  type UncertainPlayer,
} from "@/lib/season/forecast-v4";
import type { ReportPoint } from "@/lib/season/injury-model";
import {
  copyMinutesState,
  createMinutesState,
  minutesTerms,
  recordListingOnly,
  recordRows,
  recordTeamGame,
  rescaleWeights,
  setOpeningRosters,
  teamRows,
  type ListedRow,
  type MinutesState,
  type WeightTerm,
} from "@/lib/season/minutes-v4";
import { V4_BOX_COEFFICIENTS, V4_FIXED } from "@/lib/season/params-v4";
import type { StatusCode } from "@/lib/season/availability";
import type { SeasonGame } from "@/lib/season/types";

export type V4RatingParams = {
  sigma: number;
  sBox: number;
  qP: number;
  qC: number;
  qH: number;
  rhoP: number;
  qOff: number;
  rhoC: number;
  tauC: number;
  muNew: number;
  tauNew: number;
  /** Decay of the running average of minutes. */
  alpha: number;
  /** Playoff weights are raised to kappa before rescaling. */
  kappa: number;
};

export type StatusWeights = Readonly<Record<StatusCode, number>>;

/** A player-game line: [athleteId, minutes, ...the eleven box counts] or [athleteId, minutes]. */
export type V4Line = readonly [string, number, ...number[]];
export type V4GameLines = Readonly<Record<string, readonly V4Line[]>>;

// ---------------------------------------------------------------------------
// The Gaussian state
// ---------------------------------------------------------------------------

export type RosterState = {
  season: number | null;
  lastEtDate: string | null;
  n: number;
  capacity: number;
  keys: string[];
  slots: Map<string, number>;
  mean: Float64Array;
  /** Row-major, stride `capacity`. */
  cov: Float64Array;
  /** Slot key (players and pseudo-players) to the last season it was seen. */
  lastSeason: Map<string, number>;
  /** ET date of each team's last counted game this season, for back-to-backs. */
  teamLastDate: Map<string, string>;
  minutes: MinutesState;
  /** M5's window: the last regular-season games' forecast components and outcomes. */
  scaleWindow: ScaleEntry[];
  scale: number;
};

const HCA_KEY = "h";
const playerKey = (athleteId: string) => `p:${athleteId}`;
const pseudoKey = (teamId: string) => `x:${teamId}`;
const teamKey = (teamId: string) => `t:${teamId}`;

export function createRosterState(): RosterState {
  const capacity = 64;
  const state: RosterState = {
    season: null,
    lastEtDate: null,
    n: 0,
    capacity,
    keys: [],
    slots: new Map(),
    mean: new Float64Array(capacity),
    cov: new Float64Array(capacity * capacity),
    lastSeason: new Map(),
    teamLastDate: new Map(),
    minutes: createMinutesState(),
    scaleWindow: [],
    scale: 1,
  };
  addSlot(state, HCA_KEY, V4_FIXED.hca0, V4_FIXED.hcaVar0);
  return state;
}

export function copyRosterState(state: RosterState): RosterState {
  return {
    ...state,
    keys: [...state.keys],
    slots: new Map(state.slots),
    mean: Float64Array.from(state.mean),
    cov: Float64Array.from(state.cov),
    lastSeason: new Map(state.lastSeason),
    teamLastDate: new Map(state.teamLastDate),
    minutes: copyMinutesState(state.minutes),
    scaleWindow: [...state.scaleWindow],
  };
}

function addSlot(state: RosterState, key: string, mean: number, variance: number): number {
  if (state.n === state.capacity) {
    const capacity = state.capacity * 2;
    const meanNext = new Float64Array(capacity);
    meanNext.set(state.mean);
    const covNext = new Float64Array(capacity * capacity);
    for (let row = 0; row < state.n; row += 1) {
      covNext.set(state.cov.subarray(row * state.capacity, row * state.capacity + state.n), row * capacity);
    }
    state.capacity = capacity;
    state.mean = meanNext;
    state.cov = covNext;
  }
  const index = state.n;
  state.n += 1;
  state.keys.push(key);
  state.slots.set(key, index);
  state.mean[index] = mean;
  state.cov[index * state.capacity + index] = variance;
  return index;
}

function ensurePlayer(state: RosterState, athleteId: string, params: V4RatingParams): number {
  const key = playerKey(athleteId);
  const index = state.slots.get(key);
  if (index !== undefined) return index;
  return addSlot(state, key, params.muNew, params.tauNew * params.tauNew);
}

function ensurePseudo(state: RosterState, teamId: string, params: V4RatingParams): number {
  const key = pseudoKey(teamId);
  const index = state.slots.get(key);
  if (index !== undefined) return index;
  return addSlot(state, key, 0, params.tauNew * params.tauNew);
}

function ensureTeam(state: RosterState, teamId: string, params: V4RatingParams): number {
  const key = teamKey(teamId);
  const index = state.slots.get(key);
  if (index !== undefined) return index;
  return addSlot(state, key, 0, params.tauC * params.tauC);
}

/** The off-season: prune, then the between-season dynamics. Players kept are those seen in the last two seasons. */
function rollSeason(state: RosterState, season: number, params: V4RatingParams): void {
  const keep: number[] = [];
  for (let index = 0; index < state.n; index += 1) {
    const key = state.keys[index];
    if (key.startsWith("p:") || key.startsWith("x:")) {
      const last = state.lastSeason.get(key);
      if (last === undefined || last < season - 2) {
        state.lastSeason.delete(key);
        continue;
      }
    }
    keep.push(index);
  }
  const capacity = state.capacity;
  const mean = new Float64Array(capacity);
  const cov = new Float64Array(capacity * capacity);
  const factor = new Float64Array(keep.length);
  const keys: string[] = [];
  keep.forEach((old, index) => {
    const key = state.keys[old];
    keys.push(key);
    factor[index] = key === HCA_KEY ? 1 : key.startsWith("t:") ? params.rhoC : params.rhoP;
  });
  for (let row = 0; row < keep.length; row += 1) {
    mean[row] = state.mean[keep[row]] * factor[row];
    const source = keep[row] * capacity;
    for (let column = 0; column < keep.length; column += 1) {
      cov[row * capacity + column] = state.cov[source + keep[column]] * factor[row] * factor[column];
    }
    const key = keys[row];
    if (key.startsWith("t:")) cov[row * capacity + row] += (1 - params.rhoC * params.rhoC) * params.tauC * params.tauC;
    else if (key !== HCA_KEY) cov[row * capacity + row] += params.qOff;
  }
  state.mean = mean;
  state.cov = cov;
  state.keys = keys;
  state.n = keys.length;
  state.slots = new Map(keys.map((key, index) => [key, index]));
  state.season = season;
  state.lastEtDate = null;
  state.teamLastDate.clear();
}

function advanceDaysV4(state: RosterState, days: number, params: V4RatingParams): void {
  if (days <= 0) return;
  for (let index = 0; index < state.n; index += 1) {
    const key = state.keys[index];
    const q = key === HCA_KEY ? params.qH : key.startsWith("t:") ? params.qC : params.qP;
    state.cov[index * state.capacity + index] += q * days;
  }
}

/**
 * Moves the state to an ET date of a season: the roll (with the opening rosters) on a new
 * season, then the daily dynamics since the last date processed.
 */
export function advanceTo(
  state: RosterState,
  season: number,
  etDate: string,
  params: V4RatingParams,
  openingRosters: (season: number) => ReadonlyMap<string, readonly string[]>,
): void {
  if (state.season !== season) {
    if (state.season !== null && season < state.season) throw new Error("v4 state cannot move back a season.");
    rollSeason(state, season, params);
    const rosters = openingRosters(season);
    setOpeningRosters(state.minutes, rosters);
    for (const teamId of [...rosters.keys()].sort()) {
      ensureTeam(state, teamId, params);
      for (const athleteId of [...(rosters.get(teamId) ?? [])].sort()) {
        ensurePlayer(state, athleteId, params);
        state.lastSeason.set(playerKey(athleteId), season);
      }
    }
  }
  if (state.lastEtDate !== null) {
    if (etDate < state.lastEtDate) throw new Error("v4 state cannot move back in time.");
    advanceDaysV4(state, daysBetween(state.lastEtDate, etDate), params);
  }
  state.lastEtDate = etDate;
}

// ---------------------------------------------------------------------------
// The joint update
// ---------------------------------------------------------------------------

type ObservationRow = { slots: number[]; coefs: number[]; z: number; r: number };

/** Exact Kalman update with several scalar observations of independent noise, in one step. */
function jointUpdate(state: RosterState, rows: readonly ObservationRow[]): void {
  const k = rows.length;
  if (k === 0) return;
  const { n, capacity, cov, mean } = state;
  // PHt (n x k)
  const pht = new Float64Array(n * k);
  for (let a = 0; a < k; a += 1) {
    const { slots, coefs } = rows[a];
    for (let t = 0; t < slots.length; t += 1) {
      const s = slots[t];
      const c = coefs[t];
      const row = s * capacity;
      for (let i = 0; i < n; i += 1) pht[i * k + a] += cov[row + i] * c;
    }
  }
  // S = H P H' + R, its Cholesky factor, and the innovations
  const s = new Float64Array(k * k);
  const innovation = new Float64Array(k);
  for (let a = 0; a < k; a += 1) {
    const { slots, coefs, z, r } = rows[a];
    let predicted = 0;
    for (let t = 0; t < slots.length; t += 1) predicted += coefs[t] * mean[slots[t]];
    innovation[a] = z - predicted;
    for (let b = 0; b < k; b += 1) {
      let sum = 0;
      for (let t = 0; t < slots.length; t += 1) sum += coefs[t] * pht[slots[t] * k + b];
      s[a * k + b] = sum;
    }
    s[a * k + a] += r;
  }
  for (let a = 0; a < k; a += 1) {
    for (let b = 0; b < a; b += 1) {
      const average = 0.5 * (s[a * k + b] + s[b * k + a]);
      s[a * k + b] = average;
      s[b * k + a] = average;
    }
  }
  const l = new Float64Array(k * k);
  for (let a = 0; a < k; a += 1) {
    for (let b = 0; b <= a; b += 1) {
      let sum = s[a * k + b];
      for (let t = 0; t < b; t += 1) sum -= l[a * k + t] * l[b * k + t];
      if (a === b) {
        if (!(sum > 0)) throw new Error("v4 update: innovation covariance is not positive definite.");
        l[a * k + a] = Math.sqrt(sum);
      } else {
        l[a * k + b] = sum / l[b * k + b];
      }
    }
  }
  // whitened innovation e = L^{-1} innovation; G = PHt L^{-T}
  const e = new Float64Array(k);
  for (let a = 0; a < k; a += 1) {
    let sum = innovation[a];
    for (let t = 0; t < a; t += 1) sum -= l[a * k + t] * e[t];
    e[a] = sum / l[a * k + a];
  }
  const g = pht; // solved in place, row by row
  for (let i = 0; i < n; i += 1) {
    const base = i * k;
    for (let a = 0; a < k; a += 1) {
      let sum = g[base + a];
      for (let t = 0; t < a; t += 1) sum -= l[a * k + t] * g[base + t];
      g[base + a] = sum / l[a * k + a];
    }
    let shift = 0;
    for (let a = 0; a < k; a += 1) shift += g[base + a] * e[a];
    mean[i] += shift;
  }
  // P -= G G' (upper triangle, then mirrored row by row so writes stay contiguous)
  for (let i = 0; i < n; i += 1) {
    const gi = i * k;
    const rowBase = i * capacity;
    for (let j = i; j < n; j += 1) {
      const gj = j * k;
      let s0 = 0;
      let s1 = 0;
      let a = 0;
      for (; a + 1 < k; a += 2) {
        s0 += g[gi + a] * g[gj + a];
        s1 += g[gi + a + 1] * g[gj + a + 1];
      }
      if (a < k) s0 += g[gi + a] * g[gj + a];
      cov[rowBase + j] -= s0 + s1;
    }
  }
  for (let i = 1; i < n; i += 1) {
    const rowBase = i * capacity;
    for (let j = 0; j < i; j += 1) cov[rowBase + j] = cov[j * capacity + i];
  }
}

function possessionEstimate(lines: readonly V4Line[]): number {
  // stats order: points, FGA, FTA, 3PM, AST, TOV, ORB, DRB, STL, BLK, PF (after id, minutes)
  let total = 0;
  for (const line of lines) total += (line[3] as number) - (line[8] as number) + (line[7] as number) + 0.44 * (line[4] as number);
  return total;
}

const isFull = (lines: readonly V4Line[]) => lines.length > 0 && lines.every((line) => line.length === 13);
const teamMinutes = (lines: readonly V4Line[]) => lines.reduce((sum, line) => sum + line[1], 0);

export type GameOffsets = { offset: number; hcaCoefficient: number };

export function gameOffsets(state: RosterState, game: SeasonGame): GameOffsets {
  let offset = 0;
  const homeLast = state.teamLastDate.get(game.homeId);
  const awayLast = state.teamLastDate.get(game.awayId);
  if (awayLast && daysBetween(awayLast, game.etDate) === 1) offset += V4_FIXED.b2b;
  if (homeLast && daysBetween(homeLast, game.etDate) === 1) offset -= V4_FIXED.b2b;
  if (game.kind === "playoff" && !game.neutral) offset += V4_FIXED.hcaPlayoffDelta;
  return { offset, hcaCoefficient: game.neutral ? 0 : 1 };
}

/** The game's report rows for one side, as the minutes layer reads them. */
export type SideListing = { rows: readonly ListedRow[]; unfiled: boolean } | null;

export function sideListing(point: ReportPoint | null, teamId: string): SideListing {
  if (!point) return null;
  const rows: ListedRow[] = [];
  for (const row of point.rows) {
    if (row.teamId !== teamId || row.athleteId === null) continue;
    rows.push({ athleteId: row.athleteId, status: row.status, reason: row.reason });
  }
  rows.sort((a, b) => (a.athleteId < b.athleteId ? -1 : a.athleteId > b.athleteId ? 1 : 0));
  return { rows, unfiled: point.notSubmitted.includes(teamId) };
}

/**
 * The update with a final game: margin and box observations, then the minutes layer and
 * the bookkeeping. `listing` is the rows the game was played under (final point).
 */
export function updateWithGame(
  state: RosterState,
  game: SeasonGame,
  lines: V4GameLines | undefined,
  listing: { home: SideListing; away: SideListing },
  params: V4RatingParams,
): void {
  if (game.homeScore === null || game.awayScore === null) throw new Error(`v4 update: ${game.id} has no score.`);
  const season = game.season;
  const sides = [
    { teamId: game.homeId, sign: 1, listing: listing.home },
    { teamId: game.awayId, sign: -1, listing: listing.away },
  ].map((side) => {
    const own = (lines?.[side.teamId] ?? []).filter((line) => line[1] > 0);
    const usable = teamMinutes(own) >= V4_FIXED.usableTeamMinutes;
    return { ...side, lines: usable ? own : [], usable, full: usable && isFull(own) };
  });
  const { offset, hcaCoefficient } = gameOffsets(state, game);
  const margin = game.homeScore - game.awayScore;
  const capped = Math.max(-V4_FIXED.marginCap, Math.min(V4_FIXED.marginCap, margin));

  const marginRow: ObservationRow = { slots: [], coefs: [], z: capped - offset, r: params.sigma * params.sigma };
  const weights = new Map<string, Array<[number, number]>>();
  for (const side of sides) {
    const entries: Array<[number, number]> = [];
    if (side.usable) {
      const total = teamMinutes(side.lines);
      for (const line of side.lines) {
        const slot = ensurePlayer(state, line[0], params);
        state.lastSeason.set(playerKey(line[0]), season);
        entries.push([slot, (5 * line[1]) / total]);
      }
    } else {
      const slot = ensurePseudo(state, side.teamId, params);
      state.lastSeason.set(pseudoKey(side.teamId), season);
      entries.push([slot, V4_FIXED.pseudoWeight]);
    }
    weights.set(side.teamId, entries);
    for (const [slot, weight] of entries) {
      marginRow.slots.push(slot);
      marginRow.coefs.push(side.sign * weight);
    }
    marginRow.slots.push(ensureTeam(state, side.teamId, params));
    marginRow.coefs.push(side.sign);
  }
  if (hcaCoefficient !== 0) {
    marginRow.slots.push(state.slots.get(HCA_KEY) as number);
    marginRow.coefs.push(hcaCoefficient);
  }
  const rows: ObservationRow[] = [marginRow];

  const fullSides = sides.filter((side) => side.full);
  if (fullSides.length > 0) {
    const estimates = fullSides.map((side) => possessionEstimate(side.lines));
    const gamePossessions = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
    for (const side of fullSides) {
      const total = teamMinutes(side.lines);
      const teamStats = new Float64Array(11);
      for (const line of side.lines) for (let stat = 0; stat < 11; stat += 1) teamStats[stat] += line[2 + stat] as number;
      const entries = weights.get(side.teamId) as Array<[number, number]>;
      for (const line of side.lines) {
        if (line[1] < V4_FIXED.minBoxMinutes) continue;
        const possessions = (gamePossessions * line[1]) / (total / 5);
        if (!(possessions > 0)) continue;
        let deviation = 0;
        for (let stat = 0; stat < 11; stat += 1) {
          const own = (100 * (line[2 + stat] as number)) / possessions;
          const team = (100 * teamStats[stat]) / (5 * gamePossessions);
          deviation += V4_BOX_COEFFICIENTS[stat] * (own - team);
        }
        const self = state.slots.get(playerKey(line[0])) as number;
        const row: ObservationRow = {
          slots: [],
          coefs: [],
          z: deviation,
          r: (params.sBox * params.sBox * 30) / line[1],
        };
        for (const [slot, weight] of entries) {
          row.slots.push(slot);
          row.coefs.push((slot === self ? 1 : 0) - weight / 5);
        }
        rows.push(row);
      }
    }
  }
  // ---- v5 observation 3 (on-court): begin ----
  // live-2026.27-v5 (docs/live/registration-v5.md). The only difference from roster-state.ts
  // (tests/roster-state-v5.test.ts asserts it). For a player with on-floor share f = minutes /
  // game minutes in [0.15, 0.90] in a regular-season team-game with usable lines whose
  // plus/minus passes the five-man check (the side's sum equals 5 x its final margin):
  // y = 48 (PM / minutes - (M - PM) / (T - minutes)) = theta_p - sum_{q != p} (m_q / sum m) theta_q
  // + N(0, s3^2 / (f (1 - f))), T the game's minutes, M the side's final margin (uncapped).
  // s3 null (or no onCourt input) is v4 exactly.
  type OnCourtInput = {
    s3: number | null;
    plusMinus: (gameId: string, teamId: string) => ReadonlyMap<string, number> | null;
  };
  const onCourt = (params as V4RatingParams & { onCourt?: OnCourtInput }).onCourt;
  if (onCourt && onCourt.s3 !== null && game.kind === "regular") {
    const s3 = onCourt.s3;
    for (const side of sides) {
      if (!side.usable) continue;
      const plusMinusOf = onCourt.plusMinus(game.id, side.teamId);
      if (!plusMinusOf || plusMinusOf.size < 5) continue;
      const sideMargin = side.sign * margin;
      let pmSum = 0;
      for (const value of plusMinusOf.values()) pmSum += value;
      if (pmSum !== 5 * sideMargin) continue;
      const gameMinutes = teamMinutes(side.lines) / 5;
      const entries = weights.get(side.teamId) as Array<[number, number]>;
      side.lines.forEach((line, index) => {
        const minutes = line[1];
        const f = minutes / gameMinutes;
        const pm = plusMinusOf.get(line[0]);
        if (pm === undefined || !(f >= 0.15 && f <= 0.9)) return;
        const [self, selfWeight] = entries[index];
        const others = 5 - selfWeight;
        const row: ObservationRow = {
          slots: [],
          coefs: [],
          z: 48 * (pm / minutes - (sideMargin - pm) / (gameMinutes - minutes)),
          r: (s3 * s3) / (f * (1 - f)),
        };
        for (const [slot, weight] of entries) {
          row.slots.push(slot);
          row.coefs.push(slot === self ? 1 : -weight / others);
        }
        rows.push(row);
      });
    }
  }
  // ---- v5 observation 3 (on-court): end ----
  jointUpdate(state, rows);

  for (const side of sides) {
    const rowsNow = teamRows(state.minutes, side.teamId, side.listing);
    if (side.usable) {
      recordTeamGame(
        state.minutes,
        season,
        side.teamId,
        side.lines.map((line) => [line[0], line[1]] as [string, number]),
        rowsNow,
        params.alpha,
      );
    } else {
      recordListingOnly(state.minutes, side.teamId, rowsNow);
    }
    recordRows(state.minutes, side.teamId, side.listing);
    state.teamLastDate.set(side.teamId, game.etDate);
  }
}

// ---------------------------------------------------------------------------
// Forecasts
// ---------------------------------------------------------------------------

export type SideWeights = Array<[key: string, weight: number]>;

export type V4Forecast = {
  homeWinProbability: number;
  /** Mixture mean of the expected margin. */
  expectedMargin: number;
  components: Component[];
  scale: number;
  /** Expected weights with every uncertain player at his expected presence (for display). */
  home: SideWeights;
  away: SideWeights;
  uncertain: number;
  /** A7 only: every uncertain player at his expected presence, no integration. Never published. */
  plugInProbability: number;
};

function sideTerms(
  state: RosterState,
  teamId: string,
  listing: SideListing,
  statusTable: StatusWeights,
): WeightTerm[] {
  return minutesTerms(state.minutes, teamId, teamRows(state.minutes, teamId, listing), statusTable, V4_FIXED.newPlayerMinutes);
}

/** Rescaled weights for one side under one configuration; a team with nobody is its pseudo-player. */
function sideWeights(
  state: RosterState,
  teamId: string,
  terms: readonly WeightTerm[],
  presentOf: (term: WeightTerm) => number,
  kappa: number,
  params: V4RatingParams,
): SideWeights {
  const raw: Array<[string, number]> = terms.map((term) => [playerKey(term.athleteId), term.raw * presentOf(term)]);
  const scaled = rescaleWeights(raw, kappa);
  if (scaled.length === 0) {
    ensurePseudo(state, teamId, params);
    return [[pseudoKey(teamId), V4_FIXED.pseudoWeight]];
  }
  for (const [key] of scaled) {
    if (!state.slots.has(key)) ensurePlayer(state, key.slice(2), params);
  }
  return scaled;
}

function marginMoments(
  state: RosterState,
  homeId: string,
  awayId: string,
  home: SideWeights,
  away: SideWeights,
  offsets: GameOffsets,
): { mu: number; variance: number } {
  const slots: number[] = [];
  const coefs: number[] = [];
  for (const [key, weight] of home) {
    slots.push(state.slots.get(key) as number);
    coefs.push(weight);
  }
  for (const [key, weight] of away) {
    slots.push(state.slots.get(key) as number);
    coefs.push(-weight);
  }
  slots.push(state.slots.get(teamKey(homeId)) as number);
  coefs.push(1);
  slots.push(state.slots.get(teamKey(awayId)) as number);
  coefs.push(-1);
  if (offsets.hcaCoefficient !== 0) {
    slots.push(state.slots.get(HCA_KEY) as number);
    coefs.push(offsets.hcaCoefficient);
  }
  let mu = offsets.offset;
  let variance = 0;
  const { capacity, cov, mean } = state;
  for (let a = 0; a < slots.length; a += 1) {
    mu += coefs[a] * mean[slots[a]];
    for (let b = 0; b < slots.length; b += 1) variance += coefs[a] * coefs[b] * cov[slots[a] * capacity + slots[b]];
  }
  return { mu, variance: Math.max(0, variance) };
}

/**
 * M5. The forecast of one game from the current state, with the given rows for each side.
 * Creates slots for players and teams it needs (deterministically; their prior only).
 */
export function forecastGame(
  state: RosterState,
  game: SeasonGame,
  listing: { home: SideListing; away: SideListing },
  params: V4RatingParams,
  statusTable: StatusWeights,
): V4Forecast {
  ensureTeam(state, game.homeId, params);
  ensureTeam(state, game.awayId, params);
  const kappa = game.kind === "playoff" ? params.kappa : 1;
  const offsets = gameOffsets(state, game);
  const homeTerms = sideTerms(state, game.homeId, listing.home, statusTable);
  const awayTerms = sideTerms(state, game.awayId, listing.away, statusTable);
  const uncertain: UncertainPlayer[] = [];
  const indexOf = new Map<WeightTerm, number>();
  for (const term of [...homeTerms, ...awayTerms]) {
    if (term.pOut !== null) {
      indexOf.set(term, uncertain.length);
      uncertain.push({ key: term.athleteId, pOut: term.pOut });
    }
  }
  const configurations = availabilityConfigurations(
    uncertain,
    `v4-availability:${game.id}:${game.etDate}`,
    V4_FIXED.enumerateUpTo,
    V4_FIXED.enumerationDraws,
  );
  const components: Component[] = [];
  let expectedMargin = 0;
  for (const configuration of configurations) {
    const present = (term: WeightTerm) => {
      const index = indexOf.get(term);
      return index === undefined ? 1 : configuration.present[index] ? 1 : 0;
    };
    const home = sideWeights(state, game.homeId, homeTerms, present, kappa, params);
    const away = sideWeights(state, game.awayId, awayTerms, present, kappa, params);
    const { mu, variance } = marginMoments(state, game.homeId, game.awayId, home, away, offsets);
    components.push({ weight: configuration.weight, mu, sd: Math.sqrt(params.sigma * params.sigma + variance) });
    expectedMargin += configuration.weight * mu;
  }
  const expected = (term: WeightTerm) => (term.pOut === null ? 1 : 1 - term.pOut);
  const home = sideWeights(state, game.homeId, homeTerms, expected, kappa, params);
  const away = sideWeights(state, game.awayId, awayTerms, expected, kappa, params);
  const plain = marginMoments(state, game.homeId, game.awayId, home, away, offsets);
  return {
    homeWinProbability: mixtureProbability(components, state.scale),
    expectedMargin,
    components,
    scale: state.scale,
    home,
    away,
    uncertain: uncertain.length,
    plugInProbability: mixtureProbability(
      [{ weight: 1, mu: plain.mu, sd: Math.sqrt(params.sigma * params.sigma + plain.variance) }],
      state.scale,
    ),
  };
}

/** M5's scale for the current date, from the window of earlier regular-season games only. */
export function refreshScale(state: RosterState): void {
  if (state.scaleWindow.length < V4_FIXED.scaleMinimum) {
    state.scale = 1;
    return;
  }
  state.scale = estimateScale(state.scaleWindow, state.scale);
}

function recordScale(state: RosterState, entry: ScaleEntry): void {
  state.scaleWindow.push(entry);
  if (state.scaleWindow.length > V4_FIXED.scaleWindow) state.scaleWindow.shift();
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export type V4ForecastRow = {
  game: SeasonGame;
  forecast: V4Forecast;
  y: 0 | 1;
};

export type ReplayV4Input = {
  /** Every game, chronological (tip, then ID). Only finals enter. */
  games: readonly SeasonGame[];
  linesFor: (gameId: string) => V4GameLines | undefined;
  /** The report a game was played under (history: its final point). Null when none. */
  reportFor: (game: SeasonGame) => ReportPoint | null;
  openingRosters: (season: number) => ReadonlyMap<string, readonly string[]>;
  params: V4RatingParams;
  /** Status weights for a season's forecasts (M3). */
  statusTable: (season: number) => StatusWeights;
  /** Resume from this state (a checkpoint); its dates must precede the games replayed. */
  state?: RosterState;
  /** Process only ET dates before this one. */
  throughEtDate?: string;
  /** Forecast and score every final game (regular, play-in, playoff) before its date's update. */
  onForecast?: (row: V4ForecastRow, state: RosterState, listing: { home: SideListing; away: SideListing }) => void;
  /** Called after each ET date is fully processed. */
  onDate?: (etDate: string, state: RosterState) => void;
};

const countable = (game: SeasonGame) =>
  game.status === "final" && game.homeScore !== null && game.awayScore !== null;

/**
 * The filter over a game list, one ET date at a time: forecasts for every game of the date
 * from the state after the previous date (each game's result enters M5's window only after
 * its date), then the updates in tip order.
 */
export function replayRosterState(input: ReplayV4Input): RosterState {
  const state = input.state ?? createRosterState();
  const games = input.games.filter(countable);
  let index = 0;
  while (index < games.length) {
    const etDate = games[index].etDate;
    if (input.throughEtDate && etDate >= input.throughEtDate) break;
    const day: SeasonGame[] = [];
    while (index < games.length && games[index].etDate === etDate) day.push(games[index++]);
    if (state.lastEtDate !== null && state.season === day[0].season && etDate <= state.lastEtDate) {
      throw new Error(`v4 replay: ${etDate} is not after the state's ${state.lastEtDate}.`);
    }
    advanceTo(state, day[0].season, etDate, input.params, input.openingRosters);
    refreshScale(state);
    const listings = day.map((game) => {
      const point = input.reportFor(game);
      return { home: sideListing(point, game.homeId), away: sideListing(point, game.awayId) };
    });
    const pending: ScaleEntry[] = [];
    day.forEach((game, position) => {
      const forecast = forecastGame(state, game, listings[position], input.params, input.statusTable(game.season));
      const y: 0 | 1 = (game.homeScore as number) > (game.awayScore as number) ? 1 : 0;
      input.onForecast?.({ game, forecast, y }, state, listings[position]);
      if (game.kind === "regular") pending.push({ components: forecast.components, y });
    });
    day.forEach((game, position) => {
      updateWithGame(state, game, input.linesFor(game.id), listings[position], input.params);
    });
    for (const entry of pending) recordScale(state, entry);
    input.onDate?.(etDate, state);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Team strengths for the simulator (M6)
// ---------------------------------------------------------------------------

export type StrengthDistribution = {
  teamIds: string[];
  mean: Float64Array;
  /** Row-major, size teamIds.length. */
  cov: Float64Array;
};

/**
 * The distribution of team strengths sum_p w_p theta_p + c_T (plus the pseudo-player when
 * a team has no weights), for given weights per team, with home court appended last.
 */
export function strengthDistribution(
  state: RosterState,
  weightsByTeam: ReadonlyArray<[teamId: string, weights: SideWeights]>,
  params: V4RatingParams,
): StrengthDistribution {
  const rows: Array<{ slots: number[]; coefs: number[] }> = [];
  for (const [teamId, weights] of weightsByTeam) {
    const slots: number[] = [];
    const coefs: number[] = [];
    for (const [key, weight] of weights) {
      let slot = state.slots.get(key);
      if (slot === undefined) slot = key.startsWith("x:") ? ensurePseudo(state, key.slice(2), params) : ensurePlayer(state, key.slice(2), params);
      slots.push(slot);
      coefs.push(weight);
    }
    slots.push(ensureTeam(state, teamId, params));
    coefs.push(1);
    rows.push({ slots, coefs });
  }
  rows.push({ slots: [state.slots.get(HCA_KEY) as number], coefs: [1] });
  const size = rows.length;
  const mean = new Float64Array(size);
  const cov = new Float64Array(size * size);
  const { capacity } = state;
  for (let a = 0; a < size; a += 1) {
    for (let t = 0; t < rows[a].slots.length; t += 1) mean[a] += rows[a].coefs[t] * state.mean[rows[a].slots[t]];
    for (let b = 0; b <= a; b += 1) {
      let sum = 0;
      for (let t = 0; t < rows[a].slots.length; t += 1) {
        for (let u = 0; u < rows[b].slots.length; u += 1) {
          sum += rows[a].coefs[t] * rows[b].coefs[u] * state.cov[rows[a].slots[t] * capacity + rows[b].slots[u]];
        }
      }
      cov[a * size + b] = sum;
      cov[b * size + a] = sum;
    }
  }
  return { teamIds: [...weightsByTeam.map(([teamId]) => teamId), "hca"], mean, cov };
}

/** A team's expected full-health terms: unlisted members as M2 gives them, listed members (on its latest rows) at presence 1. */
export function fullHealthTerms(state: RosterState, teamId: string): WeightTerm[] {
  return minutesTerms(state.minutes, teamId, [], { O: 0, D: 0, Q: 0, P: 0, A: 0 }, V4_FIXED.newPlayerMinutes);
}

export function weightsFromTerms(
  state: RosterState,
  teamId: string,
  terms: readonly WeightTerm[],
  kappa: number,
  params: V4RatingParams,
  scaleOf: (term: WeightTerm) => number = () => 1,
): SideWeights {
  return sideWeights(state, teamId, terms, scaleOf, kappa, params);
}

export { playerKey, pseudoKey, teamKey };

// ---------------------------------------------------------------------------
// warmState: the path through the closed seasons (registration-v4.md, section 0)
// ---------------------------------------------------------------------------

/** The replay's input without any way to observe a forecast. */
export type WarmStateInput = Omit<ReplayV4Input, "onForecast" | "onDate">;

/**
 * The filter run to an ET date, returning the state and nothing else: no forecast, error or
 * score leaves this function. The state carries M5's window (the last 3,000 regular-season
 * games' standardized margins), which the next forecast's scale needs; it is never output.
 */
export function warmState(input: WarmStateInput): RosterState {
  const { games, linesFor, reportFor, openingRosters, params, statusTable, state, throughEtDate } = input;
  return replayRosterState({ games, linesFor, reportFor, openingRosters, params, statusTable, state, throughEtDate });
}
