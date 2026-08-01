import type { HistoricalRound } from "@/lib/backtest/types";

export type HistoricalSeriesFormatId =
  | "best_of_five_2_2_1"
  | "best_of_seven_2_2_1_1_1"
  | "best_of_seven_2_3_2";

export type HistoricalSeriesFormat = {
  id: HistoricalSeriesFormatId;
  label: "Best-of-5, 2-2-1" | "Best-of-7, 2-2-1-1-1" | "Best-of-7, 2-3-2";
  winsRequired: 3 | 4;
};

const SERIES_FORMATS: Record<HistoricalSeriesFormatId, HistoricalSeriesFormat> = {
  best_of_five_2_2_1: {
    id: "best_of_five_2_2_1",
    label: "Best-of-5, 2-2-1",
    winsRequired: 3,
  },
  best_of_seven_2_2_1_1_1: {
    id: "best_of_seven_2_2_1_1_1",
    label: "Best-of-7, 2-2-1-1-1",
    winsRequired: 4,
  },
  best_of_seven_2_3_2: {
    id: "best_of_seven_2_3_2",
    label: "Best-of-7, 2-3-2",
    winsRequired: 4,
  },
};

const HOME_SEQUENCE_BY_FORMAT: Record<
  HistoricalSeriesFormatId,
  readonly ("home-court" | "opponent")[]
> = {
  best_of_five_2_2_1: [
    "home-court",
    "home-court",
    "opponent",
    "opponent",
    "home-court",
  ],
  best_of_seven_2_2_1_1_1: [
    "home-court",
    "home-court",
    "opponent",
    "opponent",
    "home-court",
    "opponent",
    "home-court",
  ],
  best_of_seven_2_3_2: [
    "home-court",
    "home-court",
    "opponent",
    "opponent",
    "opponent",
    "home-court",
    "home-court",
  ],
};

type FormatEra = {
  firstSeason: number;
  lastSeason: number;
  rounds: Record<HistoricalRound, HistoricalSeriesFormatId>;
};

// This table is deliberately season-and-round keyed. Boundary changes are
// documented with primary sources in docs/series-format-provenance.md.
const FORMAT_ERAS: readonly FormatEra[] = [
  {
    firstSeason: 1984,
    lastSeason: 1984,
    rounds: {
      "First Round": "best_of_five_2_2_1",
      "Conference Semifinal": "best_of_seven_2_2_1_1_1",
      "Conference Final": "best_of_seven_2_2_1_1_1",
      "NBA Finals": "best_of_seven_2_2_1_1_1",
    },
  },
  {
    firstSeason: 1985,
    lastSeason: 2002,
    rounds: {
      "First Round": "best_of_five_2_2_1",
      "Conference Semifinal": "best_of_seven_2_2_1_1_1",
      "Conference Final": "best_of_seven_2_2_1_1_1",
      "NBA Finals": "best_of_seven_2_3_2",
    },
  },
  {
    firstSeason: 2003,
    lastSeason: 2013,
    rounds: {
      "First Round": "best_of_seven_2_2_1_1_1",
      "Conference Semifinal": "best_of_seven_2_2_1_1_1",
      "Conference Final": "best_of_seven_2_2_1_1_1",
      "NBA Finals": "best_of_seven_2_3_2",
    },
  },
  {
    firstSeason: 2014,
    lastSeason: 2026,
    rounds: {
      "First Round": "best_of_seven_2_2_1_1_1",
      "Conference Semifinal": "best_of_seven_2_2_1_1_1",
      "Conference Final": "best_of_seven_2_2_1_1_1",
      "NBA Finals": "best_of_seven_2_2_1_1_1",
    },
  },
] as const;

export function historicalSeriesFormat(
  season: number,
  round: HistoricalRound,
): HistoricalSeriesFormat {
  const eras = FORMAT_ERAS.filter(
    (era) => season >= era.firstSeason && season <= era.lastSeason,
  );

  if (eras.length !== 1) {
    throw new Error(
      `Expected exactly one registered series-format era for ${season} ${round}; found ${eras.length}.`,
    );
  }

  return SERIES_FORMATS[eras[0].rounds[round]];
}

export function homePatternForHistoricalFormat(
  format: HistoricalSeriesFormat,
  homeCourtTeam: string,
  opponent: string,
): string[] {
  return HOME_SEQUENCE_BY_FORMAT[format.id].map((host) =>
    host === "home-court" ? homeCourtTeam : opponent,
  );
}
