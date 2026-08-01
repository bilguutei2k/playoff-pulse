"use client";

import { useMemo, useState } from "react";
import evidence from "../../../docs/backtest/evidence.json";
import backtestSummary from "../../../docs/backtest/summary.json";
import holdout from "../../../docs/backtest/holdout-2026.json";
import { formatNumber, formatPercent, formatSigned } from "@/lib/utils/format";

type CalibrationBlock = {
  retained: boolean;
  raw: typeof evidence.calibration.game.raw;
  calibrated: typeof evidence.calibration.game.calibrated;
};

function ReliabilityPlot({ title, block }: { title: string; block: CalibrationBlock }) {
  const raw = block.raw.calibration;
  const calibrated = block.calibrated.calibration;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="pp-kicker">{title}</span>
        <span className={`pp-pill ${block.retained ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {block.retained ? "Research improvement" : "Rejected"}
        </span>
      </div>
      <div className="grid gap-2">
        {raw.map((bucket, index) => {
          const corrected = calibrated[index];
          return (
            <div key={index} className="grid grid-cols-[42px_1fr] items-center gap-2 text-[11px]">
              <span className="pp-number">n={bucket.n}</span>
              <div className="relative h-6 bg-[var(--color-panel-secondary)]" aria-label={`Raw predicted ${formatPercent(bucket.predicted)}, calibrated ${formatPercent(corrected.predicted)}, observed ${formatPercent(bucket.observed)}`}>
                <span className="absolute inset-y-0 w-[2px] bg-[var(--color-accent)]" style={{ left: `${bucket.predicted * 100}%` }} />
                <span className="absolute inset-y-0 w-[2px] bg-[var(--color-danger)]" style={{ left: `${corrected.predicted * 100}%` }} />
                <span className="absolute top-[9px] h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--color-success)]" style={{ left: `${bucket.observed * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
        <span>Raw Brier {formatNumber(block.raw.brier, 4)}</span>
        <span>Calibrated {formatNumber(block.calibrated.brier, 4)}</span>
        <span>Δ {formatSigned(block.calibrated.brier - block.raw.brier, 4)}</span>
      </div>
    </div>
  );
}

// Featured by mechanical rule, not editorial choice: the most recent
// completed NBA Finals in the reconstruction archive.
const featuredReplay = evidence.seriesIndex
  .filter((row) => row.round === "NBA Finals")
  .sort((a, b) => b.season - a.season)[0];

export function EvidenceExplorer() {
  const seasons = [...new Set(evidence.seriesIndex.map((row) => row.season))].sort((a, b) => b - a);
  const [season, setSeason] = useState(featuredReplay?.season ?? seasons[0]);
  const availableSeries = useMemo(() => evidence.seriesIndex.filter((row) => row.season === season), [season]);
  const [selectedSeriesId, setSelectedSeriesId] = useState(featuredReplay?.seriesId ?? availableSeries[0].seriesId);
  const selectedMeta = evidence.seriesIndex.find((row) => row.seriesId === selectedSeriesId) ?? availableSeries[0];
  const timeline = evidence.timeline.filter((row) => row.seriesId === selectedMeta.seriesId);
  const [selectedGame, setSelectedGame] = useState(1);
  const selectedPoint = timeline.find((row) => row.gameNumber === selectedGame) ?? timeline[0];
  const maxModelBrier = Math.max(...evidence.modelComparison.map((row) => row.game.brier));
  const holdoutComparison = [
    {
      id: "production",
      label: "Production",
      pooledBrier: backtestSummary.models.playoff_pulse.brierScore,
      pooledN: backtestSummary.models.playoff_pulse.n,
    },
    {
      id: "exact_srs_logit_plus_seed_v1",
      label: "Exact SRS logit + seed",
      pooledBrier: evidence.primarySeriesChallenger.metrics.brier,
      pooledN: evidence.primarySeriesChallenger.metrics.n,
    },
    {
      id: "ten_season_training_window_v1",
      label: "Ten-season window",
      pooledBrier: evidence.temporalWindowCandidate.metrics.series.brier,
      pooledN: evidence.temporalWindowCandidate.metrics.series.n,
    },
    {
      id: "srs_only",
      label: "SRS-only",
      pooledBrier: backtestSummary.models.srs_proxy_only.brierScore,
      pooledN: backtestSummary.models.srs_proxy_only.n,
    },
    {
      id: "net_rating_only",
      label: "Net-rating-only",
      pooledBrier: backtestSummary.models.net_rating_only.brierScore,
      pooledN: backtestSummary.models.net_rating_only.n,
    },
    {
      id: "higher_seed",
      label: "Higher seed",
      pooledBrier: backtestSummary.models.higher_seed.brierScore,
      pooledN: backtestSummary.models.higher_seed.n,
    },
    {
      id: "home_team",
      label: "Home team",
      pooledBrier: backtestSummary.models.home_team.brierScore,
      pooledN: backtestSummary.models.home_team.n,
    },
    {
      id: "coin_flip",
      label: "Coin flip",
      pooledBrier: backtestSummary.models.coinflip.brierScore,
      pooledN: backtestSummary.models.coinflip.n,
    },
  ] as const;
  const distinctVersions = useMemo(
    () => Array.from(
      new Map(evidence.versions.map((version) => [version.modelVersion, version])).values(),
    ),
    [],
  );
  const versionDeltas = useMemo(() => {
    if (distinctVersions.length < 2) return [];
    const previous = distinctVersions[distinctVersions.length - 2];
    const current = distinctVersions[distinctVersions.length - 1];
    const previousBySeries = Object.fromEntries(previous.series.map((row) => [row.seriesId, row.probabilityA]));
    return current.series
      .filter((row) => previousBySeries[row.seriesId] !== undefined)
      .map((row) => ({
        seriesId: row.seriesId,
        previous: previousBySeries[row.seriesId],
        current: row.probabilityA,
        delta: row.probabilityA - previousBySeries[row.seriesId],
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [distinctVersions]);

  function changeSeason(nextSeason: number) {
    const nextSeries = evidence.seriesIndex.find((row) => row.season === nextSeason);
    setSeason(nextSeason);
    if (nextSeries) setSelectedSeriesId(nextSeries.seriesId);
    setSelectedGame(1);
  }

  const points = timeline.map((row, index) => ({
    x: timeline.length === 1 ? 50 : 5 + index * (90 / (timeline.length - 1)),
    y: 95 - row.teamASeriesWinProbability * 90,
    upper: 95 - row.upper * 90,
    lower: 95 - row.lower * 90,
  }));
  const band = [
    ...points.map((point) => `${point.x},${point.upper}`),
    ...points.slice().reverse().map((point) => `${point.x},${point.lower}`),
  ].join(" ");

  return (
    <div className="grid gap-[18px]">
      <section className="pp-card">
        <div className="pp-section-head">
          <div className="pp-kicker text-[var(--color-success)]">Historical rolling-origin research</div>
          <h1 className="mt-2 text-2xl font-bold">Evidence and reconstructed forecast archive</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
            Leakage-safe historical BPM/SRS forecasts are reconstructed from the information available before each game and kept separate from manual production estimates. They were not originally issued forecasts, and no result here silently recalibrates production.
          </p>
        </div>
      </section>

      <section className="pp-card">
        <div className="pp-section-head">
          <div className="pp-kicker text-[var(--color-warning)]">
            2026 isolated holdout / separate from pooled history
          </div>
          <p className="mt-2 max-w-4xl text-xs leading-5 text-[var(--color-text-muted)]">
            Every 2026 predictive fit used only 2003–2025 inputs. Both registered
            challengers are{" "}
            <span className="font-bold text-[var(--color-warning)]">
              {
                holdout.selectionGate.registrationClassification
                  .exact_srs_logit_plus_seed_v1
              }
            </span>
            : their durable registration followed the April 18, 2026 playoff
            start. The season is a valid archived holdout for model isolation,
            but not prospective promotion evidence.
          </p>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-y-2 border-[var(--color-border-strong)]">
                {[
                  "Model",
                  "2026 game Brier",
                  "2026 series Brier",
                  "Pooled series Brier",
                  "Pooled scope",
                ].map((header) => (
                  <th
                    key={header}
                    className="pp-kicker px-2 py-2 text-[var(--color-text-primary)]"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holdoutComparison.map((row) => {
                const heldOut = holdout.metrics[row.id];
                return (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--color-border-subtle)]"
                  >
                    <td className="px-2 py-2 font-bold">{row.label}</td>
                    <td className="pp-number px-2 py-2 text-right">
                      {formatNumber(heldOut.game.brier, 4)}
                    </td>
                    <td className="pp-number px-2 py-2 text-right">
                      {formatNumber(heldOut.series.brier, 4)}
                    </td>
                    <td className="pp-number px-2 py-2 text-right">
                      {formatNumber(row.pooledBrier, 4)}
                    </td>
                    <td className="pp-number px-2 py-2 text-right">
                      n={row.pooledN}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 grid gap-2 text-xs leading-5 text-[var(--color-text-muted)]">
            <p>
              The evidenced baseline scored 0.2195 series Brier in 2026. Both challenger
              point estimates were worse, and every paired
              challenger-versus-production interval crossed zero. The gate
              decision is <span className="font-bold">not promoted</span>.
            </p>
            <p>
              The primary challenger&apos;s game column is its frozen SRS +
              home component; the registered seed adjustment applies only to
              series. Pooled scopes differ by design: fixed models use all 360
              series, the ten-season rolling candidate uses 315, and the
              primary challenger&apos;s initialized window uses 285.
            </p>
          </div>
        </div>
      </section>

      <section className="pp-card">
        <div className="pp-section-head">
          <div className="pp-kicker text-[var(--color-danger)]">
            Production-equivalent input gates
          </div>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <div className="bg-[var(--color-panel-secondary)] p-3">
            <div className="pp-kicker">Lagged rotations</div>
            <div className="pp-number mt-2 text-2xl font-bold">
              {evidence.inputAudit.laggedRotations.completePairedSeries}/
              {evidence.inputAudit.laggedRotations.totalSeries}
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
              Series with timestamped, sourced, pre-series rotations for both
              teams. Post-deadline participation is not backfilled.
            </p>
          </div>
          <div className="bg-[var(--color-panel-secondary)] p-3">
            <div className="pp-kicker">External benchmarks</div>
            <div className="pp-number mt-2 text-2xl font-bold">
              {evidence.inputAudit.externalBenchmarks.coveredSeries}/
              {evidence.inputAudit.externalBenchmarks.totalSeries}
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
              Series with an eligible timestamped public probability or
              explicitly no-vig two-sided price. No comparison is estimated
              while coverage is zero.
            </p>
          </div>
        </div>
      </section>

      <section className="pp-card">
        <div className="pp-section-head">
          <div className="pp-kicker">Two evaluation regimes / what each may claim</div>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-y-2 border-[var(--color-border-strong)]">
                {["Evaluation", "Scope", "Protocol", "Permitted claim"].map((header) => (
                  <th key={header} className="pp-kicker px-2 py-2 text-[var(--color-text-primary)]">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--color-border-subtle)] align-top">
                <td className="px-2 py-2 font-bold">Historical reconstruction</td>
                <td className="pp-number px-2 py-2">{backtestSummary.totalSeries} series / {evidence.timeline.length} pregame snapshots, {backtestSummary.firstSeason}–{backtestSummary.lastSeason}</td>
                <td className="px-2 py-2">Rating-only baseline; leakage-checked point-in-time inputs; scenario overlay excluded</td>
                <td className="px-2 py-2">Descriptive baseline performance: Brier {formatNumber(backtestSummary.models.playoff_pulse.brierScore, 4)}, conclusively better than naive baselines but conclusively worse than SRS-only and net-rating-only; the retirement gate fires and the overlay is not validated</td>
              </tr>
              <tr className="border-b border-[var(--color-border-subtle)] align-top">
                <td className="px-2 py-2 font-bold">Rolling origin</td>
                <td className="pp-number px-2 py-2">{evidence.modelComparison[0].series.n} series / {evidence.modelComparison[0].game.n} games, {evidence.evaluationSeasons[0]}–{evidence.evaluationSeasons.at(-1)}</td>
                <td className="px-2 py-2">Models fitted only on seasons before each evaluated season</td>
                <td className="px-2 py-2">Out-of-period comparison: no richer candidate conclusively improved the game endpoint versus SRS + home court. The exploratory SRS-plus-player series interval is barely below zero, but its game interval crosses zero and its BPM input is not production-equivalent (reference series Brier {formatNumber(evidence.modelComparison[0].series.brier, 4)})</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 max-w-4xl text-xs leading-5 text-[var(--color-text-muted)]">
            The two Brier levels are not directly comparable: the reconstruction
            evaluates the fixed-coefficient rating baseline on all seasons, while rolling
            origin reserves the first three seasons for initialization and
            refits its parameters before every later season. Bootstrap
            intervals for every headline difference live in
            docs/backtest/significance.json and docs/backtest/research.json.
          </p>
        </div>
      </section>

      <section className="pp-card">
        <div className="pp-section-head">
          <div className="pp-kicker">Reconstructed archive / immediately before each game</div>
        </div>
        <div className="grid gap-4 p-4">
          <p className="text-xs leading-5 text-[var(--color-text-muted)]">
            Featured by rule, not curation: the default series is the most
            recent completed NBA Finals in the archive
            {featuredReplay ? ` (${featuredReplay.season} ${featuredReplay.teamA} vs ${featuredReplay.teamB})` : ""}.
            Every archived series is selectable.
          </p>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <select value={season} onChange={(event) => changeSeason(Number(event.target.value))} className="pp-select">
              {seasons.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select value={selectedMeta.seriesId} onChange={(event) => { setSelectedSeriesId(event.target.value); setSelectedGame(1); }} className="pp-select">
              {availableSeries.map((row) => <option key={row.seriesId} value={row.seriesId}>{row.teamA} vs {row.teamB} · {row.round}</option>)}
            </select>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
            <div className="min-h-[250px]">
              <svg viewBox="0 0 100 100" role="img" aria-label={`${selectedMeta.teamA} series probability before each game`} className="h-[260px] w-full overflow-visible">
                {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1="4" x2="96" y1={95 - tick * 0.9} y2={95 - tick * 0.9} stroke="var(--color-border-subtle)" strokeWidth="0.4" /><text x="1" y={96 - tick * 0.9} fill="var(--color-text-muted)" fontSize="3">{tick}</text></g>)}
                <polygon points={band} fill="var(--overlay-accent-soft)" stroke="none" />
                <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="var(--color-success)" strokeWidth="1.5" />
                {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={selectedGame === timeline[index].gameNumber ? 2.4 : 1.6} fill={selectedGame === timeline[index].gameNumber ? "var(--color-accent)" : "var(--color-success)"} />)}
              </svg>
              <div className="flex flex-wrap justify-center gap-2">
                {timeline.map((row) => (
                  <button key={row.id} type="button" aria-pressed={selectedGame === row.gameNumber} onClick={() => setSelectedGame(row.gameNumber)} className={`pp-button pp-button-compact ${selectedGame === row.gameNumber ? "pp-button-active" : ""}`}>
                    G{row.gameNumber}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid content-start gap-2 bg-[var(--color-panel-secondary)] p-3 text-xs">
              <div className="pp-kicker text-[var(--color-accent)]">Pregame {selectedPoint.gameNumber}</div>
              <div className="flex justify-between"><span>Series state</span><span className="pp-number">{selectedPoint.winsA}–{selectedPoint.winsB}</span></div>
              <div className="flex justify-between"><span>{selectedMeta.teamA} series</span><span className="pp-number font-bold">{formatPercent(selectedPoint.teamASeriesWinProbability)}</span></div>
              <div className="flex justify-between"><span>Sensitivity</span><span className="pp-number">{formatPercent(selectedPoint.lower)}–{formatPercent(selectedPoint.upper)}</span></div>
              <div className="flex justify-between"><span>Next game</span><span className="pp-number">{formatPercent(selectedPoint.teamAGameWinProbability)}</span></div>
              <div className="flex justify-between"><span>Actual game winner</span><span>{selectedPoint.actualGameWinner}</span></div>
              <div className="flex justify-between"><span>Actual series winner</span><span>{selectedPoint.actualSeriesWinner}</span></div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {Object.entries(selectedPoint.finalScoreProbabilities).sort((a, b) => b[1] - a[1]).map(([score, probability]) => <div key={score} className="flex justify-between"><span>{score}</span><span className="pp-number">{formatPercent(probability)}</span></div>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pp-card">
        <div className="pp-section-head"><div className="pp-kicker">Calibration / raw versus nested correction</div></div>
        <div className="grid gap-6 p-4 lg:grid-cols-2">
          <ReliabilityPlot title="Game forecasts" block={evidence.calibration.game} />
          <ReliabilityPlot title="Series forecasts" block={evidence.calibration.series} />
        </div>
        <p className="border-t border-[var(--color-border-subtle)] p-4 text-xs leading-5 text-[var(--color-text-muted)]">
          Rolling-origin forecasts remain overconfident, especially at series
          level: the
          calibration fit for the reference model has slope{" "}
          {formatNumber(evidence.modelComparison[0].series.calibrationFit.slope, 2)} for
          series and {formatNumber(evidence.modelComparison[0].game.calibrationFit.slope, 2)} for
          games (a slope of 1 would be perfectly calibrated). With the expanded
          history, direct series calibration worsens Brier and log loss. Game
          calibration propagated through the exact solver also worsens series
          Brier, with an interval crossing zero. Both calibration lines are
          CLOSED and neither mapping is transferred to manual production inputs.
        </p>
      </section>

      <section className="pp-card">
        <div className="pp-section-head">
          <div className="pp-kicker">Brier decomposition / where skill comes from</div>
        </div>
        <div className="grid gap-6 p-4 lg:grid-cols-2">
          {(["game", "series"] as const).map((kind) => {
            const block = evidence.brierDecomposition[kind];
            return (
              <div key={kind} className="grid gap-3">
                <div className="pp-kicker text-[var(--color-text-primary)]">{kind} forecasts</div>
                <div className="overflow-x-auto">
                  <table className="pp-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th className="num">Brier</th>
                        <th className="num">Uncertainty</th>
                        <th className="num">Resolution</th>
                        <th className="num">Reliability</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        ["SRS + home", block.reference],
                        ["Rolling climatology", block.climatology],
                      ] as const).map(([label, row]) => (
                        <tr key={label}>
                          <td>{label}</td>
                          <td className="num pp-number">{formatNumber(row.brier, 4)}</td>
                          <td className="num pp-number">{formatNumber(row.uncertainty, 4)}</td>
                          <td className="num pp-number">{formatNumber(row.resolution, 4)}</td>
                          <td className="num pp-number">{formatNumber(row.reliability, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs leading-5 text-[var(--color-text-muted)]">
                  Brier ≈ uncertainty − resolution + reliability. The reference
                  earns its advantage mainly through more resolution, not
                  perfect calibration. Components use ten equal-count groups;
                  season-clustered intervals and the within-group residual are
                  committed in the evidence artifact.
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-[18px] lg:grid-cols-2">
        <div className="pp-card">
          <div className="pp-section-head">
            <div className="pp-kicker text-[var(--color-warning)]">Sensitivity reliability diagnostic</div>
          </div>
          <div className="grid gap-3 p-4">
            <div className="pp-number text-3xl font-bold">
              {evidence.sensitivityReliability.groupsWithinBand}/{evidence.sensitivityReliability.totalGroups}
            </div>
            <p className="text-xs leading-5 text-[var(--color-text-muted)]">
              Equal-count pre-series groups whose observed win rate falls
              inside the group&apos;s mean sensitivity band. The three highest
              probability groups fall outside on the underconfident side.
            </p>
            <div className="grid gap-1">
              {evidence.sensitivityReliability.groups.map((group) => (
                <div key={group.bin} className="grid grid-cols-[34px_1fr_54px] items-center gap-2 text-[11px]">
                  <span className="pp-number">B{group.bin}</span>
                  <span className="relative h-3 bg-[var(--color-panel-secondary)]">
                    <span
                      className="absolute h-3 bg-[var(--overlay-info-soft)]"
                      style={{
                        left: `${group.lowerMean * 100}%`,
                        width: `${(group.upperMean - group.lowerMean) * 100}%`,
                      }}
                    />
                    <span
                      className={`absolute top-[-2px] h-4 w-[2px] ${
                        group.observedWithinMeanSensitivityBand
                          ? "bg-[var(--color-success)]"
                          : "bg-[var(--color-danger)]"
                      }`}
                      style={{ left: `${group.observed * 100}%` }}
                    />
                  </span>
                  <span className="pp-number text-right">{formatPercent(group.observed)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs leading-5 text-[var(--color-text-muted)]">
              This is a grouped reliability diagnostic, not individual
              probability-interval coverage. A binary result cannot reveal the
              unobserved true probability for one series.
            </p>
          </div>
        </div>

        <div className="pp-card">
          <div className="pp-section-head">
            <div className="pp-kicker text-[var(--color-danger)]">Historical availability completeness</div>
          </div>
          <div className="grid gap-3 p-4">
            <div className="pp-number text-3xl font-bold">
              {formatPercent(evidence.availability.observationCoverage)}
            </div>
            <p className="text-xs leading-5 text-[var(--color-text-muted)]">
              Sourced point-in-time player availability coverage across{" "}
              {evidence.availability.playerSeriesOpportunities} player-series
              opportunities. With zero eligible observations, injury and
              replacement-minute effects are not estimable historically.
            </p>
            <ul className="grid gap-1 text-xs leading-5 text-[var(--color-text-muted)]">
              {evidence.availability.limitations.map((limitation) => (
                <li key={limitation}>— {limitation}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="pp-card">
        <div className="pp-section-head"><div className="pp-kicker">Model comparison / lower Brier is better</div></div>
        <div className="grid gap-3 p-4">
          {evidence.modelComparison.map((model) => (
            <div key={model.id} className="grid grid-cols-[150px_1fr_62px] items-center gap-3 text-xs">
              <span>{model.id.replaceAll("_", " ")}</span>
              <span className="h-3 bg-[var(--color-panel-secondary)]"><span className="block h-3 bg-[var(--color-accent)]" style={{ width: `${model.game.brier / maxModelBrier * 100}%` }} /></span>
              <span className="pp-number text-right">{formatNumber(model.game.brier, 4)}</span>
            </div>
          ))}
          <div className="mt-2 grid gap-2 border-t border-[var(--color-border-subtle)] pt-3">
            <div className="pp-kicker">Rolling series baselines</div>
            {evidence.strongSeriesBaselines.map((model) => {
              const comparison = evidence.strongSeriesBaselineComparisons.find(
                (row) => row.id === model.id,
              );
              return (
                <div key={model.id} className="grid gap-1 text-xs sm:grid-cols-[1fr_auto]">
                  <span>{model.id.replaceAll("_", " ")}</span>
                  <span className="pp-number">
                    Brier {formatNumber(model.brier, 4)}
                    {comparison
                      ? ` · Δ ${formatSigned(
                          comparison.series.candidateMinusBaselineBrier,
                          4,
                        )} [${formatNumber(
                          comparison.series.ci95[0],
                          4,
                        )}, ${formatNumber(
                          comparison.series.ci95[1],
                          4,
                        )}]`
                      : ""}
                  </span>
                </div>
              );
            })}
            <p className="text-xs leading-5 text-[var(--color-text-muted)]">
              Deltas are candidate minus SRS + home. The fitted seed + SRS
              point estimate is lower, but its 95% interval still reaches zero;
              it is not promoted.
            </p>
          </div>
          <div className="mt-2 grid gap-2 border-t border-[var(--color-border-subtle)] pt-3 text-xs text-[var(--color-text-muted)]">
            <p>
              Preregistered {evidence.dynamicCandidate.registration.id}: Brier{" "}
              {formatNumber(evidence.dynamicCandidate.metrics.brier, 4)}, Δ{" "}
              {formatSigned(
                evidence.dynamicCandidate.comparisonToSrsHome
                  .candidateMinusBaselineBrier,
                4,
              )}; interval includes zero. Research-only through 2026.
            </p>
            <p>
              Frozen {evidence.shrinkageCandidate.registration.id}: game Brier{" "}
              {formatNumber(evidence.shrinkageCandidate.metrics.game.brier, 4)},
              series {formatNumber(evidence.shrinkageCandidate.metrics.series.brier, 4)}.
              Both comparison intervals include zero; first promotion-eligible
              season {evidence.shrinkageCandidate.registration.firstPromotionEligibleSeason}.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-[18px] lg:grid-cols-2">
        {(["game", "series"] as const).map((kind) => (
          <div key={kind} className="pp-card">
            <div className="pp-section-head"><div className="pp-kicker text-[var(--color-danger)]">Worst {kind} forecasts / failure analysis</div></div>
            <div className="divide-y divide-[var(--color-border-subtle)] p-4 pt-0">
              {evidence.worstForecasts[kind].slice(0, 8).map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_58px_48px_56px] gap-2 py-2 text-xs">
                  <span className="truncate" title={row.id}>{row.id}</span>
                  <span className="pp-number text-right">p {formatPercent(row.probability)}</span>
                  <span className="text-right">actual {row.outcome === 1 ? "W" : "L"}</span>
                  <span className="pp-number text-right text-[var(--color-danger)]">{formatNumber(row.brierLoss, 3)}</span>
                </div>
              ))}
            </div>
            <p className="border-t border-[var(--color-border-subtle)] p-4 text-xs leading-5 text-[var(--color-text-muted)]">
              Ranked mechanically by Brier loss; no editorial substitutions.
              These misses are the tail of the measured overconfidence pattern
              (calibration slope ≈ 0.8 above), not isolated anecdotes.
            </p>
          </div>
        ))}
      </section>

      <section className="pp-card">
        <div className="pp-section-head"><div className="pp-kicker text-[var(--color-accent)]">Production forecast versions</div></div>
        <div className="grid gap-2 p-4">
          {evidence.versions.map((version) => (
            <div key={version.file} className="grid gap-1 border-b border-[var(--color-border-subtle)] pb-2 text-xs sm:grid-cols-[1fr_auto_auto]">
              <span className="font-bold">{version.modelVersion}</span>
              <span>{version.issuedAt}</span>
              <span className="pp-pill text-[var(--color-accent)]">
                {version.issuanceType === "prospective_before_game"
                  ? "Prospective issue"
                  : "Retrospective archive"}
              </span>
            </div>
          ))}
          {distinctVersions.length < 2 ? <p className="text-xs text-[var(--color-text-muted)]">One immutable production version is currently archived. Pairwise probability deltas will appear automatically when another version is issued for a comparable series.</p> : null}
          {versionDeltas.length ? (
            <div className="mt-3 grid gap-2">
              <div className="pp-kicker">Latest versus previous version</div>
              {versionDeltas.slice(0, 8).map((row) => (
                <div key={row.seriesId} className="grid grid-cols-[1fr_58px_58px_62px] gap-2 text-xs">
                  <span className="truncate">{row.seriesId}</span>
                  <span className="pp-number text-right">{formatPercent(row.previous)}</span>
                  <span className="pp-number text-right">{formatPercent(row.current)}</span>
                  <span className="pp-number text-right">{formatSigned(row.delta * 100)} pp</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
