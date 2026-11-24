"use client";

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { formatShortDay } from "@/lib/utils/dates";
import { formatChance } from "@/lib/utils/format";
import type { TeamOddsPoint } from "@/lib/view/team-odds-history";

// Vertical layout: the percent plot, a gap holding the projected-wins label, the wins
// plot, then the shared date axis.
const TOP = 10;
const PERCENT_HEIGHT = 150;
const GAP = 34;
const WINS_HEIGHT = 64;
const AXIS = 26;
const HEIGHT = TOP + PERCENT_HEIGHT + GAP + WINS_HEIGHT + AXIS;
const WINS_TOP = TOP + PERCENT_HEIGHT + GAP;
// End labels: 11px text, so 15px between their centres keeps them apart.
const LABEL_GAP = 15;
const TITLE_DASH = "5 3";

const wins = (value: number) => value.toFixed(1);
/** "Nov 12", or "Today" for the slate date: how the axis, readout and slider name a date. */
const dayLabel = (point: TeamOddsPoint) => (point.today ? "Today" : formatShortDay(point.date));

/**
 * One team's published season odds by date: playoff and title odds on a percent axis,
 * and projected wins below on the same dates, read together through one slider and one
 * readout line. Values are drawn exactly as published.
 *
 * Like RatingChart, the SVG is drawn at its container's measured width (text never
 * scales) and nothing is drawn until that width is known, so the server render can never
 * size the page. The readout sits in its own line above the plot.
 */
