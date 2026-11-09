"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { StatusTag } from "@/components/live/Badge";
import { PlayerLink } from "@/components/live/PlayerLink";
import { TeamLogo } from "@/components/live/TeamLogo";
import { useQueryState } from "@/components/live/useQueryState";
import { parsePlayersQuery, serializePlayersQuery, type PlayersQuery, type PlayersQueryOptions } from "@/lib/view/filters";
import { formatAverage, formatImpact, formatShooting, type PlayerTableRow, type StatLine } from "@/lib/view/players";

export type SortKey =
  | "name"
  | "team"
  | "games"
  | "starts"
  | keyof StatLine
  | "fieldGoal"
  | "threePoint"
  | "freeThrow"
  | "impact"
  | "status";

type Column = {
  key: SortKey;
  label: string;
  title: string;
  /** Null sorts last in either direction. */
  value: (row: PlayerTableRow) => number | string | null;
  cell: (row: PlayerTableRow) => React.ReactNode;
};

const stat = (key: keyof StatLine, label: string, title: string): Column => ({
  key,
  label,
  title,
  value: (row) => row.perGame?.[key] ?? null,
  cell: (row) => formatAverage(row.perGame?.[key] ?? null),
});

const shooting = (key: keyof PlayerTableRow["shooting"], label: string, title: string): Column => ({
  key,
  label,
  title,
  value: (row) => row.shooting[key],
  cell: (row) => formatShooting(row.shooting[key]),
});

const COLUMNS: Column[] = [
  { key: "games", label: "GP", title: "Games played", value: (row) => row.games, cell: (row) => row.games },
  { key: "starts", label: "GS", title: "Games started", value: (row) => row.starts, cell: (row) => row.starts },
  stat("minutes", "Min", "Minutes per game"),
  stat("points", "Pts", "Points per game"),
  stat("rebounds", "Reb", "Rebounds per game"),
  stat("assists", "Ast", "Assists per game"),
  stat("steals", "Stl", "Steals per game"),
  stat("blocks", "Blk", "Blocks per game"),
  stat("turnovers", "TO", "Turnovers per game"),
  shooting("fieldGoal", "FG%", "Field goals made per attempt"),
  shooting("threePoint", "3P%", "Three-pointers made per attempt"),
  shooting("freeThrow", "FT%", "Free throws made per attempt"),
  {
    key: "impact",
    label: "548 impact",
    title: "The model's estimate of the points of margin his team loses per game without him. Not validated per player.",
    value: (row) => row.impact,
    cell: (row) => formatImpact(row.impact),
  },
];

const MINUTE_FILTERS = [0, 10, 20, 30];
/** Every column a link may sort by; a `sort` outside this list falls back to the default. */
const SORT_KEYS = [
  "name",
  "team",
  "games",
  "starts",
  "minutes",
  "points",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "fieldGoal",
  "threePoint",
  "freeThrow",
  "impact",
  "status",
] as const satisfies ReadonlyArray<SortKey>;

/** Names, teams and statuses sort A to Z first; every number sorts largest first. */
const defaultDescending = (key: string) => !(key === "name" || key === "team" || key === "status");

