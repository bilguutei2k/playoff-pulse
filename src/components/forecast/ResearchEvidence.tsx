import research from "../../../docs/backtest/research.json";
import { formatNumber, formatPercent } from "@/lib/utils/format";

export function ResearchEvidence() {
  const baseline = research.results.find((result) => result.id === "srs_home");
  if (!baseline) return null;

  return (
    <div className="pp-card">
      <div className="pp-section-head">
        <div className="pp-kicker text-[var(--color-accent)]">Rolling-origin evidence</div>
        <h2 className="mt-2 text-lg font-bold">What survived validation</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
          Each evaluation season from {research.evaluationSeasons[0]}–
          {research.evaluationSeasons.at(-1)} was predicted using only earlier
          seasons after a three-season initialization window.
          Candidate complexity remains excluded when its season-clustered interval includes harm.
        </p>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-3">
        <div className="bg-[var(--color-panel-secondary)] p-3">
          <div className="pp-kicker">Games evaluated</div>
          <div className="pp-number mt-2 text-2xl font-bold">{baseline.game.n}</div>
        </div>
        <div className="bg-[var(--color-panel-secondary)] p-3">
          <div className="pp-kicker">Game Brier</div>
          <div className="pp-number mt-2 text-2xl font-bold">{formatNumber(baseline.game.brier, 3)}</div>
        </div>
        <div className="bg-[var(--color-panel-secondary)] p-3">
          <div className="pp-kicker">Series Brier</div>
          <div className="pp-number mt-2 text-2xl font-bold">{formatNumber(baseline.series.brier, 3)}</div>
        </div>
      </div>

      <div className="grid gap-3 border-t-2 border-[var(--color-border-subtle)] p-4">
        <div className="pp-kicker">Game reliability / equal-count groups</div>
        <div className="relative grid gap-3 border-x border-[var(--color-border-subtle)] py-2">
          <span className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-[var(--color-border-subtle)]" />
          {baseline.game.calibration.map((bucket, index) => (
            <div key={index} className="grid grid-cols-[56px_1fr] items-center gap-3 text-[11px]">
              <span className="pp-number text-right">n={bucket.n}</span>
              <div className="relative h-5 bg-[var(--color-panel-secondary)]" aria-label={`Predicted ${formatPercent(bucket.predicted)}, observed ${formatPercent(bucket.observed)}`}>
                <span className="absolute top-0 h-5 w-[2px] bg-[var(--color-accent)]" style={{ left: `${bucket.predicted * 100}%` }} />
                <span className="absolute top-[7px] h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--color-success)]" style={{ left: `${bucket.observed * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
          <span><span className="mr-2 inline-block h-3 w-[2px] bg-[var(--color-accent)]" />Predicted</span>
          <span><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--color-success)]" />Observed</span>
          <span>Calibration slope {formatNumber(baseline.game.calibrationFit.slope, 2)}</span>
        </div>
      </div>

      <div className="border-t-2 border-[var(--color-border-subtle)] p-4">
        <div className="pp-kicker">Strong rolling series baselines</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {research.strongSeriesBaselines.map((model) => (
            <div key={model.id} className="flex justify-between bg-[var(--color-panel-secondary)] p-3 text-xs">
              <span>{model.id.replaceAll("_", " ")}</span>
              <span className="pp-number font-bold">Brier {formatNumber(model.brier, 3)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t-2 border-[var(--color-border-subtle)] p-4 lg:grid-cols-2">
        <div className="bg-[var(--color-panel-secondary)] p-3">
          <div className="pp-kicker">Coherent calibration experiment</div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
            Game probabilities were calibrated using earlier seasons, then
            propagated through the exact series solver—not calibrated again at
            the series output.
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <span className="text-xs">Series Brier</span>
            <span className="pp-number font-bold">
              {formatNumber(
                research.nestedCalibration.gamePropagatedThroughExactSeries.raw
                  .brier,
                4,
              )}{" "}
              →{" "}
              {formatNumber(
                research.nestedCalibration.gamePropagatedThroughExactSeries
                  .calibrated.brier,
                4,
              )}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
            Point estimate improved, but the paired interval includes zero;
            research-only.
          </p>
        </div>

        <div className="bg-[var(--color-panel-secondary)] p-3">
          <div className="pp-kicker">Single primary challenger</div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
            Exact SRS-series probability plus seed difference was declared as
            the only promotion-eligible challenger for the next prospective
            evaluation.
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <span className="text-xs">Matched series Brier</span>
            <span className="pp-number font-bold">
              {formatNumber(
                research.primarySeriesChallenger.baselineMetrics.brier,
                4,
              )}{" "}
              →{" "}
              {formatNumber(
                research.primarySeriesChallenger.metrics.brier,
                4,
              )}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[var(--color-text-muted)]">
            Historical Δ{" "}
            {formatNumber(
              research.primarySeriesChallenger.comparisonToSrsHome
                .candidateMinusBaselineBrier,
              4,
            )}; its interval still crosses zero, and no future season is
            available. It is not promoted.
          </p>
        </div>
      </div>

      <div className="border-t-2 border-[var(--color-border-subtle)] p-4">
        <div className="pp-kicker">Temporal relevance challenger</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <p className="text-xs leading-5 text-[var(--color-text-muted)]">
            The unchanged SRS + home model was refit using at most the ten
            completed seasons before each target season. Its historical game
            point estimate improved, but it remains frozen research until a
            future season is observed.
          </p>
          <span className="pp-number text-xs font-bold">
            Δ game Brier{" "}
            {formatNumber(
              research.preregisteredTemporalWindowCandidate
                .comparisonToSrsHome.game.candidateMinusBaselineBrier,
              4,
            )}
          </span>
        </div>
      </div>

      <div className="border-t-2 border-[var(--color-border-subtle)] p-4">
        <div className="pp-kicker">Feature additions not promoted</div>
        <div className="mt-3 grid gap-2 text-xs text-[var(--color-text-muted)]">
          {research.comparisonsToSrsHome.map((comparison) => (
            <div key={comparison.id} className="grid gap-1 border-b border-[var(--color-border-subtle)] pb-2 sm:grid-cols-[1fr_auto]">
              <span>{comparison.id.replaceAll("_", " ")}</span>
              <span className="pp-number">
                Δ game Brier {comparison.game.candidateMinusBaselineBrier >= 0 ? "+" : ""}
                {formatNumber(comparison.game.candidateMinusBaselineBrier, 4)} · 95% interval {formatNumber(comparison.game.ci95[0], 4)} to {formatNumber(comparison.game.ci95[1], 4)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
