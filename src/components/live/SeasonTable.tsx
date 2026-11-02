"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { heatClass } from "@/components/live/heat";
import { TeamLogo } from "@/components/live/TeamLogo";
import { teamById } from "@/lib/season/teams";
import type { Conference, SeasonPhase, TeamForecast } from "@/lib/season/types";
import { formatChance, formatPointChange } from "@/lib/utils/format";

type ProbabilityKey =
  | "topSix"
  | "makePlayoffs"
  | "reachSemifinals"
  | "reachConferenceFinals"
  | "reachFinals"
  | "champion";

type SortKey = "team" | "record" | "rating" | "now" | "projectedWins" | ProbabilityKey | "change";
type Direction = "ascending" | "descending";

const PROBABILITY_COLUMNS: Array<{ key: ProbabilityKey; label: string; title: string }> = [
  { key: "topSix", label: "Top 6", title: "Chance of a top-six seed, which skips the play-in" },
  {
    key: "makePlayoffs",
    label: "Playoffs",
    title: "Chance of reaching the playoffs, directly or through the play-in",
  },
  { key: "reachSemifinals", label: "Round 2", title: "Chance of reaching the conference semifinals" },
  {
    key: "reachConferenceFinals",
    label: "Conf. finals",
    title: "Chance of reaching the conference finals",
  },
  { key: "reachFinals", label: "Finals", title: "Chance of reaching the NBA Finals" },
  { key: "champion", label: "Title", title: "Chance of winning the championship" },
];

function winShare(row: TeamForecast): number {
  const games = row.wins + row.losses;
  return games === 0 ? 0 : row.wins / games;
}

function sortValue(
  row: TeamForecast,
  key: SortKey,
  change: Record<string, number> | null,
  currentRatings: Record<string, number>,
): number | string {
  switch (key) {
    case "team":
      return teamById(row.teamId).name;
    case "record":
      return winShare(row) * 1000 + row.wins;
    case "change":
      return change?.[row.teamId] ?? Number.NEGATIVE_INFINITY;
    case "now":
      return currentRatings[row.teamId] ?? row.rating;
    default:
      return row[key];
  }
}

