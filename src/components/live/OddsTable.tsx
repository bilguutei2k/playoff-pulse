"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { heatClass } from "@/components/live/heat";
import { SeedStrip } from "@/components/live/SeedStrip";
import { TeamLogo } from "@/components/live/TeamLogo";
import { formatChance } from "@/lib/utils/format";
import { formatRating, type OddsRow } from "@/lib/view/odds";

type SortKey =
  | "team"
  | "rating"
  | "projectedWins"
  | "playIn"
  | "makePlayoffs"
  | "topSix"
  | "reachConferenceFinals"
  | "reachFinals"
  | "champion";

type View = "East" | "West" | "League";

const PROBABILITY_COLUMNS: Array<{ key: SortKey & keyof OddsRow; label: string; title: string }> = [
  { key: "playIn", label: "Play-in", title: "Chance of finishing 7th to 10th and playing in the play-in tournament" },
  { key: "makePlayoffs", label: "Playoffs", title: "Chance of reaching the playoffs, directly or through the play-in" },
  { key: "topSix", label: "Top 6", title: "Chance of a top-six seed, which skips the play-in" },
  { key: "reachConferenceFinals", label: "Conf. finals", title: "Chance of reaching the conference finals" },
  { key: "reachFinals", label: "Finals", title: "Chance of reaching the NBA Finals" },
  { key: "champion", label: "Title", title: "Chance of winning the championship" },
];

function value(row: OddsRow, key: SortKey): number | string {
  return key === "team" ? row.shortName : row[key];
}

function RatingBar({ rating, max }: { rating: number; max: number }) {
  const width = Math.min(50, (Math.abs(rating) / max) * 50);
  return (
    <span aria-hidden className="relative mx-auto mt-1.5 block h-[5px] w-14 rounded-full bg-wash-2">
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-line-strong" />
      <span
        className={`absolute inset-y-0 ${rating >= 0 ? "rounded-r-full" : "rounded-l-full"} bg-ink-2`}
        style={{ left: rating >= 0 ? "50%" : `${50 - width}%`, width: `${width}%` }}
      />
    </span>
  );
}

export function OddsTable({
  rows,
  exact,
  initialView = "East",
}: {
  rows: OddsRow[];
  /** Past the regular season, 0% and 100% are facts and print as such. */
  exact: boolean;
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "projectedWins", descending: true });
  const tabsId = useId();
  const maxRating = Math.max(1, ...rows.map((row) => Math.abs(row.rating)));
  const seedScale = Math.max(0.05, ...rows.flatMap((row) => row.seeds));
  const modeled = rows.some((row) => row.ratingNow !== null);

  const shown = useMemo(() => {
    const filtered = view === "League" ? rows : rows.filter((row) => row.conference === view);
    return [...filtered].sort((a, b) => {
      const x = value(a, sort.key);
      const y = value(b, sort.key);
      const order = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
      return (sort.descending ? -order : order) || b.projectedWins - a.projectedWins;
    });
  }, [rows, view, sort]);

  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, descending: !current.descending } : { key, descending: key !== "team" },
    );

  const header = (key: SortKey, label: string, title: string, className = "") => {
    const active = sort.key === key;
    return (
      <th
        key={key}
        scope="col"
        aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
        className={`sticky top-0 z-10 border-b border-line-strong bg-panel px-2 py-2.5 align-bottom lg:top-16 ${className}`}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          title={title}
          className={`inline-flex items-center gap-1 font-mono text-[10.5px] font-medium uppercase leading-tight tracking-[0.06em] hover:text-ink ${active ? "text-ink" : "text-ink-3"}`}
        >
          {label}
          <span aria-hidden className={`text-[9px] ${active ? "opacity-100" : "opacity-0"}`}>
            {sort.descending ? "▼" : "▲"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div>
      <div role="tablist" aria-label="Conference" className="mb-4 inline-flex rounded-lg border border-line bg-panel p-1">
        {(["East", "West", "League"] as View[]).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            id={`${tabsId}-${option}`}
            aria-selected={view === option}
            aria-controls={`${tabsId}-panel`}
            onClick={() => setView(option)}
            className={`min-h-9 rounded-md px-4 text-[14px] font-medium transition-colors ${
              view === option ? "bg-ink text-white" : "text-ink-2 hover:bg-wash hover:text-ink"
            }`}
          >
            {option === "League" ? "All 30" : option}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${view}`}
        className="max-h-[78vh] overflow-auto rounded-[var(--radius-card)] border border-line bg-panel lg:max-h-none lg:overflow-visible"
      >
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-[14px]">
          <caption className="sr-only">
            {view === "League" ? "All 30 teams" : `${view}ern Conference`}: ratings, projected records and
            playoff odds. Column headings sort the table.
          </caption>
          <thead>
            <tr>
              {header("team", "Team", "Sort by team name", "sticky left-0 z-20 pl-4 text-left")}
              {header("rating", "Rating", "Points per game better or worse than an average team", "text-center")}
              {header("projectedWins", "Proj. W–L", "Average final record, with the 10th to 90th percentile of wins", "text-center")}
              <th scope="col" className="sticky top-0 z-10 border-b border-line-strong bg-panel px-2 py-2.5 text-left align-bottom font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3 lg:top-16">
                Seed 1–15
              </th>
              {PROBABILITY_COLUMNS.map((column) => header(column.key, column.label, column.title, "text-center"))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={row.teamId} className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-[5] border-b border-line bg-panel py-2 pl-4 pr-3 text-left font-normal group-hover:bg-wash"
                >
                  <Link href={`/teams/${row.slug}`} className="flex items-center gap-2.5">
                    <span className="num w-5 text-right text-[11px] text-ink-3">{index + 1}</span>
                    <TeamLogo teamId={row.teamId} size={24} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink group-hover:underline group-hover:decoration-pulse group-hover:underline-offset-4">
                        {row.shortName}
                      </span>
                      <span className="num block text-[11.5px] text-ink-3">
                        {row.wins}–{row.losses}
                      </span>
                    </span>
                  </Link>
                </th>
                <td className="border-b border-line px-2 py-2 text-center group-hover:bg-wash">
                  <span className="num text-[14px] text-ink">{formatRating(row.rating)}</span>
                  <RatingBar rating={row.rating} max={maxRating} />
                  {modeled && row.ratingNow !== null && Math.abs(row.ratingNow - row.rating) >= 0.05 ? (
                    <span className="num mt-1 block text-[11px] text-ink-3" title="Rating minus points lost to current absences">
                      now {formatRating(row.ratingNow)}
                    </span>
                  ) : null}
                </td>
                <td className="border-b border-line px-2 py-2 text-center group-hover:bg-wash">
                  <span className="num text-[14px] text-ink">
                    {Math.round(row.projectedWins)}–{Math.round(row.projectedLosses)}
                  </span>
                  <span className="num block text-[11px] text-ink-3" title="10th to 90th percentile of final wins">
                    {row.projectedWinsP10}–{row.projectedWinsP90} W
                  </span>
                </td>
                <td className="border-b border-line px-2 py-2 group-hover:bg-wash">
                  <SeedStrip seeds={row.seeds} scale={seedScale} name={row.shortName} />
                </td>
                {PROBABILITY_COLUMNS.map((column) => (
                  <td key={column.key} className="border-b border-line px-1.5 py-2 text-center group-hover:bg-wash">
                    <span className={`heat ${heatClass(row[column.key])}`}>
                      {formatChance(row[column.key], { exact })}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
