"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";
import {
  dataLastUpdated,
  dataLastUpdatedTimestamp,
  playoffConfig,
} from "@/lib/data/playoff-config";
import { defaultModelSettings } from "@/lib/data/model-settings";
import { buildForecastSnapshot } from "@/lib/model/forecast";
import { validateConfig } from "@/lib/model/validation";
import { Section } from "@/components/layout/Section";
import { BacktestSummaryCard } from "@/components/forecast/BacktestSummaryCard";
import { MethodologyNote } from "@/components/forecast/MethodologyNote";
import { LiveDataPanel } from "@/components/forecast/LiveDataPanel";
import { ProbabilityTable } from "@/components/forecast/ProbabilityTable";
import { SeriesCard } from "@/components/forecast/SeriesCard";
import { SimulationSummary } from "@/components/forecast/SimulationSummary";
import { TeamDetailDrawer } from "@/components/forecast/TeamDetailDrawer";
import { TeamStrengthTable } from "@/components/forecast/TeamStrengthTable";
import { formatPercent } from "@/lib/utils/format";

// Mirrors DEFAULT_STALE_DAYS in scripts/refresh-data.ts: active playoff series
// never pause this long, so an older snapshot means the data pipeline broke.
const STALE_SNAPSHOT_DAYS = 4;

// Snapshot age is a client-only value: the page is statically prerendered, so
// it must be measured against the viewer's clock, not the build clock. The
// server snapshot is null (no banner in prerendered HTML); the value is stable
// within a day, so Object.is comparison keeps re-renders quiet.
const emptySubscribe = () => () => {};

function getSnapshotAgeDays(): number {
  const snapshotMs = new Date(`${dataLastUpdated}T00:00:00-07:00`).getTime();
  if (Number.isNaN(snapshotMs)) {
    return -1;
  }

  return Math.floor((Date.now() - snapshotMs) / (24 * 60 * 60 * 1000));
}

