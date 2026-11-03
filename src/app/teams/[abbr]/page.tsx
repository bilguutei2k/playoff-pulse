import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { AbsenceRows } from "@/components/live/AbsenceList";
import { Badge } from "@/components/live/Badge";
import { heatClass } from "@/components/live/heat";
import { RatingChart, type RatingChartPoint } from "@/components/live/RatingChart";
import { SectionHeading } from "@/components/live/SectionHeading";
import { TeamLogo } from "@/components/live/TeamLogo";
import { getLiveState, getSeasonGames, getSeasonLedger } from "@/lib/live-data/published";
import { teamById } from "@/lib/season/teams";
import { formatShortDay, formatTimeEt, formatWeekday } from "@/lib/utils/dates";
import { formatChance } from "@/lib/utils/format";
import { formatRating, oddsRows, type OddsRow } from "@/lib/view/odds";
import { PROJECTION_LABEL } from "@/lib/view/projection";
import { ratingHistory } from "@/lib/view/rating-history";
import { teamSchedule, type TeamGameRow } from "@/lib/view/team";
import { conferenceOrder, formatRecord, ordinal, teamBySlug, teamColor, teamDisplay } from "@/lib/view/teams";

type Params = { params: Promise<{ abbr: string }> };

// Rendered on demand from main's published data and re-rendered about once a minute
// (src/lib/live-data/published.ts). No paths are built ahead: data commits do not deploy.
export const revalidate = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { abbr } = await params;
  const team = teamBySlug(abbr);
  if (!team) return { title: "Team not found" };
  return {
    title: `${team.name}: schedule, forecasts and odds`,
    description: `${team.name} record, 548 rating, playoff and title odds, and every game with its forecast.`,
  };
}

function Tile({ label, value, probability }: { label: string; value: number; probability?: boolean }) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-lg border border-line bg-panel px-4 py-3">
      <dt className="kicker">{label}</dt>
      <dd>
        {probability ? (
          <span className={`heat ${heatClass(value)} px-2 py-1 text-[20px] font-semibold`}>{formatChance(value)}</span>
        ) : (
          <span className="figure text-[24px] font-semibold text-ink">{value}</span>
        )}
      </dd>
    </div>
  );
}

function WinsBand({ row }: { row: OddsRow }) {
  const total = Math.round(row.projectedWins + row.projectedLosses);
  const at = (wins: number) => `${(wins / total) * 100}%`;
  return (
    <div className="col-span-2 rounded-lg border border-line bg-panel px-4 py-3">
      <dt className="kicker">Projected record</dt>
      <dd className="mt-2">
        <span className="figure text-[24px] font-semibold text-ink">
          {Math.round(row.projectedWins)}–{Math.round(row.projectedLosses)}
        </span>
        <span className="ml-2 text-[13px] text-ink-2">
          {row.projectedWinsP10} to {row.projectedWinsP90} wins in 8 of 10 simulations
        </span>
        <span aria-hidden className="relative mt-3 block h-2 rounded-full bg-wash-2">
          <span
            className="absolute inset-y-0 rounded-full bg-heat-4"
            style={{ left: at(row.projectedWinsP10), width: `calc(${at(row.projectedWinsP90)} - ${at(row.projectedWinsP10)})` }}
          />
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ink"
            style={{ left: at(row.projectedWins) }}
          />
        </span>
        <span aria-hidden className="num mt-1.5 flex justify-between text-[11px] text-ink-3">
          <span>0</span>
          <span>{Math.round(total / 2)}</span>
          <span>{total} wins</span>
        </span>
      </dd>
    </div>
  );
}

