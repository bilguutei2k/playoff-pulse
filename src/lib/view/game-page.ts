// The v8 game page's charts as plain data: the margin number line, the "where the
// margin comes from" waterfall, the seals over the day, and each team's season line.
// Display bookkeeping only: every number is a seal's, a projection's, the stored
// market line's, the published forecast's or a final score. Orientation flips a sign
// so the side 548 favors reads positive; nothing is recomputed.

import { sealKindOf } from "@/lib/season/live-state";
import type { SealRow, TeamForecast } from "@/lib/season/types";
import { cardClock, type BracketView } from "@/lib/view/bracket";
import { splitPercents } from "@/lib/view/card";
import type { DayGame } from "@/lib/view/day";
import type { GameDetail } from "@/lib/view/game";
import type { MarginBreakdown, MarginPart } from "@/lib/view/margin";
import { teamDisplay } from "@/lib/view/teams";

/** The side whose margin and chance read positive: the one the shown number favors. */
export function orientationTeam(game: DayGame): { teamId: string; otherId: string; sign: 1 | -1 } {
  const margin = game.forecast?.expectedMargin ?? game.projection?.expectedMargin ?? null;
  const probability = game.forecast?.homeWinProbability ?? game.projection?.homeWinProbability ?? null;
  const homeFavored = margin !== null ? margin >= 0 : probability !== null ? probability >= 0.5 : true;
  return homeFavored
    ? { teamId: game.homeId, otherId: game.awayId, sign: 1 }
    : { teamId: game.awayId, otherId: game.homeId, sign: -1 };
}

/** "+12.8", "−3.0", "Even". */
export function signedPoints(value: number): string {
  if (Math.abs(value) < 0.05) return "Even";
  // Score margins are whole points; model margins and spreads keep one decimal.
  const size = Number.isInteger(value) ? String(Math.abs(value)) : Math.abs(value).toFixed(1);
  return `${value > 0 ? "+" : "−"}${size}`;
}

/** The large header's tile label carries its seal time: "sealed 6:30 PM". */
export function headerBracket(view: BracketView, game: DayGame): BracketView {
  const { tile } = view;
  const forecast = game.forecast;
  if (tile.kind !== "sealed" || !forecast?.issuedAt || forecast.source !== "sealed") return view;
  if (!["sealed", "morning seal", "reissued"].includes(tile.label)) return view;
  return { ...view, tile: { ...tile, label: `${tile.label} ${cardClock(forecast.issuedAt)}` } };
}

export type MarginMark = { key: "model" | "market" | "final" | "now"; value: number; label: string };

export type MarginLine = {
  teamId: string;
  otherId: string;
  min: number;
  max: number;
  ticks: number[];
  marks: MarginMark[];
};

/**
 * 548's expected margin, the market's spread (never beside a projection) and the final
 * or current score margin, in points toward the favored side. The axis starts at −10
 * to +20 and widens in steps of 5 to fit every mark.
 */
export function marginLine(game: DayGame): MarginLine | null {
  const model = game.forecast?.expectedMargin ?? game.projection?.expectedMargin ?? null;
  if (model === null) return null;
  const { teamId, otherId, sign } = orientationTeam(game);
  const marks: MarginMark[] = [{ key: "model", value: model * sign, label: "548" }];
  const spread = game.projection ? null : (game.marketLine?.homeSpread ?? null);
  if (spread !== null) marks.push({ key: "market", value: -spread * sign, label: "market" });
  if ((game.status === "final" || game.status === "in-progress") && game.homeScore !== null && game.awayScore !== null) {
    marks.push({
      key: game.status === "final" ? "final" : "now",
      value: (game.homeScore - game.awayScore) * sign,
      label: game.status === "final" ? "final" : "now",
    });
  }
  const values = marks.map((mark) => mark.value);
  const min = Math.min(-10, Math.floor((Math.min(...values) - 1) / 5) * 5);
  const max = Math.max(20, Math.ceil((Math.max(...values) + 1) / 5) * 5);
  const ticks: number[] = [];
  const step = max - min > 40 ? 10 : 5;
  for (let tick = Math.ceil(min / step) * step; tick <= max; tick += step) ticks.push(tick);
  return { teamId, otherId, min, max, ticks, marks };
}

export type WaterfallRow = {
  key: MarginPart["key"];
  label: string;
  sub: string | null;
  /** Points toward the favored side. */
  value: number;
  from: number;
  to: number;
  /** The team this part helps, for the bar's color. */
  teamId: string;
};

