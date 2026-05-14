"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, RadioTower } from "lucide-react";
import type { LiveScoreboardSnapshot } from "@/lib/live-data/types";

type LiveDataState =
  | { phase: "loading" }
  | { phase: "ready"; snapshot: LiveScoreboardSnapshot }
  | { phase: "error"; message: string };

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function scoreLine(snapshot: LiveScoreboardSnapshot): string {
  if (snapshot.status === "unavailable") {
    return "Unavailable";
  }

  if (!snapshot.games.length) {
    return "No games";
  }

  return `${snapshot.games.length} game${snapshot.games.length === 1 ? "" : "s"}`;
}

export function LiveDataPanel() {
  const [state, setState] = useState<LiveDataState>({ phase: "loading" });

  const fetchSnapshot = useCallback(async (): Promise<LiveDataState> => {
    try {
      const response = await fetch("/api/live-scoreboard", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Live route returned HTTP ${response.status}.`);
      }

      return {
        phase: "ready",
        snapshot: (await response.json()) as LiveScoreboardSnapshot,
      };
    } catch (error) {
      return {
        phase: "error",
        message:
          error instanceof Error
            ? error.message
            : "Live scoreboard could not be loaded.",
      };
    }
  }, []);

  const loadSnapshot = useCallback(async () => {
    setState({ phase: "loading" });
    setState(await fetchSnapshot());
  }, [fetchSnapshot]);

  useEffect(() => {
    let isActive = true;

    void fetchSnapshot().then((nextState) => {
      if (isActive) {
        setState(nextState);
      }
    });

    return () => {
      isActive = false;
    };
  }, [fetchSnapshot]);

  const snapshot = state.phase === "ready" ? state.snapshot : null;
  const statusLabel =
    state.phase === "loading"
      ? "Loading"
      : state.phase === "error" || snapshot?.status === "unavailable"
        ? "Unavailable"
        : "Connected";
  const statusTone =
    statusLabel === "Connected"
      ? "text-[var(--color-success)]"
      : statusLabel === "Unavailable"
        ? "text-[var(--color-danger)]"
        : "text-[var(--color-warning)]";

  return (
    <div className="grid gap-0 divide-y divide-[var(--color-border-subtle)]">
      <div className="grid gap-0 divide-y divide-[var(--color-border-subtle)] lg:grid-cols-[1fr_1fr_1fr_auto] lg:divide-x lg:divide-y-0">
        <div className="p-4">
          <div className="flex items-center gap-2">
            <RadioTower className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
            <span className="pp-kicker">Live scoreboard probe</span>
          </div>
          <div className={`pp-number mt-3 text-xl font-bold ${statusTone}`}>
            {statusLabel}
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
            Read-only feed. Forecast probabilities still use manual model inputs.
          </p>
        </div>

        <div className="p-4">
          <div className="pp-kicker">Source</div>
          <div className="mt-3 text-sm font-bold text-[var(--color-text-primary)]">
            {snapshot?.sourceLabel ?? "ESPN public scoreboard endpoint"}
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
            External score/status feed with local fallback behavior.
          </p>
        </div>

        <div className="p-4">
          <div className="pp-kicker">Feed snapshot</div>
          <div className="pp-number mt-3 text-xl font-bold">
            {snapshot ? scoreLine(snapshot) : "Checking"}
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
            Fetched {snapshot ? formatTimestamp(snapshot.fetchedAt) : "now"}.
            Manual-team matches:{" "}
            {snapshot
              ? `${snapshot.manualTeamMatches}/${snapshot.manualTeamCount}`
              : "n/a"}
            .
          </p>
        </div>

        <div className="flex items-center p-4">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-border-strong)] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] transition hover:border-[var(--color-accent)]"
            onClick={loadSnapshot}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {state.phase === "error" ? (
        <div className="flex items-start gap-3 bg-[var(--overlay-danger-soft)] p-4 text-xs leading-5 text-[var(--color-danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{state.message}</span>
        </div>
      ) : null}

      {snapshot?.warnings.length ? (
        <div className="grid gap-2 bg-[var(--overlay-accent-soft)] p-4 text-xs leading-5 text-[var(--color-text-muted)]">
          {snapshot.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {snapshot?.games.length ? (
        <div className="overflow-x-auto">
          <table className="pp-table min-w-[760px]">
            <thead>
              <tr>
                <th>Game</th>
                <th>Status</th>
                <th>Score</th>
                <th>Venue</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.games.slice(0, 6).map((game) => (
                <tr key={game.id}>
                  <td>
                    <div className="font-bold text-[var(--color-text-primary)]">
                      {game.shortName}
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {formatTimestamp(game.date)}
                    </div>
                  </td>
                  <td>
                    <span className="pp-pill">{game.statusDetail}</span>
                  </td>
                  <td className="pp-number">
                    {game.awayTeam?.abbreviation ?? "AWY"}{" "}
                    {game.awayTeam?.score ?? "-"} /{" "}
                    {game.homeTeam?.abbreviation ?? "HOME"}{" "}
                    {game.homeTeam?.score ?? "-"}
                  </td>
                  <td>{game.venue ?? "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
