"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortDay } from "@/lib/utils/dates";
import { formatChance } from "@/lib/utils/format";

export type ChartTeam = { teamId: string; code: string; name: string; color: string };
export type ChartPoint = { date: string; champion: Record<string, number> };

const GRID = "#ececec";
const AXIS = "#111111";
const AXIS_TEXT = "#666666";
const OTHER = "#dcdcdc";
const LABEL_GAP = 13;

function niceMax(value: number): { max: number; step: number } {
  const target = Math.max(value * 1.08, 0.05);
  for (const step of [0.01, 0.02, 0.05, 0.1, 0.2, 0.25]) {
    if (target / step <= 5) return { max: Math.ceil(target / step) * step, step };
  }
  return { max: 1, step: 0.25 };
}

/** End labels sorted top to bottom and pushed apart to at least LABEL_GAP pixels. */
function spreadLabels(items: Array<{ id: string; y: number }>, top: number, bottom: number) {
  const sorted = [...items].sort((a, b) => a.y - b.y).map((item) => ({ ...item, labelY: item.y }));
  for (let i = 1; i < sorted.length; i += 1) {
    sorted[i].labelY = Math.max(sorted[i].labelY, sorted[i - 1].labelY + LABEL_GAP);
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].labelY - bottom : 0;
  if (overflow > 0) {
    for (const item of sorted) item.labelY -= overflow;
    for (let i = sorted.length - 2; i >= 0; i -= 1) {
      sorted[i].labelY = Math.min(sorted[i].labelY, sorted[i + 1].labelY - LABEL_GAP);
    }
  }
  for (const item of sorted) item.labelY = Math.max(top, item.labelY);
  return new Map(sorted.map((item) => [item.id, item.labelY]));
}