export function TeamOddsChart({ points, color, name }: { points: TeamOddsPoint[]; color: string; name: string }) {
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

  const first = points[0];
  const last = points.at(-1);
  const summary =
    first && last
      ? `${name} season odds by date, ${formatShortDay(first.date)} to ${last.today ? "today" : formatShortDay(last.date)}: make playoffs ${formatChance(first.makePlayoffs)} to ${formatChance(last.makePlayoffs)}, title ${formatChance(first.champion)} to ${formatChance(last.champion)}, projected wins ${wins(first.projectedWins)} to ${wins(last.projectedWins)}.`
      : `${name} odds history is not available.`;
  const hovered = index !== null ? points[index] : null;

  return (
    <div className="min-w-0">
      <p className="rc-legend" aria-hidden>
        <span>
          <svg width="18" height="10" aria-hidden>
            <line x1="1" x2="17" y1="5" y2="5" stroke={color} strokeWidth={2} strokeLinecap="round" />
          </svg>
          Make playoffs
        </span>
        <span>
          <svg width="18" height="10" aria-hidden>
            <line x1="1" x2="17" y1="5" y2="5" stroke="var(--chart-ink)" strokeWidth={1.5} strokeDasharray={TITLE_DASH} />
          </svg>
          Title
        </span>
        <span>
          <svg width="18" height="10" aria-hidden>
            <line x1="1" x2="17" y1="5" y2="5" stroke="var(--chart-text)" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
          Projected wins
        </span>
      </p>
      <p className="rc-readout num" role="status">
        {hovered ? (
          <>
            <b className="text-ink">{dayLabel(hovered)}:</b> make playoffs {formatChance(hovered.makePlayoffs)} · title{" "}
            {formatChance(hovered.champion)} · {wins(hovered.projectedWins)} projected wins
          </>
        ) : null}
      </p>
      <div ref={ref} className="relative min-w-0" style={{ height: HEIGHT }}>
        {width !== null ? (
          <Plot
            points={points}
            color={color}
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

/** Whole-number wins ticks: the smallest step that spans the range in at most three intervals. */
function winsScale(values: number[]): { low: number; high: number; ticks: number[] } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  for (const step of [1, 2, 5, 10, 20]) {
    let low = Math.floor(min / step) * step;
    let high = Math.ceil(max / step) * step;
    if (high === low) high = low + step;
    if ((high - low) / step <= 3) {
      low = Math.max(0, low);
      const ticks: number[] = [];
      for (let value = low; value <= high; value += step) ticks.push(value);
      return { low, high, ticks };
    }
  }
  return { low: 0, high: 82, ticks: [0, 41, 82] };
}

/** Two end-label positions at least LABEL_GAP apart, kept between `top` and `bottom`. */
function separate(a: number, b: number, top: number, bottom: number): [number, number] {
  if (Math.abs(a - b) >= LABEL_GAP) return [a, b];
  const middle = (a + b) / 2;
  const aAbove = a <= b;
  let first = middle + (aAbove ? -LABEL_GAP / 2 : LABEL_GAP / 2);
  let second = middle + (aAbove ? LABEL_GAP / 2 : -LABEL_GAP / 2);
  const shift = Math.max(0, top - Math.min(first, second)) - Math.max(0, Math.max(first, second) - bottom);
  first += shift;
  second += shift;
  return [first, second];
}

function Plot({
  points,
  color,
  width,
  summary,
  index,
  setIndex,
  box,
}: {
  points: TeamOddsPoint[];
  color: string;
  width: number;
  summary: string;
  index: number | null;
  setIndex: Dispatch<SetStateAction<number | null>>;
  box: () => DOMRect | null;
}) {
  const last = points.at(-1);
  // Room at the right for "100%" and "57.8" at 11px.
  const margin = { left: 40, right: 42 };
  const plotWidth = width - margin.left - margin.right;
  const x = (i: number) => margin.left + (points.length <= 1 ? plotWidth / 2 : (i / (points.length - 1)) * plotWidth);
  const yPercent = (value: number) => TOP + (1 - Math.min(1, Math.max(0, value))) * PERCENT_HEIGHT;
  const scale = winsScale(points.map((p) => p.projectedWins));
  const yWins = (value: number) => WINS_TOP + ((scale.high - value) / (scale.high - scale.low)) * WINS_HEIGHT;
  const path = (y: (p: TeamOddsPoint) => number) => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p)}`).join("");
  // Date ticks about 80px apart; the first and the last are always labelled, and a
  // regular tick too close to either is dropped so they never collide.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / 80))));
  const lastIndex = points.length - 1;
  const showTick = (i: number) =>
    i === 0 || i === lastIndex || (i % every === 0 && x(lastIndex) - x(i) >= 64 && x(i) - x(0) >= 64);
  const [playoffLabelY, titleLabelY] = last
    ? separate(yPercent(last.makePlayoffs), yPercent(last.champion), TOP + 4, TOP + PERCENT_HEIGHT + 4)
    : [0, 0];

  const locate = (clientX: number) => {
    const rect = box();
    if (!rect || points.length === 0) return;
    const i = points.length <= 1 ? 0 : Math.round(((clientX - rect.left - margin.left) / plotWidth) * lastIndex);
    setIndex(Math.max(0, Math.min(lastIndex, i)));
  };
  const hovered = index !== null ? points[index] : undefined;

  return (
    // A labelled group: the drawing is hidden from assistive tech, the date slider is not.
    <svg width={width} height={HEIGHT} role="group" aria-label={summary} className="block select-none">
      <g aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={`p${tick}`}>
            <line
              x1={margin.left}
              x2={margin.left + plotWidth}
              y1={yPercent(tick)}
              y2={yPercent(tick)}
              stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
            />
            <text x={margin.left - 8} y={yPercent(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-text)">
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}
        <text x={margin.left} y={WINS_TOP - 10} fontSize={11} fill="var(--chart-text)">
          Projected wins
        </text>
        {scale.ticks.map((tick, i) => (
          <g key={`w${tick}`}>
            <line
              x1={margin.left}
              x2={margin.left + plotWidth}
              y1={yWins(tick)}
              y2={yWins(tick)}
              stroke={i === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
            />
            <text x={margin.left - 8} y={yWins(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--chart-text)">
              {tick}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          showTick(i) ? (
            <text
              key={p.date}
              x={x(i)}
              y={HEIGHT - 8}
              fontSize={11}
              fill={i === lastIndex && p.today ? "var(--chart-ink)" : "var(--chart-text)"}
              fontWeight={i === lastIndex && p.today ? 700 : 400}
              textAnchor={i === 0 ? "start" : i === lastIndex ? "end" : "middle"}
            >
              {dayLabel(p)}
            </text>
          ) : null,
        )}
        <path
          d={path((p) => yPercent(p.champion))}
          fill="none"
          stroke="var(--chart-ink)"
          strokeWidth={1.5}
          strokeDasharray={TITLE_DASH}
          strokeLinejoin="round"
        />
        <path d={path((p) => yPercent(p.makePlayoffs))} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path
          d={path((p) => yWins(p.projectedWins))}
          fill="none"
          stroke="var(--chart-text)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {last ? (
          <g>
            <circle cx={x(lastIndex)} cy={yPercent(last.makePlayoffs)} r={4} fill={color} stroke="var(--chart-surface)" strokeWidth={2} />
            <circle cx={x(lastIndex)} cy={yPercent(last.champion)} r={3.5} fill="var(--chart-ink)" stroke="var(--chart-surface)" strokeWidth={2} />
            <circle cx={x(lastIndex)} cy={yWins(last.projectedWins)} r={3.5} fill="var(--chart-text)" stroke="var(--chart-surface)" strokeWidth={2} />
            <text x={x(lastIndex) + 9} y={playoffLabelY} dy="0.32em" fontSize={11} fontWeight={700} fill="var(--chart-ink)">
              {formatChance(last.makePlayoffs)}
            </text>
            <text x={x(lastIndex) + 9} y={titleLabelY} dy="0.32em" fontSize={11} fill="var(--chart-ink)">
              {formatChance(last.champion)}
            </text>
            <text x={x(lastIndex) + 9} y={yWins(last.projectedWins)} dy="0.32em" fontSize={11} fill="var(--chart-ink)">
              {wins(last.projectedWins)}
            </text>
          </g>
        ) : null}
        {hovered && index !== null ? (
          <g>
            <line x1={x(index)} x2={x(index)} y1={TOP} y2={WINS_TOP + WINS_HEIGHT} stroke="var(--chart-ink)" strokeOpacity={0.35} />
            <circle cx={x(index)} cy={yPercent(hovered.makePlayoffs)} r={4} fill={color} stroke="var(--chart-surface)" strokeWidth={2} />
            <circle cx={x(index)} cy={yPercent(hovered.champion)} r={3.5} fill="var(--chart-ink)" stroke="var(--chart-surface)" strokeWidth={2} />
            <circle cx={x(index)} cy={yWins(hovered.projectedWins)} r={3.5} fill="var(--chart-text)" stroke="var(--chart-surface)" strokeWidth={2} />
          </g>
        ) : null}
      </g>
      <rect
        x={margin.left}
        y={TOP}
        width={plotWidth}
        height={WINS_TOP + WINS_HEIGHT - TOP}
        fill="transparent"
        tabIndex={0}
        role="slider"
        aria-label="Season odds by date. Use the arrow keys to move between dates."
        aria-valuemin={0}
        aria-valuemax={Math.max(0, lastIndex)}
        aria-valuenow={index ?? Math.max(0, lastIndex)}
        aria-valuetext={points.length > 0 ? dayLabel(points[index ?? lastIndex]) : undefined}
        onPointerMove={(event) => locate(event.clientX)}
        onPointerDown={(event) => locate(event.clientX)}
        onPointerLeave={(event) => {
          // A touch lifting off leaves the date it read on the readout.
          if (event.pointerType === "mouse") setIndex(null);
        }}
        // A tap or click focuses after its pointerdown has already read a date; keep that date.
        onFocus={() => setIndex((i) => i ?? lastIndex)}
        onBlur={() => setIndex(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, (i ?? lastIndex) - 1));
          else if (event.key === "ArrowRight") setIndex((i) => Math.min(lastIndex, (i ?? 0) + 1));
          else if (event.key === "Home") setIndex(0);
          else if (event.key === "End") setIndex(lastIndex);
          else if (event.key === "Escape") setIndex(null);
          else return;
          event.preventDefault();
        }}
        className="rc-plot cursor-crosshair"
      />
    </svg>
  );
}
