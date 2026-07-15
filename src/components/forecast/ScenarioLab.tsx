"use client";

import { useMemo, useState } from "react";
import evidence from "../../../docs/backtest/evidence.json";
import { playoffConfig, dataLastUpdatedTimestamp } from "@/lib/data/playoff-config";
import { defaultModelSettings } from "@/lib/data/model-settings";
import type { InjuryStatus, Series, Team } from "@/lib/model/types";
import { allocateScenarioRotation, type PlayerScenarioOverride } from "@/lib/model/rotation";
import { estimateSeriesProbability } from "@/lib/model/simulator";
import { formatNumber, formatPercent, formatSigned } from "@/lib/utils/format";

type Overrides = Record<string, PlayerScenarioOverride>;

const configuredFinals = playoffConfig.series.find((series) => series.round === "NBA Finals");
if (!configuredFinals) throw new Error("Scenario laboratory requires a configured Finals series.");
const demoSeries: Series = { ...configuredFinals, id: `${configuredFinals.id}-preserved-demo`, winsA: 0, winsB: 0 };

function PlayerControls({
  team,
  overrides,
  onChange,
}: {
  team: Team;
  overrides: Overrides;
  onChange: (playerId: string, value: PlayerScenarioOverride) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="pp-team-badge" data-team={team.abbreviation}>{team.abbreviation}</span>
        <span className="pp-kicker">Player assumptions</span>
      </div>
      {team.players
        .filter((player) => player.projectedMinutes > 0 || (player.healthyProjectedMinutes ?? 0) > 0)
        .slice(0, 9)
        .map((player) => {
          const value = overrides[player.id] ?? {};
          const status = value.injuryStatus ?? player.injuryStatus;
          const minutes = value.projectedMinutes ?? (status === "out" ? 0 : player.projectedMinutes || player.healthyProjectedMinutes || 0);
          return (
            <div key={player.id} className="grid gap-2 border-b border-[var(--color-border-subtle)] pb-2 sm:grid-cols-[1fr_116px_90px] sm:items-center">
              <span className="text-xs font-bold text-[var(--color-text-primary)]">{player.name}</span>
              <select
                aria-label={`${player.name} availability`}
                value={status}
                onChange={(event) => {
                  const injuryStatus = event.target.value as InjuryStatus;
                  onChange(player.id, {
                    ...value,
                    injuryStatus,
                    projectedMinutes: injuryStatus === "out" ? 0 : minutes || player.healthyProjectedMinutes || player.projectedMinutes,
                  });
                }}
                className="border-2 border-[var(--color-border-strong)] bg-[var(--color-bg-primary)] px-2 py-1 text-xs"
              >
                <option value="healthy">Healthy</option>
                <option value="questionable">Questionable</option>
                <option value="limited">Limited</option>
                <option value="out">Out</option>
              </select>
              <label className="grid grid-cols-[1fr_34px] items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                <input
                  aria-label={`${player.name} minutes`}
                  type="range"
                  min="0"
                  max="48"
                  step="1"
                  disabled={status === "out"}
                  value={status === "out" ? 0 : minutes}
                  onChange={(event) => onChange(player.id, { ...value, projectedMinutes: Number(event.target.value), injuryStatus: status })}
                />
                <span className="pp-number text-right">{status === "out" ? 0 : minutes}</span>
              </label>
            </div>
          );
        })}
    </div>
  );
}

