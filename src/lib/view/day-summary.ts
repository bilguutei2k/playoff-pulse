// A day's finals as the v8 day page sums them up: each final with its sealed favorite,
// the Brier score for that one game, whether 548's favorite won, how many favorites the
// sealed numbers expected to win, and the biggest miss. The sentence and the chart are
// mechanical (the miss is the upset with the highest Brier), never chosen by hand.
// No new numbers: probabilities are the shown seals', Brier is the record's formula.
//
// Wins and expected wins count the same games: finals whose seal favored a side. A seal
// that splits 50-50 in whole percents has no favorite; it is "even" and counts in
// neither. Day pages only; /record keeps its own figures (lib/view/record-page.ts).
// Tests: tests/view-day-summary.test.ts.

import { teamById } from "@/lib/season/teams";
import { splitPercents } from "@/lib/view/card";
import type { DayGame } from "@/lib/view/day";
import { gameBrier } from "@/lib/view/record";
import { gameHref, teamHref } from "@/lib/view/routes";
import { teamDisplay } from "@/lib/view/teams";

export type FinalRow = {
  game: DayGame;
  homeWon: boolean;
  /** The shown seal's two sides, whole percents adding to 100; null without a seal. */
  percents: { home: number; away: number } | null;
  /** The side the seal favored; null without a seal or on an even split. */
  favorite: { teamId: string; code: string; percent: number } | null;
  /** A seal that split 50-50 in whole percents: no favorite. */
  even: boolean;
  /** The favorite lost. Null without a seal or on an even split. */
  upset: boolean | null;
  brier: number | null;
};

/** A piece of the day sentence: plain text, or text that links somewhere. */
export type SentencePart = { text: string; href?: string };

export type DaySummary = {
  finals: FinalRow[];
  /** Finals with a sealed number, even ones included. */
  scored: FinalRow[];
  /** Scored finals whose seal favored a side: the games won and expected count. */
  decided: number;
  favoritesWon: number;
  /** The sum of the favorites' sealed chances on the decided games. */
  expected: number;
  /** Scored finals with an even seal. */
  even: number;
  sentence: string | null;
  /** The sentence with the biggest miss's game and the favorite's team linked. */
  sentenceParts: SentencePart[] | null;
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
  if (!forecast) return { game, homeWon, percents: null, favorite: null, even: false, upset: null, brier: null };
  const percents = splitPercents(forecast.homeWinProbability);
  const even = percents.home === percents.away;
  const favoriteHome = percents.home > percents.away;
  const favoriteId = favoriteHome ? game.homeId : game.awayId;
  return {
    game,
    homeWon,
    percents,
    favorite: even
      ? null
      : { teamId: favoriteId, code: teamDisplay(favoriteId).code, percent: Math.max(percents.home, percents.away) },
    even,
    upset: even ? null : favoriteHome !== homeWon,
    brier: gameBrier(forecast.homeWinProbability, homeWon),
  };
}

function missParts(row: FinalRow): SentencePart[] {
  const { game } = row;
  const favorite = row.favorite!;
  const winnerId = row.homeWon ? game.homeId : game.awayId;
  const loserId = row.homeWon ? game.awayId : game.homeId;
  const winner = teamPlace(winnerId);
  const loser = teamDisplay(loserId).shortName;
  const where = game.neutral
    ? `win over the ${loser}`
    : row.homeWon
      ? `home win over the ${loser}`
      : `win in ${teamPlace(game.homeId)}`;
  return [
    { text: "The biggest miss was " },
    { text: `${winner}'s ${where}`, href: gameHref(game.id) },
    { text: ", where 548 gave the " },
    { text: teamDisplay(favorite.teamId).shortName, href: teamHref(favorite.teamId) },
    { text: ` ${favorite.percent}%.` },
  ];
}

export function daySummary(games: readonly DayGame[]): DaySummary {
  const finals = games.flatMap((game) => {
    const row = finalRow(game);
    return row ? [row] : [];
  });
  const scored = finals.filter((row) => row.percents !== null);
  const decidedRows = scored.filter((row) => row.favorite !== null);
  const favoritesWon = decidedRows.filter((row) => row.upset === false).length;
  const expected = decidedRows.reduce((sum, row) => {
    const p = row.game.forecast!.homeWinProbability;
    return sum + Math.max(p, 1 - p);
  }, 0);
  let sentenceParts: SentencePart[] | null = null;
  if (decidedRows.length > 0) {
    const misses = decidedRows.filter((row) => row.upset).sort((a, b) => (b.brier ?? 0) - (a.brier ?? 0));
    const lead =
      favoritesWon === decidedRows.length
        ? decidedRows.length === 1
          ? "548's favorite won."
          : decidedRows.length === 2
            ? "Both favorites won."
            : `All ${decidedRows.length} favorites won.`
        : `Favorites won ${favoritesWon} of ${decidedRows.length}.`;
    sentenceParts = misses.length > 0 ? [{ text: `${lead} ` }, ...missParts(misses[0])] : [{ text: lead }];
  }
  return {
    finals,
    scored,
    decided: decidedRows.length,
    favoritesWon,
    expected,
    even: scored.length - decidedRows.length,
    sentence: sentenceParts ? sentenceParts.map((part) => part.text).join("") : null,
    sentenceParts,
  };
}
