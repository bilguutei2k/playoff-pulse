// Data for the odds page's over-time chart: one dates × teams matrix per measure, the
// compact form the client receives. Title odds come from the published state's history
// exactly as the chart always drew them (so the default view is unchanged); playoff odds
// and projected wins come from the odds history view and are null without it. Values
// are copied, never computed. Tests: tests/odds-chart.test.ts.

import type { ChartMeasure } from "@/app/odds/query";
import type { OddsHistoryFile } from "@/lib/season/odds-history";
import { SEASON_TEAMS } from "@/lib/season/teams";
import type { TeamHistoryPoint } from "@/lib/season/types";

/** values[i][j] is team teamIds[j] on dates[i]. */
export type ChartSeries = { dates: string[]; teamIds: string[]; values: number[][] };

export type OddsChartData = Record<ChartMeasure, ChartSeries | null> & { champion: ChartSeries };

/** One chart point as the chart draws it: the date and every team's value. */
export type ChartPoint = { date: string; values: Record<string, number> };

export function oddsChartData(history: readonly TeamHistoryPoint[], odds: OddsHistoryFile | null): OddsChartData {
  const points = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const teamIds = SEASON_TEAMS.map((team) => team.id);
  const champion: ChartSeries = {
    dates: points.map((point) => point.date),
    teamIds,
    values: points.map((point) => teamIds.map((teamId) => point.champion[teamId] ?? 0)),
  };
  const fromView = (metric: "makePlayoffs" | "projectedWins"): ChartSeries | null =>
    odds && odds.dates.length > 0 ? { dates: odds.dates, teamIds: odds.teamIds, values: odds[metric] } : null;
  return { champion, makePlayoffs: fromView("makePlayoffs"), projectedWins: fromView("projectedWins") };
}

/** The chart's points for one series, oldest first. */
export function seriesPoints(series: ChartSeries): ChartPoint[] {
  return series.dates.map((date, i) => ({
    date,
    values: Object.fromEntries(series.teamIds.map((teamId, j) => [teamId, series.values[i][j]])),
  }));
}
