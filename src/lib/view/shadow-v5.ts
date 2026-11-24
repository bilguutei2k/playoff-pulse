// The /record page's lines for the second shadow model v5 (registration-v5.md, "Wiring as
// built"). In testing, never the published forecast, and never compared as better or worse
// (docs/claims-ledger.md, "On-court model v5"). Pure.

import type { ShadowV5View } from "@/lib/live-data/published";
import { formatShortDay } from "@/lib/utils/dates";
import { SMALL_SAMPLE_GAMES, SMALL_SAMPLE_LABEL } from "@/lib/view/record";

export const SHADOW_V5_HEADING = "In testing: model v5 (v4 plus an on-court observation)";

export type ShadowV5Lines = {
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
  /** v5, v4, v2 and v1 on the games all four have scored, or null when there are none. */
  sameGames: { games: number; rows: Array<{ label: string; brier: string; logLoss: string }> } | null;
};

const metric = (value: number | null) => (value === null ? "–" : value.toFixed(3));

/**
 * The section's text, or null when nothing should render: no shadow file, or v5 has no first
 * seal date (`V5_FIRST_ET_DATE` null). After the stop switch is set, the lead names both dates.
 */
export function shadowV5Lines(view: ShadowV5View | null, firstEtDate: string | null): ShadowV5Lines | null {
  if (!view || firstEtDate === null) return null;
  const since = formatShortDay(view.firstEtDate);
  const sealing =
    view.lastEtDate === null
      ? `Sealing since ${since}`
      : `Sealed from ${since} to ${formatShortDay(view.lastEtDate)}, then stopped`;
  const { record, sameGames } = view;
  if (record.scored === 0) {
    return {
      heading: SHADOW_V5_HEADING,
      lead: `${sealing}; no scored games yet. Not the published forecast.`,
      scored: null,
      sameGames: null,
    };
  }
  return {
    heading: SHADOW_V5_HEADING,
    lead: `${sealing}. Not the published forecast.`,
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
              { label: "v5", brier: metric(sameGames.v5.brier), logLoss: metric(sameGames.v5.logLoss) },
              { label: "v4", brier: metric(sameGames.v4.brier), logLoss: metric(sameGames.v4.logLoss) },
              { label: "v2", brier: metric(sameGames.v2.brier), logLoss: metric(sameGames.v2.logLoss) },
              { label: "v1", brier: metric(sameGames.v1.brier), logLoss: metric(sameGames.v1.logLoss) },
            ],
          }
        : null,
  };
}
