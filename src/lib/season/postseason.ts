// Phase detection and observed postseason facts, derived only from real games.
// Matchups come from ESPN's notes and team pairs, never from date order, because
// play-in games do not follow a fixed order.

import { seasonFormat } from "@/lib/season/formats";
import { buildStandings, seedConference } from "@/lib/season/standings";
import { SEASON_TEAMS, teamById, teamIndex } from "@/lib/season/teams";
import type { ObservedPostseason, ObservedSeries } from "@/lib/season/simulate";
import type { Conference, SeasonGame, SeasonPhase } from "@/lib/season/types";

const CONFERENCES: Conference[] = ["East", "West"];
const WINS_NEEDED = 4;

function isUnfinished(game: SeasonGame): boolean {
  return game.status === "scheduled" || game.status === "in-progress";
}

function winnerOf(game: SeasonGame): string {
  return (game.homeScore as number) > (game.awayScore as number) ? game.homeId : game.awayId;
}

function loserOf(game: SeasonGame): string {
  return winnerOf(game) === game.homeId ? game.awayId : game.homeId;
}

function isStarted(game: SeasonGame): boolean {
  return game.status === "final" || game.status === "in-progress";
}

/** Whether all regular-season games are done. */
function regularSeasonComplete(games: readonly SeasonGame[], season: number): boolean {
  const postseasonStarted = games.some(
    (game) => (game.kind === "play-in" || game.kind === "playoff") && isStarted(game),
  );
  if (games.some((game) => game.kind === "regular" && isUnfinished(game))) return false;
  if (postseasonStarted) return true;
  const { gamesPerTeam } = seasonFormat(season);
  const table = buildStandings(games);
  // A team short of its total is waiting on a game the league has not rescheduled.
  return SEASON_TEAMS.every(
    (_, index) => table.wins[index] + table.losses[index] >= gamesPerTeam,
  );
}

function playInComplete(games: readonly SeasonGame[]): boolean {
  return CONFERENCES.every((conference) =>
    games.some(
      (game) =>
        game.kind === "play-in" &&
        game.conference === conference &&
        game.playIn === "8-seed" &&
        game.status === "final",
    ),
  );
}

export function detectPhase(games: readonly SeasonGame[], season: number): SeasonPhase {
  if (!regularSeasonComplete(games, season)) return "regular-season";
  const { series } = groupSeries(games);
  const finals = series.find((row) => row.round === "finals");
  if (finals && (finals.winsA >= WINS_NEEDED || finals.winsB >= WINS_NEEDED)) {
    return "complete";
  }
  if (seasonFormat(season).playIn && series.length === 0 && !playInComplete(games)) {
    return "play-in";
  }
  return "playoffs";
}

type GroupedSeries = {
  round: NonNullable<SeasonGame["round"]>;
  a: string;
  b: string;
  winsA: number;
  winsB: number;
  firstHomeId: string;
};

function groupSeries(games: readonly SeasonGame[]): { series: GroupedSeries[] } {
  const byPair = new Map<string, GroupedSeries & { firstTip: number }>();
  for (const game of games) {
    if (game.kind !== "playoff") continue;
    if (game.status === "postponed" || game.status === "canceled") continue;
    if (!game.round) {
      throw new Error(`Playoff game ${game.id} has no identifiable round.`);
    }
    const [a, b] = [game.homeId, game.awayId].sort();
    const key = `${a}-${b}`;
    const tip = Date.parse(game.tipUtc);
    const entry =
      byPair.get(key) ??
      {
        round: game.round,
        a,
        b,
        winsA: 0,
        winsB: 0,
        firstHomeId: game.homeId,
        firstTip: tip,
      };
    if (tip < entry.firstTip) {
      entry.firstTip = tip;
      entry.firstHomeId = game.homeId;
    }
    if (game.status === "final") {
      if (winnerOf(game) === a) entry.winsA += 1;
      else entry.winsB += 1;
    }
    byPair.set(key, entry);
  }
  return { series: [...byPair.values()] };
}

