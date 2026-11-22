// v3's hazard population (decision D3), shared by the fit and the development
// diagnostics so both see exactly the same observations. See fit-injury-v3.ts for the rule.

import type { AbsenceClass } from "../../src/lib/season/availability";
import { createTracker, replayInjuryModel } from "../../src/lib/season/injury-model";
import type { HazardObservation } from "../../src/lib/season/injury-v3";
import { INJURY_PARAMS, INJURY_STATUS_TABLE, LIVE_PARAMS } from "../../src/lib/season/params";
import { isRatable, type FilterState } from "../../src/lib/season/ratings";
import type { SeasonGame } from "../../src/lib/season/types";
import type { AvailabilityData } from "./availability-store";

/** Seasons after this are never loaded by the fit or the diagnostics. */
export const LAST_DEVELOPMENT_SEASON = 2024;

export type CensorCause = "season-end" | "no-box-score" | "left-rotation" | "appeared-elsewhere";

/**
 * One spell: the class at each missed game, and how it ended. Miss i (k = i + 1) gives an
 * observation unless it is the last miss of a censored spell.
 */
export type HazardSpell = {
  season: number;
  classes: AbsenceClass[];
  end: "returned" | CensorCause;
};

export type HazardFitRun = {
  observations: HazardObservation[];
  /** The same observations grouped by spell, for the diagnostics. */
  spells: HazardSpell[];
  censored: Record<CensorCause, number>;
  spellsOpened: number;
  /** Absent entries with v2's count already above zero and no open spell (after a drop): ignored. */
  ignoredContinuations: number;
  /** Continuing spells whose k disagreed with v2's count (expected 0). */
  countMismatches: number;
};

/**
 * Runs v2's replay over `games` and collects v3's at-risk observations for regular-season
 * games of `seasons`. Exported so the diagnostics can reuse exactly this population.
 */
export function collectHazardObservations(
  games: readonly SeasonGame[],
  seasons: readonly number[],
  data: AvailabilityData,
  base: FilterState,
  stateSeason: number,
): HazardFitRun {
  if (seasons.some((season) => season > LAST_DEVELOPMENT_SEASON)) {
    throw new Error("v3 hazard observations are collected on development seasons only.");
  }
  if (games.some((game) => game.season > LAST_DEVELOPMENT_SEASON)) {
    throw new Error("A season after 2023-24 reached the v3 hazard population.");
  }
  const seasonSet = new Set(seasons);
  // Each team's regular-season games in replay order, to find "the team's next game".
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

  type Spell = {
    teamId: string;
    athleteId: string;
    k: number;
    class: AbsenceClass;
    lastGameId: string;
    season: number;
    classes: AbsenceClass[];
  };
  const spells: HazardSpell[] = [];
  const close = (key: string, spell: Spell, end: HazardSpell["end"]) => {
    spells.push({ season: spell.season, classes: spell.classes, end });
    open.delete(key);
  };
  const open = new Map<string, Spell>();
  const observations: HazardObservation[] = [];
  const censored: Record<CensorCause, number> = {
    "season-end": 0,
    "no-box-score": 0,
    "left-rotation": 0,
    "appeared-elsewhere": 0,
  };
  let spellsOpened = 0;
  let ignoredContinuations = 0;
  let countMismatches = 0;
  const tracker = createTracker();

  // A spell whose next team game is not `gameId` is censored here: the season ended, or
  // the next game had no box score.
  const censorStale = (spell: Spell, key: string, gameId: string | null): boolean => {
    const next = nextGame.get(`${spell.teamId}:${spell.lastGameId}`);
    if (next === undefined) throw new Error(`No schedule entry for ${spell.teamId} ${spell.lastGameId}.`);
    if (next === gameId) return false;
    const cause = next === null ? "season-end" : "no-box-score";
    censored[cause] += 1;
    close(key, spell, cause);
    return true;
  };

  replayInjuryModel({
    games,
    state: { mean: Float64Array.from(base.mean), cov: Float64Array.from(base.cov) },
    stateSeason,
    params: LIVE_PARAMS,
    injury: INJURY_PARAMS,
    statusTable: INJURY_STATUS_TABLE,
    boxScores: data.boxScores,
    availability: data.availability,
    tracker,
    onAbsences: (game, teamId, absences) => {
      if (game.kind !== "regular" || !seasonSet.has(game.season)) return;
      const lines = data.boxScores(game.id)?.[teamId];
      if (!lines) throw new Error(`No lines for ${game.id} ${teamId}.`);
      const appeared = new Set(lines.map((line) => line[0]));
      const absentNow = new Map(absences.absent.map((entry) => [entry.athleteId, entry]));
      const continued = new Set<string>();
      for (const [key, spell] of [...open]) {
        if (spell.teamId !== teamId) continue;
        if (censorStale(spell, key, game.id)) continue;
        const entry = absentNow.get(spell.athleteId);
        if (appeared.has(spell.athleteId)) {
          observations.push({ k: spell.k, class: spell.class, returned: true });
          close(key, spell, "returned");
        } else if (entry) {
          observations.push({ k: spell.k, class: spell.class, returned: false });
          if (entry.missedBefore !== spell.k) countMismatches += 1;
          spell.k += 1;
          spell.class = entry.class;
          spell.classes.push(entry.class);
          spell.lastGameId = game.id;
          continued.add(spell.athleteId);
        } else {
          const elsewhere = tracker.book.get(spell.athleteId)?.lastTeamId !== teamId;
          const cause = elsewhere ? "appeared-elsewhere" : "left-rotation";
          censored[cause] += 1;
          close(key, spell, cause);
        }
      }
      for (const entry of absences.absent) {
        if (continued.has(entry.athleteId)) continue;
        if (entry.lost <= 0) continue;
        if (entry.missedBefore !== 0) {
          ignoredContinuations += 1;
          continue;
        }
        open.set(`${teamId}:${entry.athleteId}`, {
          teamId,
          athleteId: entry.athleteId,
          k: 1,
          class: entry.class,
          lastGameId: game.id,
          season: game.season,
          classes: [entry.class],
        });
        spellsOpened += 1;
      }
    },
  });
  for (const [key, spell] of [...open]) censorStale(spell, key, "end-of-replay");
  if (open.size > 0) throw new Error("Spells left open after the replay.");
  // A returned spell gives one observation per miss; a censored one none after its last miss.
  const derived = spells.reduce((sum, spell) => sum + spell.classes.length - (spell.end === "returned" ? 0 : 1), 0);
  if (derived !== observations.length) throw new Error("Spells and observations disagree.");
  return { observations, spells, censored, spellsOpened, ignoredContinuations, countMismatches };
}