/** Accents and case dropped, for the name search. */
function searchKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function PlayersTable({
  rows,
  caption,
  showTeam = true,
  controls = true,
  initialSort = { key: "points", descending: true },
  initialMinutes = 0,
  teams,
}: {
  rows: PlayerTableRow[];
  caption: string;
  showTeam?: boolean;
  /** Search, minimum minutes and team filters. With them, the view is kept in the URL. */
  controls?: boolean;
  initialSort?: { key: SortKey; descending: boolean };
  initialMinutes?: number;
  /** Team filter options; omit to hide the filter. */
  teams?: Array<{ id: string; code: string; name: string }>;
}) {
  // The filters and sort as one state, mirrored in the URL when the table has controls:
  // a link reproduces the view, and Back restores the previous selection. The team page's
  // roster table, without controls, keeps its sort to itself.
  const defaults = useMemo<PlayersQuery>(
    () => ({ q: "", min: initialMinutes, team: "all", sort: initialSort.key, desc: initialSort.descending }),
    [initialMinutes, initialSort.key, initialSort.descending],
  );
  const options = useMemo<PlayersQueryOptions>(
    () => ({ sortKeys: SORT_KEYS, minutes: MINUTE_FILTERS, teams: teams ?? [], defaultDescending }),
    [teams],
  );
  const parse = useCallback(
    (search: string) => (controls ? parsePlayersQuery(search, defaults, options) : defaults),
    [controls, defaults, options],
  );
  const serialize = useCallback(
    (state: PlayersQuery) => (controls ? serializePlayersQuery(state, defaults, options) : ""),
    [controls, defaults, options],
  );
  const [state, update] = useQueryState(defaults, parse, serialize);
  const [localSort, setLocalSort] = useState(initialSort);
  const sort = useMemo(
    () => (controls ? { key: state.sort as SortKey, descending: state.desc } : localSort),
    [controls, state.sort, state.desc, localSort],
  );
  const query = state.q;
  const minutes = state.min;
  const team = state.team;
  const ids = useId();

  const columns = useMemo<Column[]>(
    () => [
      ...(showTeam
        ? [
            {
              key: "team" as const,
              label: "Team",
              title: "His team in his latest game",
              value: (row: PlayerTableRow) => row.teamCode,
              cell: (row: PlayerTableRow) => (
                <span className="inline-flex items-center gap-1.5">
                  <TeamLogo teamId={row.teamId} size={16} />
                  {row.teamCode}
                </span>
              ),
            },
          ]
        : []),
      ...COLUMNS,
      {
        key: "status",
        label: "Status",
        title: "His status on his team's injury list for its next game",
        value: (row) => row.status?.order ?? null,
        cell: (row) =>
          row.status ? (
            <span title={row.status.label}>
              <StatusTag tone={row.status.tone}>{row.status.short}</StatusTag>
            </span>
          ) : (
            <span className="text-ink-3">–</span>
          ),
      },
    ],
    [showTeam],
  );

  const shown = useMemo(() => {
    const needle = searchKey(query.trim());
    const filtered = rows.filter(
      (row) =>
        (needle === "" || searchKey(row.name).includes(needle)) &&
        (minutes === 0 || (row.perGame?.minutes ?? 0) >= minutes) &&
        (team === "all" || row.teamId === team),
    );
    const column = columns.find((candidate) => candidate.key === sort.key);
    const valueOf = (row: PlayerTableRow) => (sort.key === "name" ? row.name : (column?.value(row) ?? null));
    return [...filtered].sort((a, b) => {
      const x = valueOf(a);
      const y = valueOf(b);
      if (x === null || y === null) return x === y ? a.name.localeCompare(b.name) : x === null ? 1 : -1;
      const order = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
      return (sort.descending ? -order : order) || a.name.localeCompare(b.name);
    });
  }, [rows, query, minutes, team, sort, columns]);

  const sortBy = (key: SortKey) => {
    const next = sort.key === key ? { key, descending: !sort.descending } : { key, descending: defaultDescending(key) };
    if (controls) update({ ...state, sort: next.key, desc: next.descending }, "replace");
    else setLocalSort(next);
  };

  const header = (key: SortKey, label: string, title: string, className = "") => {
    const active = sort.key === key;
    return (
      <th
        key={key}
        scope="col"
        aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
        className={`sticky top-0 z-10 whitespace-nowrap border-b-2 border-ink bg-panel px-2 py-2.5 align-bottom xl:top-[68px] ${className}`}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          title={title}
          className={`inline-flex items-center gap-1 text-[12.5px] font-medium leading-tight hover:text-ink ${active ? "text-ink" : "text-ink-3"}`}
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
      {controls ? (
        <div className="mb-4 grid gap-3 rounded-[var(--radius-card)] border border-line bg-panel p-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label htmlFor={`${ids}-search`} className="kicker block">Search</label>
            <input
              id={`${ids}-search`}
              type="search"
              value={query}
              onChange={(event) => update({ ...state, q: event.target.value }, "replace")}
              placeholder="Player name"
              autoComplete="off"
              className="pp-select mt-1.5"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-minutes`} className="kicker block">Minutes per game</label>
            <select id={`${ids}-minutes`} value={minutes} onChange={(event) => update({ ...state, min: Number(event.target.value) })} className="pp-select mt-1.5">
              {MINUTE_FILTERS.map((value) => (
                <option key={value} value={value}>{value === 0 ? "Any, including no games" : `At least ${value}`}</option>
              ))}
            </select>
          </div>
          {teams ? (
            <div>
              <label htmlFor={`${ids}-team`} className="kicker block">Team</label>
              <select id={`${ids}-team`} value={team} onChange={(event) => update({ ...state, team: event.target.value })} className="pp-select mt-1.5">
                <option value="all">All teams</option>
                {teams.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
      {controls ? (
        <p className="num mb-3 text-[12.5px] text-ink-2" role="status">
          {shown.length} of {rows.length} players
          {query.trim() !== "" || minutes !== defaults.min || team !== "all" ? (
            <>
              {" · "}
              <button type="button" className="pp-link font-normal" onClick={() => update({ ...defaults, sort: state.sort, desc: state.desc })}>
                Clear filters
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="max-h-[78vh] overflow-auto rounded-[var(--radius-card)] border border-line bg-panel xl:max-h-none xl:overflow-visible">
        <table className="w-full border-separate border-spacing-0 text-[13.5px]">
          <caption className="sr-only">{caption} Column headings sort the table.</caption>
          <thead>
            <tr>
              {header("name", "Player", "Sort by name", "sticky left-0 z-20 min-w-[8.5rem] pl-3 text-left sm:min-w-[12rem] sm:pl-4")}
              {columns.map((column) =>
                header(
                  column.key,
                  column.label,
                  column.title,
                  `${column.key === "team" || column.key === "status" ? "text-left" : "text-right"} ${column.key === "team" ? "hidden sm:table-cell" : ""}`,
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-6 text-center text-[14px] text-ink-2">
                  No player matches.
                </td>
              </tr>
            ) : (
              shown.map((row) => (
                <tr key={`${row.teamId}-${row.athleteId}`} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] border-b border-line bg-panel py-2 pl-3 pr-2 text-left font-normal group-hover:bg-wash sm:pl-4"
                  >
                    <PlayerLink athleteId={row.athleteId} name={row.name} className="font-medium text-ink" />
                    <span className="block text-[11.5px] leading-4 text-ink-3">
                      {showTeam ? <span className="sm:hidden">{row.teamCode}{row.position ? " · " : ""}</span> : null}
                      {[row.position, row.nowWith ? `now with ${row.nowWith}` : null].filter(Boolean).join(" · ") || " "}
                    </span>
                  </th>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`num whitespace-nowrap border-b border-line px-2 py-2 group-hover:bg-wash ${
                        column.key === "team" || column.key === "status" ? "text-left" : "text-right"
                      } ${column.key === "team" ? "hidden sm:table-cell" : ""} ${column.key === sort.key ? "font-semibold text-ink" : "text-ink-2"}`}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
