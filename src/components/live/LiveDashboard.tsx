"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, WifiOff } from "lucide-react";
import { GameCard } from "@/components/live/GameCard";
import { UpdatedAgo } from "@/components/live/UpdatedAgo";
import { useIsClient } from "@/components/live/useIsClient";
import type { SlateView } from "@/lib/season/slate";
import { formatClock, formatLongDay, formatStampEt } from "@/lib/utils/dates";

const POLL_LIVE_MS = 60_000;
const POLL_IDLE_MS = 300_000;

function marketSourceText(view: SlateView): string {
  const providers = [
    ...new Set(view.games.flatMap((game) => (game.market ? [game.market.provider] : []))),
  ].filter((provider) => provider && provider !== "unknown");
  if (providers.length === 1) return `${providers[0]} line via ESPN, vig removed`;
  if (providers.length > 1) return `${providers.join(" or ")} line via ESPN, vig removed`;
  return "Line via ESPN when available, vig removed";
}

function Key({ view }: { view: SlateView }) {
  const anyLive = view.games.some((game) => game.inGameHomeProbability !== null);
  const items: Array<[string, string]> = [
    [
      "Model",
      "Our chance of each team winning. Sealed numbers are fixed before tip and scored in the track record.",
    ],
    ["Market", `${marketSourceText(view)}. For reference only.`],
  ];
  if (anyLive) {
    items.push([
      "Live",
      "During a game, the model's estimate from the score and time left. Pregame is the number it started from.",
    ]);
  }
  items.push([
    "Injuries",
    "Listed with each game. The model does not account for them, so a game with a star out can be mispriced.",
  ]);
  return (
    <dl className="grid gap-x-8 gap-y-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] px-4 py-3 text-xs leading-5 text-[var(--color-text-muted)] sm:grid-cols-2">
      {items.map(([term, definition]) => (
        <div key={term} className="flex gap-2">
          <dt className="w-16 shrink-0 font-semibold text-[var(--color-text-primary)]">{term}</dt>
          <dd>{definition}</dd>
        </div>
      ))}
    </dl>
  );
}

function Notice({
  role,
  Icon,
  children,
}: {
  role: "alert" | "status";
  Icon: typeof AlertTriangle;
  children: React.ReactNode;
}) {
  return (
    <p
      role={role}
      className="flex items-start gap-2 rounded-xl border border-[#fedf89] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
    >
      <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
      <span>{children}</span>
    </p>
  );
}

export function LiveDashboard({
  initial,
  records,
}: {
  initial: SlateView;
  /** Season record ("W-L") by team ID, from the published forecast. */
  records: Record<string, string>;
}) {
  const [view, setView] = useState(initial);
  const [pollFailed, setPollFailed] = useState(false);
  const viewerZone = useIsClient();
  const router = useRouter();
  const publishedAt = useRef(initial.generatedAt);
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
          // A new publish also changes the season odds, which this poll does not carry.
          if (next.generatedAt !== publishedAt.current) {
            publishedAt.current = next.generatedAt;
            router.refresh();
          }
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
  }, [anyLive, router]);

  const liveCount = view.games.filter((game) => game.status === "in-progress").length;
  const finalCount = view.games.filter((game) => game.status === "final").length;
  const hasNext = view.nextSlateEtDate !== null && view.nextSlateEtDate !== view.etDate;

  return (
    <section aria-labelledby="today-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            {formatLongDay(view.etDate)}
          </p>
          <h1
            id="today-title"
            className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-3xl"
          >
            Today&apos;s games
          </h1>
          {view.games.length > 0 ? (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {view.games.length} {view.games.length === 1 ? "game" : "games"}
              {liveCount > 0 ? ` · ${liveCount} live` : ""}
              {finalCount > 0 ? ` · ${finalCount} final` : ""}
            </p>
          ) : null}
        </div>
        <p className="tabular text-xs leading-5 text-[var(--color-text-muted)] sm:text-right">
          Scores checked {formatClock(view.fetchedAt, viewerZone)}
          <br />
          Forecasts{" "}
          <UpdatedAgo
            iso={view.generatedAt}
            stamp={formatStampEt(view.generatedAt)}
            lowercase
          />
        </p>
      </div>

      {view.stale ? (
        <Notice role="alert" Icon={AlertTriangle}>
          The forecast job last published {view.stateAgeHours.toFixed(0)} hours ago, so ratings and
          season odds may be out of date. Sealed forecasts still show.
        </Notice>
      ) : null}
      {!view.scoresAvailable || pollFailed ? (
        <Notice role="status" Icon={WifiOff}>
          Live scores could not be loaded just now. Sealed forecasts still show, and this page keeps
          retrying.
        </Notice>
      ) : null}

      {view.games.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] p-6">
          <CalendarDays size={20} aria-hidden className="text-[var(--color-text-muted)]" />
          <p className="text-base font-semibold text-[var(--color-text-primary)]">
            No NBA games today
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            {hasNext
              ? `The next games are on ${formatLongDay(view.nextSlateEtDate!)}. Forecasts appear here that morning.`
              : "Forecasts appear here on the morning of the next game day."}{" "}
            <Link href="/odds" className="pp-link">
              See the season odds
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <Key view={view} />
          <div className="grid gap-4 lg:grid-cols-2">
            {view.games.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                records={records}
                injuriesAvailable={view.injuriesAvailable}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
