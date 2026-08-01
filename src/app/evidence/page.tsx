import { EvidenceExplorer } from "@/components/forecast/EvidenceExplorer";
import externalBenchmark538 from "../../../docs/backtest/external-benchmark-538.json";
import evidence from "../../../docs/backtest/evidence.json";

export default function EvidencePage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto max-w-7xl px-3 py-3 md:px-[18px] md:py-[18px]">
        <EvidenceExplorer />
        <section className="mt-4 border-2 border-[var(--color-border-strong)] bg-[var(--color-bg-secondary)] p-5 md:p-7">
          <p className="pp-kicker text-[var(--color-accent)]">Null result published plainly</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--color-text-primary)]">
            Direct and nested calibration are closed
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-[var(--color-text-muted)]">
            Direct series-output calibration worsened Brier from{" "}
            {evidence.calibration.series.raw.brier.toFixed(4)} to{" "}
            {evidence.calibration.series.calibrated.brier.toFixed(4)}. The coherent
            alternative—calibrating future game probabilities and rerunning the exact
            solver—also worsened series Brier from{" "}
            {evidence.calibration.gamePropagatedThroughExactSeries.raw.brier.toFixed(4)}
            {" "}to {evidence.calibration.gamePropagatedThroughExactSeries.calibrated.brier.toFixed(4)}.
          </p>
          <p className="mt-3 max-w-4xl text-sm font-bold leading-7 text-[var(--color-text-primary)]">
            Status: CLOSED. The game-only improvement is too small to justify a
            series forecast change, and the propagated paired interval crosses zero.
            These lines should not be revisited without materially new data or a new
            preregistered hypothesis.
          </p>
        </section>
        <section className="mt-4 border border-[var(--color-border-strong)] bg-[var(--color-bg-secondary)] p-5 md:p-7">
          <p className="pp-kicker text-[var(--color-accent)]">External model benchmark</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--color-text-primary)]">
            FiveThirtyEight archive comparison
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-[var(--color-text-muted)]">
            The precommitted mapping covers {externalBenchmark538.coverage.matchedSeries} of{" "}
            {externalBenchmark538.coverage.eligibleSeries} eligible series from 2016–2022.
            Playoff Pulse scored Brier {externalBenchmark538.metrics.playoffPulse.brier.toFixed(4)}
            {" "}and log loss {externalBenchmark538.metrics.playoffPulse.logLoss.toFixed(4)};
            FiveThirtyEight scored Brier {externalBenchmark538.metrics.fiveThirtyEight.brier.toFixed(4)}
            {" "}and log loss {externalBenchmark538.metrics.fiveThirtyEight.logLoss.toFixed(4)}.
          </p>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-[var(--color-text-muted)]">
            Playoff Pulse minus FiveThirtyEight Brier is {externalBenchmark538.pairedSeasonClusteredBootstrap.pointEstimate >= 0 ? "+" : ""}{externalBenchmark538.pairedSeasonClusteredBootstrap.pointEstimate.toFixed(4)},
            with a season-clustered 95% interval [{externalBenchmark538.pairedSeasonClusteredBootstrap.ci95[0].toFixed(4)}, {externalBenchmark538.pairedSeasonClusteredBootstrap.ci95[1] >= 0 ? "+" : ""}{externalBenchmark538.pairedSeasonClusteredBootstrap.ci95[1].toFixed(4)}].
            The interval crosses zero. The archive spans CARM-Elo/CARMELO and RAPTOR eras.
          </p>
          <p className="mt-3 max-w-4xl text-sm font-bold leading-7 text-[var(--color-text-primary)]">
            This is a model benchmark, not a market benchmark. Timestamped no-vig market coverage remains zero.
          </p>
        </section>
      </div>
    </main>
  );
}
