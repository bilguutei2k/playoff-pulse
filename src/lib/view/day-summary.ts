// A day's finals as the v8 day page sums them up: each final with its sealed pick, the
// Brier score for that one game, whether 548's favorite won, how many favorites the
// sealed numbers expected to win, and the biggest miss. The sentence and the chart are
// mechanical (the miss is the upset with the highest Brier), never chosen by hand.
// No new numbers: probabilities are the shown seals', Brier is the record's formula.

import { teamById } from "@/lib/season/teams";
import { splitPercents } from "@/lib/view/card";
import type { DayGame } from "@/lib/view/day";
import { gameBrier } from "@/lib/view/record";
import { teamDisplay } from "@/lib/view/teams";

export type FinalRow = {
  game: DayGame;
  homeWon: boolean;
  /** The shown seal's two sides, whole percents adding to 100; null without a seal. */
  percents: { home: number; away: number } | null;
  /** 548's sealed pick: the side the seal favored (home on an even split). */
  pick: { teamId: string; code: string; percent: number } | null;
  /** The pick lost. Null without a seal or on an even split. */
  upset: boolean | null;
  brier: number | null;
};

export type DaySummary = {
  finals: FinalRow[];
  /** Finals with a sealed number. */
  scored: FinalRow[];
  favoritesWon: number;
  /** The sum of the sealed favorites' chances: how many the numbers expected to win. */
  expected: number;
  sentence: string | null;
};

/** "Sacramento" from "Sacramento Kings": the name without the nickname. */
export function teamPlace(teamId: string): string {
  const team = teamById(teamId);
  const place = team.name.endsWith(team.shortName) ? team.name.slice(0, -team.shortName.length).trim() : "";
  return place || team.name;
}

export function finalRow(game: DayGame): FinalRow | null {
  if (game.status !== "final" || game.homeScore === null || game.awayScore === null) return null;
  const homeWon = game.homeScore > game.awayScore;
  const forecast = game.forecast?.source === "sealed" ? game.forecast : null;
  if (!forecast) return { game, homeWon, percents: null, pick: null, upset: null, brier: null };
  const percents = splitPercents(forecast.homeWinProbability);
  const pickHome = percents.home >= percents.away;
  const pickId = pickHome ? game.homeId : game.awayId;
  return {
    game,
    homeWon,
    percents,
    pick: { teamId: pickId, code: teamDisplay(pickId).code, percent: Math.max(percents.home, percents.away) },
    upset: percents.home === percents.away ? null : pickHome !== homeWon,
    brier: gameBrier(forecast.homeWinProbability, homeWon),
  };
}

function missSentence(row: FinalRow): string {
  const { game } = row;
  const winnerId = row.homeWon ? game.homeId : game.awayId;
  const loserId = row.homeWon ? game.awayId : game.homeId;
  const winner = teamPlace(winnerId);
  const loser = teamDisplay(loserId).shortName;
  const where = game.neutral
    ? `win over the ${loser}`
    : row.homeWon
      ? `home win over the ${loser}`
      : `win in ${teamPlace(game.homeId)}`;
  return `The biggest miss was ${winner}'s ${where}, where 548 gave the ${teamDisplay(row.pick!.teamId).shortName} ${row.pick!.percent}%.`;
}

export function daySummary(games: readonly DayGame[]): DaySummary {
  const finals = games.flatMap((game) => {
    const row = finalRow(game);
    return row ? [row] : [];
  });
  const scored = finals.filter((row) => row.pick !== null);
  const decided = scored.filter((row) => row.upset !== null);
  const favoritesWon = decided.filter((row) => row.upset === false).length;
  const expected = scored.reduce((sum, row) => {
    const p = row.game.forecast!.homeWinProbability;
    return sum + Math.max(p, 1 - p);
  }, 0);
  let sentence: string | null = null;
  if (decided.length > 0) {
    const misses = decided.filter((row) => row.upset).sort((a, b) => (b.brier ?? 0) - (a.brier ?? 0));
    const lead =
      favoritesWon === decided.length
        ? decided.length === 1
          ? "548's favorite won."
          : decided.length === 2
            ? "Both favorites won."
            : `All ${decided.length} favorites won.`
        : `Favorites won ${favoritesWon} of ${decided.length}.`;
    sentence = misses.length > 0 ? `${lead} ${missSentence(misses[0])}` : lead;
  }
  return { finals, scored, favoritesWon, expected, sentence };
}
