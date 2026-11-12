"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { StatusTag } from "@/components/live/Badge";
import { PlayerLink } from "@/components/live/PlayerLink";
import { SortHeader } from "@/components/live/SortHeader";
import { TeamLink } from "@/components/live/TeamLink";
import { useQueryState } from "@/components/live/useQueryState";
import { parsePlayersQuery, serializePlayersQuery, type PlayersQuery, type PlayersQueryOptions } from "@/lib/view/filters";
import { SCORE_LABEL } from "@/lib/season/player-stats";
import { formatAverage, formatScore, formatShooting, type PlayerTableRow, type StatLine } from "@/lib/view/players";

export type SortKey =
  | "name"
  | "team"
  | "games"
  | "starts"
  | keyof StatLine
  | "fieldGoal"
  | "threePoint"
  | "freeThrow"
  | "score"
  | "status";

type Column = {
  key: SortKey;
  label: string;
  /** The column's full name, for the phone's sort menu and the mouse tooltip. */
  title: string;
  /** A "?" explanation beside the heading. */
  hint?: string;
  /** Short unit for the phone's summary line: "29.9 pts", or with unitFirst "FG% 52.1". */
  unit?: string;
  unitFirst?: boolean;
  /** Null sorts last in either direction. */
  value: (row: PlayerTableRow) => number | string | null;
  cell: (row: PlayerTableRow) => React.ReactNode;
};

const stat = (key: keyof StatLine, label: string, title: string, unit: string, hint?: string): Column => ({
  key,
  label,
  title,
  hint,
  unit,
  value: (row) => row.perGame?.[key] ?? null,
  cell: (row) => formatAverage(row.perGame?.[key] ?? null),
});

const shooting = (key: keyof PlayerTableRow["shooting"], label: string, title: string): Column => ({
  key,
  label,
  title,
  unit: label,
  unitFirst: true,
  value: (row) => row.shooting[key],
  cell: (row) => formatShooting(row.shooting[key]),
});