export function ScenarioLab() {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [replaySeriesId, setReplaySeriesId] = useState(
    evidence.seriesIndex.find((row) => row.season === 2025)?.seriesId ?? evidence.seriesIndex[0].seriesId,
  );
  const baseTeams = useMemo(() => Object.fromEntries(playoffConfig.teams.map((team) => [team.id, team])), []);
  const baseA = baseTeams[demoSeries.teamA];
  const baseB = baseTeams[demoSeries.teamB];
  const baseline = useMemo(
    () => estimateSeriesProbability(demoSeries, { [baseA.id]: baseA, [baseB.id]: baseB }, defaultModelSettings),
    [baseA, baseB],
  );
  const allocationA = useMemo(() => allocateScenarioRotation(baseA, { overrides }), [baseA, overrides]);
  const allocationB = useMemo(() => allocateScenarioRotation(baseB, { overrides }), [baseB, overrides]);
  const scenario = useMemo(
    () => estimateSeriesProbability(
      demoSeries,
      { [baseA.id]: allocationA.team, [baseB.id]: allocationB.team },
      defaultModelSettings,
    ),
    [allocationA.team, allocationB.team, baseA.id, baseB.id],
  );
  const replay = evidence.timeline.filter((row) => row.seriesId === replaySeriesId);
  const replayMeta = evidence.seriesIndex.find((row) => row.seriesId === replaySeriesId);
  const scoreRows = Object.entries(scenario.finalScoreProbabilities).sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid gap-[18px]">
      <section className="pp-card">
        <div className="pp-section-head">
          <div className="pp-kicker text-[var(--color-accent)]">Preserved demonstration / hypothetical</div>
          <h1 className="mt-2 text-2xl font-bold">Scenario laboratory</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
            Replays the configured Finals from 0–0 using the manual {dataLastUpdatedTimestamp} roster snapshot. It does not imply the completed 2026 postseason is active.
          </p>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <PlayerControls team={baseA} overrides={overrides} onChange={(id, value) => setOverrides((current) => ({ ...current, [id]: value }))} />
          <PlayerControls team={baseB} overrides={overrides} onChange={(id, value) => setOverrides((current) => ({ ...current, [id]: value }))} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-[var(--color-border-subtle)] p-4">
          <span className="text-xs text-[var(--color-text-muted)]">
            Replacement minutes: {baseA.abbreviation} {formatNumber(allocationA.replacementMinutes)} / {baseB.abbreviation} {formatNumber(allocationB.replacementMinutes)}
          </span>
          <button type="button" onClick={() => setOverrides({})} className="border-2 border-[var(--color-border-strong)] px-3 py-2 text-xs font-bold uppercase">Reset assumptions</button>
        </div>
      </section>

      <section className="pp-card">
        <div className="pp-section-head">
          <div className="pp-kicker">Central estimate versus sensitivity</div>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="grid gap-3">
            <div className="flex items-end justify-between">
              <span className="pp-team-badge" data-team={baseA.abbreviation}>{baseA.abbreviation}</span>
              <span className="pp-number text-3xl font-bold">{formatPercent(scenario.teamASeriesWinProbability)}</span>
            </div>
            <div className="relative h-4 bg-[var(--color-panel-secondary)]">
              <span className="absolute top-0 h-4 bg-[var(--color-accent)] opacity-60" style={{ left: `${scenario.uncertainty.lower * 100}%`, width: `${(scenario.uncertainty.upper - scenario.uncertainty.lower) * 100}%` }} />
              <span className="absolute top-[-4px] h-6 w-[3px] bg-[var(--color-text-primary)]" style={{ left: `${scenario.teamASeriesWinProbability * 100}%` }} />
            </div>
            <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
              <span>Sensitivity {formatPercent(scenario.uncertainty.lower)}–{formatPercent(scenario.uncertainty.upper)}</span>
              <span>Δ from baseline {formatSigned((scenario.teamASeriesWinProbability - baseline.teamASeriesWinProbability) * 100)} pp</span>
            </div>
            <div className="grid gap-1 border-t border-[var(--color-border-subtle)] pt-3">
              {scenario.nextGame?.drivers.filter((driver) => Math.abs(driver.marginPointsForTeamA) >= 0.05).map((driver) => (
                <div key={driver.label} className="flex justify-between text-xs"><span>{driver.label}</span><span className="pp-number">{formatSigned(driver.marginPointsForTeamA)}</span></div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {scoreRows.map(([score, probability]) => (
              <div key={score} className="grid grid-cols-[32px_1fr_52px] items-center gap-2 text-xs">
                <span className="pp-number font-bold">{score}</span>
                <span className="pp-probbar"><span className="pp-probbar-fill" style={{ width: `${probability * 100}%` }} /></span>
                <span className="pp-number text-right">{formatPercent(probability)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pp-card">
        <div className="pp-section-head">
          <div className="pp-kicker text-[var(--color-success)]">Reconstructed historical replay / research inputs</div>
          <h2 className="mt-2 text-lg font-bold">Pregame probability path</h2>
        </div>
        <div className="grid gap-4 p-4">
          <select value={replaySeriesId} onChange={(event) => setReplaySeriesId(event.target.value)} className="w-full border-2 border-[var(--color-border-strong)] bg-[var(--color-bg-primary)] p-2 text-sm">
            {evidence.seriesIndex.slice().sort((a, b) => b.season - a.season || a.seriesId.localeCompare(b.seriesId)).map((row) => (
              <option key={row.seriesId} value={row.seriesId}>{row.season} · {row.teamA} vs {row.teamB} · {row.round}</option>
            ))}
          </select>
          <div className="grid gap-2">
            {replay.map((row) => (
              <div key={row.id} className="grid grid-cols-[54px_54px_1fr_62px] items-center gap-2 text-xs">
                <span className="pp-number">G{row.gameNumber}</span>
                <span>{row.winsA}–{row.winsB}</span>
                <span className="relative h-3 bg-[var(--color-panel-secondary)]">
                  <span className="absolute h-3 bg-[var(--color-success)]" style={{ width: `${row.teamASeriesWinProbability * 100}%` }} />
                </span>
                <span className="pp-number text-right">{formatPercent(row.teamASeriesWinProbability)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs leading-5 text-[var(--color-text-muted)]">
            {replayMeta?.teamA} probability reconstructed immediately before each game. These were not forecasts issued at the time. Historical BPM/SRS inputs are visually and semantically separate from the production scenario above.
          </p>
        </div>
      </section>
    </div>
  );
}
