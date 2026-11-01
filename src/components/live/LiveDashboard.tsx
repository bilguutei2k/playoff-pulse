"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Clock, XCircle } from "lucide-react";
import { teamById } from "@/lib/season/teams";
import type { SlateGameView, SlateView } from "@/lib/season/slate";
import type { PlayoffRound } from "@/lib/season/types";
import { formatPercent } from "@/lib/utils/format";

const POLL_LIVE_MS = 60_000;
const POLL_IDLE_MS = 300_000;
// Home and away identity. Validated with the dataviz palette check against the
// panel surface; team labels sit beside the bar, so color is never the only cue.
const AWAY_COLOR = "#1f6fb5";
const HOME_COLOR = "var(--color-accent)";

const subscribeNever = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

function formatTime(iso: string, isClient: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    // Before hydration the server cannot know the viewer's zone, so it shows ET.
    timeZone: isClient ? undefined : "America/New_York",
  }).format(new Date(iso));
}

function formatDateTime(iso: string, isClient: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: isClient ? undefined : "America/New_York",
  }).format(new Date(iso));
}

function formatSlateDate(etDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${etDate}T12:00:00Z`));
}

function ProbabilityBar({
  away,
  home,
  awayName,
  homeName,
}: {
  away: number;
  home: number;
  awayName: string;
  homeName: string;
}) {
  return (
    <div
      className="flex h-3 w-full gap-0.5"
      role="img"
      aria-label={`${awayName} ${formatPercent(away)}, ${homeName} ${formatPercent(home)}`}
      title={`${awayName} ${formatPercent(away)} · ${homeName} ${formatPercent(home)}`}
    >
      <span
        className="block h-full rounded-l-[4px]"
        style={{ width: `${away * 100}%`, background: AWAY_COLOR }}
      />
      <span
        className="block h-full rounded-r-[4px]"
        style={{ width: `${home * 100}%`, background: HOME_COLOR }}
      />
    </div>
  );
}

function ForecastBadge({ game }: { game: SlateGameView }) {
  const isClient = useIsClient();
  if (game.missed) {
    return (
      <span className="pp-pill" title="This game tipped before a forecast was sealed.">
        <AlertTriangle size={12} aria-hidden /> Missed seal, not in the record
      </span>
    );
  }
  if (game.beforeRecord) {
    return (
      <span className="pp-pill" title="This game tipped before the first forecast was sealed.">
        Before the record began
      </span>
    );
  }
  if (!game.forecast) return null;
  if (game.forecast.source === "provisional") {
    return (
      <span
        className="pp-pill"
        title="Computed from the latest published ratings because the scheduled job has not sealed this game yet. Never scored."
      >
        <Clock size={12} aria-hidden /> Provisional, not sealed
      </span>
    );
  }
  const issued = game.forecast.issuedAt
    ? `Sealed ${formatDateTime(game.forecast.issuedAt, isClient)}`
    : "Sealed";
  if (game.forecast.inputsIncomplete) {
    return (
      <span
        className="pp-pill"
        title={`${issued}. An earlier game had not finished when this was sealed, so its result is missing from the ratings.`}
      >
        <AlertTriangle size={12} aria-hidden /> Sealed, inputs incomplete
      </span>
    );
  }
  return (
    <span className="pp-pill" title={issued}>
      <CheckCircle2 size={12} aria-hidden /> Sealed
    </span>
  );
}

function TeamRow({
  teamId,
  color,
  score,
  probability,
  isWinner,
}: {
  teamId: string;
  color: string;
  score: number | null;
  probability: number | null;
  isWinner: boolean;
}) {
  const team = teamById(teamId);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ background: color }}
      />
      <span
        className={`min-w-0 flex-1 truncate ${
          isWinner
            ? "font-bold text-[var(--color-text-primary)]"
            : "text-[var(--color-text-secondary)]"
        }`}
      >
        {team.name}
      </span>
      {score !== null ? (
        <span className="pp-number w-10 text-right text-base font-bold text-[var(--color-text-primary)]">
          {score}
        </span>
      ) : null}
      <span className="pp-number w-14 text-right text-[var(--color-text-secondary)]">
        {probability === null ? "n/a" : formatPercent(probability)}
      </span>
    </div>
  );
}

const ROUND_LABELS: Record<PlayoffRound, string> = {
  "first-round": "First round",
  "conference-semifinal": "Conference semifinal",
  "conference-final": "Conference final",
  finals: "NBA Finals",
};

function gameLabel(game: SlateGameView): string | null {
  if (game.kind === "play-in") return "Play-in";
  if (game.kind === "cup-final") return "NBA Cup final (not in standings)";
  if (game.round) return ROUND_LABELS[game.round];
  return null;
}

function statusLabel(game: SlateGameView, isClient: boolean): string {
  if (game.status === "scheduled") return formatTime(game.tipUtc, isClient);
  if (game.status === "postponed") return "Postponed";
  if (game.status === "canceled") return "Canceled";
  return game.statusDetail;
}

function InjuryList({ game }: { game: SlateGameView }) {
  const total = game.injuries.away.length + game.injuries.home.length;
  if (total === 0) return null;
  const sides = [
    { teamId: game.awayId, rows: game.injuries.away },
    { teamId: game.homeId, rows: game.injuries.home },
  ];
  return (
    <details className="mt-3 border-t border-[var(--color-border-subtle)] pt-2 text-xs text-[var(--color-text-muted)]">
      <summary className="cursor-pointer">Reported injuries ({total}), not in the model</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {sides.map(({ teamId, rows }) => (
          <div key={teamId}>
            <div className="font-bold text-[var(--color-text-secondary)]">
              {teamById(teamId).abbreviation}
            </div>
            {rows.length === 0 ? (
              <div>None reported</div>
            ) : (
              <ul>
                {rows.map((row) => (
                  <li key={`${row.athleteId}-${row.name}`}>
                    {row.name}: {row.status}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function GameCard({ game }: { game: SlateGameView }) {
  const isClient = useIsClient();
  const home = teamById(game.homeId);
  const away = teamById(game.awayId);
  const forecast = game.forecast;
  const live = game.inGameHomeProbability;
  const shownHome = live ?? forecast?.homeWinProbability ?? null;
  const shownAway = shownHome === null ? null : 1 - shownHome;
  const isFinal = game.status === "final";
  const homeWon =
    isFinal &&
    game.homeScore !== null &&
    game.awayScore !== null &&
    game.homeScore > game.awayScore;
  const awayWon = isFinal && !homeWon;
  const margin = forecast?.expectedMargin ?? null;

  return (
    <article className="pp-card flex flex-col p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-secondary)]">
          {game.status === "in-progress" ? (
            <CircleDot size={13} aria-hidden className="text-[var(--color-danger)]" />
          ) : null}
          {statusLabel(game, isClient)}
          {gameLabel(game) ? (
            <span className="font-normal text-[var(--color-text-muted)]">· {gameLabel(game)}</span>
          ) : null}
        </span>
        <ForecastBadge game={game} />
      </header>

      <div className="grid gap-1.5">
        <TeamRow
          teamId={game.awayId}
          color={AWAY_COLOR}
          score={game.awayScore}
          probability={shownAway}
          isWinner={awayWon}
        />
        <TeamRow
          teamId={game.homeId}
          color={HOME_COLOR}
          score={game.homeScore}
          probability={shownHome}
          isWinner={homeWon}
        />
      </div>

      {shownHome !== null && shownAway !== null ? (
        <div className="mt-3">
          <ProbabilityBar
            away={shownAway}
            home={shownHome}
            awayName={away.abbreviation}
            homeName={home.abbreviation}
          />
        </div>
      ) : null}

      <dl className="mt-3 grid gap-1 text-xs text-[var(--color-text-muted)]">
        {live !== null && forecast ? (
          <div className="flex justify-between gap-3">
            <dt>Bar shows the in-game estimate. Pregame</dt>
            <dd className="pp-number">
              {home.abbreviation} {formatPercent(forecast.homeWinProbability)}
            </dd>
          </div>
        ) : null}
        {margin !== null ? (
          <div className="flex justify-between gap-3">
            <dt>Expected margin</dt>
            <dd className="pp-number">
              {Math.abs(margin) < 0.05
                ? "Even"
                : `${margin > 0 ? home.abbreviation : away.abbreviation} by ${Math.abs(margin).toFixed(1)}`}
            </dd>
          </div>
        ) : null}
        {game.neutral ? (
          <div className="flex justify-between gap-3">
            <dt>Venue</dt>
            <dd>Neutral site</dd>
          </div>
        ) : null}
        {game.series ? (
          <div className="flex justify-between gap-3">
            <dt>
              Series {home.abbreviation} {game.series.homeWins}-{game.series.awayWins} {away.abbreviation}
            </dt>
            <dd className="pp-number">
              {game.series.homeWinsSeries >= 0.5 ? home.abbreviation : away.abbreviation} wins it{" "}
              {formatPercent(Math.max(game.series.homeWinsSeries, 1 - game.series.homeWinsSeries))}
            </dd>
          </div>
        ) : game.seriesSummary ? (
          <div className="flex justify-between gap-3">
            <dt>Series</dt>
            <dd>{game.seriesSummary}</dd>
          </div>
        ) : null}
        {game.sealedFavoriteWon !== null ? (
          <div className="flex items-center justify-between gap-3">
            <dt>Sealed favorite</dt>
            <dd className="flex items-center gap-1 text-[var(--color-text-secondary)]">
              {game.sealedFavoriteWon ? (
                <CheckCircle2 size={12} aria-hidden />
              ) : (
                <XCircle size={12} aria-hidden />
              )}
              {game.sealedFavoriteWon ? "Won" : "Lost"}
            </dd>
          </div>
        ) : null}
      </dl>

      <InjuryList game={game} />
    </article>
  );
}

export function LiveDashboard({ initial }: { initial: SlateView }) {
  const [view, setView] = useState(initial);
  const [pollFailed, setPollFailed] = useState(false);
  const isClient = useIsClient();
  const anyLive = view.games.some((game) => game.status === "in-progress");

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/live/today", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = (await response.json()) as SlateView;
        if (!cancelled) {
          setView(next);
          setPollFailed(false);
        }
      } catch {
        if (!cancelled) setPollFailed(true);
      }
    };
    const timer = setInterval(poll, anyLive ? POLL_LIVE_MS : POLL_IDLE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [anyLive]);

  return (
    <section aria-labelledby="today-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="pp-kicker">Today&apos;s games</div>
          <h2
            id="today-title"
            className="mt-1 text-xl font-bold text-[var(--color-text-primary)]"
          >
            {formatSlateDate(view.etDate)}
          </h2>
        </div>
        <p className="pp-number text-xs text-[var(--color-text-muted)]">
          Scores checked {formatTime(view.fetchedAt, isClient)}
        </p>
      </div>

      {view.stale ? (
        <p
          role="alert"
          className="pp-card mb-3 flex items-start gap-2 p-3 text-sm text-[var(--color-text-secondary)]"
        >
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
          The forecast job last published {view.stateAgeHours.toFixed(0)} hours ago, so ratings and
          season odds may be out of date.
        </p>
      ) : null}
      {!view.scoresAvailable || pollFailed ? (
        <p
          role="status"
          className="pp-card mb-3 flex items-start gap-2 p-3 text-sm text-[var(--color-text-secondary)]"
        >
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
          Live scores could not be loaded just now. Sealed forecasts still show, and this page keeps
          retrying.
        </p>
      ) : null}

      {view.games.length === 0 ? (
        <p className="pp-card p-4 text-sm text-[var(--color-text-secondary)]">
          No NBA games on this date.
          {view.nextSlateEtDate && view.nextSlateEtDate !== view.etDate
            ? ` The next games are on ${formatSlateDate(view.nextSlateEtDate)}.`
            : ""}
        </p>
      ) : (
        <>
          <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ background: AWAY_COLOR }}
              />
              Away
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ background: HOME_COLOR }}
              />
              Home
            </span>
            <span>Percentages are each team&apos;s chance of winning.</span>
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {view.games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
