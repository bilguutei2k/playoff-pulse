"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TeamLogo } from "@/components/live/TeamLogo";
import { teamById } from "@/lib/season/teams";
import { formatShortDay } from "@/lib/utils/dates";
import { formatChance } from "@/lib/utils/format";

export type ChartSeries = { teamId: string; color: string };
export type ChartPoint = { date: string; champion: Record<string, number> };

const HEIGHT = 260;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
// Chart chrome: hairline grid one step off the surface, muted axis text.
const GRID = "#eaecf0";
const AXIS = "#d0d5dd";
const AXIS_TEXT = "#545f71";

function niceStep(max: number): number {
  for (const step of [0.01, 0.02, 0.05, 0.1, 0.2, 0.25]) if (max / step <= 5) return step;
  return 0.25;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
}

function tickIndices(count: number, width: number): number[] {
  const maxTicks = Math.max(2, Math.floor(width / 72));
  if (count <= maxTicks) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil((count - 1) / (maxTicks - 1));
  const ticks: number[] = [];
  for (let index = 0; index < count; index += step) ticks.push(index);
  if (ticks.at(-1) !== count - 1) ticks[ticks.length - 1] = count - 1;
  return ticks;
}

export function TitleOddsChart({
  points,
  series,
}: {
  /** Daily title-odds snapshots, oldest first. */
  points: ChartPoint[];
  /** The teams to draw, most likely champion first, with colors chosen on the server. */
  series: ChartSeries[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const focusTeam = highlight ?? pinned;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const { yMax, step } = useMemo(() => {
    let max = 0;
    for (const point of points) {
      for (const { teamId } of series) max = Math.max(max, point.champion[teamId] ?? 0);
    }
    const chosen = niceStep(Math.max(max * 1.1, 0.05));
    return { yMax: Math.ceil(Math.max(max * 1.1, 0.05) / chosen) * chosen, step: chosen };
  }, [points, series]);

  const firstDay = points.length > 0 ? dayNumber(points[0].date) : 0;
  const lastDay = points.length > 0 ? dayNumber(points[points.length - 1].date) : 0;
  const x = (date: string) =>
    lastDay === firstDay
      ? MARGIN.left + plotWidth / 2
      : MARGIN.left + ((dayNumber(date) - firstDay) / (lastDay - firstDay)) * plotWidth;
  const y = (value: number) => MARGIN.top + plotHeight - (value / yMax) * plotHeight;

  const yTicks: number[] = [];
  for (let value = 0; value <= yMax + 1e-9; value += step) yTicks.push(value);
  const xTicks = tickIndices(points.length, plotWidth);
  const latest = points.at(-1);
  const activeIndex = hoverIndex;
  const active = activeIndex === null ? null : points[activeIndex];

  const pathFor = (teamId: string) => {
    let path = "";
    let drawing = false;
    for (const point of points) {
      const value = point.champion[teamId];
      if (value === undefined) {
        drawing = false;
        continue;
      }
      path += `${drawing ? "L" : "M"}${x(point.date).toFixed(1)},${y(value).toFixed(1)}`;
      drawing = true;
    }
    return path;
  };

  const nearestIndex = (clientX: number) => {
    const element = containerRef.current;
    if (!element || points.length === 0) return null;
    const left = element.getBoundingClientRect().left;
    const offset = clientX - left;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const distance = Math.abs(x(point.date) - offset);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (points.length === 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const current = hoverIndex ?? points.length - 1;
      const next =
        event.key === "ArrowLeft" ? Math.max(0, current - 1) : Math.min(points.length - 1, current + 1);
      setHoverIndex(next);
    } else if (event.key === "Escape") {
      setHoverIndex(null);
    }
  };

  const tooltipRows = active
    ? series
        .map(({ teamId, color }) => ({ teamId, color, value: active.champion[teamId] }))
        .filter((row): row is { teamId: string; color: string; value: number } => row.value !== undefined)
        .sort((a, b) => b.value - a.value)
    : [];
  const tooltipLeft = active ? x(active.date) : 0;
  const tooltipOnLeft = tooltipLeft > width * 0.6;

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={containerRef}
        className="relative"
        tabIndex={0}
        role="group"
        aria-label="Title odds by date for the eight likeliest champions. Use the left and right arrow keys to read each date."
        onKeyDown={onKeyDown}
        onFocus={() => setHoverIndex((current) => current ?? Math.max(0, points.length - 1))}
        onBlur={() => setHoverIndex(null)}
        onPointerMove={(event) => setHoverIndex(nearestIndex(event.clientX))}
        onPointerDown={(event) => setHoverIndex(nearestIndex(event.clientX))}
        // A tap ends with pointerleave on touch screens; keep that readout until the next tap.
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setHoverIndex(null);
        }}
      >
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block h-auto max-w-full"
          aria-hidden
        >
          {yTicks.map((value) => (
            <g key={value}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(value)}
                y2={y(value)}
                stroke={value === 0 ? AXIS : GRID}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={MARGIN.left - 8}
                y={y(value)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill={AXIS_TEXT}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {Math.round(value * 100)}%
              </text>
            </g>
          ))}
          {xTicks.map((index) => {
            const point = points[index];
            const anchor =
              points.length === 1 ? "middle" : index === 0 ? "start" : index === points.length - 1 ? "end" : "middle";
            return (
              <text
                key={point.date}
                x={x(point.date)}
                y={HEIGHT - 8}
                textAnchor={anchor}
                fontSize={11}
                fill={AXIS_TEXT}
              >
                {formatShortDay(point.date)}
              </text>
            );
          })}
          {active ? (
            <line
              x1={x(active.date)}
              x2={x(active.date)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              stroke={AXIS}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ) : null}
          {[...series].reverse().map(({ teamId, color }) => {
            const dimmed = focusTeam !== null && focusTeam !== teamId;
            const last = latest?.champion[teamId];
            return (
              <g key={teamId} opacity={dimmed ? 0.15 : 1} style={{ transition: "opacity 120ms" }}>
                <path
                  d={pathFor(teamId)}
                  fill="none"
                  stroke={color}
                  strokeWidth={focusTeam === teamId ? 3 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {points.length <= 3
                  ? points.map((point) =>
                      point.champion[teamId] === undefined ? null : (
                        <circle
                          key={point.date}
                          cx={x(point.date)}
                          cy={y(point.champion[teamId])}
                          r={4}
                          fill={color}
                          stroke="#ffffff"
                          strokeWidth={2}
                        />
                      ),
                    )
                  : last !== undefined && latest ? (
                      <circle cx={x(latest.date)} cy={y(last)} r={4} fill={color} stroke="#ffffff" strokeWidth={2} />
                    ) : null}
                {active && active.champion[teamId] !== undefined && points.length > 3 ? (
                  <circle
                    cx={x(active.date)}
                    cy={y(active.champion[teamId])}
                    r={4}
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
        {active ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 w-48 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] p-2.5 text-xs shadow-[0_4px_12px_rgba(16,24,40,0.08)]"
            style={
              tooltipOnLeft
                ? { right: width - tooltipLeft + 12 }
                : { left: Math.min(tooltipLeft + 12, width - 200) }
            }
          >
            <p className="mb-1.5 font-semibold text-[var(--color-text-primary)]">
              Title odds, {formatShortDay(active.date)}
            </p>
            <ul className="grid gap-1">
              {tooltipRows.map((row) => (
                <li key={row.teamId} className="flex items-center gap-2">
                  <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: row.color }} />
                  <TeamLogo teamId={row.teamId} size={14} />
                  <span className="text-[var(--color-text-muted)]">{teamById(row.teamId).abbreviation}</span>
                  <span className="tabular ml-auto font-semibold text-[var(--color-text-primary)]">
                    {formatChance(row.value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <ul aria-label="Legend" className="flex flex-wrap gap-2">
        {series.map(({ teamId, color }) => {
          const team = teamById(teamId);
          const value = latest?.champion[teamId];
          const isPinned = pinned === teamId;
          return (
            <li key={teamId}>
              <button
                type="button"
                aria-pressed={isPinned}
                onClick={() => setPinned(isPinned ? null : teamId)}
                onPointerEnter={() => setHighlight(teamId)}
                onPointerLeave={() => setHighlight(null)}
                onFocus={() => setHighlight(teamId)}
                onBlur={() => setHighlight(null)}
                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  isPinned
                    ? "border-[var(--color-text-secondary)] bg-[var(--color-panel-secondary)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] hover:border-[var(--color-border-strong)]"
                }`}
              >
                <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: color, height: 3 }} />
                <TeamLogo teamId={teamId} size={16} />
                <span className="font-medium text-[var(--color-text-primary)]">{team.abbreviation}</span>
                {value !== undefined ? (
                  <span className="tabular text-[var(--color-text-muted)]">{formatChance(value)}</span>
                ) : null}
                <span className="sr-only">{isPinned ? ", highlighted" : ", highlight this line"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <details className="text-sm">
        <summary className="cursor-pointer text-[var(--color-accent)]">Show the data as a table</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="pp-table">
            <caption className="sr-only">Title odds by date</caption>
            <thead>
              <tr>
                <th scope="col">Team</th>
                {points.map((point) => (
                  <th key={point.date} scope="col" className="num">
                    {formatShortDay(point.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map(({ teamId }) => (
                <tr key={teamId}>
                  <th scope="row">
                    <span className="flex items-center gap-2">
                      <TeamLogo teamId={teamId} size={16} />
                      {teamById(teamId).abbreviation}
                    </span>
                  </th>
                  {points.map((point) => (
                    <td key={point.date} className="num">
                      {point.champion[teamId] === undefined ? "–" : formatChance(point.champion[teamId])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
