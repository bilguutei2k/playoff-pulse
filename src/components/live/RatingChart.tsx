"use client";

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
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

const HEIGHT = 240;
// End labels: 11px text, so 15px between their centres keeps them apart.
const LABEL_GAP = 15;

function signed(value: number): string {
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

/**
 * One team's rating by game day against the league: the light band is the full
 * spread of the 30 ratings, the darker band the middle half. The published rating,
 * when it differs, is a separate open marker at the end, labelled "today".
 *
 * The SVG is drawn at its container's measured width in real pixels (text never
 * scales), and nothing is drawn until that width is known, so the server render
 * can never size the page (VB-1). The readout sits in its own line above the plot,
 * so it never covers the end labels.
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
  const [width, setWidth] = useState<number | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const last = points.at(-1);
  const showPublished = last !== undefined && Math.abs(published - last.team) >= 0.05;
  const summary = last
    ? `${name} rating by game day, latest ${signed(last.team)}${showPublished ? `; today's published rating ${signed(published)}` : ""}; league from ${signed(last.min)} to ${signed(last.max)}.`
    : `${name} rating history is not available.`;
  const hovered = index !== null ? points[index] : null;
  const label = (p: RatingChartPoint) => (p.preseason ? "Season start" : `After ${formatShortDay(p.date)}`);

  return (
    <div className="min-w-0">
      <p className="rc-legend" aria-hidden>
        <span>
          <svg width="18" height="10" aria-hidden>
            <line x1="1" x2="17" y1="5" y2="5" stroke={color} strokeWidth={2} strokeLinecap="round" />
          </svg>
          {name}, rebuilt by game day
        </span>
        {showPublished ? (
          <span>
            <svg width="12" height="12" aria-hidden>
              <circle cx="6" cy="6" r="4.5" fill="var(--chart-surface)" stroke="var(--chart-ink)" strokeWidth={1.5} />
            </svg>
            Today&apos;s published rating
          </span>
        ) : null}
      </p>
      <p className="rc-readout num" role="status">
        {hovered ? (
          <>
            <b className="text-ink">{label(hovered)}:</b> {signed(hovered.team)} · league {signed(hovered.min)} to{" "}
            {signed(hovered.max)}
          </>
        ) : null}
      </p>
      <div ref={ref} className="relative min-w-0" style={{ height: HEIGHT }}>
        {width !== null ? (
          <Plot
            points={points}
            color={color}
            published={published}
            showPublished={showPublished}
            width={width}
            summary={summary}
            index={index}
            setIndex={setIndex}
            box={() => ref.current?.getBoundingClientRect() ?? null}
          />
        ) : (
          <span className="sr-only">{summary}</span>
        )}
      </div>
    </div>
  );
}

function Plot({
  points,
  color,
  published,
  showPublished,
  width,
  summary,
  index,
  setIndex,
  box,
}: {
  points: RatingChartPoint[];
  color: string;
  published: number;
  showPublished: boolean;
  width: number;
  summary: string;
  index: number | null;
  setIndex: Dispatch<SetStateAction<number | null>>;
  box: () => DOMRect | null;
}) {
  const last = points.at(-1);
  // Room at the right for "+10.4 today" at 11px.
  const margin = { top: 12, right: showPublished ? 78 : 46, bottom: 28, left: 40 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = HEIGHT - margin.top - margin.bottom;
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
  // Date ticks about 80px apart; "Nov 12" at 11px is about 36px wide.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / 80))));
  // A regular date tick too close to the final one is dropped so the two never collide.
  const showTick = (i: number) =>
    i === points.length - 1 || (i % every === 0 && x(points.length - 1) - x(i) >= 64 && (i === 0 || x(i) - x(0) >= 52));
  // End labels for the replayed and the published rating, kept LABEL_GAP apart and
  // inside the plot's height.
  let replayLabelY = last ? y(last.team) : 0;
  let publishedLabelY = y(published);
  if (last && showPublished && Math.abs(replayLabelY - publishedLabelY) < LABEL_GAP) {
    const middle = (replayLabelY + publishedLabelY) / 2;
    const replayAbove = last.team >= published;
    replayLabelY = middle + (replayAbove ? -LABEL_GAP / 2 : LABEL_GAP / 2);
    publishedLabelY = middle + (replayAbove ? LABEL_GAP / 2 : -LABEL_GAP / 2);
    const shift = Math.max(0, 6 - Math.min(replayLabelY, publishedLabelY)) - Math.max(0, Math.max(replayLabelY, publishedLabelY) - (HEIGHT - margin.bottom));
    replayLabelY += shift;
    publishedLabelY += shift;
  }

  const locate = (clientX: number) => {
    const rect = box();
    if (!rect || points.length === 0) return;
    const i = points.length <= 1 ? 0 : Math.round(((clientX - rect.left - margin.left) / plotWidth) * (points.length - 1));
    setIndex(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <svg width={width} height={HEIGHT} role="img" aria-label={summary} className="block select-none">
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={margin.left}
            x2={margin.left + plotWidth}
            y1={y(tick)}
            y2={y(tick)}
            stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
          />
          <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-text)">
            {signed(tick)}
          </text>
        </g>
      ))}
      <path d={area((p) => p.min, (p) => p.max)} fill="var(--chart-ink)" fillOpacity={0.05} />
      <path d={area((p) => p.q1, (p) => p.q3)} fill="var(--chart-ink)" fillOpacity={0.08} />
      {points.map((p, i) =>
        showTick(i) ? (
          <text
            key={`${p.date}-${p.preseason}`}
            x={x(i)}
            y={HEIGHT - 8}
            fontSize={11}
            fill="var(--chart-text)"
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
          >
            {p.preseason ? "Start" : formatShortDay(p.date)}
          </text>
        ) : null,
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last ? (
        <g>
          <circle cx={x(points.length - 1)} cy={y(last.team)} r={4} fill={color} stroke="var(--chart-surface)" strokeWidth={2} />
          <text
            x={x(points.length - 1) + 10}
            y={replayLabelY}
            dy="0.32em"
            fontSize={11}
            fill={showPublished ? "var(--chart-text)" : "var(--chart-ink)"}
            fontWeight={showPublished ? 400 : 700}
          >
            {signed(last.team)}
          </text>
          {showPublished ? (
            <g>
              <circle cx={x(points.length - 1)} cy={y(published)} r={4.5} fill="var(--chart-surface)" stroke="var(--chart-ink)" strokeWidth={1.5} />
              <text x={x(points.length - 1) + 10} y={publishedLabelY} dy="0.32em" fontSize={11} fill="var(--chart-ink)">
                <tspan fontWeight={700}>{signed(published)}</tspan> today
              </text>
            </g>
          ) : null}
        </g>
      ) : null}
      {index !== null && points[index] ? (
        <g>
          <line x1={x(index)} x2={x(index)} y1={margin.top} y2={margin.top + plotHeight} stroke="var(--chart-ink)" strokeOpacity={0.35} />
          <circle cx={x(index)} cy={y(points[index].team)} r={4} fill={color} stroke="var(--chart-surface)" strokeWidth={2} />
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
        className="rc-plot cursor-crosshair"
      />
    </svg>
  );
}
