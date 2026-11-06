import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dayHref } from "@/components/live/DateStrip";
import {
  MarginSection,
  MatchupHeader,
  NoNumber,
  OutSection,
  Result,
  Seals,
  SeasonSoFar,
  WhereFrom,
} from "@/components/live/GameSections";
import { AutoRefresh } from "@/components/live/AutoRefresh";
import { Ticker } from "@/components/live/Ticker";
import { loadDayView } from "@/lib/live-data/day-loader";
import { getGameById, getLiveState, getSeasonGames } from "@/lib/live-data/published";
import { formatLongDay, formatShortDay } from "@/lib/utils/dates";
import { buildGameDetail, nextGameFor } from "@/lib/view/game";
import { seasonLine } from "@/lib/view/game-page";
import { seasonLengths } from "@/lib/view/odds";
import { recordsThrough, teamDisplay, teamLines } from "@/lib/view/teams";

// Rendered on demand from main's published data and re-rendered about once a minute
// (src/lib/live-data/published.ts). No paths are built ahead: data commits do not deploy.
export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ gameId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { gameId } = await params;
  const game = await getGameById(gameId);
  if (!game) return { title: "Game not found" };
  const away = teamDisplay(game.awayId);
  const home = teamDisplay(game.homeId);
  return {
    title: `${away.name} at ${home.name}, ${formatLongDay(game.etDate)}`,
    description: `548's win probability for ${away.shortName} at ${home.shortName}, what moves it, the sealed forecasts and the result.`,
  };
}

const DEFAULT_SEASON_GAMES = 82;

export default async function GamePage({ params }: Params) {
  const { gameId } = await params;
  const stored = await getGameById(gameId);
  if (!stored) notFound();
  const day = await loadDayView(stored.etDate);
  const game = day.games.find((row) => row.id === gameId);
  if (!game) notFound();

  const [liveState, games] = await Promise.all([getLiveState(), getSeasonGames()]);
  const detail = buildGameDetail({ state: liveState, game, storeGames: games });
  const lines = day.kind === "past" ? recordsThrough(games, day.etDate) : teamLines(liveState);
  const current = teamLines(liveState);
  const forecasts = new Map(liveState.forecast.teams.map((team) => [team.teamId, team]));
  const lengths = seasonLengths(games);
  const today = day.kind === "today";
  const hasNumber = game.forecast !== null || game.projection !== null;
  const weekday = formatLongDay(game.etDate).split(",")[0];

  return (
    <>
      <Ticker />
      <main className="pp-container pb-4 pt-7 sm:pt-11">
        <nav aria-label="Breadcrumb" className="mb-[22px] text-[13px]">
          <Link href={dayHref(game.etDate, day.todayEtDate)} className="text-ink-2 hover:text-ink hover:underline hover:underline-offset-4">
            <span aria-hidden>← </span>
            {weekday}, {formatShortDay(game.etDate)}
          </Link>
        </nav>
        <h1 className="sr-only">
          {teamDisplay(game.awayId).name} at {teamDisplay(game.homeId).name}
        </h1>
        <MatchupHeader game={game} lines={lines} modelVersion={liveState.modelVersion} />
        <div className="mt-14 grid items-start gap-x-[72px] gap-y-14 sm:mt-[72px] lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-14 sm:gap-[72px]">
            {hasNumber ? <MarginSection game={game} /> : <NoNumber game={game} />}
            {detail.breakdown ? <WhereFrom game={game} breakdown={detail.breakdown} detail={detail} /> : null}
            <OutSection game={game} today={today} />
          </div>
          <aside aria-label="Result, seals and both teams" className="flex min-w-0 flex-col gap-14 sm:gap-[60px]">
            <Result game={game} detail={detail} />
            <Seals game={game} detail={detail} />
            <SeasonSoFar
              today={today}
              teams={[game.awayId, game.homeId].map((teamId) => {
                const forecast = forecasts.get(teamId);
                return {
                  teamId,
                  line: current[teamId],
                  forecast,
                  season: forecast ? seasonLine(forecast, lengths[teamId] ?? DEFAULT_SEASON_GAMES) : null,
                  next: nextGameFor(games, teamId, game.tipUtc),
                };
              })}
            />
          </aside>
        </div>
      </main>
      {today ? <AutoRefresh live={game.status === "in-progress"} /> : null}
    </>
  );
}