export function TitleOddsChart({
  points,
  highlighted,
  others,
}: {
  /** Daily snapshots, oldest first. */
  points: ChartPoint[];
  /** The likeliest champions today, drawn in team colors, most likely first. */
  highlighted: ChartTeam[];
  /** Every other team, drawn in gray for context. */
  others: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const narrow = width < 520;
  const height = narrow ? 260 : 320;
  const margin = { top: 14, right: narrow ? 92 : 112, bottom: 30, left: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const { max, step } = useMemo(() => {
    let top = 0;
    for (const point of points) for (const value of Object.values(point.champion)) top = Math.max(top, value);
    return niceMax(top);
  }, [points]);

  const x = (i: number) => margin.left + (points.length <= 1 ? plotWidth / 2 : (i / (points.length - 1)) * plotWidth);
  const y = (value: number) => margin.top + plotHeight - (Math.min(value, max) / max) * plotHeight;
  const path = (teamId: string) =>
    points.map((point, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(point.champion[teamId] ?? 0).toFixed(1)}`).join("");

  const last = points.at(-1);
  const labels = last
    ? spreadLabels(
        highlighted.map((team) => ({ id: team.teamId, y: y(last.champion[team.teamId] ?? 0) })),
        margin.top + 4,
        margin.top + plotHeight,
      )
    : new Map<string, number>();

  const ticks: number[] = [];
  for (let value = 0; value <= max + 1e-9; value += step) ticks.push(value);
  const maxDateTicks = Math.max(2, Math.floor(plotWidth / 80));
  const every = Math.max(1, Math.ceil(points.length / maxDateTicks));
  const dateTicks = points.map((_, i) => i).filter((i) => i % every === 0 || i === points.length - 1);
  const shownIndex = index ?? null;
  const hovered = shownIndex !== null ? points[shownIndex] : null;

  const locate = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || points.length === 0) return;
    const relative = clientX - box.left - margin.left;
    const i = points.length <= 1 ? 0 : Math.round((relative / plotWidth) * (points.length - 1));
    setIndex(Math.max(0, Math.min(points.length - 1, i)));
  };

  const summary = last
    ? `Title odds over ${points.length} ${points.length === 1 ? "day" : "days"}. Latest: ${highlighted
        .map((team) => `${team.name} ${formatChance(last.champion[team.teamId] ?? 0)}`)
        .join(", ")}.`
    : "No title odds history yet.";

  return (
    <div>
      <div ref={ref} className="relative min-w-0 overflow-hidden">
        <svg width={width} height={height} role="img" aria-label={summary} className="block select-none">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={margin.left} x2={margin.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? AXIS : GRID} />
              <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                {Math.round(tick * 100)}%
              </text>
            </g>
          ))}
          {dateTicks.map((i) => (
            <text key={points[i].date} x={x(i)} y={height - 8} textAnchor={points.length > 1 && i === points.length - 1 ? "end" : points.length > 1 && i === 0 ? "start" : "middle"} fontSize={11} fill={AXIS_TEXT}>
              {formatShortDay(points[i].date)}
            </text>
          ))}
          {others.map((teamId) => (
            <path key={teamId} d={path(teamId)} fill="none" stroke={OTHER} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {[...highlighted].reverse().map((team) => (
            <path key={team.teamId} d={path(team.teamId)} fill="none" stroke={team.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {last
            ? highlighted.map((team) => {
                const endX = x(points.length - 1);
                const endY = y(last.champion[team.teamId] ?? 0);
                const labelY = labels.get(team.teamId) ?? endY;
                return (
                  <g key={team.teamId}>
                    <rect x={endX - 4} y={endY - 4} width={8} height={8} fill={team.color} stroke="#ffffff" strokeWidth={1.5} />
                    <path d={`M${endX + 6},${endY} L${endX + 14},${labelY}`} stroke={OTHER} fill="none" />
                    <rect x={endX + 16} y={labelY - 4} width={10} height={4} fill={team.color} />
                    <text x={endX + 30} y={labelY} dy="0.32em" fontSize={11.5} fill="#111111">
                      {team.code} {formatChance(last.champion[team.teamId] ?? 0)}
                    </text>
                  </g>
                );
              })
            : null}
          {hovered && shownIndex !== null ? (
            <g>
              <line x1={x(shownIndex)} x2={x(shownIndex)} y1={margin.top} y2={margin.top + plotHeight} stroke="#111111" strokeOpacity={0.4} />
              {highlighted.map((team) => (
                <circle key={team.teamId} cx={x(shownIndex)} cy={y(hovered.champion[team.teamId] ?? 0)} r={4} fill={team.color} stroke="#ffffff" strokeWidth={2} />
              ))}
            </g>
          ) : null}
          <rect
            x={margin.left - 8}
            y={margin.top}
            width={plotWidth + 16}
            height={plotHeight}
            fill="transparent"
            tabIndex={0}
            aria-label="Title odds by date. Use the arrow keys to move between dates."
            onPointerMove={(event) => locate(event.clientX)}
            onPointerDown={(event) => locate(event.clientX)}
            onPointerLeave={() => setIndex(null)}
            onBlur={() => setIndex(null)}
            onFocus={() => setIndex(points.length - 1)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, (i ?? points.length - 1) - 1));
              else if (event.key === "ArrowRight") setIndex((i) => Math.min(points.length - 1, (i ?? 0) + 1));
              else if (event.key === "Escape") setIndex(null);
              else return;
              event.preventDefault();
            }}
            className="cursor-crosshair outline-none focus-visible:outline-none"
          />
        </svg>
        {hovered && shownIndex !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 w-44 border border-ink bg-panel px-3 py-2 text-[13px]"
            style={{
              left: x(shownIndex) + 188 < width ? x(shownIndex) + 12 : Math.max(0, x(shownIndex) - 188),
            }}
          >
            <p className="mb-1.5 font-bold">{formatShortDay(hovered.date)}</p>
            <ul className="space-y-1">
              {[...highlighted]
                .sort((a, b) => (hovered.champion[b.teamId] ?? 0) - (hovered.champion[a.teamId] ?? 0))
                .map((team) => (
                  <li key={team.teamId} className="flex items-center gap-2">
                    <span aria-hidden className="h-1 w-3" style={{ background: team.color }} />
                    <span className="num font-bold text-ink">{formatChance(hovered.champion[team.teamId] ?? 0)}</span>
                    <span className="truncate text-ink-2">{team.name}</span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </div>
      <ul aria-label="Legend" className="legend mt-3">
        {highlighted.map((team) => (
          <li key={team.teamId} className="flex items-center gap-1.5">
            <span aria-hidden className="h-1 w-4" style={{ background: team.color }} />
            {team.name}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-1 w-4" style={{ background: OTHER }} />
          Other teams
        </li>
      </ul>
      <div className="sr-only">
      <table>
        <caption>Title odds by date</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {highlighted.map((team) => (
              <th key={team.teamId} scope="col">{team.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{formatShortDay(point.date)}</th>
              {highlighted.map((team) => (
                <td key={team.teamId}>{formatChance(point.champion[team.teamId] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
