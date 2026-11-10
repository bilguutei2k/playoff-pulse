"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TeamLink } from "@/components/live/TeamLink";
import { formatShortDay } from "@/lib/utils/dates";
import { formatChance } from "@/lib/utils/format";

/** One highlighted team: its line color and, when that color is shared, a dash pattern. */
export type ChartTeam = { teamId: string; code: string; name: string; color: string; dash: string | null };
export type ChartPoint = { date: string; champion: Record<string, number> };

/**
 * End labels are HTML (team links) placed beside the plot. Each takes one row of this
 * height; rows never overlap, and the row is the label's tap target.
 */
const LABEL_ROW = { narrow: 24, wide: 22 };
/** Swatch, logo, code and a percentage up to "100%" at 12px, plus the leader. */
const LABEL_SPACE = 118;
const LEADER = 12;

function niceMax(value: number): { max: number; step: number } {
  const target = Math.max(value * 1.08, 0.05);
  for (const step of [0.01, 0.02, 0.05, 0.1, 0.2, 0.25]) {
    if (target / step <= 5) return { max: Math.ceil(target / step) * step, step };
  }
  return { max: 1, step: 0.25 };
}

/**
 * End labels sorted top to bottom, each at least `gap` pixels from the next, kept
 * between `top` and `bottom` (centers). The chart is tall enough for every row.
 */
export function spreadLabels(items: Array<{ id: string; y: number }>, top: number, bottom: number, gap: number) {
  const sorted = [...items].sort((a, b) => a.y - b.y).map((item) => ({ ...item, labelY: Math.max(top, item.y) }));
  for (let i = 1; i < sorted.length; i += 1) {
    sorted[i].labelY = Math.max(sorted[i].labelY, sorted[i - 1].labelY + gap);
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].labelY - bottom : 0;
  if (overflow > 0) {
    sorted[sorted.length - 1].labelY = bottom;
    for (let i = sorted.length - 2; i >= 0; i -= 1) {
      sorted[i].labelY = Math.min(sorted[i].labelY, sorted[i + 1].labelY - gap);
    }
  }
  return new Map(sorted.map((item) => [item.id, item.labelY]));
}

