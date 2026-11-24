// "Biggest moves": the teams whose published playoff odds rose or fell most across one
// slate's games, each beside the final it played.
//
// A date's entry is that slate's last published forecast: the job rewrites the date's
// snapshot on every run of the slate, the season odds count every final so far, and the
// slate rolls at 6 a.m. ET, after the night's games. So an entry already counts its own
// date's games, and the move from one entry to the next comes with the games dated after
// the earlier one, up to the later.
//
// Which two entries: the last two once the latest slate has a final (the move so far
// today). Until then the latest entry differs from the one before only by the morning's
// injury report, so the section would be empty for most of the day, from the roll until
// the first final. In that stretch it shows the slate before instead: the entry before the
// latest against the one before that, with that slate's results, and says which day it is.
// The one computed number is the difference of two published values; the result is
// placed beside the move and never offered as its cause. Display only. Tests:
// tests/odds-moves.test.ts.

import type { OddsHistoryFile } from "@/lib/season/odds-history";
import type { SeasonGame } from "@/lib/season/types";

/** Moves smaller than one percentage point are not shown. */
export const MOVE_MIN_POINTS = 1;
/** At most this many each way. */
export const MOVES_SHOWN = 3;

export type MoveGame = { opponentId: string; won: boolean; teamScore: number; opponentScore: number };

export type OddsMove = {
  teamId: string;
  /** Published playoff odds on the earlier and the later date (`now` is the odds at `to`). */
  before: number;
  now: number;
  /** now − before, in probability (0.042 is 4.2 points), rounded to the published four places. */
  change: number;
  /** The team's last final dated after the earlier date and up to the later one, if any. */
  game: MoveGame | null;
};

export type OddsMoves = {
  from: string;
  to: string;
  /**
   * "since": the latest slate has a final, and `to` is the latest entry (the odds now).
   * "day": it has none yet, and `to` is the slate before, whose games are all in.
   */
  kind: "since" | "day";
  rises: OddsMove[];
  falls: OddsMove[];
};

/** Whether any final is dated after `from` and up to `to`. */
function anyFinalBetween(games: readonly SeasonGame[], from: string, to: string): boolean {
  return games.some(
    (game) => game.etDate > from && game.etDate <= to && game.status === "final" && game.homeScore !== null && game.awayScore !== null,
  );
}

/** The team's last final (by tip) dated after `from` and up to `to`, or null. */
function gameBetween(games: readonly SeasonGame[], teamId: string, from: string, to: string): MoveGame | null {
  const played = games
    .filter(
      (game) =>
        game.etDate > from &&
        game.etDate <= to &&
        game.status === "final" &&
        game.homeScore !== null &&
        game.awayScore !== null &&
        (game.homeId === teamId || game.awayId === teamId),
    )
    .sort((a, b) => Date.parse(a.tipUtc) - Date.parse(b.tipUtc));
  const game = played.at(-1);
  if (!game || game.homeScore === null || game.awayScore === null) return null;
  const home = game.homeId === teamId;
  const teamScore = home ? game.homeScore : game.awayScore;
  const opponentScore = home ? game.awayScore : game.homeScore;
  return { opponentId: home ? game.awayId : game.homeId, won: teamScore > opponentScore, teamScore, opponentScore };
}

/**
 * The biggest playoff-odds moves across one slate (see the header for which), or null when
 * the history is absent, has fewer than two dates, or no move reaches MOVE_MIN_POINTS.
 */
export function oddsMoves(history: OddsHistoryFile | null, games: readonly SeasonGame[]): OddsMoves | null {
  if (!history || history.dates.length < 2) return null;
  const latest = history.dates.length - 1;
  // Before the latest slate's first final, show the slate before it, when the history reaches that far.
  const waiting = latest >= 2 && !anyFinalBetween(games, history.dates[latest - 1], history.dates[latest]);
  const last = waiting ? latest - 1 : latest;
  const from = history.dates[last - 1];
  const to = history.dates[last];
  const before = history.makePlayoffs[last - 1];
  const after = history.makePlayoffs[last];
  const moves: OddsMove[] = history.teamIds.map((teamId, index) => ({
    teamId,
    before: before[index],
    now: after[index],
    // Both inputs carry four places; rounding removes floating-point dust.
    change: Math.round((after[index] - before[index]) * 1e4) / 1e4,
    game: null,
  }));
  const big = moves.filter((move) => Math.abs(move.change) * 100 >= MOVE_MIN_POINTS - 1e-9);
  const pick = (sign: 1 | -1) =>
    big
      .filter((move) => Math.sign(move.change) === sign)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.now - a.now || a.teamId.localeCompare(b.teamId))
      .slice(0, MOVES_SHOWN)
      .map((move) => ({ ...move, game: gameBetween(games, move.teamId, from, to) }));
  const rises = pick(1);
  const falls = pick(-1);
  if (rises.length === 0 && falls.length === 0) return null;
  return { from, to, kind: waiting ? "day" : "since", rises, falls };
}
