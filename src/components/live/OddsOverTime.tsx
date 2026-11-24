"use client";

import { useId } from "react";
import { TitleOddsChart, type ChartMeasureInfo, type ChartTeam } from "@/components/live/TitleOddsChart";
import { useQueryState } from "@/components/live/useQueryState";
import { titleChartStyles } from "@/app/odds/chart-colors";
import { ODDS_DEFAULT, parseOddsQuery, serializeOddsQuery, type ChartMeasure } from "@/app/odds/query";
import { formatShortDay } from "@/lib/utils/dates";
import { seriesPoints, type OddsChartData } from "@/lib/view/odds-chart";
import { PANEL_COLOR, teamDisplay } from "@/lib/view/teams";

const MEASURES: Array<ChartMeasureInfo & { key: ChartMeasure; button: string }> = [
  { key: "champion", button: "Title", label: "Title odds", kind: "probability" },
  { key: "makePlayoffs", button: "Playoffs", label: "Playoff odds", kind: "probability" },
  { key: "projectedWins", button: "Projected wins", label: "Projected wins", kind: "wins" },
];

/**
 * The odds page's over-time chart with its controls: the measure (title odds by default;
 * playoff odds and projected wins when the odds history view is published) and one team
 * to highlight besides today's top teams by title odds. Both live in the page's URL
 * query, so a link reproduces the view. The default is the chart as it always was.
 */
export function OddsOverTime({
  data,
  order,
  shown,
}: {
  data: OddsChartData;
  /** Every team, likeliest champion today first. */
  order: string[];
  /** How many of `order` are drawn in color by default. */
  shown: number;
}) {
  const [query, setQuery] = useQueryState(ODDS_DEFAULT, parseOddsQuery, serializeOddsQuery);
  const ids = useId();
  const available = MEASURES.filter((measure) => data[measure.key] !== null);
  const measure = available.find((option) => option.key === query.chart.measure) ?? available[0];
  const series = data[measure.key] ?? data.champion;
  const points = seriesPoints(series);
  const picked = query.chart.team !== null && order.includes(query.chart.team) ? query.chart.team : null;
  const top = order.slice(0, shown);
  const colored = picked !== null && !top.includes(picked) ? [...top, picked] : top;
  const styles = titleChartStyles(colored, PANEL_COLOR);
  const highlighted: ChartTeam[] = colored.map((teamId) => ({
    teamId,
    code: teamDisplay(teamId).code,
    name: teamDisplay(teamId).shortName,
    color: styles[teamId].color,
    dash: styles[teamId].dash,
  }));
  const others = order.filter((teamId) => !colored.includes(teamId));
  const teams = order.map((teamId) => ({ teamId, name: teamDisplay(teamId).name })).sort((a, b) => a.name.localeCompare(b.name));

  const setMeasure = (next: ChartMeasure) => setQuery({ ...query, chart: { ...query.chart, measure: next } }, "replace");
  const setTeam = (next: string) => setQuery({ ...query, chart: { ...query.chart, team: next === "" ? null : next } }, "replace");

  return (
    <>
      <div className="sh">
        <h2 id="history-title">{measure.label} over time</h2>
        <span>
          Top {shown}
          {measure.key === "champion" ? "" : " by title odds"} today in team colors
          {highlighted.some((team) => team.dash) ? ", dashed where colors are close" : ""}, others grey
        </span>
      </div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        {available.length > 1 ? (
          <div role="group" aria-label="Measure" className="flex flex-wrap gap-x-6 text-[15px]">
            {available.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={option.key === measure.key}
                onClick={() => setMeasure(option.key)}
                className={`inline-flex h-11 items-center decoration-2 underline-offset-8 ${
                  option.key === measure.key ? "font-bold text-ink underline" : "text-ink-2 hover:text-ink"
                }`}
              >
                {option.button}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="w-full min-w-0 sm:w-64">
          <label htmlFor={`${ids}-team`} className="kicker block">
            Highlight a team
          </label>
          <select
            id={`${ids}-team`}
            value={picked ?? ""}
            onChange={(event) => setTeam(event.target.value)}
            className="pp-select mt-1.5 min-h-11"
          >
            <option value="">Top {shown} only</option>
            {teams.map((team) => (
              <option key={team.teamId} value={team.teamId}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {points.length < 2 ? (
        <p className="notice-quiet mb-4">
          The chart adds a point each day; it starts{" "}
          {points.length > 0 ? formatShortDay(points[0].date) : "with the first published forecast"}, so there is not
          much of a line yet.
        </p>
      ) : null}
      <TitleOddsChart points={points} highlighted={highlighted} others={others} measure={measure} picked={picked} />
      {measure.key !== "champion" ? (
        <p className="mt-3 text-[13px] leading-5 text-ink-2">
          Each day&apos;s published season odds{measure.kind === "wins" ? ": the average final regular-season wins" : ""}.
          Not claimed calibrated midseason.
        </p>
      ) : null}
    </>
  );
}
