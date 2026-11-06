"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { TeamLogo } from "@/components/live/TeamLogo";
import { formatChance } from "@/lib/utils/format";
import { formatRating, type OddsRow } from "@/lib/view/odds";
import { teamColor } from "@/lib/view/teams";

type SortKey =
  | "team"
  | "rating"
  | "ratingNow"
  | "projectedWins"
  | "playIn"
  | "makePlayoffs"
  | "topSix"
  | "reachConferenceFinals"
  | "reachFinals"
  | "champion";

type View = "East" | "West" | "League";

const DEFAULT_SORT: { key: SortKey; descending: boolean } = { key: "projectedWins", descending: true };

/** Separator rows in a conference view under the default sort: a gap, not a rule. */
const GROUPS: Record<number, { long: string; short: string }> = {
  6: { long: "Projected 7th to 10th: play-in", short: "7th to 10th: play-in" },
  10: { long: "Projected 11th and below", short: "11th and below" },
};

type ChanceKey = "playIn" | "makePlayoffs" | "topSix" | "reachConferenceFinals" | "reachFinals" | "champion";

const CHANCE_TITLES: Record<ChanceKey, string> = {
  playIn: "Chance of finishing 7th to 10th and playing in the play-in tournament",
  makePlayoffs: "Chance of reaching the playoffs, directly or through the play-in",
  topSix: "Chance of a top-six seed, which skips the play-in",
  reachConferenceFinals: "Chance of reaching the conference finals",
  reachFinals: "Chance of reaching the NBA Finals",
  champion: "Chance of winning the championship",
};

function value(row: OddsRow, key: SortKey): number | string {
  if (key === "team") return row.shortName;
  if (key === "ratingNow") return row.ratingNow ?? row.rating;
  return row[key];
}

/** A whole percent: bold from 50%, grey below 1%. */
function Chance({ value: chance, exact }: { value: number; exact: boolean }) {
  const text = formatChance(chance, { exact });
  if (chance >= 0.5) return <b className="font-bold">{text}</b>;
  if (text === "<1%" || text === "0%") return <span className="text-ink-2">{text}</span>;
  return <>{text}</>;
}

