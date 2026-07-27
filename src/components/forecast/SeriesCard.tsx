import { Home, MoveRight, TrendingUp } from "lucide-react";
import type { Series, SeriesForecast, Team } from "@/lib/model/types";
import { formatNumber, formatPercent, formatSigned } from "@/lib/utils/format";

type SeriesCardProps = {
  series: Series;
  forecast: SeriesForecast;
  teamsById: Record<string, Team>;
  onTeamSelect?: (teamId: string) => void;
};

function injurySummary(team: Team): string[] {
  return team.players.flatMap((player) => {
    if (player.injuryStatus === "out") {
      return `${player.name} OUT`;
    }

    if (player.injuryStatus === "limited") {
      return `${player.name} (limited)`;
    }

    if (player.injuryStatus === "questionable") {
      return `${player.name} (questionable)`;
    }

    return [];
  });
}

function DotSeries({ wins }: { wins: number }) {
  return (
    <span className="inline-flex gap-1">
      {Array.from({ length: 4 }).map((_, index) => (
        <span
          key={index}
          className={`h-3 w-3 rounded-full border-2 ${
            index < wins
              ? "border-[var(--color-success-soft)] bg-[var(--color-success)]"
              : "border-[var(--color-border-subtle)] bg-transparent"
          }`}
        />
      ))}
    </span>
  );
}

function ProbabilityRow({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="grid grid-cols-[44px_1fr_68px] items-center gap-3">
      <span className="pp-team-badge" data-team={label}>
        {label}
      </span>
      <span className="pp-probbar">
        <span
          className="pp-probbar-fill"
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </span>
      <span className="pp-number text-right text-sm font-bold">
        {formatPercent(value)}
      </span>
    </div>
  );
}

function seriesStageLabel(series: Series): string {
  if (series.round === "NBA Finals") {
    return "NBA Finals";
  }

  return `${series.conference} / ${series.round}`;
}