function SeedChart({ row }: { row: OddsRow }) {
  const max = Math.max(0.05, ...row.seeds);
  const top = [...row.seeds.keys()].sort((a, b) => row.seeds[b] - row.seeds[a]).slice(0, 3);
  return (
    <div>
      <div className="flex h-44 items-end gap-[3px] border-b border-line-strong" role="img" aria-label={`${row.shortName} seed chances: ${row.seeds.map((value, i) => `${ordinal(i + 1)} ${formatChance(value)}`).join(", ")}`}>
        {row.seeds.map((value, index) => (
          <div key={index} className="flex h-full flex-1 flex-col items-center justify-end" title={`${ordinal(index + 1)} seed: ${formatChance(value)}`}>
            {top.includes(index) && value >= 0.005 ? (
              <span className="num mb-1 text-[11px] text-ink-2">{formatChance(value)}</span>
            ) : null}
            <span
              className="block w-full max-w-6 rounded-t-[4px]"
              style={{
                height: `${(value / max) * 85}%`,
                minHeight: value > 0 ? 1 : 0,
                background: index < 6 ? "#0b6e55" : index < 10 ? "#8ab2a3" : "#b9b5ae",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {row.seeds.map((_, index) => (
          <span key={index} className="num flex-1 text-center text-[10.5px] text-ink-3">{index + 1}</span>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[#0b6e55]" />Seeds 1–6, straight in</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[#8ab2a3]" />7–10, play-in</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[#b9b5ae]" />11–15, out</li>
      </ul>
    </div>
  );
}

function ScheduleRow({ row, modelVersion }: { row: TeamGameRow; modelVersion: string }) {
  const opponent = teamDisplay(row.opponentId);
  const { game } = row;
  return (
    <tr className="group border-b border-line last:border-0 hover:bg-wash">
      <td className="num whitespace-nowrap py-2.5 pl-3 pr-2 text-[12.5px] text-ink-2 sm:pl-4 sm:pr-3">
        <span className="hidden sm:inline">{formatWeekday(game.etDate)} </span>
        {formatShortDay(game.etDate)}
      </td>
      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
        <Link href={`/game/${game.id}`} className="flex items-center gap-2">
          <span className="w-4 text-[12px] text-ink-3 sm:w-5">{row.home ? "vs" : "at"}</span>
          <TeamLogo teamId={row.opponentId} size={20} />
          <span className="font-medium text-ink group-hover:underline group-hover:decoration-pulse group-hover:underline-offset-4">
            {opponent.shortName}
          </span>
        </Link>
      </th>
      <td className="num whitespace-nowrap py-2.5 pr-3 text-[13px]">
        {row.result ? (
          <span>
            <span className={`mr-1.5 font-semibold ${row.result.won ? "text-good" : "text-bad"}`}>{row.result.won ? "W" : "L"}</span>
            <span className="text-ink">{row.result.teamScore}–{row.result.opponentScore}</span>
          </span>
        ) : game.status === "postponed" ? (
          <span className="text-ink-3">Postponed</span>
        ) : game.status === "in-progress" ? (
          <span className="text-pulse-ink">Live</span>
        ) : (
          <span className="text-ink-2">{formatTimeEt(game.tipUtc)}</span>
        )}
      </td>
      <td className="py-2.5 pr-3 text-right sm:pr-4">
        {row.forecast ? (
          <span className="inline-flex items-center gap-2">
            {row.forecast.source === "projection" ? (
              <Badge tone="quiet">Proj.</Badge>
            ) : row.forecast.modelVersion !== null && row.forecast.modelVersion !== modelVersion ? (
              <span title={`Sealed by ${row.forecast.modelVersion}, which does not account for injuries`}>
                <Badge tone="quiet">{row.forecast.modelVersion.split("-").at(-1)}</Badge>
              </span>
            ) : null}
            <span className={`heat ${heatClass(row.forecast.probability)} min-w-[3rem] px-1.5 py-0.5 text-[12.5px]`}>
              {formatChance(row.forecast.probability)}
            </span>
          </span>
        ) : row.missed ? (
          <Badge tone="bad">Missed</Badge>
        ) : (
          <span className="text-[12px] text-ink-3" title={row.result ? "Played before the record began" : undefined}>
            {row.result ? (
              <>
                <span className="hidden sm:inline">Before the record</span>
                <span className="sm:hidden">–</span>
              </>
            ) : (
              "–"
            )}
          </span>
        )}
      </td>
    </tr>
  );
}

function ScheduleTable({ rows, caption, modelVersion }: { rows: TeamGameRow[]; caption: string; modelVersion: string }) {
  return (
    <div className="table-scroll rounded-[var(--radius-card)] border border-line bg-panel">
      <table className="w-full text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-strong text-left">
            <th scope="col" className="kicker py-2 pl-3 pr-2 font-medium sm:pl-4 sm:pr-3">Date</th>
            <th scope="col" className="kicker py-2 pr-3 font-medium">Opponent</th>
            <th scope="col" className="kicker py-2 pr-3 font-medium">Result</th>
            <th scope="col" className="kicker py-2 pr-4 text-right font-medium">548</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ScheduleRow key={row.game.id} row={row} modelVersion={modelVersion} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const UPCOMING_SHOWN = 10;

export default async function TeamPage({ params }: Params) {
  const { abbr } = await params;
  const team = teamBySlug(abbr);
  if (!team) notFound();
  if (team.slug !== abbr) permanentRedirect(`/teams/${team.slug}`);

  const [liveState, games, ledger, history] = await Promise.all([
    getLiveState(),
    getSeasonGames(),
    getSeasonLedger(),
    ratingHistory(),
  ]);
  const rows = oddsRows(liveState, games);
  const row = rows.find((candidate) => candidate.teamId === team.id);
  if (!row) notFound();
  const division = teamById(team.id).division;
  const standing = conferenceOrder(liveState.forecast.teams, team.conference).findIndex((t) => t.teamId === team.id) + 1;
  const schedule = teamSchedule({ state: liveState, games, ledger, teamId: team.id });
  const played = schedule.filter((game) => game.result !== null).reverse();
  const upcoming = schedule.filter((game) => game.result === null);
  const anySealed = played.some((game) => game.forecast?.source === "sealed");
  const chartPoints: RatingChartPoint[] = history.map((point) => {
    const values = Object.values(point.ratings).sort((a, b) => a - b);
    const quantile = (q: number) => values[Math.round(q * (values.length - 1))];
    return {
      date: point.date,
      preseason: point.preseason,
      team: point.ratings[team.id],
      min: values[0],
      q1: quantile(0.25),
      q3: quantile(0.75),
      max: values.at(-1)!,
    };
  });
  const modeled = liveState.injury !== null;
  const absences = liveState.absences.filter((absence) => absence.teamId === team.id).sort((a, b) => b.points - a.points);

  return (
    <main className="pp-container py-8 sm:py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-[14px]">
        <Link href="/teams" className="text-ink-2 hover:text-ink"><span aria-hidden>← </span>All teams</Link>
      </nav>
      <header className="panel flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-7">
        <TeamLogo teamId={team.id} size={56} />
        <div className="min-w-0 flex-1">
          <p className="kicker">{team.conference}ern Conference · {division}</p>
          <h1 className="headline mt-1 text-[30px] sm:text-[40px]">{team.name}</h1>
          <p className="mt-2 text-[15px] text-ink-2">
            <span className="num font-semibold text-ink">{formatRecord(row.wins, row.losses)}</span>, {ordinal(standing)} in the {team.conference} by record ·
            rating <span className="num font-semibold text-ink">{formatRating(row.rating)}</span>, {ordinal(row.ratingRank)} of 30
            {modeled && row.ratingNow !== null && Math.abs(row.ratingNow - row.rating) >= 0.05 ? (
              <> · <span className="num">{formatRating(row.ratingNow)}</span> with current absences</>
            ) : null}
          </p>
        </div>
      </header>

      <section aria-labelledby="odds-title" className="mt-8">
        <h2 id="odds-title" className="sr-only">Season odds</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Make playoffs" value={row.makePlayoffs} probability />
          <Tile label="Play-in" value={row.playIn} probability />
          <Tile label="Top six seed" value={row.topSix} probability />
          <Tile label="Win the title" value={row.champion} probability />
          <WinsBand row={row} />
        </dl>
        <p className="mt-3 text-[13px] text-ink-3">
          From {liveState.forecast.iterations.toLocaleString("en-US")} simulations of the rest of the season. Midseason
          playoff odds are not claimed to be well calibrated, and no skill is claimed for title odds.{" "}
          <Link href="/odds" className="pp-link">Every team&apos;s odds</Link>
        </p>
      </section>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section aria-labelledby="seeds-title" className="panel p-5 sm:p-6">
          <SectionHeading id="seeds-title" kicker="Where they finish" title="Seed chances" />
          <div className="mt-5"><SeedChart row={row} /></div>
        </section>
        <section aria-labelledby="rating-title" className="panel p-5 sm:p-6">
          <SectionHeading id="rating-title" kicker="Team strength" title="Rating over time" />
          <div className="mt-4">
            {chartPoints.length > 0 ? (
              <RatingChart points={chartPoints} color={teamColor(team.id)} name={team.shortName} published={row.rating} />
            ) : (
              <p className="notice-quiet">The rating history could not be rebuilt for this build.</p>
            )}
          </div>
          <p className="mt-3 text-[12.5px] leading-5 text-ink-3">
            Points per game against an average team after each game day, rebuilt from results with the rating model
            alone, without the injury adjustment. The shaded bands are the league&apos;s full spread and its middle half.
            {modeled ? " The open marker is today's published rating at full strength, which adjusts past margins for who played." : ""}
          </p>
        </section>
      </div>

      {modeled ? (
        <section aria-labelledby="absences-title" className="mt-10">
          <SectionHeading
            id="absences-title"
            kicker="Injuries in the model"
            title="Current absences"
            dek={
              absences.length > 0
                ? `In the next game these cost the ${team.shortName} ${(liveState.absencePoints[team.id] ?? 0).toFixed(1)} points of margin in the season odds. A game's sealed number counts the injury report in use at its seal instead, weighted by status; its game page lists those players.`
                : undefined
            }
          />
          {absences.length > 0 ? (
            <div className="panel mt-4 px-4 py-1"><AbsenceRows rows={absences} /></div>
          ) : (
            <p className="notice-quiet mt-4">The model counts no {team.shortName} player as out right now.</p>
          )}
        </section>
      ) : (
        <p className="notice-quiet mt-10">
          Injuries are not in this forecast yet: it comes from {liveState.modelVersion}, which does not account for the
          NBA injury report.
        </p>
      )}

      <section aria-labelledby="upcoming-title" className="mt-10">
        <SectionHeading id="upcoming-title" kicker="Schedule" title="Upcoming games" dek={upcoming.some((game) => game.forecast?.source === "projection") ? PROJECTION_LABEL : undefined} />
        <div className="mt-4">
          {upcoming.length === 0 ? (
            <p className="notice-quiet">No games left on the schedule.</p>
          ) : (
            <>
              <ScheduleTable modelVersion={liveState.modelVersion} rows={upcoming.slice(0, UPCOMING_SHOWN)} caption={`${team.shortName} upcoming games`} />
              {upcoming.length > UPCOMING_SHOWN ? (
                <details className="group mt-3">
                  <summary className="pp-button cursor-pointer list-none">
                    <span className="group-open:hidden">Show the other {upcoming.length - UPCOMING_SHOWN} games</span>
                    <span className="hidden group-open:inline">Hide the rest of the schedule</span>
                  </summary>
                  <div className="mt-3">
                    <ScheduleTable modelVersion={liveState.modelVersion} rows={upcoming.slice(UPCOMING_SHOWN)} caption={`${team.shortName} later games`} />
                  </div>
                </details>
              ) : null}
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="results-title" className="mt-10">
        <SectionHeading
          id="results-title"
          kicker="Schedule"
          title="Results"
          dek={
            played.length > 0
              ? "Most recent first, with 548's sealed pregame chance for this team. The record starts with the first seal; earlier games show the score only."
              : undefined
          }
        />
        <div className="mt-4">
          {played.length === 0 ? (
            <p className="notice-quiet">No games played yet.</p>
          ) : (
            <>
              {!anySealed ? <p className="notice-quiet mb-3">No {team.shortName} game has been sealed and played yet.</p> : null}
              <ScheduleTable modelVersion={liveState.modelVersion} rows={played} caption={`${team.shortName} results`} />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
