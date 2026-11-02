import Link from "next/link";
import { Badge, StatusPill } from "@/components/live/Badge";
import { SplitBar } from "@/components/live/SplitBar";
import { TeamLogo } from "@/components/live/TeamLogo";
import {
  forecastBadge,
  formatDiff,
  injuryNotes,
  marginText,
  metaLine,
  resultLine,
  splitPercents,
  statusLabel,
} from "@/lib/view/card";
import type { DayGame } from "@/lib/view/day";
import { formatRecord, ordinal, teamDisplay, type TeamLine } from "@/lib/view/teams";

type Side = "away" | "home";

function TeamRow({
  game,
  side,
  line,
  percent,
  marketPercent,
  score,
  winner,
  big,
}: {
  game: DayGame;
  side: Side;
  line: TeamLine | undefined;
  percent: number | null;
  marketPercent: number | null;
  score: number | null;
  winner: boolean | null;
  /** The probability is the headline (before tip) rather than the score. */
  big: boolean;
}) {
  const team = teamDisplay(side === "home" ? game.homeId : game.awayId);
  const loser = winner === false;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5">
      <div className="flex min-w-0 items-center gap-3">
        <TeamLogo teamId={team.id} size={30} />
        <div className="min-w-0">
          <p className={`truncate text-[16px] leading-tight ${loser ? "font-medium text-ink-2" : "font-semibold text-ink"}`}>
            {team.shortName}
          </p>
          {line ? (
            <p className="num mt-0.5 text-[12px] leading-none text-ink-3">
              {formatRecord(line.wins, line.losses)}
              {line.rank > 0 ? (
                <>
                  <span aria-hidden className="mx-1 text-ink-4">·</span>
                  <span title={`${ordinal(line.rank)} in the 548 rating`}>
                    <span className="sr-only">rating rank </span>#{line.rank}
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
      <div className="min-w-[4.5rem] text-right">
        {percent !== null ? (
          <p className={`figure ${big ? "text-[30px] font-semibold text-ink" : "text-[18px] font-medium text-ink-2"}`}>
            {percent}
            <span className={big ? "text-[18px]" : "text-[13px]"}>%</span>
          </p>
        ) : null}
        {marketPercent !== null && percent !== null ? (
          <p className="num mt-1 whitespace-nowrap text-[11.5px] leading-none text-market">
            Market {marketPercent}%{" "}
            <span className="text-ink-3" title="548's number minus the market's, in percentage points">
              ({formatDiff(percent, marketPercent)})
            </span>
          </p>
        ) : null}
      </div>
      {score !== null ? (
        <p
          className={`figure w-12 text-right text-[28px] ${loser ? "font-medium text-ink-3" : "font-semibold text-ink"}`}
        >
          {score}
        </p>
      ) : (
        <span />
      )}
    </div>
  );
}

export function GameCard({
  game,
  lines,
  modelVersion,
  modelNote = true,
}: {
  game: DayGame;
  lines: Record<string, TeamLine>;
  modelVersion: string;
  /** Say on the card when its number predates the injury model. Off when the page says it. */
  modelNote?: boolean;
}) {
  const away = teamDisplay(game.awayId);
  const home = teamDisplay(game.homeId);
  const status = statusLabel(game);
  const badge = forecastBadge(game, modelVersion);
  const tipped = game.status === "in-progress" || game.status === "final";
  const live = game.status === "in-progress" && game.inGameHomeProbability !== null;

  // The headline number: live estimate during a game, else the seal, provisional or projection.
  const pregame = game.forecast?.homeWinProbability ?? game.projection?.homeWinProbability ?? null;
  const shown = live ? game.inGameHomeProbability : pregame;
  const percents = shown !== null ? splitPercents(shown) : null;
  // The market sits beside pregame numbers only: never beside a projection or a live estimate.
  const market =
    game.market && game.forecast && !live ? splitPercents(game.market.homeWinProbability) : null;
  const scores = tipped && game.homeScore !== null && game.awayScore !== null;
  const homeWon = game.status === "final" && scores ? game.homeScore! > game.awayScore! : null;
  const margin = game.forecast?.expectedMargin ?? game.projection?.expectedMargin ?? null;
  const notes = injuryNotes(game);
  const result = resultLine(game);
  const label = live ? "Live estimate" : tipped ? "548 pregame" : "548";
  const meta = metaLine(game);
  const where = meta.slice(1).join(" · ");

  return (
    <article className="group relative flex w-full flex-col rounded-[var(--radius-card)] border border-line bg-panel transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_10px_30px_-18px_rgba(18,20,23,0.35)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5">
        <StatusPill label={status.label} live={status.live} />
        {game.status === "final" ? null : (
          <p className="num shrink-0 whitespace-nowrap text-[12px] text-ink-2">{meta[0]}</p>
        )}
        {badge ? (
          <span className="ml-auto">
            <Badge tone={badge.tone} title={badge.detail}>
              {badge.label}
            </Badge>
          </span>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 pb-0.5 pt-1">
          <span />
          <span className="kicker min-w-[4.5rem] text-right text-[10px]">{percents ? label : ""}</span>
          <span className={`kicker w-12 text-right text-[10px] ${scores ? "" : "invisible"}`}>Score</span>
        </div>
        <TeamRow
          game={game}
          side="away"
          line={lines[game.awayId]}
          percent={percents?.away ?? null}
          marketPercent={market?.away ?? null}
          score={scores ? game.awayScore : null}
          winner={homeWon === null ? null : !homeWon}
          big={!scores}
        />
        <TeamRow
          game={game}
          side="home"
          line={lines[game.homeId]}
          percent={percents?.home ?? null}
          marketPercent={market?.home ?? null}
          score={scores ? game.homeScore : null}
          winner={homeWon}
          big={!scores}
        />

        {shown !== null ? (
          <div className="mt-3">
            <SplitBar awayId={game.awayId} homeId={game.homeId} homeProbability={shown} />
          </div>
        ) : null}

        <div className="mb-3 mt-3 space-y-1.5 text-[13px] leading-5 text-ink-2">
          {result ? <p className="font-medium text-ink">{result}</p> : null}
          {margin !== null && !result ? (
            <p>
              {marginText(margin, game.homeId, game.awayId)}
              {live && pregame !== null ? (
                <span className="text-ink-3"> · pregame {splitPercents(pregame).home}% {home.code}</span>
              ) : null}
              {!game.market && game.forecast && !live && !tipped ? (
                <span className="text-ink-3"> · No market line yet</span>
              ) : null}
            </p>
          ) : null}
          {notes && notes.length > 0 ? (
            <p className="text-ink-2">
              <span className="font-medium text-ink">Injuries </span>
              {notes.join("; ")}
            </p>
          ) : null}
          {modelNote && game.forecast && game.forecast.absencePoints === null ? (
            <p className="text-[12px] text-ink-3">Before injuries: this number comes from {game.forecast.modelVersion}.</p>
          ) : null}
          {game.forecast?.availabilityMissing ? (
            <p className="text-[12px] text-ink-3">No NBA injury report was available for this number.</p>
          ) : null}
          {game.missed ? <p className="text-[12px] text-bad">Tipped without a seal: counted as missed.</p> : null}
          {game.beforeRecord ? <p className="text-[12px] text-ink-3">Tipped before the record began.</p> : null}
        </div>
        {where ? (
          <p className="mt-auto truncate border-t border-line pt-2.5 text-[12px] text-ink-3" title={where}>
            {game.status === "final" ? `${meta[0]} · ` : ""}
            {where}
          </p>
        ) : null}
      </div>

      <Link
        href={`/game/${game.id}`}
        className="absolute inset-0 rounded-[var(--radius-card)]"
        aria-label={`${away.shortName} at ${home.shortName}: game details`}
      />
    </article>
  );
}
