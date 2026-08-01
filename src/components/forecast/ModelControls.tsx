"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ModelSettings, Team } from "@/lib/model/types";
import { formatSigned } from "@/lib/utils/format";

type ModelControlsProps = {
  settings: ModelSettings;
  teams: Team[];
  manualAdjustments: Record<string, number>;
  onSettingsChange: (settings: ModelSettings) => void;
  onManualAdjustmentChange: (teamId: string, value: number) => void;
  onReset: () => void;
};

export function ModelControls({
  settings,
  teams,
  manualAdjustments,
  onSettingsChange,
  onManualAdjustmentChange,
  onReset,
}: ModelControlsProps) {
  return (
    <div className="pp-card border-0 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--color-accent)]" aria-hidden />
          <h3 className="pp-kicker text-[var(--color-text-primary)]">Unvalidated overlay controls</h3>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="pp-button pp-button-danger"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Reset
        </button>
      </div>

      <div className="grid gap-0 divide-y divide-[var(--color-border-subtle)] lg:grid-cols-[0.9fr_1.4fr] lg:divide-x lg:divide-y-0">
        <div className="space-y-5 p-4">
          <label className="block">
            <span className="flex items-center justify-between gap-3">
              <span className="pp-kicker">Home-court advantage</span>
              <span className="pp-number font-bold text-[var(--color-accent)]">
                {settings.homeCourtAdvantage.toFixed(1)}
              </span>
            </span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.1"
              value={settings.homeCourtAdvantage}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  homeCourtAdvantage: Number(event.target.value),
                })
              }
              className="mt-3 w-full"
            />
          </label>

          <label className="block">
            <span className="pp-kicker">Simulation iterations</span>
            <select
              value={settings.simulationIterations}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  simulationIterations: Number(event.target.value),
                })
              }
              className="pp-select mt-2 bg-[var(--color-bg-secondary)]"
            >
              <option value={1000}>1,000</option>
              <option value={5000}>5,000</option>
              <option value={10000}>10,000</option>
              <option value={25000}>25,000</option>
            </select>
          </label>
        </div>

        <div className="p-4">
          <div className="mb-3 pp-kicker">Manual scenario adjustments</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((team) => (
              <label
                key={team.id}
                className="block rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-3"
              >
                <span className="flex items-center justify-between gap-3 text-sm">
                  <span className="pp-team-badge" data-team={team.abbreviation}>
                    {team.abbreviation}
                  </span>
                  <span
                    className={`pp-number font-bold ${
                      (manualAdjustments[team.id] ?? team.manualAdjustment) < 0
                        ? "text-[var(--color-danger)]"
                        : (manualAdjustments[team.id] ?? team.manualAdjustment) > 0
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-text-muted)]"
                    }`}
                  >
                    {formatSigned(manualAdjustments[team.id] ?? team.manualAdjustment)}
                  </span>
                </span>
                <input
                  type="range"
                  min="-3"
                  max="3"
                  step="0.1"
                  value={manualAdjustments[team.id] ?? team.manualAdjustment}
                  onChange={(event) =>
                    onManualAdjustmentChange(team.id, Number(event.target.value))
                  }
                  className="mt-3 w-full"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
