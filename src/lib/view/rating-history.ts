// Team ratings by game day, reconstructed with `replayRatings` over every stored
// season (data/season/games from 2005, then the live season), snapshotted after each
// ET date of the live season. This is the rating model without the injury
// adjustment, so it reproduces v1's published ratings exactly; v2 publishes
// full-strength ratings that can differ by a point or so, and the team page says so.
// The live season's games are read at render time, so the replay is cached per server
// process for each copy of the games and parameters, and reruns only when they change.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FIRST_SEASON } from "@/lib/season/formats";
import { getLiveState, getSeasonGames } from "@/lib/live-data/published";
import { replayRatings } from "@/lib/season/ratings";
import { SEASON_TEAMS, teamIndex } from "@/lib/season/teams";
import type { LiveState, SeasonGame } from "@/lib/season/types";

export type RatingPoint = {
  /** ET date after whose games this snapshot was taken; the first point is the season start. */
  date: string;
  preseason: boolean;
  ratings: Record<string, number>;
};

let earlier: { season: number; games: SeasonGame[] } | null = null;
let cache: { games: readonly SeasonGame[]; params: string; points: RatingPoint[] } | null = null;

function storedSeason(season: number): SeasonGame[] {
  const file = path.join(process.cwd(), "data", "season", "games", `${season}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SeasonGame[]) : [];
}

function snapshot(mean: ArrayLike<number>): Record<string, number> {
  return Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, mean[teamIndex(team.id)]]));
}

/** Every stored season before the live one, read once per process. */
function earlierSeasons(season: number): SeasonGame[] {
  if (earlier?.season !== season) {
    const games: SeasonGame[] = [];
    for (let year = FIRST_SEASON; year < season; year += 1) games.push(...storedSeason(year));
    earlier = { season, games };
  }
  return earlier.games;
}

export async function ratingHistory(): Promise<RatingPoint[]> {
  const [liveState, seasonGames] = await Promise.all([getLiveState(), getSeasonGames()]);
  const params = JSON.stringify([liveState.season, liveState.params]);
  if (cache && cache.games === seasonGames && cache.params === params) return cache.points;
  const points = replayHistory(liveState, seasonGames);
  cache = { games: seasonGames, params, points };
  return points;
}

function replayHistory(liveState: LiveState, seasonGames: readonly SeasonGame[]): RatingPoint[] {
  try {
    const season = liveState.season;
    const games: SeasonGame[] = [...earlierSeasons(season), ...seasonGames];
    games.sort((a, b) => Date.parse(a.tipUtc) - Date.parse(b.tipUtc) || a.id.localeCompare(b.id));

    const points: RatingPoint[] = [];
    let lastDate: string | null = null;
    const result = replayRatings(games, liveState.params, {
      onBeforeGame: (game, state) => {
        if (game.season !== season || game.etDate === lastDate) return;
        // The state before a new date's first game holds every result through the last one.
        points.push({
          date: lastDate ?? game.etDate,
          preseason: lastDate === null,
          ratings: snapshot(state.mean),
        });
        lastDate = game.etDate;
      },
    });
    if (lastDate !== null) points.push({ date: lastDate, preseason: false, ratings: snapshot(result.state.mean) });
    return points;
  } catch (error) {
    console.error("[ratings] history unavailable", error);
    return [];
  }
}