const COLUMNS: Column[] = [
  {
    key: "games",
    label: "GP",
    title: "Games played",
    hint: "Games he played: a stored box score shows him on the floor. Games he sat out are not counted.",
    unit: "GP",
    value: (row) => row.games,
    cell: (row) => row.games,
  },
  {
    key: "starts",
    label: "GS",
    title: "Games started",
    hint: "Games he started, out of the games he played.",
    unit: "GS",
    value: (row) => row.starts,
    cell: (row) => row.starts,
  },
  stat("minutes", "Min", "Minutes per game", "min"),
  stat("points", "Pts", "Points per game", "pts"),
  stat("rebounds", "Reb", "Rebounds per game", "reb"),
  stat("assists", "Ast", "Assists per game", "ast"),
  stat("steals", "Stl", "Steals per game", "stl"),
  stat("blocks", "Blk", "Blocks per game", "blk"),
  stat("turnovers", "TO", "Turnovers per game", "TO", "Turnovers: times per game he lost the ball to the other team."),
  shooting("fieldGoal", "FG%", "Field goal percentage"),
  shooting("threePoint", "3P%", "Three-point percentage"),
  shooting("freeThrow", "FT%", "Free throw percentage"),
  {
    key: "score",
    label: "548 score",
    title: "548 score",
    hint: `${SCORE_LABEL} It is not a reliable ranking of players and cannot see most defence. A dash means no box score this season or in the three before.`,
    unit: "548 score",
    unitFirst: true,
    value: (row) => row.score,
    cell: (row) => formatScore(row.score),
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
  "score",
  "status",
] as const satisfies ReadonlyArray<SortKey>;

/** Names, teams and statuses sort A to Z first; every number sorts largest first. */
const defaultDescending = (key: string) => !(key === "name" || key === "team" || key === "status");

/** The phone's summary line always shows these; a sort by another column adds it. */
const SUMMARY_KEYS: SortKey[] = ["points", "rebounds", "assists", "score"];

/** Accents and case dropped, for the name search. */
function searchKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * True from the first render after hydration. A filtered list marked `data-qwait`
 * stays hidden until then when the URL carries filters (QueryWaitScript), so a link
 * with filters never shows the unfiltered list first (NAV-22).
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  // Set in the same effect pass in which useQueryState reads the URL, so both land in one render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/**
 * An inline script that runs before the list is painted: when the URL has any of
 * `keys`, it hides every `[data-qwait]` element until the component drops the
 * attribute after hydration (with a four-second fallback, should hydration fail).
 */
export function QueryWaitScript({ keys }: { keys: readonly string[] }) {
  const code = `(function(){try{var p=new URLSearchParams(location.search);if(!${JSON.stringify(keys)}.some(function(k){return p.has(k)}))return;if(document.getElementById("pp-qwait"))return;var s=document.createElement("style");s.id="pp-qwait";s.textContent="[data-qwait]{visibility:hidden}";document.head.appendChild(s);setTimeout(function(){s.remove()},4000)}catch(e){}})();`;
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: code }} />;
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
  const hydrated = useHydrated();
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
              title: "Team",
              value: (row: PlayerTableRow) => row.teamCode,
              cell: (row: PlayerTableRow) => <TeamLink teamId={row.teamId} form="code" logo={16} />,
            },
          ]
        : []),
      // Status beside the name, as on phones, so it shows without sideways scrolling
      // wherever the stats need a scroll box (768 to 1100 px).
      {
        key: "status",
        label: "Status",
        title: "Injury status",
        value: (row: PlayerTableRow) => row.status?.order ?? null,
        cell: (row: PlayerTableRow) => <StatusCell row={row} />,
      },
      ...COLUMNS,
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

  const setSort = (next: { key: SortKey; descending: boolean }) => {
    if (controls) update({ ...state, sort: next.key, desc: next.descending }, "replace");
    else setLocalSort(next);
  };
  const sortBy = (key: SortKey) =>
    setSort(sort.key === key ? { key, descending: !sort.descending } : { key, descending: defaultDescending(key) });

  const filtered = query.trim() !== "" || minutes !== defaults.min || team !== "all";
  const isText = sort.key === "name" || sort.key === "team" || sort.key === "status";
  const summaryColumns = COLUMNS.filter((column) => SUMMARY_KEYS.includes(column.key) || column.key === sort.key);
  // Sticky under the masthead where the table is not in its own scroll box (xl up).
  const stickyHead = "sticky top-0 bg-panel xl:top-[var(--mast)]";

  return (
    <div data-qwait={controls && !hydrated ? "" : undefined}>
      {controls ? <QueryWaitScript keys={["q", "min", "team", "sort", "dir"]} /> : null}
      <div className={`flex flex-wrap items-end gap-x-5 gap-y-3 ${controls ? "mb-5" : "mb-3 sm:hidden"}`}>
        {controls ? (
          <>
            <div className="w-full sm:w-auto sm:min-w-[14rem] sm:flex-1 lg:max-w-[22rem]">
              <label htmlFor={`${ids}-search`} className="kicker block">Search</label>
              <input
                id={`${ids}-search`}
                type="search"
                value={query}
                onChange={(event) => update({ ...state, q: event.target.value }, "replace")}
                placeholder="Player name"
                autoComplete="off"
                className="pp-select mt-1.5 min-h-11"
              />
            </div>
            <div className="min-w-0 flex-1 sm:w-52 sm:flex-none">
              <label htmlFor={`${ids}-minutes`} className="kicker block">Minutes per game</label>
              <select id={`${ids}-minutes`} value={minutes} onChange={(event) => update({ ...state, min: Number(event.target.value) })} className="pp-select mt-1.5 min-h-11">
                {MINUTE_FILTERS.map((value) => (
                  <option key={value} value={value}>{value === 0 ? "Any, including no games" : `At least ${value}`}</option>
                ))}
              </select>
            </div>
            {teams ? (
              <div className="min-w-0 flex-1 sm:w-60 sm:flex-none">
                <label htmlFor={`${ids}-team`} className="kicker block">Team</label>
                <select id={`${ids}-team`} value={team} onChange={(event) => update({ ...state, team: event.target.value })} className="pp-select mt-1.5 min-h-11">
                  <option value="all">All teams</option>
                  {teams.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </>
        ) : null}
        {/* Phones: the column headings are hidden, so sorting is a menu and an order button. */}
        <div className="flex w-full items-end gap-2 sm:hidden">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${ids}-sort`} className="kicker block">Sort by</label>
            <select
              id={`${ids}-sort`}
              value={sort.key}
              onChange={(event) => {
                const key = event.target.value as SortKey;
                setSort({ key, descending: defaultDescending(key) });
              }}
              className="pp-select mt-1.5 min-h-11"
            >
              <option value="name">Name</option>
              {columns.map((column) => (
                <option key={column.key} value={column.key}>{column.title}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setSort({ key: sort.key, descending: !sort.descending })}
            className="pp-button min-h-11 flex-none px-3 text-14"
            aria-label={`Order: ${orderText(isText, sort.descending)}. Reverse the order`}
          >
            {orderText(isText, sort.descending)}
          </button>
        </div>
      </div>
      {controls ? (
        <p className="num mb-2 text-13 text-ink-2" role="status">
          {shown.length} of {rows.length} players
          {filtered ? (
            <>
              {" · "}
              <button
                type="button"
                className="pp-link font-normal"
                onClick={() => update({ ...defaults, sort: state.sort, desc: state.desc })}
              >
                Clear filters
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="sm:max-h-[78vh] sm:overflow-auto xl:max-h-none xl:overflow-visible">
        <table className="tb players-tb">
          <caption className="sr-only">{caption} Column headings sort the table.</caption>
          <thead className="max-sm:hidden">
            <tr>
              <SortHeader
                label="Player"
                active={sort.key === "name"}
                descending={sort.descending}
                onSort={() => sortBy("name")}
                title="Sort by name"
                className={`${stickyHead} left-0 z-20 min-w-[11rem]`}
              />
              {columns.map((column) => (
                <SortHeader
                  key={column.key}
                  label={column.label}
                  active={sort.key === column.key}
                  descending={sort.descending}
                  onSort={() => sortBy(column.key)}
                  align={column.key === "team" || column.key === "status" ? "left" : "right"}
                  title={column.title === column.label ? undefined : column.title}
                  hint={column.hint}
                  hintLabel={column.title}
                  className={`${stickyHead} z-10`}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="!py-6 text-center text-14 !text-ink-2">
                  No player matches.
                </td>
              </tr>
            ) : (
              shown.map((row) => (
                <tr key={`${row.teamId}-${row.athleteId}`} className="group">
                  <th scope="row" className="bg-panel text-left group-hover:bg-wash max-sm:whitespace-normal sm:sticky sm:left-0 sm:z-[1]">
                    <div className="flex items-center gap-3">
                      {showTeam ? (
                        <span className="w-[4.25rem] flex-none sm:hidden">
                          <TeamLink teamId={row.teamId} form="code" logo={16} className="-my-3 py-3" />
                        </span>
                      ) : null}
                      <div className="relative min-w-0 flex-1">
                        <PlayerLink
                          athleteId={row.athleteId}
                          name={row.name}
                          className="players-name font-medium text-ink max-sm:after:absolute max-sm:after:-inset-y-2 max-sm:after:inset-x-0 max-sm:after:content-['']"
                        />
                        <span className="block text-12 leading-4 text-ink-2">
                          <span className="max-sm:hidden">{row.position ?? " "}</span>
                          <span className="sm:hidden">
                            {row.perGame === null ? <span>No games this season · </span> : null}
                            {(row.perGame === null ? summaryColumns.filter((column) => column.key === "score") : summaryColumns).map((column, index) => (
                              <span key={column.key}>
                                {index > 0 ? " · " : ""}
                                <span className={`whitespace-nowrap ${column.key === sort.key ? "font-semibold text-ink" : ""}`}>
                                  {column.unitFirst ? `${column.unit} ${column.cell(row)}` : `${column.cell(row)} ${column.unit}`}
                                </span>
                              </span>
                            ))}
                          </span>
                        </span>
                      </div>
                      <span className="flex-none sm:hidden">
                        <StatusCell row={row} />
                      </span>
                    </div>
                    {row.nowWith ? (
                      <span className="mt-0.5 block text-12 leading-4 text-ink-2">
                        now with{" "}
                        <TeamLink teamId={row.nowWithId ?? row.teamId} form="code" className="relative z-[2] font-medium text-ink" />
                      </span>
                    ) : null}
                  </th>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`whitespace-nowrap group-hover:bg-wash max-sm:hidden ${
                        column.key === "team" || column.key === "status" ? "" : "nm"
                      } ${column.key === sort.key ? "font-semibold" : "!text-ink-2"}`}
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

function orderText(isText: boolean, descending: boolean): string {
  if (isText) return descending ? "Z to A" : "A to Z";
  return descending ? "High to low" : "Low to high";
}

function StatusCell({ row }: { row: PlayerTableRow }) {
  if (!row.status) return <span className="text-ink-2" aria-label="Not on the injury list">–</span>;
  return <StatusTag tone={row.status.tone} title={row.status.label}>{row.status.short}</StatusTag>;
}