/** Facts about the postseason so far. Requires a finished regular season. */
export function buildObservedPostseason(games: readonly SeasonGame[]): ObservedPostseason {
  const table = buildStandings(games);
  const seeds = {
    East: seedConference("East", table),
    West: seedConference("West", table),
  };
  const playInFinal: ObservedPostseason["playInFinal"] = {};
  const playInResults: ObservedPostseason["playInResults"] = {};
  for (const conference of CONFERENCES) {
    const playIn = games.filter(
      (game) =>
        game.kind === "play-in" && game.conference === conference && game.status === "final",
    );
    const sevenEight = playIn.find((game) => game.playIn === "7v8");
    const nineTen = playIn.find((game) => game.playIn === "9v10");
    const eightSeed = playIn.find((game) => game.playIn === "8-seed");
    playInResults[conference] = {
      ...(sevenEight ? { sevenEightWinner: teamIndex(winnerOf(sevenEight)) } : {}),
      ...(nineTen ? { nineTenWinner: teamIndex(winnerOf(nineTen)) } : {}),
    };
    playInFinal[conference] = {
      ...(sevenEight ? { seven: teamIndex(winnerOf(sevenEight)) } : {}),
      ...(eightSeed ? { eight: teamIndex(winnerOf(eightSeed)) } : {}),
    };
    if (sevenEight && eightSeed) {
      // Rule check: the 7v8 loser always hosts the 8-seed game.
      if (eightSeed.homeId !== loserOf(sevenEight)) {
        throw new Error(
          `${conference} play-in: expected the 7v8 loser to host the 8-seed game ${eightSeed.id}.`,
        );
      }
    }
  }

  const series: ObservedSeries[] = groupSeries(games).series.map((row) => {
    const teamA = teamIndex(row.a);
    const teamB = teamIndex(row.b);
    const conferenceA = teamById(row.a).conference;
    const conferenceB = teamById(row.b).conference;
    return {
      round: row.round,
      conference: conferenceA === conferenceB ? conferenceA : "Finals",
      teamA,
      teamB,
      winsA: row.winsA,
      winsB: row.winsB,
      homeCourt: teamIndex(row.firstHomeId),
    };
  });

  return { seeds, playInFinal, playInResults, series };
}

export type EspnSeed = { teamId: string; playoffSeed: number | null };

/**
 * Compares our seeds 1-10 to ESPN's. Valid only after every regular game is final
 * and before any play-in game starts, since ESPN's seed then reflects the play-in.
 */
export function crossCheckSeeds(
  espn: readonly EspnSeed[],
  games: readonly SeasonGame[],
): string[] {
  const table = buildStandings(games);
  const problems: string[] = [];
  for (const conference of CONFERENCES) {
    seedConference(conference, table)
      .slice(0, 10)
      .forEach((index, position) => {
        const team = SEASON_TEAMS[index];
        const row = espn.find((entry) => entry.teamId === team.id);
        if (row?.playoffSeed !== position + 1) {
          problems.push(
            `${conference}: ours has ${team.abbreviation} seeded ${position + 1}, ESPN has ${row?.playoffSeed ?? "none"}`,
          );
        }
      });
  }
  return problems;
}

/**
 * A completed season as it looked before `etDate`. Later results are hidden, and
 * postseason games that nobody could know about yet are removed. Used by the replay
 * harness to run the live logic over real past postseasons with a frozen clock.
 */
export function seasonAsOf(
  games: readonly SeasonGame[],
  etDate: string,
  options: { includeSlate?: boolean } = {},
): SeasonGame[] {
  const isKnownDate = (date: string) =>
    options.includeSlate ? date <= etDate : date < etDate;
  const startedPairs = new Set<string>();
  for (const game of games) {
    if (game.kind === "playoff" && isKnownDate(game.etDate)) {
      startedPairs.add([game.homeId, game.awayId].sort().join("-"));
    }
  }
  const visible: SeasonGame[] = [];
  for (const game of games) {
    if (game.kind === "play-in" && !isKnownDate(game.etDate)) continue;
    if (
      game.kind === "playoff" &&
      !startedPairs.has([game.homeId, game.awayId].sort().join("-"))
    ) {
      continue;
    }
    visible.push(
      game.status === "final" && game.etDate >= etDate
        ? { ...game, status: "scheduled", homeScore: null, awayScore: null }
        : game,
    );
  }
  return visible;
}