export function SeriesCard({
  series,
  forecast,
  teamsById,
  onTeamSelect,
}: SeriesCardProps) {
  const teamA = teamsById[forecast.teamAId];
  const teamB = teamsById[forecast.teamBId];
  const nextGame = forecast.nextGame;
  const homeTeam = nextGame ? teamsById[nextGame.homeTeamId] : null;
  const teamAProbability = nextGame?.teamAWinProbability ?? 0;
  const teamBProbability = nextGame?.teamBWinProbability ?? 0;
  const teamAInjuries = injurySummary(teamA);
  const teamBInjuries = injurySummary(teamB);
  const manualNotes = [
    teamA.manualAdjustment !== 0
      ? `${teamA.abbreviation} ${formatSigned(teamA.manualAdjustment)}`
      : null,
    teamB.manualAdjustment !== 0
      ? `${teamB.abbreviation} ${formatSigned(teamB.manualAdjustment)}`
      : null,
  ].filter(Boolean);
  const scoreDistribution = Object.entries(forecast.finalScoreProbabilities)
    .sort(([, probabilityA], [, probabilityB]) => probabilityB - probabilityA);

  return (
    <article className="pp-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--color-text-primary)] bg-[var(--color-bg-primary)] px-4 py-3">
        <div>
          <div className="pp-kicker text-[var(--color-accent)]">
            {seriesStageLabel(series)}
          </div>
          <h3 className="mt-2 text-sm font-bold text-[var(--color-text-primary)]">
            {teamA.name} <span className="text-[var(--color-text-faint)]">vs</span>{" "}
            {teamB.name}
          </h3>
        </div>
        <span className="pp-pill border-[rgba(58,140,84,0.4)] text-[var(--color-success)]">
          Live series
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b-2 border-[var(--color-border-subtle)] bg-gradient-to-b from-[var(--color-panel-secondary)] to-[var(--color-panel-primary)] px-4 py-4">
        <button
          type="button"
          className="pp-action-tile grid justify-items-center gap-2 border-transparent bg-transparent p-2 text-center"
          onClick={() => onTeamSelect?.(teamA.id)}
        >
          <span className="pp-team-badge" data-team={teamA.abbreviation}>
            {teamA.abbreviation}
          </span>
          <span className="pp-kicker">{teamA.conference.slice(0, 1)}{teamA.seed}</span>
        </button>
        <div className="grid justify-items-center gap-2">
          <div className="flex items-center gap-4">
            <span
              className={`pp-number text-3xl font-bold ${
                forecast.winsA > forecast.winsB
                  ? "text-[var(--color-success-soft)]"
                  : "text-[var(--color-text-primary)]"
              }`}
            >
              {forecast.winsA}
            </span>
            <span className="pp-kicker text-[var(--color-text-faint)]">BO7</span>
            <span
              className={`pp-number text-3xl font-bold ${
                forecast.winsB > forecast.winsA
                  ? "text-[var(--color-success-soft)]"
                  : "text-[var(--color-text-primary)]"
              }`}
            >
              {forecast.winsB}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <DotSeries wins={forecast.winsA} />
            <DotSeries wins={forecast.winsB} />
          </div>
        </div>
        <button
          type="button"
          className="pp-action-tile grid justify-items-center gap-2 border-transparent bg-transparent p-2 text-center"
          onClick={() => onTeamSelect?.(teamB.id)}
        >
          <span className="pp-team-badge" data-team={teamB.abbreviation}>
            {teamB.abbreviation}
          </span>
          <span className="pp-kicker">{teamB.conference.slice(0, 1)}{teamB.seed}</span>
        </button>
      </div>

      {nextGame ? (
        <div className="grid gap-3 border-b-2 border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] px-4 py-3 sm:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="pp-kicker text-[var(--color-accent)]">
              Next game / G{nextGame.gameNumber}
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <Home className="h-4 w-4" aria-hidden />
              <span className="font-bold">{homeTeam ? homeTeam.abbreviation : "Neutral"}</span>
              <span className="text-[var(--color-text-muted)]">home court</span>
            </div>
          </div>
          <div className="grid gap-2">
            <div className="pp-kicker">Next-game win probability</div>
            <ProbabilityRow label={teamA.abbreviation} value={teamAProbability} />
            <ProbabilityRow label={teamB.abbreviation} value={teamBProbability} />
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 border-b-2 border-[var(--color-border-subtle)] px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="pp-kicker">Series win probability</span>
          <span className="pp-kicker text-[var(--color-text-faint)]">
            Exact solver
          </span>
        </div>
        <ProbabilityRow
          label={teamA.abbreviation}
          value={forecast.teamASeriesWinProbability}
        />
        <ProbabilityRow
          label={teamB.abbreviation}
          value={forecast.teamBSeriesWinProbability}
        />
        {forecast.uncertainty.samples > 0 ? (
          <div className="mt-1 grid gap-1">
            <div className="flex justify-between text-[11px] text-[var(--color-text-muted)]">
              <span>80% input/model range</span>
              <span className="pp-number">
                {formatPercent(forecast.uncertainty.lower)}–{formatPercent(forecast.uncertainty.upper)}
              </span>
            </div>
            <div className="relative h-2 bg-[var(--color-panel-secondary)]">
              <span
                className="absolute h-2 bg-[var(--color-accent)] opacity-70"
                style={{
                  left: `${forecast.uncertainty.lower * 100}%`,
                  width: `${(forecast.uncertainty.upper - forecast.uncertainty.lower) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {scoreDistribution.length > 1 ? (
        <div className="grid gap-2 border-b-2 border-[var(--color-border-subtle)] px-4 py-3">
          <div className="pp-kicker">Exact final-score distribution</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {scoreDistribution.map(([score, probability]) => (
              <div key={score} className="grid grid-cols-[30px_1fr_48px] items-center gap-2 text-xs">
                <span className="pp-number font-bold">{score}</span>
                <span className="pp-probbar h-[7px]">
                  <span className="pp-probbar-fill" style={{ width: `${probability * 100}%` }} />
                </span>
                <span className="pp-number text-right">{formatPercent(probability)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {forecast.scenarioImpacts.length ? (
        <div className="grid gap-2 border-b-2 border-[var(--color-border-subtle)] bg-[var(--overlay-accent-soft)] px-4 py-3 text-xs">
          <div className="pp-kicker text-[var(--color-accent)]">Availability scenarios</div>
          {forecast.scenarioImpacts.map((scenario) => (
            <div key={scenario.playerId} className="flex flex-wrap justify-between gap-2">
              <span>{scenario.label}</span>
              <span className="pp-number">
                available {formatPercent(scenario.ifAvailable)} / out {formatPercent(scenario.ifOut)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 border-b-2 border-[var(--color-border-subtle)] px-4 py-3 text-sm sm:grid-cols-3">
        <div className="bg-[var(--color-panel-secondary)] p-3">
          <div className="flex items-center gap-2 pp-kicker">
            <TrendingUp className="h-4 w-4" aria-hidden />
            Margin
          </div>
          <p
            className={`pp-number mt-2 font-bold ${
              (nextGame?.expectedMarginForTeamA ?? 0) >= 0
                ? "text-[var(--color-success)]"
                : "text-[var(--color-danger)]"
            }`}
          >
            {nextGame ? formatSigned(nextGame.expectedMarginForTeamA) : "0.0"}
          </p>
        </div>
        <div className="bg-[var(--color-panel-secondary)] p-3">
          <div className="pp-kicker">Strength diff</div>
          <p
            className={`pp-number mt-2 font-bold ${
              forecast.teamStrengthDifference >= 0
                ? "text-[var(--color-success)]"
                : "text-[var(--color-danger)]"
            }`}
          >
            {formatSigned(forecast.teamStrengthDifference)}
          </p>
        </div>
        <div className="bg-[var(--color-panel-secondary)] p-3">
          <div className="pp-kicker">Games left</div>
          <p className="pp-number mt-2 font-bold">
            {formatNumber(forecast.expectedGamesRemaining)}
          </p>
        </div>
      </div>

      {nextGame ? (
        <div className="grid gap-2 border-b-2 border-[var(--color-border-subtle)] px-4 py-3">
          <div className="pp-kicker">Next-game margin drivers</div>
          {nextGame.drivers
            .filter((driver) => Math.abs(driver.marginPointsForTeamA) >= 0.05)
            .sort((a, b) => Math.abs(b.marginPointsForTeamA) - Math.abs(a.marginPointsForTeamA))
            .map((driver) => (
              <div key={driver.label} className="flex justify-between text-xs text-[var(--color-text-muted)]">
                <span>{driver.label}</span>
                <span className="pp-number">{formatSigned(driver.marginPointsForTeamA)}</span>
              </div>
            ))}
        </div>
      ) : null}

      {manualNotes.length ? (
        <div className="flex flex-wrap items-center gap-2 bg-[var(--overlay-accent-soft)] px-4 py-3">
          <span className="pp-pill border-[rgba(201,150,31,0.45)] text-[var(--color-accent)]">
            Manual adj
          </span>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {manualNotes.join(" / ")}
          </span>
        </div>
      ) : null}

      {teamAInjuries.length || teamBInjuries.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--color-border-subtle)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
          {teamAInjuries.length ? (
            <span>{teamA.abbreviation}: {teamAInjuries.join(", ")}</span>
          ) : null}
          {teamAInjuries.length && teamBInjuries.length ? (
            <MoveRight className="h-3 w-3" aria-hidden />
          ) : null}
          {teamBInjuries.length ? (
            <span>{teamB.abbreviation}: {teamBInjuries.join(", ")}</span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
