"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import type {
  BracketForecastRow,
  Team,
  TeamForecast,
} from "@/lib/model/types";
import { formatNumber, formatPercent, formatSigned } from "@/lib/utils/format";

type TeamDetailDrawerProps = {
  team: Team | null;
  forecast: TeamForecast | null;
  bracketRow: BracketForecastRow | null;
  currentSeriesProbability: number | null;
  dataLastUpdatedTimestamp: string;
  validationStatus: string;
  onClose: () => void;
};

function modelStatus(player: Team["players"][number]): string {
  if (player.injuryStatus === "out" || player.projectedMinutes <= 0) {
    return "Inactive";
  }

  return "Active";
}

function statusTone(player: Team["players"][number]): string {
  if (player.injuryStatus === "out" || player.projectedMinutes <= 0) {
    return "text-[var(--color-danger)]";
  }

  if (player.injuryStatus === "questionable" || player.injuryStatus === "limited") {
    return "text-[var(--color-warning)]";
  }

  return "text-[var(--color-success)]";
}

function DetailMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="border border-[var(--color-border-subtle)] bg-[var(--color-panel-secondary)] p-3">
      <div className="pp-kicker">{label}</div>
      <div className={`pp-number mt-2 text-lg font-bold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function TeamDetailDrawer({
  team,
  forecast,
  bracketRow,
  currentSeriesProbability,
  dataLastUpdatedTimestamp,
  validationStatus,
  onClose,
}: TeamDetailDrawerProps) {
  useEffect(() => {
    if (!team) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, team]);

  if (!team || !forecast) {
    return null;
  }

  const probabilityRows = [
    ["Current series", currentSeriesProbability],
    ["Conference finals", bracketRow?.reachConferenceFinalsProbability ?? null],
    ["Finals", bracketRow?.reachFinalsProbability ?? null],
    ["Championship", bracketRow?.championshipProbability ?? null],
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(26,24,20,0.28)]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
      />
      <aside
        className="relative h-full w-full max-w-[620px] overflow-y-auto border-l-2 border-[var(--color-border-strong)] bg-[var(--color-panel-primary)] shadow-2xl pp-scan-lite"
        aria-modal="true"
        role="dialog"
        aria-labelledby="team-detail-title"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b-2 border-[var(--color-border-strong)] bg-[var(--color-bg-primary)] p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pp-team-badge" data-team={team.abbreviation}>
                {team.abbreviation}
              </span>
              <span className="pp-kicker text-[var(--color-accent)]">
                {team.conference} / Seed {team.seed}
              </span>
            </div>
            <h2
              id="team-detail-title"
              className="mt-3 text-xl font-bold text-[var(--color-text-primary)]"
            >
              {team.name}
            </h2>
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-border-strong)] bg-[var(--color-panel-secondary)] transition hover:border-[var(--color-accent)]"
            aria-label="Close team detail drawer"
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="grid gap-4 p-4">
          <div className="grid gap-2 border-2 border-[var(--color-border-subtle)] bg-[var(--overlay-accent-soft)] p-3 text-xs leading-5 text-[var(--color-text-muted)]">
            <div className="flex flex-wrap gap-2">
              <span className="pp-pill border-[rgba(201,150,31,0.45)] text-[var(--color-accent)]">
                Manual model inputs
              </span>
              <span className="pp-pill">Updated {dataLastUpdatedTimestamp}</span>
              <span className="pp-pill">{validationStatus}</span>
            </div>
            <p>
              These are manually maintained playoff model inputs, not live
              official NBA stats. Probabilities are model estimates from the
              current static snapshot.
            </p>
          </div>

          <section className="grid gap-3">
            <h3 className="pp-kicker text-[var(--color-text-primary)]">
              Forecast probabilities
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {probabilityRows.map(([label, value]) => (
                <DetailMetric
                  key={label}
                  label={label}
                  value={value === null ? "n/a" : formatPercent(value)}
                />
              ))}
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="pp-kicker text-[var(--color-text-primary)]">
              Team strength breakdown
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <DetailMetric
                label="Player-minute impact"
                value={formatNumber(forecast.playerMinuteImpact)}
              />
              <DetailMetric
                label="Net rating"
                value={formatSigned(forecast.netRating)}
              />
              <DetailMetric
                label="Elo-derived value"
                value={formatSigned(forecast.eloPointValue)}
              />
              <DetailMetric
                label="Manual adjustment"
                value={formatSigned(forecast.manualAdjustment)}
                tone={
                  forecast.manualAdjustment > 0
                    ? "text-[var(--color-success)]"
                    : forecast.manualAdjustment < 0
                      ? "text-[var(--color-danger)]"
                      : "text-[var(--color-text-faint)]"
                }
              />
              <DetailMetric
                label="Final team strength"
                value={formatSigned(forecast.finalStrength)}
                tone="text-[var(--color-text-primary)]"
              />
            </div>
          </section>

          <section className="grid gap-3">
            <h3 className="pp-kicker text-[var(--color-text-primary)]">
              Roster model inputs
            </h3>
            <div className="overflow-x-auto border-2 border-[var(--color-border-subtle)]">
              <table className="pp-table min-w-[560px]">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="num">Minutes</th>
                    <th className="num">Impact</th>
                    <th>Injury</th>
                    <th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  {team.players.map((player) => (
                    <tr key={player.id}>
                      <td className="font-bold text-[var(--color-text-primary)]">
                        {player.name}
                      </td>
                      <td className="num pp-number">
                        {formatNumber(player.projectedMinutes, 0)}
                      </td>
                      <td className="num pp-number">
                        {formatSigned(player.impact)}
                      </td>
                      <td className="capitalize">{player.injuryStatus}</td>
                      <td className={`pp-kicker ${statusTone(player)}`}>
                        {modelStatus(player)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
