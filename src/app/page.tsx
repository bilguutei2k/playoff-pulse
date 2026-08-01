import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import backtestSummary from "../../docs/backtest/summary.json";
import significance from "../../docs/backtest/significance.json";
import evidence from "../../docs/backtest/evidence.json";
import research from "../../docs/backtest/research.json";
import { playoffConfig, dataLastUpdatedTimestamp } from "@/lib/data/playoff-config";
import { defaultModelSettings } from "@/lib/data/model-settings";
import { estimateBaselineSeriesProbability } from "@/lib/model/simulator";
import { formatNumber, formatPercent, formatSigned } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Playoff Pulse — A Traceable NBA Playoff Forecasting Experiment",
  description:
    "A retrospective on building and evaluating an NBA playoff forecasting system: rolling-origin evaluation, bootstrap comparisons, overconfidence analysis, and rejected model changes.",
};

const RESEARCH_MODEL_LABELS: Record<string, string> = {
  srs_home: "SRS + home (reference)",
  net_home: "Net rating + home",
  srs_player_home: "SRS + player + home",
  collinear_full: "Collinear full model",
  offense_defense_player: "Offense + defense + player",
};

const BASELINE_LABELS: Record<string, string> = {
  coinflip: "Coin flip (0.50)",
  home_team: "Home team wins",
  higher_seed: "Higher seed wins",
  net_rating_only: "Net-rating only",
  srs_proxy_only: "SRS-proxy only",
};

const BASELINE_ORDER = [
  "coinflip",
  "home_team",
  "higher_seed",
  "net_rating_only",
  "srs_proxy_only",
];

const REPO_URL = "https://github.com/bilguutei2k/playoff-pulse";

// Preserved 2026 counterfactual: the configured (completed) Finals reset to
// 0-0 through the same evidenced baseline used by the backtest and /snapshot.
function preservedBaseline() {
  const finals = playoffConfig.series.find((series) => series.round === "NBA Finals");
  if (!finals) {
    return null;
  }

  const teamsById = Object.fromEntries(playoffConfig.teams.map((team) => [team.id, team]));
  const teamA = teamsById[finals.teamA];
  const teamB = teamsById[finals.teamB];
  const forecast = estimateBaselineSeriesProbability(
    { ...finals, id: `${finals.id}-preserved-demo`, winsA: 0, winsB: 0 },
    { [teamA.id]: teamA, [teamB.id]: teamB },
    defaultModelSettings,
  );

  return { teamA, teamB, forecast };
}

function seriesLabel(seriesId: string): string {
  const meta = evidence.seriesIndex.find((row) => row.seriesId === seriesId);
  if (!meta) {
    return seriesId;
  }

  return `${meta.season} · ${meta.teamA} vs ${meta.teamB} · ${meta.round}`;
}

