"use client";

import { useEffect, useRef, useState } from "react";
import { formatShortDay } from "@/lib/utils/dates";

export type RatingChartPoint = {
  date: string;
  preseason: boolean;
  team: number;
  min: number;
  q1: number;
  q3: number;
  max: number;
};

const GRID = "#ece9e4";
const AXIS_TEXT = "#6b6863";

function signed(value: number): string {
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

/**
 * One team's rating by game day against the league: the light band is the full
 * spread of the 30 ratings, the darker band the middle half. The published rating,
 * when it differs, is a separate open marker at the end.
 */
export function RatingChart({
  points,
  color,
  name,
  published,
}: {
  points: RatingChartPoint[];
  color: string;
  name: string;
  /** Today's published rating, drawn as its own marker. */
  published: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [index, setIndex] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = 240;
  const margin = { top: 12, right: 64, bottom: 28, left: 40 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const extent = Math.max(4, ...points.flatMap((point) => [Math.abs(point.min), Math.abs(point.max)]), Math.abs(published));
  const tickStep = extent > 8 ? 5 : 2;
  const limit = Math.ceil(extent / tickStep) * tickStep;
  const x = (i: number) => margin.left + (points.length <= 1 ? plotWidth / 2 : (i / (points.length - 1)) * plotWidth);
  const y = (value: number) => margin.top + ((limit - value) / (2 * limit)) * plotHeight;
  const area = (low: (p: RatingChartPoint) => number, high: (p: RatingChartPoint) => number) =>
    points.length === 0
      ? ""
      : `${points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(high(p))}`).join("")}${[...points]
          .map((p, i) => ({ p, i }))
          .reverse()
          .map(({ p, i }) => `L${x(i)},${y(low(p))}`)
          .join("")}Z`;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.team)}`).join("");
  const ticks: number[] = [];
  for (let value = -limit; value <= limit; value += tickStep) ticks.push(value);
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / 80))));
  // A regular date tick too close to the final one is dropped so the two never collide.
  const showTick = (i: number) =>
    i === points.length - 1 || (i % every === 0 && x(points.length - 1) - x(i) >= 56);
  const last = points.at(-1);
  // End labels for the replayed and the published rating, kept at least 12px apart.
  let replayLabelY = last ? y(last.team) : 0;
  let publishedLabelY = y(published);
  if (last && Math.abs(replayLabelY - publishedLabelY) < 12) {
    const middle = (replayLabelY + publishedLabelY) / 2;
    const up = last.team >= published;
    replayLabelY = middle + (up ? -6 : 6);
    publishedLabelY = middle + (up ? 6 : -6);
  }
  const hovered = index !== null ? points[index] : null;

  const locate = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || points.length === 0) return;
    const i = points.length <= 1 ? 0 : Math.round(((clientX - box.left - margin.left) / plotWidth) * (points.length - 1));
    setIndex(Math.max(0, Math.min(points.length - 1, i)));
  };
  const label = (p: RatingChartPoint) => (p.preseason ? "Season start" : `After ${formatShortDay(p.date)}`);

  return (
    <div ref={ref} className="relative min-w-0 overflow-hidden">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={last ? `${name} rating by game day, latest ${signed(last.team)}; league from ${signed(last.min)} to ${signed(last.max)}.` : `${name} rating history is not available.`}
        className="block select-none"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={margin.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#b9b5ae" : GRID} />
            <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT} className="font-mono">
              {signed(tick)}
            </text>
          </g>
        ))}
        <path d={area((p) => p.min, (p) => p.max)} fill="#121417" fillOpacity={0.05} />
        <path d={area((p) => p.q1, (p) => p.q3)} fill="#121417" fillOpacity={0.07} />
        {points.map((p, i) =>
          showTick(i) ? (
            <text key={`${p.date}-${p.preseason}`} x={x(i)} y={height - 8} fontSize={11} fill={AXIS_TEXT} className="font-mono" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
              {p.preseason ? "Start" : formatShortDay(p.date)}
            </text>
          ) : null,
        )}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last ? (
          <g>
            <circle cx={x(points.length - 1)} cy={y(last.team)} r={4} fill={color} stroke="#ffffff" strokeWidth={2} />
            <text x={x(points.length - 1) + 10} y={replayLabelY} dy="0.32em" fontSize={11.5} fill="#121417" className="font-mono">
              {signed(last.team)}
            </text>
            {Math.abs(published - last.team) >= 0.05 ? (
              <g>
                <circle cx={x(points.length - 1)} cy={y(published)} r={4.5} fill="#ffffff" stroke="#121417" strokeWidth={1.5} />
                <text x={x(points.length - 1) + 10} y={publishedLabelY} dy="0.32em" fontSize={11} fill="#5c5a57" className="font-mono">
                  {signed(published)}
                </text>
              </g>
            ) : null}
          </g>
        ) : null}
        {hovered && index !== null ? (
          <g>
            <line x1={x(index)} x2={x(index)} y1={margin.top} y2={margin.top + plotHeight} stroke="#121417" strokeOpacity={0.35} />
            <circle cx={x(index)} cy={y(hovered.team)} r={4} fill={color} stroke="#ffffff" strokeWidth={2} />
          </g>
        ) : null}
        <rect
          x={margin.left}
          y={margin.top}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          tabIndex={0}
          aria-label="Rating by game day. Use the arrow keys to move between dates."
          onPointerMove={(event) => locate(event.clientX)}
          onPointerDown={(event) => locate(event.clientX)}
          onPointerLeave={() => setIndex(null)}
          onFocus={() => setIndex(points.length - 1)}
          onBlur={() => setIndex(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, (i ?? points.length - 1) - 1));
            else if (event.key === "ArrowRight") setIndex((i) => Math.min(points.length - 1, (i ?? 0) + 1));
            else if (event.key === "Escape") setIndex(null);
            else return;
            event.preventDefault();
          }}
          className="cursor-crosshair outline-none"
        />
      </svg>
      {hovered && index !== null ? (
        <div
          role="status"
          className="pointer-events-none absolute top-2 z-10 w-48 rounded-lg border border-line bg-panel px-3 py-2 text-[12px] shadow-[0_8px_24px_-12px_rgba(18,20,23,0.35)]"
          style={{ left: x(index) + 200 < width ? x(index) + 12 : Math.max(0, x(index) - 204) }}
        >
          <p className="kicker mb-1">{label(hovered)}</p>
          <p className="flex items-center gap-2">
            <span aria-hidden className="h-[2px] w-3 rounded-full" style={{ background: color }} />
            <span className="num font-semibold text-ink">{signed(hovered.team)}</span>
            <span className="text-ink-2">{name}</span>
          </p>
          <p className="num mt-1 text-ink-3">
            League {signed(hovered.min)} to {signed(hovered.max)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