function SortHeader({
  label,
  sub,
  title,
  column,
  sort,
  onSort,
  align = "right",
  className = "",
}: {
  label: string;
  sub?: string;
  title: string;
  column: SortKey;
  sort: { key: SortKey; direction: Direction };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = sort.direction === "descending" ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? sort.direction : "none"}
      title={title}
      className={`sticky top-0 z-20 border-b border-[var(--color-border-strong)] bg-[var(--color-panel-primary)] px-2.5 py-2.5 align-bottom ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 rounded text-xs font-semibold leading-4 ${
          align === "right" ? "flex-row-reverse text-right" : "text-left"
        } ${active ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
      >
        <span className="flex flex-col">
          <span className="whitespace-nowrap">{label}</span>
          {sub ? <span className="whitespace-nowrap font-normal text-[var(--color-text-muted)]">{sub}</span> : null}
        </span>
        {active ? <Icon size={12} aria-hidden className="shrink-0" /> : null}
      </button>
    </th>
  );
}

function signed(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
}

function ConferenceTable({
  conference,
  rows,
  sort,
  onSort,
  change,
  changeSince,
  exact,
  currentRatings,
}: {
  conference: Conference;
  rows: TeamForecast[];
  sort: { key: SortKey; direction: Direction };
  onSort: (key: SortKey) => void;
  change: Record<string, number> | null;
  changeSince: string | null;
  exact: boolean;
  /** Rating with current absences, or null when the published state has none. */
  currentRatings: Record<string, number> | null;
}) {
  const sorted = useMemo(() => {
    const factor = sort.direction === "ascending" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const first = sortValue(a, sort.key, change, currentRatings ?? {});
      const second = sortValue(b, sort.key, change, currentRatings ?? {});
      if (typeof first === "string" && typeof second === "string") {
        return factor * first.localeCompare(second);
      }
      return factor * ((first as number) - (second as number)) || b.champion - a.champion;
    });
  }, [rows, sort, change, currentRatings]);

  return (
    <section aria-labelledby={`conference-${conference}`} className="flex flex-col gap-3">
      <h3
        id={`conference-${conference}`}
        className="text-base font-semibold text-[var(--color-text-primary)]"
      >
        {conference === "East" ? "Eastern Conference" : "Western Conference"}
      </h3>
      <div className="max-h-[75vh] overflow-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] xl:max-h-none xl:overflow-visible">
        <table
          className={`w-full ${currentRatings ? "min-w-[1026px]" : "min-w-[930px]"} table-fixed border-separate border-spacing-0 text-sm tabular`}
        >
          <caption className="sr-only">
            {conference === "East" ? "Eastern" : "Western"} Conference season forecast. Column
            headers sort the table.
          </caption>
          {/* Fixed widths keep both conference tables aligned; the team column takes the rest. */}
          <colgroup>
            <col />
            <col className="w-16" />
            <col className="w-24" />
            {currentRatings ? <col className="w-24" /> : null}
            <col className="w-[5.5rem]" />
            {PROBABILITY_COLUMNS.map((column) => (
              <col
                key={column.key}
                className={column.key === "reachConferenceFinals" ? "w-24" : "w-[4.75rem]"}
              />
            ))}
            {change ? <col className="w-28" /> : null}
          </colgroup>
          <thead>
            <tr>
              <SortHeader
                label="Team"
                title="Sort by team name"
                column="team"
                sort={sort}
                onSort={onSort}
                align="left"
                className="left-0 z-30 rounded-tl-xl shadow-[inset_-1px_0_0_var(--color-border-subtle)] xl:shadow-none"
              />
              <SortHeader label="Record" title="Wins and losses so far" column="record" sort={sort} onSort={onSort} />
              <SortHeader
                label="Rating"
                sub="± uncertainty"
                title={
                  currentRatings
                    ? "Full strength: points per game better than an average team with everyone available, with one standard deviation of uncertainty"
                    : "Points per game better than an average team, with one standard deviation of uncertainty"
                }
                column="rating"
                sort={sort}
                onSort={onSort}
              />
              {currentRatings ? (
                <SortHeader
                  label="Now"
                  sub="with absences"
                  title="The full-strength rating minus the points this team gives up in its next game to players the model currently counts as out. Display only."
                  column="now"
                  sort={sort}
                  onSort={onSort}
                />
              ) : null}
              <SortHeader
                label="Proj. wins"
                sub="10th-90th"
                title="Average projected final wins, with the 10th to 90th percentile range"
                column="projectedWins"
                sort={sort}
                onSort={onSort}
              />
              {PROBABILITY_COLUMNS.map((column) => (
                <SortHeader
                  key={column.key}
                  label={column.label}
                  title={column.title}
                  column={column.key}
                  sort={sort}
                  onSort={onSort}
                />
              ))}
              {change ? (
                <SortHeader
                  label="Title change"
                  sub={changeSince ? `pts since ${changeSince}` : "pts"}
                  title={`Change in title odds, in percentage points${changeSince ? `, since ${changeSince}` : ""}`}
                  column="change"
                  sort={sort}
                  onSort={onSort}
                  className="rounded-tr-xl"
                />
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const team = teamById(row.teamId);
              const delta = change?.[row.teamId];
              const cell = "border-b border-[var(--color-border-subtle)] px-2.5 py-2 text-right";
              return (
                <tr key={row.teamId} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] px-2.5 py-2 text-left font-medium text-[var(--color-text-primary)] shadow-[inset_-1px_0_0_var(--color-border-subtle)] group-hover:bg-[#f9fafb] xl:shadow-none"
                  >
                    <span className="flex items-center gap-2.5 whitespace-nowrap" title={team.name}>
                      <TeamLogo teamId={row.teamId} size={22} />
                      <span className="xl:hidden">{team.abbreviation}</span>
                      <span className="hidden xl:inline">{team.name}</span>
                    </span>
                  </th>
                  <td className={`${cell} text-[var(--color-text-secondary)] group-hover:bg-[#f9fafb]`}>
                    {row.wins}-{row.losses}
                  </td>
                  <td className={`${cell} group-hover:bg-[#f9fafb]`}>
                    <span className="block font-medium text-[var(--color-text-primary)]">
                      {signed(row.rating)}
                    </span>
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      ±{row.ratingSd.toFixed(1)}
                    </span>
                  </td>
                  {currentRatings ? (
                    <td
                      className={`${cell} group-hover:bg-[#f9fafb]`}
                      title={
                        (currentRatings[row.teamId] ?? row.rating) < row.rating - 0.05
                          ? `Gives up ${(row.rating - (currentRatings[row.teamId] ?? row.rating)).toFixed(1)} points to current absences`
                          : "No current absence the model counts"
                      }
                    >
                      <span
                        className={`block ${
                          (currentRatings[row.teamId] ?? row.rating) < row.rating - 0.05
                            ? "font-medium text-[var(--color-text-primary)]"
                            : "text-[var(--color-text-muted)]"
                        }`}
                      >
                        {signed(currentRatings[row.teamId] ?? row.rating)}
                      </span>
                    </td>
                  ) : null}
                  <td className={`${cell} group-hover:bg-[#f9fafb]`}>
                    <span className="block font-medium text-[var(--color-text-primary)]">
                      {row.projectedWins.toFixed(1)}
                    </span>
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {row.projectedWinsP10}-{row.projectedWinsP90}
                    </span>
                  </td>
                  {PROBABILITY_COLUMNS.map((column) => (
                    <td key={column.key} className={`${cell} group-hover:bg-[#f9fafb]`}>
                      <span className={`pp-heat ${heatClass(row[column.key])}`}>
                        {formatChance(row[column.key], { exact })}
                      </span>
                    </td>
                  ))}
                  {change ? (
                    <td className={`${cell} text-[var(--color-text-secondary)] group-hover:bg-[#f9fafb]`}>
                      {delta === undefined ? "–" : formatPointChange(delta)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SeasonTable({
  teams,
  phase,
  change,
  changeSince,
  currentRatings = null,
}: {
  teams: TeamForecast[];
  phase: SeasonPhase;
  /** Change in title odds by team, or null before there is anything to compare. */
  change: Record<string, number> | null;
  changeSince: string | null;
  /** Full-strength rating minus current absence points, by team. Null hides the column. */
  currentRatings?: Record<string, number> | null;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: Direction }>({
    key: "champion",
    direction: "descending",
  });
  const onSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "descending" ? "ascending" : "descending" }
        : { key, direction: key === "team" ? "ascending" : "descending" },
    );
  // Outside the regular season, zeros and ones are settled facts, such as an
  // eliminated team, so they print as 0% and 100%.
  const exact = phase !== "regular-season";
  const conferences: Array<[Conference, TeamForecast[]]> = [
    ["East", teams.filter((row) => teamById(row.teamId).conference === "East")],
    ["West", teams.filter((row) => teamById(row.teamId).conference === "West")],
  ];
  return (
    <div className="flex flex-col gap-8">
      {conferences.map(([conference, rows]) => (
        <ConferenceTable
          key={conference}
          conference={conference}
          rows={rows}
          sort={sort}
          onSort={onSort}
          change={change}
          changeSince={changeSince}
          exact={exact}
          currentRatings={currentRatings}
        />
      ))}
    </div>
  );
}