export default function Home() {
  const referenceModel = evidence.modelComparison.find((model) => model.id === "srs_home");
  const richestComparison = research.comparisonsToSrsHome.find(
    (row) => row.id === "offense_defense_player",
  );
  const orderedSignificance = BASELINE_ORDER.map((baseline) =>
    significance.comparisons.find((row) => row.baseline === baseline),
  ).filter((row) => row !== undefined);
  const worstSeries = evidence.worstForecasts.series.slice(0, 5);
  const scenario = preservedBaseline();
  const pulse = backtestSummary.models.playoff_pulse;

  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-[18px] px-3 py-3 md:px-[18px] md:py-[18px]">
        {/* 1. What this is */}
        <section className="pp-card">
          <div className="p-4">
            <div className="pp-kicker text-[var(--color-accent)]">Retrospective</div>
            <h1 className="mt-3 text-2xl font-bold tracking-normal text-[var(--color-text-primary)] md:text-3xl">
              A traceable NBA playoff forecasting experiment
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-[var(--color-text-muted)]">
              I built a forecasting system, evaluated increasingly sophisticated
              variants, and found that a simple rating-and-home-court reference
              captured most of the measurable skill. This site shows how those
              conclusions were reached — and where the forecasts stayed
              overconfident.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 border-y-2 border-[var(--color-border-strong)] bg-[var(--overlay-accent-soft)] px-3 py-2">
              {[
                "2026 season complete: Knicks beat Spurs 4–1",
                "No forecasts were issued during the 2026 postseason",
                "2026 holdout scored separately; challenger registrations are contaminated",
                "Historical evaluation is reconstructed, and labeled as such",
              ].map((label) => (
                <span key={label} className="pp-pill border-[rgba(201,150,31,0.45)] text-[var(--color-accent)]">
                  {label}
                </span>
              ))}
            </div>
            <p className="mt-4 max-w-4xl text-xs leading-5 text-[var(--color-text-muted)]">
              <span className="font-bold text-[var(--color-text-secondary)]">Traceable</span>{" "}
              means every probability on this site links to the committed code,
              data snapshot, and evaluation artifact that produced it — not
              that any forecast was audited live. Model inputs are manually
              configured estimates and are disclosed as such.
            </p>
          </div>
        </section>

        {/* 2. What survived evaluation */}
        <section className="pp-card">
          <div className="pp-section-head">
            <div className="pp-kicker text-[var(--color-success)]">02 / What survived evaluation</div>
          </div>
          <div className="grid gap-6 p-4 xl:grid-cols-2">
            <div>
              <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
                Rolling-origin evaluation (the strict test)
              </h2>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                Models trained only on seasons before each evaluated season,
                {" "}{evidence.evaluationSeasons[0]}–{evidence.evaluationSeasons.at(-1)}:{" "}
                {referenceModel?.game.n} games, {referenceModel?.series.n} series.
                Lower Brier is better.
              </p>
              <table className="mt-3 w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-y-2 border-[var(--color-border-strong)]">
                    <th className="pp-kicker px-2 py-2 text-[var(--color-text-primary)]">Model</th>
                    <th className="pp-kicker px-2 py-2 text-right text-[var(--color-text-primary)]">Game Brier</th>
                    <th className="pp-kicker px-2 py-2 text-right text-[var(--color-text-primary)]">Series Brier</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.modelComparison.map((model) => (
                    <tr key={model.id} className="border-b border-[var(--color-border-subtle)]">
                      <td className="px-2 py-2">{RESEARCH_MODEL_LABELS[model.id] ?? model.id}</td>
                      <td className="pp-number px-2 py-2 text-right">{formatNumber(model.game.brier, 4)}</td>
                      <td className="pp-number px-2 py-2 text-right">{formatNumber(model.series.brier, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">
                No richer feature set conclusively beat SRS + home court. The
                best candidate changed the series point estimate by{" "}
                {richestComparison
                  ? formatNumber(richestComparison.series.candidateMinusBaselineBrier, 4)
                  : "—"}{" "}
                Brier, but its season-clustered 95% interval
                {richestComparison
                  ? ` [${formatNumber(richestComparison.series.ci95[0], 4)}, ${formatNumber(richestComparison.series.ci95[1], 4)}]`
                  : ""}{" "}
                includes zero.
              </p>
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
                {backtestSummary.totalSeries}-series reconstruction (descriptive)
              </h2>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                The visible rating-only baseline — with the player/minutes/injury
                overlay excluded — scored Brier{" "}
                <span className="pp-number font-bold text-[var(--color-text-primary)]">
                  {formatNumber(pulse.brierScore, 4)}
                </span>{" "}
                on {backtestSummary.totalSeries} reconstructed series,{" "}
                {backtestSummary.firstSeason}–{backtestSummary.lastSeason}. Paired bootstrap
                differences (negative favors the model):
              </p>
              <table className="mt-3 w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-y-2 border-[var(--color-border-strong)]">
                    <th className="pp-kicker px-2 py-2 text-[var(--color-text-primary)]">Versus</th>
                    <th className="pp-kicker px-2 py-2 text-right text-[var(--color-text-primary)]">Δ Brier</th>
                    <th className="pp-kicker px-2 py-2 text-right text-[var(--color-text-primary)]">95% CI</th>
                    <th className="pp-kicker px-2 py-2 text-right text-[var(--color-text-primary)]">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedSignificance.map((row) => (
                    <tr key={row.baseline} className="border-b border-[var(--color-border-subtle)]">
                      <td className="px-2 py-2">{BASELINE_LABELS[row.baseline] ?? row.baseline}</td>
                      <td className="pp-number px-2 py-2 text-right">
                        {formatSigned(row.candidateMinusBaselineBrier, 4)}
                      </td>
                      <td className="pp-number px-2 py-2 text-right">
                        [{formatNumber(row.seriesResampled.ci95[0], 4)}, {formatNumber(row.seriesResampled.ci95[1], 4)}]
                      </td>
                      <td className={`px-2 py-2 text-right font-bold ${row.conclusive ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"}`}>
                        {row.conclusive ? "Conclusive" : "Inconclusive"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">
                The model conclusively beats the naive baselines. Its point
                estimate trails SRS-only by{" "}
                {formatNumber(
                  pulse.brierScore -
                    backtestSummary.models.srs_proxy_only.brierScore,
                  4,
                )}{" "}
                Brier, but the difference is not statistically distinguishable
                from zero. Series accuracy is {formatPercent(pulse.accuracy)}{" "}
                versus{" "}
                {formatPercent(backtestSummary.models.higher_seed.accuracy)}
                for the higher-seed baseline.
              </p>
            </div>
          </div>
          <div className="border-t border-[var(--color-border-subtle)] p-4">
            <h3 className="pp-kicker text-[var(--color-text-primary)]">Evaluated / promoted only within research</h3>
            <ul className="mt-2 grid gap-3 text-xs leading-5 text-[var(--color-text-muted)] sm:grid-cols-2 xl:grid-cols-5">
              <li>
                Coherent game calibration through the exact solver: series
                Brier{" "}
                {formatNumber(
                  evidence.calibration.gamePropagatedThroughExactSeries.raw
                    .brier,
                  4,
                )}{" "}
                →{" "}
                {formatNumber(
                  evidence.calibration.gamePropagatedThroughExactSeries
                    .calibrated.brier,
                  4,
                )}
                . Interval includes zero; not promoted.
              </li>
              <li>
                Primary exact-SRS + seed challenger: matched series Brier{" "}
                {formatNumber(
                  evidence.primarySeriesChallenger.baselineMetrics.brier,
                  4,
                )}{" "}
                →{" "}
                {formatNumber(evidence.primarySeriesChallenger.metrics.brier, 4)}
                . Its interval includes zero; sealed for 2027.
              </li>
              <li>
                Ten-season window: historical game Δ{" "}
                {formatSigned(
                  evidence.temporalWindowCandidate.comparisonToSrsHome.game
                    .candidateMinusBaselineBrier,
                  4,
                )}
                , with the interval below zero. Retrospective; frozen for 2027.
              </li>
              <li>
                Preregistered dynamic margin updates (frozen{" "}
                {evidence.dynamicCandidate.registration.frozenAt}): indistinguishable
                from static ({formatNumber(evidence.dynamicCandidate.metrics.brier, 6)} vs{" "}
                {referenceModel ? formatNumber(referenceModel.game.brier, 6) : "—"}). Not promoted.
              </li>
              <li>
                Rating-gap player shrinkage: game Δ{" "}
                {formatSigned(
                  evidence.shrinkageCandidate.comparisonToSrsHome.game
                    .candidateMinusBaselineBrier,
                  4,
                )}{" "}
                with an interval spanning zero. Frozen for 2027; not promoted.
              </li>
            </ul>
          </div>
        </section>

        {/* 3. Confidence exceeded reliability */}
        <section className="pp-card">
          <div className="pp-section-head">
            <div className="pp-kicker text-[var(--color-danger)]">03 / Confidence exceeded reliability</div>
          </div>
          <div className="grid gap-6 p-4 xl:grid-cols-[0.8fr_1.2fr]">
            <div>
              <div className="pp-number text-3xl font-bold text-[var(--color-text-primary)]">
                slope ≈ {referenceModel ? formatNumber(referenceModel.series.calibrationFit.slope, 2) : "—"}
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">
                Rolling-origin calibration fit for series forecasts (games:{" "}
                {referenceModel ? formatNumber(referenceModel.game.calibrationFit.slope, 2) : "—"}).
                A slope below 1 means systematic overconfidence: extreme
                probabilities were too extreme. The individual failures on the
                right are the tail of this measured pattern, not isolated bad
                luck. Reliability plots are on the{" "}
                <Link href="/evidence" className="underline decoration-2 underline-offset-2">
                  evidence page
                </Link>
                .
              </p>
            </div>
            <div>
              <h3 className="pp-kicker text-[var(--color-text-primary)]">
                Highest-confidence series misses
              </h3>
              <div className="mt-2 divide-y divide-[var(--color-border-subtle)]">
                {worstSeries.map((row) => (
                  <div key={row.id} className="grid grid-cols-[1fr_72px_64px] gap-2 py-2 text-xs">
                    <span>{seriesLabel(row.id)}</span>
                    <span className="pp-number text-right">p {formatPercent(row.probability)}</span>
                    <span className="pp-number text-right text-[var(--color-danger)]">
                      loss {formatNumber(row.brierLoss, 3)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                Selected mechanically: the incorrect reconstructed series
                forecasts with the highest favorite confidence, no editorial
                substitutions. Only inputs recorded in the pregame snapshots
                are cited as explanation.
              </p>
            </div>
          </div>
        </section>

        {/* 4. Sensitivity, not hindsight */}
        <section className="pp-card">
          <div className="pp-section-head">
            <div className="pp-kicker text-[var(--color-accent)]">04 / Sensitivity, not hindsight</div>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            {scenario ? (
              <>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="pp-team-badge" data-team={scenario.teamA.abbreviation}>
                      {scenario.teamA.abbreviation}
                    </span>
                    <span className="pp-number text-3xl font-bold">
                      {formatPercent(scenario.forecast.teamASeriesWinProbability)}
                    </span>
                  </div>
                  <div className="mt-2 pp-kicker text-[var(--color-success)]">
                    Backtested baseline
                  </div>
                </div>
                <p className="max-w-2xl text-xs leading-5 text-[var(--color-text-muted)]">
                  The completed 2026 Finals ({scenario.teamA.abbreviation} vs{" "}
                  {scenario.teamB.abbreviation}) reset to 0–0 under the frozen{" "}
                  {dataLastUpdatedTimestamp} rating snapshot. This is the
                  rating-only baseline, not an issued Finals forecast. The lab
                  shows any player, minute, or injury adjustment beside this
                  value with a delta and an unvalidated label.
                </p>
                <Link
                  href="/lab"
                  className="pp-button pp-button-primary w-fit"
                >
                  Open the scenario lab
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </>
            ) : null}
          </div>
        </section>

        {/* 5. Verify the work */}
        <section className="pp-card">
          <div className="pp-section-head">
            <div className="pp-kicker">05 / Verify the work</div>
          </div>
          <div className="grid gap-6 p-4 lg:grid-cols-3">
            <div>
              <h3 className="pp-kicker text-[var(--color-text-primary)]">Raw artifacts</h3>
              <ul className="mt-2 grid gap-1 text-xs leading-6">
                {[
                  ["Claims ledger", "docs/claims-ledger.md"],
                  ["Parameter provenance", "docs/parameter-provenance.md"],
                  ["Backtest methodology + limitations", "docs/backtest/methodology.md"],
                  ["Bootstrap significance", "docs/backtest/significance.json"],
                  ["Rolling-origin research", "docs/backtest/research.json"],
                  [`All ${backtestSummary.totalSeries * 6} model-series predictions`, "docs/backtest/predictions.json"],
                  ["Availability completeness audit", "docs/backtest/availability.json"],
                  ["Rotation + benchmark input audit", "docs/backtest/input-audit.json"],
                  ["Point-in-time implementation record", "docs/point-in-time-implementation.md"],
                ].map(([label, filePath]) => (
                  <li key={filePath}>
                    <a
                      href={`${REPO_URL}/blob/main/${filePath}`}
                      className="underline decoration-2 underline-offset-2 hover:text-[var(--color-accent)]"
                    >
                      {label}
                    </a>{" "}
                    <span className="text-[var(--color-text-muted)]">{filePath}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="pp-kicker text-[var(--color-text-primary)]">Reproduce</h3>
              <pre className="mt-2 overflow-x-auto bg-[var(--color-panel-secondary)] p-3 text-[11px] leading-5">
{`git clone ${REPO_URL}
corepack pnpm install
corepack pnpm verify
corepack pnpm backtest:all`}
              </pre>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                Every headline number regenerates from committed inputs.
                Leakage assertions (`snapshot_as_of &lt; seriesStartDate`) run
                inside the backtest itself.
              </p>
            </div>
            <div>
              <h3 className="pp-kicker text-[var(--color-danger)]">Standing limitations</h3>
              <ul className="mt-2 grid gap-1 text-xs leading-5 text-[var(--color-text-muted)]">
                <li>Reconstructed forecasts were not issued contemporaneously.</li>
                <li>Production inputs are manual, subjective estimates.</li>
                <li>Sensitivity bands pass 8 of 10 grouped reliability checks, but are not individual probability-interval coverage guarantees.</li>
                <li>Historical availability coverage is 0%; injury effects remain unvalidated rather than inferred from outcomes.</li>
                <li>No official NBA data; no betting use.</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/methodology" className="pp-button">
                  Methodology
                </Link>
                <Link href="/evidence" className="pp-button">
                  Evidence archive
                </Link>
                <Link href="/snapshot" className="pp-button">
                  Final 2026 snapshot
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
