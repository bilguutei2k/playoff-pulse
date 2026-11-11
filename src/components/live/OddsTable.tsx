"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Hint } from "@/components/live/Hint";
import { SortHeader } from "@/components/live/SortHeader";
import { TeamLink } from "@/components/live/TeamLink";
import { useQueryState } from "@/components/live/useQueryState";
import {
  ODDS_DEFAULT,
  defaultDescending,
  parseOddsQuery,
  serializeOddsQuery,
  type OddsSortKey as SortKey,
  type OddsView as View,
} from "@/app/odds/query";
import { formatChance } from "@/lib/utils/format";
import { formatRating, type OddsRow } from "@/lib/view/odds";
import { teamColor } from "@/lib/view/teams";

const VIEWS: View[] = ["East", "West", "League"];

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
  // By full name, so teams sort by city ("Atlanta Hawks" first), not nickname.
  if (key === "team") return row.name;
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

/** "52–63": wins in 8 of 10 simulations, printed so the bar is never the only key (DS-16). */
function winsRangeText(row: OddsRow): string {
  return `${row.projectedWinsP10}–${row.projectedWinsP90}`;
}

/** Wins in 8 of 10 simulations on a 0-to-season axis, in the team's color, black tick at the average. */
function WinsRange({ row }: { row: OddsRow }) {
  const at = (wins: number) => `${Math.min(100, Math.max(0, (wins / Math.max(1, row.seasonLength)) * 100))}%`;
  return (
    <span className="inline-flex items-center gap-2.5 align-middle">
      <span className="tabular w-[3.4em] text-right text-[13px] text-ink-2" aria-hidden>
        {winsRangeText(row)}
      </span>
      <span
        className="relative inline-block h-3.5 w-[140px] lg:w-[80px] xl:w-[140px]"
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
    </span>
  );
}

