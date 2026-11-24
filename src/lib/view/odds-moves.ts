// "Biggest moves": the teams whose published playoff odds rose or fell most between the
// odds history's last two dates, each beside the final it played in between.
//
// A date's entry is that slate's last published forecast: the job rewrites the date's
// snapshot on every run of the slate, the season odds count every final so far, and the
// slate rolls at 6 a.m. ET, after the night's games. So the earlier date's entry already
// counts that date's games, and the move to the latest entry comes with the games played
// after it: those dated after the earlier date, up to the latest (today's finals so far).
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
  /** Published playoff odds on the earlier and the later date. */
  before: number;
  now: number;
  /** now − before, in probability (0.042 is 4.2 points), rounded to the published four places. */
  change: number;
  /** The team's last final dated after the earlier date and up to the later one, if any. */
  game: MoveGame | null;
};

export type OddsMoves = { from: string; to: string; rises: OddsMove[]; falls: OddsMove[] };

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
 * The biggest playoff-odds moves between the history's last two dates, or null when the
 * history is absent, has fewer than two dates, or no move reaches MOVE_MIN_POINTS.
 */
export function oddsMoves(history: OddsHistoryFile | null, games: readonly SeasonGame[]): OddsMoves | null {
  if (!history || history.dates.length < 2) return null;
  const last = history.dates.length - 1;
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
  return { from, to, rises, falls };
}