/** Wins in 8 of 10 simulations on a 0-to-season axis, in the team's color, black tick at the average. */
function WinsRange({ row }: { row: OddsRow }) {
  const at = (wins: number) => `${Math.min(100, Math.max(0, (wins / Math.max(1, row.seasonLength)) * 100))}%`;
  return (
    <span
      className="relative inline-block h-3.5 w-[180px] align-middle"
      role="img"
      aria-label={`${row.projectedWinsP10} to ${row.projectedWinsP90} wins in 8 of 10 simulations, ${Math.round(row.projectedWins)} on average`}
    >
      <i aria-hidden className="absolute inset-x-0 top-1.5 h-0.5 bg-line" />
      <i
        aria-hidden
        className="absolute top-[3px] h-2"
        style={{
          left: at(row.projectedWinsP10),
          width: `calc(${at(row.projectedWinsP90)} - ${at(row.projectedWinsP10)})`,
          minWidth: 2,
          background: teamColor(row.teamId),
        }}
      />
      <i aria-hidden className="absolute top-0 h-3.5 w-[3px] -translate-x-1/2 bg-ink" style={{ left: at(row.projectedWins) }} />
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
  const [sort, setSort] = useState(DEFAULT_SORT);
  // Below 1024 px the table starts with four columns; "All columns" shows the rest.
  const [allColumns, setAllColumns] = useState(false);
  const tabsId = useId();
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

  const grouped = view !== "League" && sort.key === DEFAULT_SORT.key && sort.descending === DEFAULT_SORT.descending;
  // Columns beyond the phone's four: always from 1024 px, on demand below it.
  const extra = allColumns ? "" : "hidden lg:table-cell";
  const phoneOnly = allColumns ? "hidden" : "lg:hidden";

  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, descending: !current.descending } : { key, descending: key !== "team" },
    );

  const header = (key: SortKey, label: string, title: string, className = "", id: string = key) => {
    const active = sort.key === key;
    return (
      <th
        key={id}
        scope="col"
        aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
        className={`sticky top-0 z-10 bg-panel lg:top-[68px] ${className}`}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          title={title}
          className={`relative inline-flex items-center whitespace-nowrap hover:text-ink ${active ? "text-ink" : ""}`}
        >
          {label}
          {/* Outside the label's box, so right-aligned headings line up with their figures. */}
          <span
            aria-hidden
            className={`absolute top-1/2 -translate-y-1/2 text-[9px] ${className.includes("nm") ? "-left-3" : "-right-3"} ${active ? "opacity-100" : "opacity-0"}`}
          >
            {sort.descending ? "▼" : "▲"}
          </span>
        </button>
      </th>
    );
  };

  const chanceCell = (row: OddsRow, key: ChanceKey, className = "") => (
    <td key={key} className={`nm whitespace-nowrap ${className}`}>
      <Chance value={row[key]} exact={exact} />
    </td>
  );

  return (
    <div>
      <div role="tablist" aria-label="Conference" className="mb-5 flex gap-6 text-[15px]">
        {(["East", "West", "League"] as View[]).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            id={`${tabsId}-${option}`}
            aria-selected={view === option}
            aria-controls={`${tabsId}-panel`}
            onClick={() => setView(option)}
            className={`inline-flex h-11 items-center decoration-2 underline-offset-8 ${
              view === option ? "font-bold text-ink underline" : "text-ink-2 hover:text-ink"
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
        className={allColumns ? "max-h-[78vh] overflow-auto lg:max-h-none lg:overflow-visible" : ""}
      >
        <table className={`tb ${allColumns ? "min-w-[60rem]" : ""}`}>
          <caption className="sr-only">
            {view === "League" ? "All 30 teams" : `${view}ern Conference`}: ratings, projected records and playoff
            odds. Column headings sort the table.
          </caption>
          <thead>
            <tr>
              {header("team", "Team", "Sort by team name", "sticky left-0 z-20 pr-3")}
              {header("rating", "Rating", "Points per game better or worse than an average team", `nm ${extra}`)}
              {modeled
                ? header("ratingNow", "Now", "Rating minus the points lost to players currently out, for the next game", `nm ${extra}`)
                : null}
              {header("projectedWins", "Proj.", "Average final record", `nm ${extra}`)}
              {header("projectedWins", "Wins", "Average final wins", `nm ${phoneOnly}`, "wins")}
              <th scope="col" className={`sticky top-0 z-10 bg-panel lg:top-[68px] ${extra}`}>
                Wins, 8 in 10 sims
              </th>
              {header("playIn", "Play-in", CHANCE_TITLES.playIn, `nm ${extra}`)}
              {header("makePlayoffs", "Playoffs", CHANCE_TITLES.makePlayoffs, "nm")}
              {header("topSix", "Top six", CHANCE_TITLES.topSix, `nm ${extra}`)}
              {header("reachConferenceFinals", "Conf. finals", CHANCE_TITLES.reachConferenceFinals, `nm ${extra}`)}
              {header("reachFinals", "Finals", CHANCE_TITLES.reachFinals, `nm ${extra}`)}
              {header("champion", "Title", CHANCE_TITLES.champion, "nm")}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => {
              const group = grouped ? GROUPS[index] : undefined;
              return [
                group ? (
                  <tr key={`group-${index}`}>
                    <td
                      colSpan={12}
                      className="!border-b !border-ink !pb-1.5 !pt-5 text-[13px] !text-ink-2"
                    >
                      <span className="hidden lg:inline">{group.long}</span>
                      <span className="lg:hidden">{allColumns ? group.long : group.short}</span>
                    </td>
                  </tr>
                ) : null,
                <tr key={row.teamId} className="group">
                  <th scope="row" className="sticky left-0 z-[5] bg-panel pr-3 text-left group-hover:bg-wash">
                    <Link href={`/teams/${row.slug}`} className="flex items-center gap-2 whitespace-nowrap">
                      <TeamLogo teamId={row.teamId} size={18} />
                      <b className="font-bold group-hover:underline group-hover:underline-offset-4">{row.shortName}</b>
                      <span className="num text-[13px] text-ink-2">
                        {row.wins}–{row.losses}
                      </span>
                    </Link>
                  </th>
                  <td className={`nm ${extra} group-hover:bg-wash`}>{formatRating(row.rating)}</td>
                  {modeled ? (
                    <td className={`nm ${extra} !text-ink-2 group-hover:bg-wash`}>
                      {row.ratingNow === null ? "–" : formatRating(row.ratingNow)}
                    </td>
                  ) : null}
                  <td className={`nm whitespace-nowrap ${extra} group-hover:bg-wash`}>
                    <b className="font-bold">
                      {Math.round(row.projectedWins)}–{Math.round(row.projectedLosses)}
                    </b>
                  </td>
                  <td className={`nm ${phoneOnly} group-hover:bg-wash`}>{Math.round(row.projectedWins)}</td>
                  <td className={`${extra} w-[200px] group-hover:bg-wash`}>
                    <WinsRange row={row} />
                  </td>
                  {chanceCell(row, "playIn", `${extra} group-hover:bg-wash`)}
                  <td className="nm whitespace-nowrap group-hover:bg-wash">
                    <span className="inline-flex items-center justify-end gap-2">
                      <Chance value={row.makePlayoffs} exact={exact} />
                      <span aria-hidden className="bar inline-block !h-2 w-10 sm:w-16">
                        <i style={{ width: `${Math.min(100, row.makePlayoffs * 100)}%` }} />
                      </span>
                    </span>
                  </td>
                  {chanceCell(row, "topSix", `${extra} group-hover:bg-wash`)}
                  {chanceCell(row, "reachConferenceFinals", `${extra} group-hover:bg-wash`)}
                  {chanceCell(row, "reachFinals", `${extra} group-hover:bg-wash`)}
                  {chanceCell(row, "champion", "group-hover:bg-wash")}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        aria-expanded={allColumns}
        onClick={() => setAllColumns((open) => !open)}
        className="mt-4 inline-flex h-11 items-center text-[15px] font-bold hover:underline hover:underline-offset-4 lg:hidden"
      >
        {allColumns ? "Fewer columns" : "All columns"}
      </button>
    </div>
  );
}