export type Waterfall = {
  teamId: string;
  rows: WaterfallRow[];
  total: number;
  min: number;
  max: number;
  ticks: number[];
};

const PART_LABELS: Record<MarginPart["key"], string> = {
  rating: "Ratings",
  home: "Home court",
  strength: "Ratings and home court",
  rest: "Rest",
  absences: "Absences",
};

/** The breakdown's parts, stacked from zero toward the total, in points toward the favored side. */
export function waterfall(game: DayGame, breakdown: MarginBreakdown, detail: GameDetail): Waterfall {
  const { teamId, otherId, sign } = orientationTeam(game);
  const listed = game.absences ? game.absences.home.players.length + game.absences.away.players.length : 0;
  const rest =
    detail.homeOnBackToBack && detail.awayOnBackToBack
      ? "Both on a back-to-back"
      : detail.homeOnBackToBack
        ? `${teamDisplay(game.homeId).code} on a back-to-back`
        : detail.awayOnBackToBack
          ? `${teamDisplay(game.awayId).code} on a back-to-back`
          : null;
  let at = 0;
  const rows = breakdown.parts.map((part) => {
    const value = part.display * sign;
    const row: WaterfallRow = {
      key: part.key,
      label: PART_LABELS[part.key],
      sub:
        part.key === "rest"
          ? rest
          : part.key === "absences"
            ? `${listed} ${listed === 1 ? "player" : "players"} ${game.projection?.basis?.kind === "current-absences" ? "counted from current absences" : "on the report"}`
            : part.key === "home" && game.neutral
              ? "Neutral site"
              : null,
      value,
      from: at,
      to: at + value,
      teamId: value >= 0 ? teamId : otherId,
    };
    at += value;
    return row;
  });
  const total = Math.round(breakdown.total * sign * 10) / 10;
  const edges = [0, total, ...rows.flatMap((row) => [row.from, row.to])];
  const min = Math.min(0, Math.floor(Math.min(...edges)));
  const max = Math.max(1, Math.ceil(Math.max(...edges)));
  const range = max - min;
  const step = range > 24 ? 10 : range > 10 ? 5 : range > 4 ? 2 : 1;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max; tick += step) ticks.push(tick);
  return { teamId, rows, total, min, max, ticks };
}

export type SealPoint = {
  key: string;
  label: string;
  percent: number;
  at: string;
  /** The reference version's seal: drawn as an open square. */
  reference: boolean;
  scored: boolean;
};

export type SealSeries = {
  teamId: string;
  points: SealPoint[];
  min: number;
  start: number;
  end: number;
};

const KIND_LABELS = { morning: "Morning", reissued: "Reissued", final: "Final" } as const;

/**
 * Every seal for this game over the day, as the favored side's chance: the published
 * version's morning, reissued and final seals joined by a line, and the reference
 * version's seal as an open square. Null when nothing was sealed.
 */
export function sealSeries(game: DayGame, detail: GameDetail): SealSeries | null {
  const { teamId } = orientationTeam(game);
  const chance = (row: SealRow) => splitPercents(row.homeWinProbability)[teamId === row.homeId ? "home" : "away"];
  const points: SealPoint[] = [];
  for (const version of detail.versions) {
    const reference = version.role !== "published";
    const short = version.modelVersion.split("-").at(-1) ?? version.modelVersion;
    for (const row of [version.morning, version.reissued, version.final]) {
      if (!row) continue;
      const kind = sealKindOf(row);
      points.push({
        key: `${version.modelVersion}-${row.issuedAt}`,
        label: reference ? short : version.twoSeals ? KIND_LABELS[kind] : "Sealed",
        percent: chance(row),
        at: row.issuedAt,
        reference,
        scored: version.scored === row,
      });
    }
  }
  if (points.length === 0) return null;
  points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const times = points.map((point) => Date.parse(point.at));
  const lowest = Math.min(...points.map((point) => point.percent));
  return {
    teamId,
    points,
    min: lowest >= 50 ? 50 : lowest >= 25 ? 25 : 0,
    start: Math.min(...times),
    end: Math.max(...times),
  };
}

export type SeasonLine = {
  playoffs: number;
  champion: number;
  projectedWins: number;
  p10: number;
  p90: number;
  games: number;
};

export function seasonLine(forecast: TeamForecast, games: number): SeasonLine {
  return {
    playoffs: forecast.makePlayoffs,
    champion: forecast.champion,
    projectedWins: forecast.projectedWins,
    p10: forecast.projectedWinsP10,
    p90: forecast.projectedWinsP90,
    games,
  };
}
