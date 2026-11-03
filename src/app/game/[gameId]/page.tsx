import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dayHref } from "@/components/live/DateStrip";
import {
  MatchupHeader,
  Result,
  Seals,
  TeamSnapshot,
  WhatMoves,
  WinProbability,
} from "@/components/live/GameSections";
import { AutoRefresh } from "@/components/live/AutoRefresh";
import { loadDayView } from "@/lib/live-data/day-loader";
import { liveState } from "@/lib/season/published";
import { formatLongDay } from "@/lib/utils/dates";
import { buildGameDetail, nextGameFor } from "@/lib/view/game";
import { gameById, seasonGames } from "@/lib/view/store";
import { recordsThrough, teamDisplay, teamLines } from "@/lib/view/teams";

export const revalidate = 60;

type Params = { params: Promise<{ gameId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { gameId } = await params;
  const game = gameById(gameId);
  if (!game) return { title: "Game not found" };
  const away = teamDisplay(game.awayId);
  const home = teamDisplay(game.homeId);
  return {
    title: `${away.name} at ${home.name}, ${formatLongDay(game.etDate)}`,
    description: `548's win probability for ${away.shortName} at ${home.shortName}, what moves it, the sealed forecasts and the result.`,
  };
}

export default async function GamePage({ params }: Params) {
  const { gameId } = await params;
  const stored = gameById(gameId);
  if (!stored) notFound();
  const day = await loadDayView(stored.etDate);
  const game = day.games.find((row) => row.id === gameId);
  if (!game) notFound();

  const games = seasonGames();
  const detail = buildGameDetail({ state: liveState, game, storeGames: games });
  const lines = day.kind === "past" ? recordsThrough(games, day.etDate) : teamLines(liveState);
  const current = teamLines(liveState);
  const forecasts = new Map(liveState.forecast.teams.map((team) => [team.teamId, team]));

  return (
    <main className="pp-container py-6 sm:py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-[14px]">
        <Link href={dayHref(game.etDate, day.todayEtDate)} className="text-ink-2 hover:text-ink">
          <span aria-hidden>← </span>Games on {formatLongDay(game.etDate)}
        </Link>
      </nav>
      <h1 className="sr-only">
        {teamDisplay(game.awayId).name} at {teamDisplay(game.homeId).name}
      </h1>
      <MatchupHeader game={game} lines={lines} modelVersion={liveState.modelVersion} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <WinProbability game={game} />
          {detail.breakdown ? <WhatMoves game={game} breakdown={detail.breakdown} detail={detail} today={day.kind === "today"} /> : null}
          <Result game={game} detail={detail} />
          <Seals game={game} detail={detail} />
        </div>
        <aside aria-label="Both teams" className="flex flex-col gap-4">
          <h2 className="kicker">Both teams today</h2>
          {[game.awayId, game.homeId].map((teamId) => (
            <TeamSnapshot
              key={teamId}
              teamId={teamId}
              forecast={forecasts.get(teamId)}
              line={current[teamId]}
              next={nextGameFor(games, teamId, game.tipUtc)}
            />
          ))}
        </aside>
      </div>
      {day.kind === "today" ? <AutoRefresh live={game.status === "in-progress"} /> : null}
    </main>
  );
}
