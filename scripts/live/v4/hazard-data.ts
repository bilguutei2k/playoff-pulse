// v4's hazard population: v3 D3's rules exactly (scripts/live/v3-hazard-data.ts, which
// stays frozen), with each observation also carrying its reason text, so the group can
// replace the class (registration-v4.md, M4). Data comes only through dev-data.ts.

import { absenceClass, type AbsenceClass } from "../../../src/lib/season/availability";
import { absenceGroup } from "../../../src/lib/season/availability-v4";
import { createTracker, replayInjuryModel } from "../../../src/lib/season/injury-model";
import { INJURY_PARAMS, INJURY_STATUS_TABLE, LIVE_PARAMS } from "../../../src/lib/season/params";
import { isRatable, replayRatings } from "../../../src/lib/season/ratings";
import { devAvailability, devGames, devStoredBoxLookup } from "./dev-data";

export const HAZARD_SEASONS = [2022, 2023, 2024] as const;
const WARMUP_SEASON = 2021;

export type GroupedObservation = {
  season: number;
  k: number;
  class: AbsenceClass;
  group: string;
  returned: boolean;
  /** The spell's id, and the miss index within it (for the "still out j games later" reads). */
  spell: number;
};

export function collectGroupedObservations(): GroupedObservation[] {
  const all = devGames(2005, 2024);
  const base = replayRatings(all.filter((game) => game.season < WARMUP_SEASON), LIVE_PARAMS).state;
  const games = all.filter((game) => game.season >= WARMUP_SEASON);
  const boxScores = devStoredBoxLookup([WARMUP_SEASON, ...HAZARD_SEASONS]);
  const availability = devAvailability(HAZARD_SEASONS);
  const seasonSet = new Set<number>(HAZARD_SEASONS);
  const nextGame = new Map<string, string | null>();
  const lastByTeam = new Map<string, string>();
  for (const game of games) {
    if (game.kind !== "regular" || !isRatable(game) || !seasonSet.has(game.season)) continue;
    for (const teamId of [game.homeId, game.awayId]) {
      const key = `${game.season}:${teamId}`;
      const previous = lastByTeam.get(key);
      if (previous) nextGame.set(`${teamId}:${previous}`, game.id);
      lastByTeam.set(key, game.id);
      nextGame.set(`${teamId}:${game.id}`, null);
    }
  }
  type Spell = { id: number; teamId: string; athleteId: string; k: number; class: AbsenceClass; reason: string | null; lastGameId: string; season: number };
  const open = new Map<string, Spell>();
  const observations: GroupedObservation[] = [];
  const tracker = createTracker();
  let spellId = 0;
  const censorStale = (spell: Spell, key: string, gameId: string | null): boolean => {
    const next = nextGame.get(`${spell.teamId}:${spell.lastGameId}`);
    if (next === undefined) throw new Error(`No schedule entry for ${spell.teamId} ${spell.lastGameId}.`);
    if (next === gameId) return false;
    open.delete(key);
    return true;
  };
  const reasonOf = (gameId: string, teamId: string, athleteId: string): string | null =>
    availability(gameId)?.final?.rows.find((row) => row.teamId === teamId && row.athleteId === athleteId)?.reason ?? null;
  const observe = (spell: Spell, returned: boolean) =>
    observations.push({ season: spell.season, k: spell.k, class: spell.class, group: absenceGroup(spell.reason), returned, spell: spell.id });

  replayInjuryModel({
    games,
    state: { mean: Float64Array.from(base.mean), cov: Float64Array.from(base.cov) },
    stateSeason: WARMUP_SEASON - 1,
    params: LIVE_PARAMS,
    injury: INJURY_PARAMS,
    statusTable: INJURY_STATUS_TABLE,
    boxScores,
    availability,
    tracker,
    onAbsences: (game, teamId, absences) => {
      if (game.kind !== "regular" || !seasonSet.has(game.season)) return;
      const lines = boxScores(game.id)?.[teamId];
      if (!lines) throw new Error(`No lines for ${game.id} ${teamId}.`);
      const appeared = new Set(lines.map((line) => line[0]));
      const absentNow = new Map(absences.absent.map((entry) => [entry.athleteId, entry]));
      const continued = new Set<string>();
      for (const [key, spell] of [...open]) {
        if (spell.teamId !== teamId) continue;
        if (censorStale(spell, key, game.id)) continue;
        const entry = absentNow.get(spell.athleteId);
        if (appeared.has(spell.athleteId)) {
          observe(spell, true);
          open.delete(key);
        } else if (entry) {
          observe(spell, false);
          spell.k += 1;
          spell.class = entry.class;
          spell.reason = reasonOf(game.id, teamId, spell.athleteId);
          spell.lastGameId = game.id;
          continued.add(spell.athleteId);
        } else {
          open.delete(key);
        }
      }
      for (const entry of absences.absent) {
        if (continued.has(entry.athleteId) || entry.lost <= 0 || entry.missedBefore !== 0) continue;
        const reason = reasonOf(game.id, teamId, entry.athleteId);
        if (absenceClass(reason) !== entry.class) throw new Error("Reason and class disagree.");
        open.set(`${teamId}:${entry.athleteId}`, {
          id: spellId++,
          teamId,
          athleteId: entry.athleteId,
          k: 1,
          class: entry.class,
          reason,
          lastGameId: game.id,
          season: game.season,
        });
      }
    },
  });
  return observations;
}
