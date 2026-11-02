import Link from "next/link";
import { Badge, StatusPill } from "@/components/live/Badge";
import { SplitBar } from "@/components/live/SplitBar";
import { TeamLogo } from "@/components/live/TeamLogo";
import type { SealRow, SeasonGame, TeamForecast } from "@/lib/season/types";
import { formatReportTime, formatShortDay, formatTimeEt, formatWeekday } from "@/lib/utils/dates";
import { driverStatus } from "@/lib/utils/injuries";
import { formatChance } from "@/lib/utils/format";
import {
  forecastBadge,
  formatDiff,
  marginText,
  metaLine,
  spreadText,
  splitPercents,
  statusLabel,
} from "@/lib/view/card";
import type { DayGame } from "@/lib/view/day";
import type { GameDetail } from "@/lib/view/game";
import type { MarginBreakdown, MarginPart } from "@/lib/view/margin";
import { PROJECTION_LABEL } from "@/lib/view/projection";
import { formatRecord, ordinal, pairColors, teamDisplay, teamHref, type TeamLine } from "@/lib/view/teams";

export function Panel({
  id,
  kicker,
  title,
  children,
  className = "",
}: {
  id: string;
  kicker?: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`panel p-5 sm:p-6 ${className}`}>
      {kicker ? <p className="kicker">{kicker}</p> : null}
      <h2 id={id} className="headline mt-1 text-[22px]">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const KIND_LABELS: Record<SeasonGame["kind"], string> = {
  regular: "Regular season",
  "cup-final": "NBA Cup final",
  "play-in": "Play-in",
  playoff: "Playoffs",
};

function HeaderTeam({ id, line, align, dim }: { id: string; line?: TeamLine; align: "left" | "right"; dim: boolean }) {
  const team = teamDisplay(id);
  return (
    <div className={`flex min-w-0 items-center gap-3 sm:gap-4 ${align === "right" ? "sm:flex-row-reverse sm:text-right" : ""}`}>
      <TeamLogo teamId={id} size={48} />
      <div className="min-w-0">
        <Link
          href={teamHref(id)}
          className={`block truncate text-[18px] font-semibold leading-tight hover:underline hover:decoration-pulse hover:underline-offset-4 sm:text-[22px] ${dim ? "text-ink-2" : "text-ink"}`}
        >
          <span className="lg:hidden">{team.shortName}</span>
          <span className="hidden lg:inline">{team.name}</span>
        </Link>
        {line ? (
          <p className="num mt-1 text-[12px] text-ink-3">
            {formatRecord(line.wins, line.losses)}
            {line.rank > 0 ? ` · #${line.rank}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function HeaderScore({ score, dim }: { score: number | null; dim: boolean }) {
  if (score === null) return null;
  return (
    <p className={`figure text-[40px] sm:text-[56px] ${dim ? "font-medium text-ink-3" : "font-semibold text-ink"}`}>{score}</p>
  );
}

export function MatchupHeader({ game, lines, modelVersion }: { game: DayGame; lines: Record<string, TeamLine>; modelVersion: string }) {
  const status = statusLabel(game);
  const badge = forecastBadge(game, modelVersion);
  const scores = (game.status === "final" || game.status === "in-progress") && game.homeScore !== null && game.awayScore !== null;
  const homeWon = game.status === "final" && scores ? game.homeScore! > game.awayScore! : null;
  const meta = metaLine(game);
  const awayScore = scores ? game.awayScore : null;
  const homeScore = scores ? game.homeScore : null;
  return (
    <header className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3 sm:px-6">
        <StatusPill label={status.label} live={status.live} />
        <p className="kicker">
          {KIND_LABELS[game.kind]} · {formatWeekday(game.etDate)}, {formatShortDay(game.etDate)}
        </p>
        {badge ? (
          <span className="ml-auto">
            <Badge tone={badge.tone} title={badge.detail}>{badge.label}</Badge>
          </span>
        ) : null}
      </div>
      {/* Narrow: one row per team, score at the end. Wide: away, scores, home. */}
      <div className="space-y-4 px-5 py-6 sm:hidden">
        {[
          { id: game.awayId, score: awayScore, dim: homeWon === true },
          { id: game.homeId, score: homeScore, dim: homeWon === false },
        ].map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3">
            <HeaderTeam id={row.id} line={lines[row.id]} align="left" dim={row.dim} />
            <HeaderScore score={row.score} dim={row.dim} />
          </div>
        ))}
      </div>
      <div className="hidden items-center gap-6 px-6 py-8 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(0,1fr)]">
        <HeaderTeam id={game.awayId} line={lines[game.awayId]} align="left" dim={homeWon === true} />
        <div className="min-w-[3.5rem] text-right"><HeaderScore score={awayScore} dim={homeWon === true} /></div>
        <p className="kicker text-center">{game.neutral ? "vs" : "at"}</p>
        <div className="min-w-[3.5rem]"><HeaderScore score={homeScore} dim={homeWon === false} /></div>
        <HeaderTeam id={game.homeId} line={lines[game.homeId]} align="right" dim={homeWon === false} />
      </div>
      <p className="border-t border-line px-5 py-3 text-[13px] text-ink-2 sm:px-6">{meta.join(" · ")}</p>
    </header>
  );
}

function BigNumber({ id, percent, market, align }: { id: string; percent: number; market: number | null; align: "left" | "right" }) {
  const team = teamDisplay(id);
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <p className="text-[14px] font-medium text-ink-2">{team.shortName}</p>
      <p className="figure mt-1 text-[48px] font-semibold text-ink sm:text-[60px]">
        {percent}
        <span className="text-[28px] sm:text-[34px]">%</span>
      </p>
      {market !== null ? (
        <p className="num mt-2 text-[13px] text-market">
          Market {market}% <span className="text-ink-3">({formatDiff(percent, market)})</span>
        </p>
      ) : null}
    </div>
  );
}

export function WinProbability({ game }: { game: DayGame }) {
  const live = game.status === "in-progress" && game.inGameHomeProbability !== null;
  const pregame = game.forecast?.homeWinProbability ?? game.projection?.homeWinProbability ?? null;
  if (pregame === null) {
    return (
      <Panel id="win-probability" kicker="548" title="Win probability">
        <p className="text-[15px] text-ink-2">
          {game.missed
            ? "This game tipped before a forecast was sealed, so there is no number for it. It counts as missed in the record."
            : game.beforeRecord
              ? "This game tipped before the first forecast was sealed, so it has no number and is not in the record."
              : "No forecast is available for this game."}
        </p>
      </Panel>
    );
  }
  const shown = live ? game.inGameHomeProbability! : pregame;
  const percents = splitPercents(shown);
  const market = game.market && game.forecast && !live ? splitPercents(game.market.homeWinProbability) : null;
  const margin = game.forecast?.expectedMargin ?? game.projection?.expectedMargin ?? 0;
  const provider = game.market?.provider ?? game.marketLine?.provider ?? null;
  return (
    <Panel
      id="win-probability"
      kicker={live ? "Live estimate" : game.projection ? "Projection" : game.status === "final" ? "Sealed before tip" : "548"}
      title="Win probability"
    >
      {game.projection ? <p className="notice-quiet mb-4">{PROJECTION_LABEL}</p> : null}
      <div className="flex items-end justify-between gap-6">
        <BigNumber id={game.awayId} percent={percents.away} market={market?.away ?? null} align="left" />
        <BigNumber id={game.homeId} percent={percents.home} market={market?.home ?? null} align="right" />
      </div>
      <div className="mt-5">
        <SplitBar awayId={game.awayId} homeId={game.homeId} homeProbability={shown} height={14} />
      </div>
      <dl className="mt-6 grid gap-x-8 gap-y-3 text-[14px] sm:grid-cols-2">
        {live ? (
          <div>
            <dt className="kicker">Pregame</dt>
            <dd className="mt-1 text-ink">
              {teamDisplay(game.homeId).code} {splitPercents(pregame).home}% before tip. The live estimate uses the score and the time left; it never changes a seal.
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="kicker">Predicted margin</dt>
          <dd className="mt-1 text-ink">{marginText(margin, game.homeId, game.awayId)} points</dd>
        </div>
        {game.projection ? null : (
          <div>
            <dt className="kicker">Market spread{provider ? ` (${provider})` : ""}</dt>
            <dd className="mt-1 text-market">
              {game.marketLine?.homeSpread !== null && game.marketLine?.homeSpread !== undefined
                ? spreadText(game.marketLine.homeSpread, game.homeId, game.awayId)
                : "No market line for this game"}
            </dd>
          </div>
        )}
      </dl>
      {game.projection ? null : (
        <p className="mt-4 text-[12px] leading-5 text-ink-3">
          The market is the {provider ?? "sportsbook"} moneyline via ESPN with the vig removed, shown for
          reference. It is never a model input and is not scored.
        </p>
      )}
    </Panel>
  );
}

const PART_LABELS: Record<MarginPart["key"], string> = {
  rating: "Team ratings",
  home: "Home court",
  strength: "Team ratings and home court",
  rest: "Rest (back-to-back)",
  absences: "Expected absences",
};

function signedFor(points: number, homeId: string, awayId: string): string {
  if (Math.abs(points) < 0.05) return "0.0";
  return `${teamDisplay(points > 0 ? homeId : awayId).code} +${Math.abs(points).toFixed(1)}`;
}

function DivergingRow({ label, points, scale, homeId, awayId, total = false }: { label: string; points: number; scale: number; homeId: string; awayId: string; total?: boolean }) {
  const [awayColor, homeColor] = pairColors(awayId, homeId);
  const width = Math.min(50, (Math.abs(points) / scale) * 50);
  return (
    <div className={`grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5.5rem] items-center gap-3 py-2 sm:grid-cols-[13rem_minmax(0,1fr)_6rem] ${total ? "border-t border-line-strong pt-3" : ""}`}>
      <p className={`text-[14px] leading-tight ${total ? "font-semibold text-ink" : "text-ink-2"}`}>{label}</p>
      <div aria-hidden className="relative h-3">
        <span className="absolute inset-y-[-4px] left-1/2 w-px bg-line-strong" />
        {width > 0 ? (
          <span
            className={`absolute top-0 h-3 ${points > 0 ? "rounded-r-[3px]" : "rounded-l-[3px]"}`}
            style={{
              left: points > 0 ? "50%" : `${50 - width}%`,
              width: `${width}%`,
              background: points > 0 ? homeColor : awayColor,
            }}
          />
        ) : null}
      </div>
      <p className={`num text-right text-[13px] ${total ? "font-semibold text-ink" : "text-ink-2"}`}>
        {signedFor(points, homeId, awayId)}
      </p>
    </div>
  );
}

function Drivers({ game }: { game: DayGame }) {
  const forecast = game.forecast;
  if (!forecast?.drivers || !forecast.absencePoints) return null;
  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {(["away", "home"] as const).map((side) => {
        const id = side === "home" ? game.homeId : game.awayId;
        const drivers = forecast.drivers![side];
        const points = forecast.absencePoints![side];
        return (
          <div key={side} className="rounded-lg bg-wash px-4 py-3">
            <p className="flex items-center justify-between gap-3 text-[13px] font-semibold text-ink">
              <span className="flex items-center gap-2">
                <TeamLogo teamId={id} size={18} />
                {teamDisplay(id).shortName}
              </span>
              <span className="num font-medium text-ink-2">{points >= 0.05 ? `−${points.toFixed(1)}` : "0.0"} pts</span>
            </p>
            {drivers.length === 0 ? (
              <p className="mt-2 text-[13px] text-ink-3">No listed absences.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[13px] text-ink-2">
                {drivers.map((driver) => (
                  <li key={driver.athleteId} className="flex justify-between gap-3">
                    <span>
                      {driver.name} <span className="text-ink-3">({driverStatus(driver)})</span>
                    </span>
                    <span className="num">{driver.points.toFixed(1)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function WhatMoves({ game, breakdown, detail }: { game: DayGame; breakdown: MarginBreakdown; detail: GameDetail }) {
  const scale = Math.max(4, ...breakdown.parts.map((part) => Math.abs(part.display)), Math.abs(breakdown.total));
  const forecast = game.forecast;
  const restWho = detail.homeOnBackToBack && detail.awayOnBackToBack
    ? "Both teams are on the second night of a back-to-back."
    : detail.homeOnBackToBack
      ? `${teamDisplay(game.homeId).shortName} are on the second night of a back-to-back.`
      : detail.awayOnBackToBack
        ? `${teamDisplay(game.awayId).shortName} are on the second night of a back-to-back.`
        : null;
  return (
    <Panel id="what-moves" kicker="Expected margin" title="What moves the number">
      <p className="mb-3 text-[14px] leading-6 text-ink-2">
        Each part adds points to one side&apos;s expected margin; together they make the prediction.
        {restWho ? ` ${restWho}` : ""}
      </p>
      <div>
        {breakdown.parts.map((part) => (
          <DivergingRow key={part.key} label={PART_LABELS[part.key]} points={part.display} scale={scale} homeId={game.homeId} awayId={game.awayId} />
        ))}
        <DivergingRow label="Predicted margin" points={Math.round(breakdown.total * 10) / 10} scale={scale} homeId={game.homeId} awayId={game.awayId} total />
      </div>
      <div className="mt-4 space-y-2 text-[13px] leading-5 text-ink-3">
        {!breakdown.separated ? (
          <p>Ratings have been updated since this seal, so its rating and home-court parts are shown together.</p>
        ) : null}
        {game.projection ? <p>A projection has no injury term: expected absences enter only when the game is sealed.</p> : null}
        {forecast && forecast.absencePoints === null ? (
          <p>This number is from {forecast.modelVersion}, which does not account for injuries, so there is no absence line.</p>
        ) : null}
        {forecast?.availabilityMissing ? <p>No NBA injury report under 24 hours old was available, so absences are zero.</p> : null}
        {forecast?.availabilityStale && forecast.reportAt ? (
          <p>The latest report could not be read, so the last good one, from {formatReportTime(forecast.reportAt)}, was used.</p>
        ) : null}
        {forecast?.reportAt && !forecast.availabilityStale ? <p>Injury report used: the NBA&apos;s of {formatReportTime(forecast.reportAt)}.</p> : null}
      </div>
      <Drivers game={game} />
    </Panel>
  );
}

function SealCell({ row, homeId, pending }: { row: SealRow | null; homeId: string; pending: string }) {
  if (!row) return <span className="text-ink-3">{pending}</span>;
  const { home } = splitPercents(row.homeWinProbability);
  return (
    <span className="num text-ink">
      {teamDisplay(homeId).code} {home}%
      <span className="ml-2 text-[12px] text-ink-3">{formatTimeEt(row.issuedAt)}</span>
    </span>
  );
}

export function Seals({ game, detail }: { game: DayGame; detail: GameDetail }) {
  const tipped = game.status === "in-progress" || game.status === "final";
  return (
    <Panel id="seals" kicker="The record" title="Seals">
      {detail.versions.length === 0 ? (
        <p className="text-[14px] leading-6 text-ink-2">
          {game.missed
            ? "No seal was made before tip. The game is counted as missed and is never backfilled."
            : game.beforeRecord
              ? "This game tipped before the first seal, so it is not part of the record."
              : "Not sealed yet. The morning seal is issued on game day, and the final seal in the hour before tip."}
        </p>
      ) : (
        <div className="table-scroll -mx-1">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-line-strong text-left">
                <th scope="col" className="kicker py-2 pr-3 font-medium">Model</th>
                <th scope="col" className="kicker py-2 pr-3 font-medium">Morning seal</th>
                <th scope="col" className="kicker py-2 pr-3 font-medium">Final seal</th>
                <th scope="col" className="kicker py-2 font-medium">Scored</th>
              </tr>
            </thead>
            <tbody>
              {detail.versions.map((version) => {
                const twoSeals = version.morning?.sealKind !== undefined;
                return (
                  <tr key={version.modelVersion} className="border-b border-line last:border-0">
                    <th scope="row" className="py-3 pr-3 text-left font-normal">
                      <span className="num text-[13px] text-ink">
                        <span className="sm:hidden">{version.modelVersion.split("-").at(-1)}</span>
                        <span className="hidden sm:inline">{version.modelVersion}</span>
                      </span>
                      <span className="block text-[12px] text-ink-3">
                        {version.role === "published" ? "Published" : version.role === "reference" ? "Reference" : "Earlier"}
                      </span>
                    </th>
                    <td className="py-3 pr-3">
                      <SealCell row={version.morning} homeId={game.homeId} pending="None" />
                      {version.reissued ? (
                        <span className="mt-1 block">
                          <SealCell row={version.reissued} homeId={game.homeId} pending="None" />
                          <span className="block text-[12px] text-ink-3">Reissued with the injury report</span>
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3">
                      {twoSeals ? (
                        <SealCell row={version.final} homeId={game.homeId} pending={tipped ? "None" : "Due in the hour before tip"} />
                      ) : (
                        <span className="text-ink-3">Seals once</span>
                      )}
                    </td>
                    <td className="py-3 text-[13px] text-ink-2">
                      {!tipped
                        ? "After the final"
                        : version.scored === version.final && version.final
                          ? "Final seal"
                          : twoSeals
                            ? <Badge tone="warn">No final seal</Badge>
                            : "Morning seal"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-[13px] leading-5 text-ink-3">
        Each game is sealed from the ratings before its date: a morning seal, then a final seal in the hour
        before tip with the latest NBA injury report. The final seal is scored when it exists; otherwise the
        morning seal is, and the game counts as &quot;no final seal&quot;. A morning seal made before any usable
        report is reissued once, when one arrives, and both stay in the ledger. Every model version keeps its own record.
      </p>
    </Panel>
  );
}

export function Result({ game, detail }: { game: DayGame; detail: GameDetail }) {
  if (game.status !== "final" || game.homeScore === null || game.awayScore === null) return null;
  const winnerId = detail.homeWon ? game.homeId : game.awayId;
  const winner = teamDisplay(winnerId);
  return (
    <Panel id="result" kicker="Final" title="Result">
      <p className="text-[17px] text-ink">
        <span className="font-semibold">{winner.name}</span> won{" "}
        <span className="num">{Math.max(game.homeScore, game.awayScore)}–{Math.min(game.homeScore, game.awayScore)}</span>.
      </p>
      {detail.results.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-2">No seal was scored for this game.</p>
      ) : (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {detail.results.map((result) => (
            <div key={result.modelVersion} className="rounded-lg bg-wash px-4 py-3">
              <dt className="flex items-center justify-between gap-2">
                <span className="num text-[12px] text-ink-2">{result.modelVersion}</span>
                <span className="kicker text-[10px]">{result.role === "published" ? "Published" : "Reference"}</span>
              </dt>
              <dd className="mt-2 text-[14px] text-ink-2">
                Gave {winner.shortName}{" "}
                <span className="figure text-[24px] font-semibold text-ink">{splitPercents(result.seal.homeWinProbability)[detail.homeWon ? "home" : "away"]}%</span>
              </dd>
              <dd className="num mt-1 text-[13px] text-ink-2">Brier {result.brier.toFixed(3)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-4 text-[13px] leading-5 text-ink-3">
        Brier is the squared gap between the forecast and the result: 0 is perfect and an even 50% scores 0.25.
        One game says nothing about skill; see the <Link className="pp-link" href="/record">track record</Link>.
      </p>
    </Panel>
  );
}

function OddsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="num text-[14px] text-ink">{value}</dd>
    </div>
  );
}

export function TeamSnapshot({ teamId, forecast, line, next }: { teamId: string; forecast: TeamForecast | undefined; line: TeamLine | undefined; next: SeasonGame | null }) {
  const team = teamDisplay(teamId);
  const opponent = next ? teamDisplay(next.homeId === teamId ? next.awayId : next.homeId) : null;
  return (
    <section aria-labelledby={`team-${teamId}`} className="panel p-5">
      <div className="flex items-center gap-3">
        <TeamLogo teamId={teamId} size={36} />
        <div className="min-w-0">
          <h3 id={`team-${teamId}`} className="truncate text-[17px] font-semibold text-ink">{team.name}</h3>
          {line ? (
            <p className="num text-[12px] text-ink-3">
              {formatRecord(line.wins, line.losses)} · rating {line.rating >= 0 ? "+" : "−"}
              {Math.abs(line.rating).toFixed(1)} ({ordinal(line.rank)})
            </p>
          ) : null}
        </div>
      </div>
      {forecast ? (
        <dl className="mt-3">
          <OddsRow label="Make playoffs" value={formatChance(forecast.makePlayoffs)} />
          <OddsRow label="Win the title" value={formatChance(forecast.champion)} />
          <OddsRow label="Projected wins" value={`${Math.round(forecast.projectedWins)} (${forecast.projectedWinsP10}–${forecast.projectedWinsP90})`} />
          {next && opponent ? (
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-[13px] text-ink-2">Next game</dt>
              <dd className="text-[14px]">
                <Link href={`/game/${next.id}`} className="pp-link">
                  {formatWeekday(next.etDate)} {formatShortDay(next.etDate)} {next.homeId === teamId ? "vs" : "at"} {opponent.code}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <p className="mt-3 text-[14px]">
        <Link href={teamHref(teamId)} className="pp-link">{team.shortName} team page</Link>
      </p>
    </section>
  );
}