export function ForecastDashboard() {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const snapshotAgeDays = useSyncExternalStore<number | null>(
    emptySubscribe,
    getSnapshotAgeDays,
    () => null,
  );

  const snapshot = useMemo(
    () => buildForecastSnapshot(playoffConfig, defaultModelSettings),
    [],
  );

  const validation = useMemo(
    () =>
      validateConfig(
        playoffConfig,
        defaultModelSettings,
      ),
    [],
  );
  const activeSeries = playoffConfig.series.filter(
    (series) => series.winsA < 4 && series.winsB < 4,
  );
  const showStaleWarning =
    activeSeries.length > 0 &&
    snapshotAgeDays !== null &&
    snapshotAgeDays > STALE_SNAPSHOT_DAYS;
  const finalsSeries = playoffConfig.series.find(
    (series) => series.round === "NBA Finals",
  );
  const finalsComplete = Boolean(
    finalsSeries && (finalsSeries.winsA === 4 || finalsSeries.winsB === 4),
  );
  const championTeam =
    finalsSeries && finalsComplete
      ? snapshot.teamsById[
          finalsSeries.winsA === 4 ? finalsSeries.teamA : finalsSeries.teamB
        ]
      : null;
  const finalsScoreLabel = finalsSeries
    ? `${Math.max(finalsSeries.winsA, finalsSeries.winsB)}-${Math.min(finalsSeries.winsA, finalsSeries.winsB)}`
    : null;
  const titleLiveRows = snapshot.bracketForecast.rows.filter(
    (row) => row.championshipProbability > 0 || row.reachFinalsProbability > 0,
  );
  const championshipRows = (titleLiveRows.length
    ? titleLiveRows
    : snapshot.bracketForecast.rows
  ).slice(0, 6);
  const championshipGridClass = `grid gap-3 p-4 sm:grid-cols-2 ${
    championshipRows.length > 2 ? "xl:grid-cols-6" : ""
  }`;
  const activeSeriesGridClass = `grid gap-4 p-4 ${
    activeSeries.length > 1 ? "xl:grid-cols-2" : ""
  }`;
  const topChampionshipProbability =
    championshipRows[0]?.championshipProbability ?? 1;
  const selectedTeam = selectedTeamId ? snapshot.teamsById[selectedTeamId] : null;
  const selectedTeamForecast =
    snapshot.teamForecasts.find((forecast) => forecast.teamId === selectedTeamId) ??
    null;
  const selectedBracketRow =
    snapshot.bracketForecast.rows.find((row) => row.teamId === selectedTeamId) ??
    null;
  const selectedCurrentSeries =
    snapshot.seriesForecasts.find(
      (forecast) =>
        forecast.winsA < 4 &&
        forecast.winsB < 4 &&
        (forecast.teamAId === selectedTeamId || forecast.teamBId === selectedTeamId),
    ) ?? null;
  const selectedCurrentSeriesProbability =
    selectedCurrentSeries && selectedTeamId
      ? selectedCurrentSeries.teamAId === selectedTeamId
        ? selectedCurrentSeries.teamASeriesWinProbability
        : selectedCurrentSeries.teamBSeriesWinProbability
      : null;
  const validationStatus = validation.errors.length
    ? "Validation: errors"
    : validation.warnings.length
      ? "Validation: warnings"
      : "Validation: passed";

  return (
    <div className="flex flex-col gap-[18px]">
      <Section title="Model Status">
        <SimulationSummary
          validationErrors={validation.errors}
          validationWarnings={validation.warnings}
          dataLastUpdatedTimestamp={dataLastUpdatedTimestamp}
        />
      </Section>

      <div className="flex flex-wrap items-center gap-2 border-y-2 border-[var(--color-border-strong)] bg-[var(--overlay-accent-soft)] px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
        {[
          ...(championTeam
            ? [`Playoffs complete: ${championTeam.name} won the title`]
            : []),
          "Manual data snapshot",
          `Last updated ${dataLastUpdatedTimestamp}`,
          "Read-only live scoreboard probe",
          "Probabilities are evidenced-baseline estimates",
          `Model ${snapshot.metadata.modelVersion}`,
          validationStatus,
        ].map((label) => (
          <span key={label} className="pp-pill border-[rgba(201,150,31,0.45)] text-[var(--color-accent)]">
            {label}
          </span>
        ))}
      </div>

      {showStaleWarning ? (
        <div className="flex items-start gap-3 border-y-2 border-[var(--color-border-strong)] bg-[var(--overlay-danger-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            This snapshot is {snapshotAgeDays} days old while series are still
            active. Active playoff series do not pause this long, so the data
            refresh has likely failed - treat every probability on this page as
            outdated.
          </span>
        </div>
      ) : null}

      <Section
        title="Engineering Appendix: Live Data Probe"
        description="Preserved read-only NBA scoreboard feed, kept as a data-ingestion validation demo. It never fed the model, and with the season complete it typically shows no games."
      >
        <LiveDataPanel />
      </Section>

      <Section
        title="Championship Estimate"
        description="Backtested rating-only baseline probabilities. With a finished Finals these terminal values are accounting, not forecasts; player and injury scenarios live in the clearly labeled lab overlay."
      >
        <div className={championshipGridClass}>
          {championshipRows.map((row) => {
            const team = snapshot.teamsById[row.teamId];
            const scale =
              topChampionshipProbability > 0
                ? row.championshipProbability / topChampionshipProbability
                : 0;

            return (
              <button
                type="button"
                key={row.teamId}
                className="pp-action-tile p-3 text-left"
                onClick={() => setSelectedTeamId(row.teamId)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="pp-team-badge" data-team={team.abbreviation}>
                    {team.abbreviation}
                  </span>
                  <span className="pp-kicker">{team.conference.slice(0, 1)}{team.seed}</span>
                </div>
                <div className="pp-number mt-3 text-2xl font-bold">
                  {formatPercent(row.championshipProbability)}
                </div>
                <div className="pp-probbar mt-3 h-[9px]">
                  <span
                    className="pp-probbar-fill"
                    style={{ width: `${Math.max(0, Math.min(1, scale)) * 100}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Active Series"
        description="Each card shows the evidenced rating-only baseline. Player, minutes, injury, and manual assumptions are excluded from these published probabilities and appear only as a labeled scenario overlay in the lab."
      >
        {activeSeries.length === 0 ? (
          <div className="p-4 text-sm leading-6 text-[var(--color-text-muted)]">
            No active series remain.{" "}
            {championTeam && finalsScoreLabel
              ? `The ${championTeam.name} won the NBA Finals ${finalsScoreLabel}. Series results stay available in the probability table below.`
              : "The configured bracket is complete."}
          </div>
        ) : (
          <div className={activeSeriesGridClass}>
            {activeSeries.map((series) => {
              const forecast = snapshot.seriesForecasts.find(
                (item) => item.seriesId === series.id,
              );

              if (!forecast) {
                return null;
              }

              return (
                <SeriesCard
                  key={series.id}
                  series={series}
                  forecast={forecast}
                  teamsById={snapshot.teamsById}
                  onTeamSelect={setSelectedTeamId}
                />
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Model Validation">
        <BacktestSummaryCard />
      </Section>

      <div className="grid gap-[18px] xl:grid-cols-[1.4fr_1fr]">
        <Section
          title="Probability Table"
          description="Backtested baseline title paths. Eliminated teams are shown as inactive rather than active future paths."
        >
          <ProbabilityTable
            seriesForecasts={snapshot.seriesForecasts}
            bracketForecast={snapshot.bracketForecast}
            teamsById={snapshot.teamsById}
            onTeamSelect={setSelectedTeamId}
          />
        </Section>

        <Section
          title="Team Strength"
          description="The rating-only baseline and the separately identified unvalidated scenario contribution."
        >
          <TeamStrengthTable
            teamsById={snapshot.teamsById}
            forecasts={snapshot.teamForecasts}
            onTeamSelect={setSelectedTeamId}
          />
        </Section>
      </div>

      <div className="grid gap-[18px]">
        <Section title="What The Model Can't See">
          <MethodologyNote />
        </Section>
      </div>

      <TeamDetailDrawer
        team={selectedTeam}
        forecast={selectedTeamForecast}
        bracketRow={selectedBracketRow}
        currentSeriesProbability={selectedCurrentSeriesProbability}
        dataLastUpdatedTimestamp={dataLastUpdatedTimestamp}
        validationStatus={validationStatus}
        onClose={() => setSelectedTeamId(null)}
      />
    </div>
  );
}
