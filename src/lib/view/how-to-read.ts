// The sentences that explain 548's tile and the "Out" figure, in one place. The "How to
// read a card" section at the foot of the day pages, the key above the cards, and the
// tooltips on the cards and the game page all reuse them word for word, so a reader
// meets one explanation and the claims ledger review covers one text.

import type { TileKind } from "@/lib/view/bracket";

/** Each tile style and what it means, as the day page's key and tooltips say it. */
export const TILE_GLYPHS: Record<TileKind, { word: string; text: string }> = {
  sealed: { word: "Solid", text: "sealed before tip and scored." },
  live: { word: "Outline", text: "the live estimate, from the score and the clock." },
  dash: { word: "Dashed", text: "never scored (a provisional number or a projection)." },
};

export const SEALS_SENTENCE =
  "Each game is sealed in the morning and again in the hour before tip; the final seal is the one scored.";

/** The "Tile" entry of "How to read a card": the three styles, then how sealing works. */
export const TILE_DEFINITION = `${TILE_GLYPHS.sealed.word}: ${TILE_GLYPHS.sealed.text} ${TILE_GLYPHS.live.word}: ${TILE_GLYPHS.live.text} ${TILE_GLYPHS.dash.word}: ${TILE_GLYPHS.dash.text} ${SEALS_SENTENCE}`;

/** The "Out" entry: what the points beside a team code are, and what is not modeled. */
export const OUT_DEFINITION =
  "Points of margin each side gives up to players on the NBA injury report, weighted by status. A team that has not filed counts the players who missed its last game. Unknown future injuries, minutes shifting to teammates and matchups are not modeled.";

/** "Sealed before tip and scored. Each game is sealed…": one tile's meaning as a tooltip. */
export function tileHelp(kind: TileKind): string {
  const { text } = TILE_GLYPHS[kind];
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return kind === "sealed" ? `${sentence} ${SEALS_SENTENCE}` : sentence;
}
