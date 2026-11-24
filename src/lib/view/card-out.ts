// Who a game card names beside each side's "Out" figure: the one or two largest
// absences from the shown number's own drivers (the seal's, or the projection's), then
// how many more are listed. Picking and wording only: no new number, and the names are
// the ones the game page lists for the same number. Like the card line /how-it-works
// describes, only players listed out, doubtful or questionable (or counted out because
// they missed the last game) are named or counted; probable and available never are.
// Tests: tests/view-card-out.test.ts.

import type { StatusCode } from "@/lib/season/availability";
import { surname } from "@/lib/utils/injuries";
import type { AbsencePlayer, AbsenceSide, AbsenceSides } from "@/lib/view/injuries";
import { teamDisplay } from "@/lib/view/teams";

/** At most this many names a side. */
export const CARD_OUT_NAMED = 2;

/**
 * A second name is added only while the two printed names together stay within this
 * many characters, so a side's line fits beside the market on a desktop card and the
 * card grows by one line at most there; a long single name stands alone.
 */
export const CARD_OUT_CHARS = 20;

/** A side's figure prints from this many points (the card's "Out" rule in bracket.ts). */
const SHOWN_POINTS = 0.05;

/** The status letter a named player carries; out (or counted out) carries none. */
export type CardOutStatus = "D" | "Q";

export type CardOutName = {
  athleteId: string | null;
  /** As printed: the surname, or "J. Williams" when two named teammates share one. */
  name: string;
  /** "First Last", for a tooltip or a label. */
  fullName: string;
  status: CardOutStatus | null;
};

export type CardOutSide = {
  teamId: string;
  code: string;
  names: CardOutName[];
  /** Other players listed out, doubtful or questionable (or counted out) on this side. */
  more: number;
};

const STATUS_WORDS: Record<CardOutStatus, string> = { D: "Doubtful", Q: "Questionable" };

/** "Questionable" for the letter's tooltip. */
export function cardOutStatusWord(status: CardOutStatus): string {
  return STATUS_WORDS[status];
}

/** Out, doubtful, questionable, or counted out because he missed the last game. */
function injured(player: AbsencePlayer): boolean {
  return player.status === null || player.status === "O" || player.status === "D" || player.status === "Q";
}

function letter(status: StatusCode | null): CardOutStatus | null {
  return status === "D" || status === "Q" ? status : null;
}

/** One side's names, or null when the card prints no figure for it or nobody is listed. */
export function cardOutSide(side: AbsenceSide): CardOutSide | null {
  if (side.points < SHOWN_POINTS) return null;
  const listed = side.players.filter(injured);
  // Players with stored points, largest first (stable for ties); the rest have none to rank.
  const ranked = listed
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.points !== null)
    .sort((a, b) => b.player.points! - a.player.points! || a.index - b.index)
    .map(({ player }) => player);
  const named: AbsencePlayer[] = [];
  for (const player of ranked) {
    if (named.length >= CARD_OUT_NAMED) break;
    if (named.length > 0) {
      const chars = [...named, player].reduce((sum, item) => sum + surname(item.name).length, 0);
      if (chars > CARD_OUT_CHARS) break;
    }
    named.push(player);
  }
  if (named.length === 0) return null;
  const surnames = named.map((player) => surname(player.name));
  const names = named.map((player, index) => {
    const shared = surnames.filter((name) => name === surnames[index]).length > 1;
    const initial = player.name.trim().charAt(0);
    return {
      athleteId: player.athleteId,
      name: shared && initial ? `${initial}. ${surnames[index]}` : surnames[index],
      fullName: player.name,
      status: letter(player.status),
    };
  });
  return { teamId: side.teamId, code: teamDisplay(side.teamId).code, names, more: listed.length - named.length };
}

/** Both sides' names keyed by team code, for the card's "Out" row; empty without the injury term. */
export function cardOutNames(sides: AbsenceSides | null): Record<string, CardOutSide> {
  const result: Record<string, CardOutSide> = {};
  if (!sides) return result;
  for (const side of [sides.away, sides.home]) {
    const named = cardOutSide(side);
    if (named) result[named.code] = named;
  }
  return result;
}

/**
 * What the key above the cards needs: whether any card prints an "Out" figure, and
 * which status letters the named players carry, in the key's order.
 */
export function cardOutKey(games: ReadonlyArray<{ absences: AbsenceSides | null }>): {
  any: boolean;
  statuses: CardOutStatus[];
} {
  let any = false;
  const seen = new Set<CardOutStatus>();
  for (const game of games) {
    if (!game.absences) continue;
    for (const side of [game.absences.away, game.absences.home]) {
      if (side.points >= SHOWN_POINTS) any = true;
      for (const name of cardOutSide(side)?.names ?? []) if (name.status) seen.add(name.status);
    }
  }
  return { any, statuses: (["Q", "D"] as const).filter((status) => seen.has(status)) };
}
