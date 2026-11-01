"use client";

import { useMemo, useState } from "react";
import { teamById } from "@/lib/season/teams";
import type { Conference, TeamForecast } from "@/lib/season/types";
import { formatPercent } from "@/lib/utils/format";

type SortKey =
  | "champion"
  | "reachFinals"
  | "reachConferenceFinals"
  | "reachSemifinals"
  | "makePlayoffs"
  | "topSix"
  | "projectedWins"
  | "rating";

const COLUMNS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: "rating", label: "Rating", title: "Points better than an average team, with its uncertainty" },
  { key: "projectedWins", label: "Proj. wins", title: "Mean projected wins, with the 10th to 90th percentile" },
  { key: "topSix", label: "Top 6", title: "Chance of a top-6 seed and a direct playoff spot" },
  { key: "makePlayoffs", label: "Playoffs", title: "Chance of reaching the playoffs, including through the play-in" },
  { key: "reachSemifinals", label: "Round 2", title: "Chance of reaching the conference semifinals" },
  { key: "reachConferenceFinals", label: "Conf. finals", title: "Chance of reaching the conference finals" },
  { key: "reachFinals", label: "Finals", title: "Chance of reaching the NBA Finals" },
  { key: "champion", label: "Title", title: "Chance of winning the championship" },
];

function heatClass(value: number): string {
  if (value < 0.0005) return "pp-heat-zero";
  if (value < 0.1) return "pp-heat-low";
  if (value < 0.4) return "pp-heat-mid";
  return "pp-heat-high";
}

function ProbabilityCell({ value }: { value: number }) {
  return (
    <td className="num">
      <span className={`pp-heat ${heatClass(value)}`}>
        {value < 0.0005 ? "<0.1%" : formatPercent(value)}
      </span>
    </td>
  );
}

function ConferenceTable({
  conference,
  rows,
  sortKey,
  onSort,
}: {
  conference: Conference;
  rows: TeamForecast[];
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b[sortKey] - a[sortKey]),
    [rows, sortKey],
  );
  return (
    <div className="pp-card">
      <div className="pp-section-head">
        <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{conference}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="pp-table">
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col" className="num">
                Record
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="num"
                  aria-sort={sortKey === column.key ? "descending" : "none"}
                  title={column.title}
                >
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                    className={`uppercase ${
                      sortKey === column.key
                        ? "text-[var(--color-text-primary)] underline underline-offset-4"
                        : ""
                    }`}
                  >
                    {column.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const team = teamById(row.teamId);
              return (
                <tr key={row.teamId}>
                  <th
                    scope="row"
                    className="!font-[inherit] !text-[13px] !normal-case !tracking-normal"
                    title={team.name}
                  >
                    {team.abbreviation}
                  </th>
                  <td className="num">
                    {row.wins}-{row.losses}
                  </td>
                  <td className="num">
                    {row.rating > 0 ? "+" : ""}
                    {row.rating.toFixed(1)} <span className="text-[var(--color-text-muted)]">±{row.ratingSd.toFixed(1)}</span>
                  </td>
                  <td className="num">
                    {row.projectedWins.toFixed(1)}{" "}
                    <span className="text-[var(--color-text-muted)]">
                      {row.projectedWinsP10}-{row.projectedWinsP90}
                    </span>
                  </td>
                  <ProbabilityCell value={row.topSix} />
                  <ProbabilityCell value={row.makePlayoffs} />
                  <ProbabilityCell value={row.reachSemifinals} />
                  <ProbabilityCell value={row.reachConferenceFinals} />
                  <ProbabilityCell value={row.reachFinals} />
                  <ProbabilityCell value={row.champion} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SeasonTable({ teams }: { teams: TeamForecast[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("champion");
  const east = teams.filter((row) => teamById(row.teamId).conference === "East");
  const west = teams.filter((row) => teamById(row.teamId).conference === "West");
  return (
    <div className="grid gap-3">
      <ConferenceTable conference="East" rows={east} sortKey={sortKey} onSort={setSortKey} />
      <ConferenceTable conference="West" rows={west} sortKey={sortKey} onSort={setSortKey} />
    </div>
  );
}
