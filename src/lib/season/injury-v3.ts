/** Opt-in v3 groundwork. No production caller imports this module. */
import type { AbsenceClass } from "./availability";
import type { RandomSource } from "../model/random";
import {
  createTracker, currentAbsences, replayInjuryModel, survivalBucket,
  type AvailabilityTracker, type CurrentAbsence, type InjuryParams,
  type ReplayInput, type StatusTable, type SurvivalTable,
} from "./injury-model";

export const V3_MODEL_VERSION = "live-2026.27-v3";
export type HazardObservation = { missed: number; class: AbsenceClass; returned: boolean };
export type HazardTable = { long: number[]; short: number[] };

/** Adjacent pooling is fixed before evaluation; zero has no observations of its own. */
export function fitHazards(rows: readonly HazardObservation[]) {
  const counts = { long: Array<number>(7).fill(0), short: Array<number>(7).fill(0) };
  const events = { long: Array<number>(7).fill(0), short: Array<number>(7).fill(0) };
  const table: HazardTable = { long: [], short: [] };
  const pools: Record<AbsenceClass, number[][]> = { long: [], short: [] };
  for (const row of rows) {
    if (!Number.isInteger(row.missed) || row.missed < 1) throw new Error("Invalid risk ordinal");
    const b = survivalBucket(row.missed);
    counts[row.class][b]++;
    events[row.class][b] += Number(row.returned);
  }
  for (const c of ["long", "short"] as const) {
    const groups = counts[c].map((n, b) => ({ n, e: events[c][b], members: [b] }));
    for (let i = groups.length - 1; i > 0; i--) {
      if (groups[i].n >= 30) continue;
      groups[i - 1].n += groups[i].n;
      groups[i - 1].e += groups[i].e;
      groups[i - 1].members.push(...groups[i].members);
      groups.splice(i, 1);
    }
    if (groups.length > 1 && groups[0].n < 30) {
      groups[1].n += groups[0].n;
      groups[1].e += groups[0].e;
      groups[1].members.push(...groups[0].members);
      groups.shift();
    }
    for (const group of groups) {
      if (group.n < 30) throw new Error(`Insufficient ${c} risk observations`);
      for (const b of group.members) table[c][b] = group.e / group.n;
    }
    pools[c] = groups.map((g) => g.members.sort((a, b) => a - b));
    if (!(table[c][6] > 0)) throw new Error(`Unidentified ${c} return tail`);
  }
  return { table, counts, events, pools };
}

function hazard(table: HazardTable, c: AbsenceClass, k: number): number {
  const h = table[c][survivalBucket(k)];
  if (!(h >= 0 && h <= 1)) throw new Error("Invalid return hazard");
  return h;
}

/** P(still out at the j-th next team game | k missed); j is one-based. */
export function stillOut(table: HazardTable, k: number, c: AbsenceClass, j: number, nextOut?: number): number {
  if (!Number.isInteger(k) || k < 0 || !Number.isInteger(j) || j < 1) throw new Error("Invalid game ordinal");
  let p = nextOut ?? 1 - hazard(table, c, k);
  if (!(p >= 0 && p <= 1)) throw new Error("Invalid next-game probability");
  for (let n = 1; n < j; n++) p *= 1 - hazard(table, c, k + n);
  return p;
}

/** Exact sum of the survival curve, including the geometric 31+ tail. */
export function expectedGamesV3(table: HazardTable, k: number, c: AbsenceClass, nextOut?: number): number {
  const tail = hazard(table, c, 31);
  if (!(tail > 0)) throw new Error("Unidentified return tail");
  let total = 0;
  const firstTail = Math.max(1, 32 - k);
  for (let j = 1; j < firstTail; j++) total += stillOut(table, k, c, j, nextOut);
  return total + stillOut(table, k, c, firstTail, nextOut) / tail;
}

export type V3Absence = CurrentAbsence & { nextOut?: number };
export type ExcludedAbsence = {
  teamId: string; athleteId: string; gamesMissed: number;
  reason: "no longer counted: out of the rotation window" | "no longer counted: joined another team";
};

/** Preserve v2's rating/forecast equations; continue true gaps after rotation expiry. */
export function replayInjuryV3(input: ReplayInput) {
  const tracker = input.tracker ?? createTracker();
  return replayInjuryModel({ ...input, tracker, onAbsences: (game, teamId, absences) => {
    const appeared = new Set(input.boxScores(game.id)?.[teamId]?.map((line) => line[0]) ?? []);
    const tracked = new Set(absences.absent.map((row) => row.athleteId));
    const prefix = `${teamId}:`;
    for (const [key, missed] of tracker.missed) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (!appeared.has(id) && !tracked.has(id)) tracker.missed.set(key, missed + 1);
    }
    input.onAbsences?.(game, teamId, absences);
  } });
}

export function currentAbsencesV3(
  tracker: AvailabilityTracker, injury: InjuryParams, survival: SurvivalTable,
  options: { expireInferred: boolean; hazards?: HazardTable; statusTable: StatusTable },
): { current: V3Absence[]; excluded: ExcludedAbsence[] } {
  const excluded: ExcludedAbsence[] = [];
  if (options.expireInferred) {
    for (const [key, gamesMissed] of tracker.missed) {
      const [teamId, athleteId] = key.split(":");
      if (tracker.latestRows.get(teamId)?.some((r) => r.athleteId === athleteId)) continue;
      const departed = tracker.book.get(athleteId)?.lastTeamId !== teamId;
      if (departed || gamesMissed > 10) excluded.push({ teamId, athleteId, gamesMissed,
        reason: departed ? "no longer counted: joined another team" : "no longer counted: out of the rotation window" });
    }
  }
  const excludedKeys = new Set(excluded.map((r) => `${r.teamId}:${r.athleteId}`));
  const current = currentAbsences(tracker, injury, survival)
    .filter((a) => !excludedKeys.has(`${a.teamId}:${a.athleteId}`))
    .map((a): V3Absence => {
      if (!options.hazards) return a;
      const row = tracker.latestRows.get(a.teamId)?.find((r) => r.athleteId === a.athleteId);
      const nextOut = row ? options.statusTable[row.status] : undefined;
      return { ...a, nextOut, expectedGames: expectedGamesV3(options.hazards, a.gamesMissed, a.class, nextOut) };
    });
  return { current, excluded };
}

export type AbsenceSchedule = { mode: "v3"; current: readonly V3Absence[]; hazards?: HazardTable };

/** Separate seeded stream: return sampling never consumes game-outcome randomness. */
export function sampleAbsenceSchedule(schedule: AbsenceSchedule, random: RandomSource): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  // 82 regular + two play-in + four seven-game series is the maximum remaining path.
  const horizon = 112;
  for (const a of schedule.current) {
    if (!(a.points >= 0 && Number.isFinite(a.points)) || !(a.expectedGames >= 0 && Number.isFinite(a.expectedGames))) {
      throw new Error("Invalid absence magnitude");
    }
    const curve = result[a.teamId] ?? Array<number>(horizon).fill(0);
    const u = schedule.hazards ? random() : 0;
    let p = schedule.hazards ? stillOut(schedule.hazards, a.gamesMissed, a.class, 1, a.nextOut) : 0;
    for (let j = 1; j <= horizon; j++) {
      const share = schedule.hazards
        ? Number(u < p)
        : Math.max(0, Math.min(1, a.expectedGames - j + 1));
      curve[j - 1] += a.points * share;
      if (schedule.hazards) p *= 1 - hazard(schedule.hazards, a.class, a.gamesMissed + j);
    }
    result[a.teamId] = curve;
  }
  return result;
}
