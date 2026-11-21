// v1 and v2 on the open seasons, through dev-data.ts only, for the Stage A gate and A8:
// game forecasts (v1's development replay; v2's registered fit-season harness) and season
// simulations at a checkpoint (T4's form).

import { createTracker, replayInjuryModel, type ForecastRow, type InjuryParams } from "../../../src/lib/season/injury-model";
import {
  INJURY_PARAMS,
  INJURY_STATUS_TABLE,
  LIVE_PARAMS,
  SIMULATOR_UNCERTAINTY_SCALE,
} from "../../../src/lib/season/params";
import { replayRatings, rollSeason } from "../../../src/lib/season/ratings";
import { simulateSeason } from "../../../src/lib/season/simulate";
import { buildStandings } from "../../../src/lib/season/standings";
import type { SeasonGame } from "../../../src/lib/season/types";
import type { ScoredGame } from "../eval-metrics";
import { devAvailability, devGames, devSeasonGames, devStoredBoxLookup } from "./dev-data";
import { isQualifying, REPORT_SEASONS } from "./engine-run";

const outcome = (game: SeasonGame): 0 | 1 => ((game.homeScore as number) > (game.awayScore as number) ? 1 : 0);

/** v1's development replay from 2004-05 (LIVE_PARAMS), every final game, as registered. */
export function v1GameRows(lastSeason: number): Map<string, ScoredGame & { game: SeasonGame }> {
  const games = devGames(2005, lastSeason).filter((game) => game.kind !== "cup-final");
  const rows = new Map<string, ScoredGame & { game: SeasonGame }>();
  for (const { game, prediction, homeWon } of replayRatings(games, LIVE_PARAMS, { collectPredictions: true }).predictions) {
    rows.set(game.id, { id: game.id, season: game.season, p: prediction.homeWinProbability, y: homeWon ? 1 : 0, game });
  }
  return rows;
}

/** v2's registered fit-season harness on 2021-22 to 2023-24: final-point numbers of qualifying games. */
export function v2FinalRows(injury: InjuryParams = INJURY_PARAMS): Map<string, ScoredGame> {
  const all = devGames(2005, 2024);
  const base = replayRatings(all.filter((game) => game.season < 2021), LIVE_PARAMS).state;
  const availability = devAvailability(REPORT_SEASONS);
  const rows = new Map<string, ScoredGame>();
  replayInjuryModel({
    games: all.filter((game) => game.season >= 2021),
    state: { mean: Float64Array.from(base.mean), cov: Float64Array.from(base.cov) },
    stateSeason: 2020,
    params: LIVE_PARAMS,
    injury,
    statusTable: INJURY_STATUS_TABLE,
    boxScores: devStoredBoxLookup([2021, ...REPORT_SEASONS]),
    availability,
    tracker: createTracker(),
    onForecast: (row: ForecastRow) => {
      if (!isQualifying(row.game, availability)) return;
      rows.set(row.game.id, { id: row.game.id, season: row.game.season, p: row.final.homeWinProbability, y: outcome(row.game) });
    },
  });
  return rows;
}

export type CheckpointName = "opening" | "dec1" | "feb1" | "apr1";

export function checkpointDate(season: number, checkpoint: CheckpointName): string {
  if (checkpoint === "dec1") return `${season - 1}-12-01`;
  if (checkpoint === "feb1") return `${season}-02-01`;
  if (checkpoint === "apr1") return `${season}-04-01`;
  const first = devSeasonGames(season)
    .filter((game) => game.kind === "regular")
    .map((game) => game.etDate)
    .sort()[0];
  return first;
}

export function seasonOutcome(season: number) {
  const seasonGames = devSeasonGames(season);
  const made = new Set<string>();
  for (const game of seasonGames) {
    if (game.kind === "playoff" && game.status === "final") {
      made.add(game.homeId);
      made.add(game.awayId);
    }
  }
  return { seasonGames, made, finalWins: buildStandings(seasonGames).wins };
}

/** The season as known on an ET date: later regular games back to scheduled. */
export function asOfDate(seasonGames: readonly SeasonGame[], etDate: string): SeasonGame[] {
  return seasonGames
    .filter((game) => game.kind === "regular" || game.kind === "cup-final")
    .map((game) =>
      game.status === "final" && game.etDate >= etDate ? { ...game, status: "scheduled" as const, homeScore: null, awayScore: null } : game,
    );
}

export type SeasonRead = { pMake: Map<string, number>; projected: Map<string, number> };

/** v1 as T4 simulated it: plain replay through the day before, LIVE_PARAMS, uncertainty scale 1.5. */
export function v1SeasonAt(season: number, etDate: string, iterations: number): SeasonRead {
  const known = asOfDate(seasonOutcome(season).seasonGames, etDate);
  const games = devGames(2005, season);
  const opening = !games.some((game) => game.season === season && game.etDate < etDate && game.status === "final");
  const replay = replayRatings(games, LIVE_PARAMS, {
    isIncluded: (game) => game.etDate < etDate,
    asOfEtDate: opening ? undefined : etDate,
  });
  if (opening) {
    // Opening night: v1's own roll, as its replay applies it on a season's first game.
    rollSeason(replay.state, LIVE_PARAMS);
    for (const teamId of Object.keys(replay.lastGameEtDate)) replay.lastGameEtDate[teamId] = null;
  }
  const forecast = simulateSeason({
    season,
    phase: "regular-season",
    games: known,
    state: replay.state,
    params: LIVE_PARAMS,
    asOfEtDate: etDate,
    lastGameEtDate: replay.lastGameEtDate,
    iterations,
    uncertaintyScale: SIMULATOR_UNCERTAINTY_SCALE,
  });
  return {
    pMake: new Map(forecast.teams.map((team) => [team.teamId, team.makePlayoffs])),
    projected: new Map(forecast.teams.map((team) => [team.teamId, team.projectedWins])),
  };
}