/** A short sample of the team's line: its color and dash pattern. */
function Swatch({ team, width = 16 }: { team: ChartTeam; width?: number }) {
  return (
    <svg aria-hidden width={width} height={6} className="block flex-none">
      <line
        x1={0}
        x2={width}
        y1={3}
        y2={3}
        stroke={team.color}
        strokeWidth={2.5}
        strokeDasharray={team.dash ? team.dash.split(" ").map((n) => Number(n) * 0.75).join(" ") : undefined}
      />
    </svg>
  );
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
  const block = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [index, setIndex] = useState<number | null>(null);
  // The team whose label or readout entry is hovered or focused: its line comes forward.
  const [active, setActive] = useState<string | null>(null);
  const [focusFrame, setFocusFrame] = useState(false);

  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A tap shows a date until the next tap; a tap outside the chart clears it.
  useEffect(() => {
    if (index === null) return;
    const onPointer = (event: PointerEvent) => {
      if (!block.current?.contains(event.target as Node)) setIndex(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [index]);

  const narrow = width < 520;
  const row = narrow ? LABEL_ROW.narrow : LABEL_ROW.wide;
  const margin = { top: 14, right: LABEL_SPACE, bottom: 30, left: narrow ? 36 : 42 };
  // Tall enough that every end label has its own row.
  const height = Math.max(narrow ? 280 : 330, margin.top + margin.bottom + highlighted.length * row + 8);
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
        margin.top + row / 2 - 4,
        margin.top + plotHeight,
        row,
      )
    : new Map<string, number>();

  const ticks: number[] = [];
  for (let value = 0; value <= max + 1e-9; value += step) ticks.push(value);
  const maxDateTicks = Math.max(2, Math.floor(plotWidth / 80));
  const every = Math.max(1, Math.ceil(points.length / maxDateTicks));
  const dateTicks = points
    .map((_, i) => i)
    // The last date is end-anchored and about 40px wide; keep other ticks clear of it.
    .filter((i) => i === points.length - 1 || (i % every === 0 && x(points.length - 1) - x(i) >= 64));
  const hovered = index !== null ? points[index] : null;
  const endX = x(points.length - 1);

  const locate = (clientX: number) => {
    const box = plot.current?.getBoundingClientRect();
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

  const lineStroke = (team: ChartTeam) => (active && active !== team.teamId ? "var(--chart-track)" : team.color);
  const dashArray = (team: ChartTeam) => team.dash ?? undefined;
  const ordered = active
    ? [...highlighted.filter((team) => team.teamId !== active), ...highlighted.filter((team) => team.teamId === active)]
    : [...highlighted].reverse();
  const highlight = (teamId: string | null) => ({
    onPointerEnter: () => setActive(teamId),
    onPointerLeave: () => setActive(null),
    onFocus: () => setActive(teamId),
    onBlur: () => setActive(null),
  });

  return (
    <div
      ref={block}
      className="title-chart flex flex-col"
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setIndex(null);
      }}
    >
      <div ref={plot} className="relative min-w-0 overflow-x-clip">
        <svg width={width} height={height} role="img" aria-label={summary} className="block select-none">
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
                {Math.round(tick * 100)}%
              </text>
            </g>
          ))}
          {dateTicks.map((i) => (
            <text
              key={points[i].date}
              x={x(i)}
              y={height - 8}
              textAnchor={points.length > 1 && i === points.length - 1 ? "end" : points.length > 1 && i === 0 ? "start" : "middle"}
              fontSize={11}
              fill="var(--chart-text)"
            >
              {formatShortDay(points[i].date)}
            </text>
          ))}
          {others.map((teamId) => (
            <path
              key={teamId}
              d={path(teamId)}
              fill="none"
              stroke="var(--chart-track)"
              strokeWidth={1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {ordered.map((team) => (
            <path
              key={team.teamId}
              d={path(team.teamId)}
              fill="none"
              stroke={lineStroke(team)}
              strokeWidth={active === team.teamId ? 3 : 2}
              strokeDasharray={dashArray(team)}
              strokeLinejoin="round"
              strokeLinecap={team.dash ? "butt" : "round"}
            />
          ))}
          {last
            ? highlighted.map((team) => {
                const endY = y(last.champion[team.teamId] ?? 0);
                const labelY = labels.get(team.teamId) ?? endY;
                return (
                  <g key={team.teamId}>
                    <path
                      d={`M${endX + 5},${endY} L${endX + LEADER - 2},${labelY}`}
                      stroke="var(--chart-mid)"
                      strokeOpacity={0.6}
                      fill="none"
                    />
                    <rect
                      x={endX - 3.5}
                      y={endY - 3.5}
                      width={7}
                      height={7}
                      fill={lineStroke(team)}
                      stroke="var(--chart-surface)"
                      strokeWidth={1.5}
                    />
                  </g>
                );
              })
            : null}
          {hovered && index !== null ? (
            <g>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={margin.top}
                y2={margin.top + plotHeight}
                stroke="var(--chart-ink)"
                strokeOpacity={0.4}
              />
              {highlighted.map((team) => (
                <circle
                  key={team.teamId}
                  cx={x(index)}
                  cy={y(hovered.champion[team.teamId] ?? 0)}
                  r={4}
                  fill={lineStroke(team)}
                  stroke="var(--chart-surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
          ) : null}
          {focusFrame ? (
            <rect
              x={margin.left - 3}
              y={margin.top - 6}
              width={plotWidth + 7}
              height={plotHeight + 12}
              fill="none"
              stroke="var(--chart-focus)"
              strokeWidth={2}
              pointerEvents="none"
            />
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
            onBlur={() => {
              setIndex(null);
              setFocusFrame(false);
            }}
            onFocus={(event) => {
              let keyboard = true;
              try {
                keyboard = event.currentTarget.matches(":focus-visible");
              } catch {
                // Older browsers: show the frame.
              }
              setFocusFrame(keyboard);
              // A pointer has already chosen a date; keyboard focus starts at the latest.
              setIndex((i) => i ?? points.length - 1);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, (i ?? points.length - 1) - 1));
              else if (event.key === "ArrowRight") setIndex((i) => Math.min(points.length - 1, (i ?? 0) + 1));
              else if (event.key === "Home") setIndex(0);
              else if (event.key === "End") setIndex(points.length - 1);
              else if (event.key === "Escape") setIndex(null);
              else return;
              event.preventDefault();
              setFocusFrame(true);
            }}
            style={{ touchAction: "pan-y" }}
            className="cursor-crosshair outline-none"
          />
        </svg>
        {last ? (
          <ul aria-label="Latest title odds" className="contents">
            {highlighted.map((team) => {
              const labelY = labels.get(team.teamId) ?? y(last.champion[team.teamId] ?? 0);
              return (
                <li
                  key={team.teamId}
                  className={`title-chart-label ${active === team.teamId ? "is-active" : ""}`}
                  style={{ left: endX + LEADER, top: labelY - row / 2, height: row }}
                  {...highlight(team.teamId)}
                >
                  <Swatch team={team} />
                  <TeamLink teamId={team.teamId} form="code" logo={16} className="self-stretch" />
                  <span className="tabular">{formatChance(last.champion[team.teamId] ?? 0)}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {/* Outside the plot: below it on phones, above it from 640px. */}
      <div role="status" className="title-chart-readout sm:order-first">
        {hovered && index !== null ? (
          <>
            <b className="title-chart-date">{formatShortDay(hovered.date)}</b>
            <ul className="title-chart-values">
              {[...highlighted]
                .sort((a, b) => (hovered.champion[b.teamId] ?? 0) - (hovered.champion[a.teamId] ?? 0))
                .map((team) => (
                  <li key={team.teamId} {...highlight(team.teamId)}>
                    <Swatch team={team} width={14} />
                    <TeamLink teamId={team.teamId} form="code" />
                    <b className="tabular">{formatChance(hovered.champion[team.teamId] ?? 0)}</b>
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <span className="text-ink-2">
            Tap or hover the chart to read a date; with a keyboard, focus the chart and use the arrow keys.
          </span>
        )}
      </div>
      <div className="sr-only">
        <table>
          <caption>Title odds by date</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              {highlighted.map((team) => (
                <th key={team.teamId} scope="col">
                  {team.name}
                </th>
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
