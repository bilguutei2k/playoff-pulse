// The /record page's lines for the shadow model v4 (registration-v4.md, W2). In testing,
// never the published forecast, and never compared as better or worse
// (docs/claims-ledger.md, "Roster-state model v4"). Pure.

import type { ShadowV4View } from "@/lib/live-data/published";
import { formatShortDay } from "@/lib/utils/dates";
import { SMALL_SAMPLE_GAMES, SMALL_SAMPLE_LABEL } from "@/lib/view/record";

export const SHADOW_V4_HEADING = "In testing: roster-state model v4";

export type ShadowV4Lines = {
  heading: string;
  lead: string;
  /** Null until a game is scored: the lead says so. */
  scored: {
    games: number;
    brier: string;
    logLoss: string;
    /** Below 500 scored games, the site's small-sample label; else null. */
    smallSample: string | null;
  } | null;
  /** v4, v2 and v1 on the games all three have scored, or null when there are none. */
  sameGames: { games: number; rows: Array<{ label: string; brier: string; logLoss: string }> } | null;
};

const metric = (value: number | null) => (value === null ? "–" : value.toFixed(3));

/**
 * The section's text, or null when nothing should render: no shadow file, or v4 has no
 * first seal date yet (`V4_FIRST_ET_DATE` null).
 */
export function shadowV4Lines(view: ShadowV4View | null, firstEtDate: string | null): ShadowV4Lines | null {
  if (!view || firstEtDate === null) return null;
  const since = formatShortDay(view.firstEtDate);
  const { record, sameGames } = view;
  if (record.scored === 0) {
    return {
      heading: SHADOW_V4_HEADING,
      lead: `Sealing since ${since}; no scored games yet. Not the published forecast.`,
      scored: null,
      sameGames: null,
    };
  }
  return {
    heading: SHADOW_V4_HEADING,
    lead: `Sealing since ${since}. Not the published forecast.`,
    scored: {
      games: record.scored,
      brier: metric(record.brier),
      logLoss: metric(record.logLoss),
      smallSample: record.scored < SMALL_SAMPLE_GAMES ? SMALL_SAMPLE_LABEL(record.scored) : null,
    },
    sameGames:
      sameGames.games > 0
        ? {
            games: sameGames.games,
            rows: [
              { label: "v4", brier: metric(sameGames.v4.brier), logLoss: metric(sameGames.v4.logLoss) },
              { label: "v2", brier: metric(sameGames.v2.brier), logLoss: metric(sameGames.v2.logLoss) },
              { label: "v1", brier: metric(sameGames.v1.brier), logLoss: metric(sameGames.v1.logLoss) },
            ],
          }
        : null,
  };
}