export function OddsTable({
  rows,
  exact,
}: {
  rows: OddsRow[];
  /** Past the regular season, 0% and 100% are facts and print as such. */
  exact: boolean;
}) {
  const [query, setQuery] = useQueryState(ODDS_DEFAULT, parseOddsQuery, serializeOddsQuery);
  const { view, sort } = query;
  // Below 1024 px the table starts with four columns; "All columns" shows the rest.
  const [allColumns, setAllColumns] = useState(false);
  const tabsId = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLTableSectionElement>(null);
  const modeled = rows.some((row) => row.ratingNow !== null);
  const seasonLength = rows[0]?.seasonLength ?? 82;
  // Keeps the column headings under the masthead while the table scrolls sideways in
  // its own box (all columns below 1024 px), where position: sticky cannot reach the page.
  useEffect(() => {
    const box = scroller.current;
    const thead = head.current;
    if (!allColumns || !box || !thead) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const scrolls = box.scrollWidth > box.clientWidth + 1;
      const mast = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mast")) || 0;
      const rect = box.getBoundingClientRect();
      const room = rect.height - thead.offsetHeight - 48;
      const shift = scrolls ? Math.max(0, Math.min(mast - rect.top, room)) : 0;
      thead.style.transform = shift > 0 ? `translateY(${Math.round(shift)}px)` : "";
      // A collapsed border stays with the table, so the moved head draws its own rule.
      thead.toggleAttribute("data-moved", shift > 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      thead.style.transform = "";
      thead.removeAttribute("data-moved");
    };
  }, [allColumns]);

  const shown = useMemo(() => {
    const filtered = view === "League" ? rows : rows.filter((row) => row.conference === view);
    return [...filtered].sort((a, b) => {
      const x = value(a, sort.key);
      const y = value(b, sort.key);
      const order = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
      return (sort.descending ? -order : order) || b.projectedWins - a.projectedWins;
    });
  }, [rows, view, sort]);

  const grouped =
    view !== "League" && sort.key === ODDS_DEFAULT.sort.key && sort.descending === ODDS_DEFAULT.sort.descending;
  // Columns beyond the phone's four: always from 1024 px, on demand below it.
  const extra = allColumns ? "" : "hidden lg:table-cell";
  const phoneOnly = allColumns ? "hidden" : "lg:hidden";
  // Native sticky headings below the masthead, except while the table scrolls in its own
  // box (the effect above moves them there).
  const stickyTop = allColumns ? "lg:sticky lg:top-[var(--mast)]" : "sticky top-[var(--mast)]";

  const setView = (next: View) => setQuery({ view: next, sort }, "replace");
  const sortBy = (key: SortKey) =>
    setQuery(
      {
        view,
        sort: sort.key === key ? { key, descending: !sort.descending } : { key, descending: defaultDescending(key) },
      },
      "replace",
    );

  // Tabs: one tab stop, arrows move and select (WAI-ARIA tabs with automatic activation).
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = VIEWS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % VIEWS.length
        : event.key === "ArrowLeft"
          ? (index + last) % VIEWS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setView(VIEWS[next]);
    tabs.current[next]?.focus();
  };

  const header = (
    key: SortKey,
    label: string,
    options: { title?: string; hint?: React.ReactNode; className?: string; layer?: string; align?: "left" | "right" } = {},
  ) => (
    <SortHeader
      key={`${key}-${label}`}
      label={label}
      active={sort.key === key}
      descending={sort.descending}
      onSort={() => sortBy(key)}
      align={options.align ?? "right"}
      title={options.hint ? undefined : options.title}
      hint={options.hint}
      className={`${stickyTop} bg-panel ${options.className ?? ""} ${options.layer ?? "z-10"}`}
    />
  );

  const chanceCell = (row: OddsRow, key: ChanceKey, className = "") => (
    <td key={key} className={`nm whitespace-nowrap ${className}`}>
      <Chance value={row[key]} exact={exact} />
    </td>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6">
        <div role="tablist" aria-label="Conference" className="flex gap-6 text-[15px]">
          {VIEWS.map((option, index) => (
            <button
              key={option}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${tabsId}-${option}`}
              aria-selected={view === option}
              aria-controls={`${tabsId}-panel`}
              tabIndex={view === option ? 0 : -1}
              onClick={() => setView(option)}
              onKeyDown={(event) => onTabKey(event, index)}
              className={`inline-flex h-11 items-center decoration-2 underline-offset-8 ${
                view === option ? "font-bold text-ink underline" : "text-ink-2 hover:text-ink"
              }`}
            >
              {option === "League" ? "All 30" : option}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={allColumns}
          aria-controls={`${tabsId}-panel`}
          onClick={() => setAllColumns((open) => !open)}
          className="inline-flex h-11 items-center text-[15px] font-bold hover:underline hover:underline-offset-4 lg:hidden"
        >
          {allColumns ? "Fewer columns" : "All columns"}
        </button>
      </div>
      <div
        ref={scroller}
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${view}`}
        className={allColumns ? "overflow-x-auto overscroll-x-contain lg:overflow-visible" : ""}
      >
        <table className={`tb odds-table ${allColumns ? "min-w-[64rem]" : ""}`}>
          <caption className="sr-only">
            {view === "League" ? "All 30 teams" : `${view}ern Conference`}: ratings, projected records and playoff
            odds. Column headings sort the table.
          </caption>
          <thead ref={head} className="relative z-20">
            <tr>
              {header("team", "Team", {
                align: "left",
                title: "Sort by team name",
                className: "sticky left-0 pr-3",
                layer: "z-20",
              })}
              {header("rating", "Rating", {
                className: extra,
                hint: `Points per game better or worse than an average team on a neutral court${
                  modeled ? ", adjusted for who missed past games to approximate full strength" : ""
                }.`,
              })}
              {modeled
                ? header("ratingNow", "Now", {
                    className: extra,
                    hint: "The rating minus the points lost to players currently out, for the team's next game.",
                  })
                : null}
              {header("projectedWins", "Proj.", {
                className: extra,
                hint: "Average final regular-season record across the simulations. The range of wins is in the next column.",
              })}
              {header("projectedWins", "Wins", {
                className: phoneOnly,
                title: "Average final wins; below, wins in 8 of 10 simulations",
              })}
              <th scope="col" className={`${stickyTop} z-10 bg-panel ${extra} odds-range-head`}>
                Wins, 8 in 10 sims
                <Hint label="Wins, 8 in 10 sims">
                  The middle 8 of every 10 simulated seasons end with this many wins. The bar runs from 0 to{" "}
                  {seasonLength} wins; the black tick is the average.
                </Hint>
              </th>
              {header("playIn", "Play-in", { className: extra, hint: `${CHANCE_TITLES.playIn}.` })}
              {header("makePlayoffs", "Playoffs", { title: CHANCE_TITLES.makePlayoffs })}
              {header("topSix", "Top six", { className: extra, hint: `${CHANCE_TITLES.topSix}.` })}
              {header("reachConferenceFinals", "Conf. finals", {
                className: extra,
                title: CHANCE_TITLES.reachConferenceFinals,
              })}
              {header("reachFinals", "Finals", { className: extra, title: CHANCE_TITLES.reachFinals })}
              {header("champion", "Title", { title: CHANCE_TITLES.champion })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => {
              const group = grouped ? GROUPS[index] : undefined;
              return [
                group ? (
                  <tr key={`group-${index}`}>
                    <td colSpan={12} className="!border-b !border-ink !pb-1.5 !pt-5 text-[13px] !text-ink-2">
                      <span className="hidden lg:inline">{group.long}</span>
                      <span className="lg:hidden">{allColumns ? group.long : group.short}</span>
                    </td>
                  </tr>
                ) : null,
                <tr key={row.teamId} className="group">
                  <th scope="row" className="sticky left-0 z-[5] bg-panel pr-3 text-left group-hover:bg-wash max-[374px]:pr-1.5">
                    {/* Phones: the record sits under the name, beside the two-line wins cell. */}
                    <span className="flex items-center gap-x-2 whitespace-nowrap max-sm:flex-col max-sm:items-start max-sm:whitespace-normal">
                      <TeamLink teamId={row.teamId} form="short" logo={18} className="font-bold" />
                      <span className="num text-[13px] text-ink-2 max-sm:pl-6 max-sm:text-[12px] max-sm:leading-tight max-[374px]:pl-0">
                        {row.wins}–{row.losses}
                      </span>
                    </span>
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
                  <td className={`nm ${phoneOnly} group-hover:bg-wash`}>
                    <span className="block leading-tight">{Math.round(row.projectedWins)}</span>
                    <span className="tabular block text-[12px] leading-tight text-ink-2">
                      <span className="sr-only">8 in 10 simulations: </span>
                      {winsRangeText(row)}
                    </span>
                  </td>
                  <td className={`${extra} group-hover:bg-wash`}>
                    <WinsRange row={row} />
                  </td>
                  {chanceCell(row, "playIn", `${extra} group-hover:bg-wash`)}
                  <td className="nm whitespace-nowrap group-hover:bg-wash">
                    <span className="inline-flex items-center justify-end gap-2">
                      <Chance value={row.makePlayoffs} exact={exact} />
                      <span aria-hidden className="bar inline-block !h-2 w-10 max-[374px]:hidden sm:w-16 lg:hidden xl:inline-block">
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
    </div>
  );
}
