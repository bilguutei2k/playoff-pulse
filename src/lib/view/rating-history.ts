// Team ratings by game day, reconstructed with `replayRatings` over every stored
// season (data/season/games from 2005, then the live season), snapshotted after each
// ET date of the live season. This is the rating model without the injury
// adjustment, so it reproduces v1's published ratings exactly; v2 publishes
// full-strength ratings that can differ by a point or so, and the team page says so.
// Computed once per server process and cached; the site rebuilds on every publish.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FIRST_SEASON } from "@/lib/season/formats";
import { liveState } from "@/lib/season/published";
import { replayRatings } from "@/lib/season/ratings";
import { SEASON_TEAMS, teamIndex } from "@/lib/season/teams";
import type { SeasonGame } from "@/lib/season/types";
import { seasonGames } from "@/lib/view/store";

export type RatingPoint = {
  /** ET date after whose games this snapshot was taken; the first point is the season start. */
  date: string;
  preseason: boolean;
  ratings: Record<string, number>;
};

let cache: RatingPoint[] | null = null;

function storedSeason(season: number): SeasonGame[] {
  const file = path.join(process.cwd(), "data", "season", "games", `${season}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SeasonGame[]) : [];
}

function snapshot(mean: ArrayLike<number>): Record<string, number> {
  return Object.fromEntries(SEASON_TEAMS.map((team) => [team.id, mean[teamIndex(team.id)]]));
}

export function ratingHistory(): RatingPoint[] {
  if (cache) return cache;
  try {
    const season = liveState.season;
    const games: SeasonGame[] = [];
    for (let year = FIRST_SEASON; year < season; year += 1) games.push(...storedSeason(year));
    games.push(...seasonGames());
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
    cache = points;
  } catch (error) {
    console.error("[ratings] history unavailable", error);
    cache = [];
  }
  return cache;
}
