// A tiny hand-built season for replay tests: two teams play each other every other day,
// with box-score lines chosen per game. Used by the v2 defect reproducers and the v3
// gap-tracking tests.

import type { StoredLine } from "@/lib/season/box-scores";
import { addDays } from "@/lib/season/dates";
import {
  createTracker,
  replayInjuryModel,
  type AvailabilityTracker,
  type GameAvailability,
  type InjuryParams,
  type ReplayInput,
  type StatusTable,
} from "@/lib/season/injury-model";
import { LIVE_PARAMS } from "@/lib/season/params";
import { createFilterState } from "@/lib/season/ratings";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";

export const REPLAY_INJURY: InjuryParams = { beta: 0.4, gRep: 0.2, k: 1000, lG: 1000, lM: 3 };
export const REPLAY_TABLE: StatusTable = { O: 0.999, D: 0.9834, Q: 0.4827, P: 0.1863, A: 0.1863 };
export const TEAM_A = SEASON_TEAMS[0].id;
export const TEAM_B = SEASON_TEAMS[1].id;
export const TEAM_C = SEASON_TEAMS[2].id;

/** A starter's line: 34 minutes, Game Score 22. */
export const starter = (athleteId: string): StoredLine => [athleteId, 34, 22];
/** Bench filler at replacement level. */
export const filler = (athleteId: string): StoredLine => [athleteId, 14, 2.8];

export type ReplayGameSpec = {
  home: string;
  away: string;
  lines: Record<string, StoredLine[]> | null;
  availability?: GameAvailability | null;
  season?: number;
};

export function buildReplayGames(specs: readonly ReplayGameSpec[], start = "2026-10-21"): {
  games: SeasonGame[];
  boxScores: (gameId: string) => Record<string, StoredLine[]> | undefined;
  availability: (gameId: string) => GameAvailability | null;
} {
  const box = new Map<string, Record<string, StoredLine[]>>();
  const avail = new Map<string, GameAvailability | null>();
  const games = specs.map((spec, index): SeasonGame => {
    const etDate = addDays(start, index * 2);
    const id = `r${index + 1}`;
    if (spec.lines) box.set(id, spec.lines);
    avail.set(id, spec.availability ?? null);
    return {
      id,
      season: spec.season ?? 2027,
      kind: "regular",
      tipUtc: `${etDate}T23:30:00.000Z`,
      etDate,
      homeId: spec.home,
      awayId: spec.away,
      neutral: false,
      status: "final",
      homeScore: 100 + (index % 3),
      awayScore: 99,
    };
  });
  return {
    games,
    boxScores: (gameId) => box.get(gameId),
    availability: (gameId) => avail.get(gameId) ?? null,
  };
}

export function runReplay(
  specs: readonly ReplayGameSpec[],
  onAbsences?: ReplayInput["onAbsences"],
  tracker: AvailabilityTracker = createTracker(),
) {
  const built = buildReplayGames(specs);
  const output = replayInjuryModel({
    games: built.games,
    state: createFilterState(LIVE_PARAMS),
    stateSeason: 2027,
    params: LIVE_PARAMS,
    injury: REPLAY_INJURY,
    statusTable: REPLAY_TABLE,
    boxScores: built.boxScores,
    availability: built.availability,
    tracker,
    onAbsences,
  });
  return { ...built, ...output };
}

/** Lines for one team: the named starters plus four fillers unique to the team. */
export function teamLines(teamId: string, starters: readonly string[]): StoredLine[] {
  return [...starters.map(starter), ...[1, 2, 3, 4].map((n) => filler(`${teamId}-bench-${n}`))];
}
