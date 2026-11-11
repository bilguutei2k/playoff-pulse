"use client";

import Link from "next/link";
import { useCallback, useId, useMemo } from "react";
import { InjuryTable } from "@/components/live/InjuryTable";
import { QueryWaitScript, useHydrated } from "@/components/live/PlayersTable";
import { SectionHeading } from "@/components/live/SectionHeading";
import { TeamLink } from "@/components/live/TeamLink";
import { useQueryState } from "@/components/live/useQueryState";
import { INJURIES_DEFAULT, parseInjuriesQuery, serializeInjuriesQuery, type InjuriesQuery } from "@/lib/view/filters";
import { STATUS_FILTERS, type InjuryBlock, type InjuryReportView, type InjuryRowView } from "@/lib/view/injury-report";

/**
 * The injuries page's lists with a team and a status filter. Everything is rendered on
 * the server first; filtering only hides rows, lists and games. The filters live in the
 * URL ("/injuries?team=DET&status=out"), so a link reproduces the view, a game page can
 * open a team's list, and Back restores the previous selection. A link that arrives with
 * filters keeps the lists hidden until they are applied (QueryWaitScript).
 */
export function InjuryReport({
  view,
  teams,
  caveat,
  definitions,
}: {
  view: InjuryReportView;
  /** Every team for the team filter, by name. */
  teams: Array<{ id: string; code: string; name: string; shortName: string }>;
  /** What the lists are and are not; always visible, under the filters. */
  caveat?: React.ReactNode;
  /** The source and column definitions, in a collapsed block. */
  definitions?: React.ReactNode;
}) {
  const parse = useCallback((search: string) => parseInjuriesQuery(search, teams), [teams]);
  const serialize = useCallback((state: InjuriesQuery) => serializeInjuriesQuery(state, teams), [teams]);
  const [{ team, status }, update] = useQueryState(INJURIES_DEFAULT, parse, serialize);
  const hydrated = useHydrated();
  const selectId = useId();

  const rowsOf = useMemo(
    () => (block: InjuryBlock): InjuryRowView[] =>
      status === "all" ? block.rows : block.rows.filter((row) => row.statusView.filter === status),
    [status],
  );
  const teamMatches = (block: InjuryBlock) => team === "all" || block.teamId === team;
  const shows = (block: InjuryBlock) => teamMatches(block) && (status === "all" || rowsOf(block).length > 0);

  const slates = view.slates
    .map((slate) => ({
      ...slate,
      games: slate.games.filter((game) => shows(game.away) || shows(game.home)),
    }))
    .filter((slate) => !(team !== "all" || status !== "all") || slate.games.length > 0);
  const others = view.others.filter(shows);
  const players = [...slates.flatMap((slate) => slate.games.flatMap((game) => [game.away, game.home])), ...others]
    .filter(teamMatches)
    .reduce((sum, block) => sum + rowsOf(block).length, 0);
  const filtered = team !== "all" || status !== "all";
  const emptyText = status === "all" ? undefined : "Nobody with this status.";
  const nothing = filtered && slates.length === 0 && others.length === 0;
  const clear = (
    <button type="button" className="pp-link font-normal" onClick={() => update(INJURIES_DEFAULT)}>
      Clear filters
    </button>
  );

  return (
    <div data-qwait={hydrated ? undefined : ""}>
      <QueryWaitScript keys={["team", "status"]} />
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-8">
        <div className="min-w-0 sm:w-64">
          <label htmlFor={selectId} className="kicker block">Team</label>
          <select id={selectId} value={team} onChange={(event) => update({ team: event.target.value, status })} className="pp-select mt-1.5 min-h-11">
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
                onClick={() => update({ team, status: option.key })}
                className={`pp-button pp-button-compact min-h-11 ${status === option.key ? "pp-button-active" : ""}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      {caveat ? <p className="mt-4 max-w-[64ch] text-13 leading-5 text-ink-2">{caveat}</p> : null}
      {definitions ? (
        <details className="group mt-3 max-w-5xl">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-14 font-semibold text-ink">
            <span aria-hidden className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">▸</span>
            What Source, Status and 548 pts mean
          </summary>
          <div className="pb-2 pt-1">{definitions}</div>
        </details>
      ) : null}
      <p className="num mt-3 text-13 text-ink-2" role="status">
        {players} {players === 1 ? "player" : "players"}
        {filtered ? (players === 1 ? " matches" : " match") : " listed or counted"}
        {filtered && !nothing ? <>{" · "}{clear}</> : null}
      </p>

      {nothing ? (
        <p className="notice-quiet mt-8">
          No player matches these filters. {clear}
        </p>
      ) : null}

      {slates.map((slate) => (
        <section key={slate.etDate} aria-labelledby={`slate-${slate.etDate}`} className="mt-12">
          <SectionHeading
            id={`slate-${slate.etDate}`}
            title={slate.title}
            note={`${slate.games.length} ${slate.games.length === 1 ? "game" : "games"}${filtered ? " shown" : ""} · in tip order · times ET`}
          />
          <ul className="mt-2">
            {slate.games.map((game, index) => {
              const sides = [game.away, game.home].filter((block) => teamMatches(block));
              return (
                <li key={game.gameId} className="mt-8 first:mt-0">
                  <article id={`game-${game.gameId}`} aria-labelledby={`title-${game.gameId}`}>
                    <header className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${index === 0 ? "" : "border-t border-line-strong pt-4"}`}>
                      <h3 id={`title-${game.gameId}`} className="min-w-0 text-17 font-bold leading-snug text-ink">
                        <TeamLink teamId={game.awayId} form="full" logo={18} />{" "}
                        <span className="font-normal text-ink-2">{game.neutral ? "vs" : "at"}</span>{" "}
                        <TeamLink teamId={game.homeId} form="full" logo={18} />
                      </h3>
                      <p className="num text-13 text-ink-2">{game.time}</p>
                      <Link href={`/game/${game.gameId}`} className="pp-link ml-auto inline-flex min-h-11 items-center text-13 sm:min-h-0">
                        Game page
                      </Link>
                    </header>
                    <div className={`grid gap-x-10 ${sides.length === 2 ? "lg:grid-cols-2" : ""}`}>
                      {sides.map((block) => (
                        <InjuryTable key={block.teamId} block={block} rows={rowsOf(block)} headingLevel="h4" emptyText={emptyText} />
                      ))}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {view.others.length > 0 && others.length > 0 ? (
        <section aria-labelledby="others-title" className="mt-14">
          <SectionHeading id="others-title" title="Teams not playing on these days" note="Each team's list for its next game" />
          <ul className="mt-2 grid gap-x-10 lg:grid-cols-2">
            {others.map((block) => (
              <li key={block.teamId} className="mt-4 border-t border-ink">
                <InjuryTable block={block} rows={rowsOf(block)} showGame emptyText={emptyText} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
