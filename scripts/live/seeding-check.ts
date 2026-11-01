// S4: seeds computed from real results against what actually happened. Seeds 1-6
// come from ESPN's final playoffSeed. Seeds 7-10 come from play-in pairings,
// because ESPN's final playoffSeed already includes the play-in result.

import * as fs from "node:fs";
import * as path from "node:path";
import { buildStandings, seedConference } from "../../src/lib/season/standings";
import { SEASON_TEAMS, teamIndex } from "../../src/lib/season/teams";
import type { Conference } from "../../src/lib/season/types";
import { loadSeasonGames } from "./game-store";

type StandingRow = { teamId: string; playoffSeed: number | null };

export type SeedingMismatch = {
  season: number;
  conference: Conference;
  seed: number;
  computed: string;
  actual: string;
};

export function runSeedingCheck(): { checked: number; mismatches: SeedingMismatch[] } {
  const standings = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data/season/final-standings.json"), "utf-8"),
  ) as Record<string, StandingRow[]>;
  const mismatches: SeedingMismatch[] = [];
  let checked = 0;
  for (let season = 2022; season <= 2026; season += 1) {
    const games = loadSeasonGames(season);
    const table = buildStandings(games);
    for (const conference of ["East", "West"] as Conference[]) {
      const computed = seedConference(conference, table).map(
        (index) => SEASON_TEAMS[index].id,
      );
      const actual = new Map<number, string>();
      for (const row of standings[season]) {
        const team = SEASON_TEAMS[teamIndex(row.teamId)];
        if (team.conference !== conference || row.playoffSeed === null) continue;
        if (row.playoffSeed <= 6) actual.set(row.playoffSeed, row.teamId);
      }
      const playIn = games.filter(
        (game) => game.kind === "play-in" && game.conference === conference,
      );
      const sevenEight = playIn.find((game) => game.playIn === "7v8");
      const nineTen = playIn.find((game) => game.playIn === "9v10");
      if (!sevenEight || !nineTen) {
        throw new Error(`${season} ${conference}: play-in games not identified from notes.`);
      }
      actual.set(7, sevenEight.homeId);
      actual.set(8, sevenEight.awayId);
      actual.set(9, nineTen.homeId);
      actual.set(10, nineTen.awayId);
      for (let seed = 1; seed <= 10; seed += 1) {
        checked += 1;
        const want = actual.get(seed);
        if (want !== computed[seed - 1]) {
          mismatches.push({
            season,
            conference,
            seed,
            computed: SEASON_TEAMS[teamIndex(computed[seed - 1])].abbreviation,
            actual: want ? SEASON_TEAMS[teamIndex(want)].abbreviation : "none",
          });
        }
      }
    }
  }
  return { checked, mismatches };
}

if (process.argv[1]?.endsWith("seeding-check.ts")) {
  const result = runSeedingCheck();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.mismatches.length === 0 ? 0 : 1);
}
