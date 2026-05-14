"use client";

import { useMemo, useState } from "react";
import {
  dataLastUpdatedTimestamp,
  playoffConfig,
} from "@/lib/data/playoff-config";
import { defaultModelSettings } from "@/lib/data/model-settings";
import type { ModelSettings } from "@/lib/model/types";
import {
  applyManualAdjustments,
  buildForecastSnapshot,
} from "@/lib/model/forecast";
import { validateConfig } from "@/lib/model/validation";
import { Section } from "@/components/layout/Section";
import { BacktestSummaryCard } from "@/components/forecast/BacktestSummaryCard";
import { MethodologyNote } from "@/components/forecast/MethodologyNote";
import { LiveDataPanel } from "@/components/forecast/LiveDataPanel";
import { ModelControls } from "@/components/forecast/ModelControls";
import { ProbabilityTable } from "@/components/forecast/ProbabilityTable";
import { SeriesCard } from "@/components/forecast/SeriesCard";
import { SimulationSummary } from "@/components/forecast/SimulationSummary";
import { TeamDetailDrawer } from "@/components/forecast/TeamDetailDrawer";
import { TeamStrengthTable } from "@/components/forecast/TeamStrengthTable";
import { formatPercent } from "@/lib/utils/format";

const initialAdjustments = Object.fromEntries(
  playoffConfig.teams.map((team) => [team.id, team.manualAdjustment]),
);

export function ForecastDashboard() {
  const [settings, setSettings] = useState<ModelSettings>(defaultModelSettings);
  const [manualAdjustments, setManualAdjustments] =
    useState<Record<string, number>>(initialAdjustments);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const adjustedTeams = useMemo(
    () => applyManualAdjustments(playoffConfig.teams, manualAdjustments),
    [manualAdjustments],
  );

  const snapshot = useMemo(
    () => buildForecastSnapshot(playoffConfig, settings, adjustedTeams),
    [settings, adjustedTeams],
  );

  const validation = useMemo(
    () =>
      validateConfig(
        { ...playoffConfig, teams: adjustedTeams },
        settings,
      ),
    [settings, adjustedTeams],
  );
  const activeSeries = playoffConfig.series.filter(
    (series) => series.winsA < 4 && series.winsB < 4,
  );
  const championshipRows = snapshot.bracketForecast.rows.slice(0, 6);
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
          "Manual data snapshot",
          `Last updated ${dataLastUpdatedTimestamp}`,
          "Read-only live scoreboard probe",
          "Probabilities are model estimates",
          validationStatus,
        ].map((label) => (
          <span key={label} className="pp-pill border-[rgba(201,150,31,0.45)] text-[var(--color-accent)]">
            {label}
          </span>
        ))}
      </div>

      <Section
        title="Live Data Probe"
        description="Read-only NBA scoreboard feed for data-ingestion validation. It does not overwrite manual ratings, injuries, rotations, or series state yet."
      >
        <LiveDataPanel />
      </Section>

      <Section
        title="Championship Estimate"
        description="Top title probabilities from the current manual input set and bracket simulation."
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
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
                className="border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-3 text-left transition hover:border-[var(--color-accent)] hover:bg-[var(--overlay-row-hover)]"
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
        description="Each card shows the current manual series state, next-game estimate, series probability, and main model drivers."
      >
        <div className="grid gap-4 p-4 xl:grid-cols-2">
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
      </Section>

      <Section title="Model Validation">
        <BacktestSummaryCard />
      </Section>

      <div className="grid gap-[18px] xl:grid-cols-[1.4fr_1fr]">
        <Section
          title="Probability Table"
          description="Current series, conference finals, Finals, and championship probabilities."
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
          description="Point-scale estimate from player-minute impact, net rating, Elo, and manual adjustment."
        >
          <TeamStrengthTable
            teamsById={snapshot.teamsById}
            forecasts={snapshot.teamForecasts}
            onTeamSelect={setSelectedTeamId}
          />
        </Section>
      </div>

      <div className="grid gap-[18px] xl:grid-cols-2">
        <Section
          title="Controls"
          description="Changes are local to this browser session. No account, database, or write-back API is used in this MVP."
        >
          <ModelControls
            settings={settings}
            teams={snapshot.teams}
            manualAdjustments={manualAdjustments}
            onSettingsChange={setSettings}
            onManualAdjustmentChange={(teamId, value) =>
              setManualAdjustments((current) => ({ ...current, [teamId]: value }))
            }
            onReset={() => {
              setSettings(defaultModelSettings);
              setManualAdjustments(initialAdjustments);
            }}
          />
        </Section>

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
