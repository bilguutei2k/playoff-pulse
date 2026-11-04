"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { InjuryTable } from "@/components/live/InjuryTable";
import { TeamLogo } from "@/components/live/TeamLogo";
import { STATUS_FILTERS, type InjuryBlock, type InjuryReportView, type InjuryRowView } from "@/lib/view/injury-report";
import type { StatusFilterKey } from "@/lib/view/players";

type StatusChoice = StatusFilterKey | "all";

/**
 * The injuries page's lists with a team and a status filter. Everything is rendered on
 * the server first; filtering only hides rows, lists and games.
 */
export function InjuryReport({
  view,
  teams,
}: {
  view: InjuryReportView;
  /** Every team for the team filter, by name. */
  teams: Array<{ id: string; name: string; shortName: string }>;
}) {
  const [team, setTeam] = useState<string>("all");
  const [status, setStatus] = useState<StatusChoice>("all");
  const selectId = useId();

  const rowsOf = useMemo(
    () => (block: InjuryBlock): InjuryRowView[] =>
      status === "all" ? block.rows : block.rows.filter((row) => row.statusView.filter === status),
    [status],
  );
  const teamMatches = (block: InjuryBlock) => team === "all" || block.teamId === team;
  const shows = (block: InjuryBlock) => teamMatches(block) && (status === "all" || rowsOf(block).length > 0);

  const slates = view.slates.map((slate) => ({
    ...slate,
    games: slate.games.filter((game) => shows(game.away) || shows(game.home)),
  }));
  const others = view.others.filter(shows);
  const players = [...slates.flatMap((slate) => slate.games.flatMap((game) => [game.away, game.home])), ...others]
    .filter(teamMatches)
    .reduce((sum, block) => sum + rowsOf(block).length, 0);
  const filtered = team !== "all" || status !== "all";
  const emptyText = status === "all" ? undefined : "Nobody with this status.";

  return (
    <div>
      <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-panel p-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0 sm:w-64">
          <label htmlFor={selectId} className="kicker block">Team</label>
          <select id={selectId} value={team} onChange={(event) => setTeam(event.target.value)} className="pp-select mt-1.5">
            <option value="all">All teams</option>
            {teams.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </div>
        <fieldset className="min-w-0">
          <legend className="kicker">Status</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={status === option.key}
                onClick={() => setStatus(option.key)}
                className={`pp-button pp-button-compact min-h-9 ${status === option.key ? "pp-button-active" : ""}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="num mt-3 text-[12.5px] text-ink-2" role="status">
        {players} {players === 1 ? "player" : "players"}
        {filtered ? (players === 1 ? " matches" : " match") : " listed or counted"}
        {filtered ? (
          <>
            {" · "}
            <button type="button" className="pp-link font-normal" onClick={() => { setTeam("all"); setStatus("all"); }}>
              Clear filters
            </button>
          </>
        ) : null}
      </p>

      {slates.map((slate) => (
        <section key={slate.etDate} aria-labelledby={`slate-${slate.etDate}`} className="mt-10">
          <h2 id={`slate-${slate.etDate}`} className="headline text-[22px] sm:text-[26px]">{slate.title}</h2>
          <p className="num mt-1 text-[13px] text-ink-2">
            {slate.games.length} {slate.games.length === 1 ? "game" : "games"}
            {filtered ? " shown" : ""} · in tip order · times ET
          </p>
          {slate.games.length === 0 ? (
            <p className="notice-quiet mt-4">No game on this day matches the filters.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {slate.games.map((game) => {
                const sides = [game.away, game.home].filter((block) => teamMatches(block));
                return (
                  <li key={game.gameId}>
                    <article id={`game-${game.gameId}`} aria-labelledby={`title-${game.gameId}`} className="panel overflow-hidden">
                      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-wash px-4 py-2.5 sm:px-5">
                        <h3 id={`title-${game.gameId}`} className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-ink">
                          <TeamLogo teamId={game.awayId} size={18} />
                          <span className="truncate">
                            {teamName(teams, game.awayId)} {game.neutral ? "vs" : "at"} {teamName(teams, game.homeId)}
                          </span>
                          <TeamLogo teamId={game.homeId} size={18} />
                        </h3>
                        <p className="num text-[12.5px] text-ink-2">{game.time}</p>
                        <Link href={`/game/${game.gameId}`} className="pp-link ml-auto text-[13px]">
                          Game page
                        </Link>
                      </header>
                      <div className={`grid divide-y divide-line ${sides.length === 2 ? "lg:grid-cols-2 lg:divide-x lg:divide-y-0" : ""}`}>
                        {sides.map((block) => (
                          <InjuryTable key={block.teamId} block={block} rows={rowsOf(block)} headingLevel="h4" emptyText={emptyText} />
                        ))}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {view.others.length > 0 ? (
        <section aria-labelledby="others-title" className="mt-12">
          <h2 id="others-title" className="headline text-[22px] sm:text-[26px]">Teams not playing on these days</h2>
          <p className="mt-1 text-[14px] text-ink-2">Each team&apos;s list for its next game.</p>
          {others.length === 0 ? (
            <p className="notice-quiet mt-4">No other team matches the filters.</p>
          ) : (
            <ul className="mt-4 grid gap-4 lg:grid-cols-2">
              {others.map((block) => (
                <li key={block.teamId} className="panel overflow-hidden">
                  <InjuryTable block={block} rows={rowsOf(block)} showGame emptyText={emptyText} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function teamName(teams: Array<{ id: string; shortName: string }>, id: string): string {
  return teams.find((team) => team.id === id)?.shortName ?? id;
}
