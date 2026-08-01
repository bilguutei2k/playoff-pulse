import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import backtestSummary from "../../../docs/backtest/summary.json";
import backtestResults from "../../../docs/backtest/results.json";
import evidence from "../../../docs/backtest/evidence.json";
import retirementDecision from "../../../docs/backtest/retirement-decision.json";
import { formatNumber, formatSigned } from "@/lib/utils/format";
import { ResearchEvidence } from "@/components/forecast/ResearchEvidence";

type SectionTable = {
  type: "table";
  headers: string[];
  rows: string[][];
};

type SectionSubsection = {
  type: "subsection";
  label: string;
  text: string;
};

type SectionBodyContent = string | (string | SectionTable | SectionSubsection)[];

type MethodologySection = {
  title: string;
  body: SectionBodyContent;
};

const fixedModel = backtestResults.results.find(
  (result) => result.modelName === "playoff_pulse",
);
const fixedSrs = backtestResults.results.find(
  (result) => result.modelName === "srs_proxy_only",
);
const fixedNet = backtestResults.results.find(
  (result) => result.modelName === "net_rating_only",
);
const fixedHigherSeed = backtestResults.results.find(
  (result) => result.modelName === "higher_seed",
);

const sections: MethodologySection[] = [
  {
    title: "Purpose",
    body: "Playoff Pulse is a retrospective forecasting experiment and a preserved scenario engine for NBA playoff series. It turns disclosed manual assumptions into game, series, Finals, and championship estimates, then separates those production-style outputs from reconstructed and rolling-origin research evidence. It is not a betting product and does not make wagering recommendations.",
  },
  {
    title: "Team Strength Formula",
    body: "The MVP uses teamStrength = playerWeight * playerMinuteWeightedImpact + netRatingWeight * netRating + eloWeight * eloToPointScale + manualAdjustment. Default weights are 0.55, 0.25, and 0.20, with manual adjustment added as a point-scale override.",
  },
  {
    title: "Player-Minute Weighting",
    body: "Each player's manual impact rating is weighted by projected playoff minutes and divided by a 240-minute team game. This creates a point-scale rotation estimate that can move when minutes, injuries, or availability change.",
  },
  {
    title: "Injury Handling",
    body: "Players marked out are excluded from the central player-minute estimate. Limited and questionable players receive disclosed central multipliers. The uncertainty layer samples questionable availability and exposes available-versus-out scenarios; these are model assumptions, not medical forecasts.",
  },
  {
    title: "Home Court",
    body: "Expected margin starts with the difference between the two teams' strength estimates. The configured home-court advantage is 2.2 points added to the expected margin when the home team has court advantage. This is a manual assumption, not empirically fitted to playoff data.",
  },
  {
    title: "Exact Series Solver",
    body: "Game margins are converted to win probabilities with a logistic function using a scale parameter of 6.5. Every possible remaining best-of-seven path is then solved exactly with dynamic programming, respecting the current score and home pattern. Monte Carlo is reserved for bracket-wide and input-uncertainty calculations.",
  },
  {
    title: "Full Bracket Simulation",
    body: "The bracket simulation repeatedly resolves configured rounds and creates future series from winners. Each path draws shared team-strength and parameter uncertainty, so a team's latent strength is correlated across its games. The 10th–90th percentile series ranges are sensitivity intervals under disclosed assumptions, not empirically validated coverage guarantees. A configured Finals score and home pattern are always respected.",
  },
  {
    title: "Manual and Static Inputs",
    body: "Team ratings, player impact, projected minutes, injury statuses, model weights, and the placeholder market odds remain manual configuration in static files. NBA Finals roster inputs were manually rechecked against public Game 2 notes on June 5, 2026, and projected minutes use Game 1 participation as the baseline, but the impacts are still subjective estimates. The 2026 playoffs are complete: the Knicks defeated the Spurs 4-1 in the NBA Finals, with the final series state verified against the ESPN public scoreboard on July 12, 2026. The daily scoreboard workflow is bookkeeping only - it does not adjust ratings, minutes, injuries, or rosters. No odds API, account system, database, or authentication is active.",
  },
  {
    title: "Backtest Results",
    body: [
      `Across ${backtestSummary.totalSeries} playoff series from ${backtestSummary.firstSeason} through ${backtestSummary.lastSeason}, the fixed Playoff Pulse configuration posts Brier ${backtestSummary.models.playoff_pulse.brierScore.toFixed(4)}. It conclusively beats coin flip (${backtestSummary.models.coinflip.brierScore.toFixed(4)}), directional higher-seed (${backtestSummary.models.higher_seed.brierScore.toFixed(4)}), and directional home-team (${backtestSummary.models.home_team.brierScore.toFixed(4)}) baselines.`,
      `The expanded result does not conclusively beat the simple rating models: its point estimate trails SRS-only by ${(backtestSummary.models.playoff_pulse.brierScore - backtestSummary.models.srs_proxy_only.brierScore).toFixed(4)} Brier and leads net-rating-only by ${(backtestSummary.models.net_rating_only.brierScore - backtestSummary.models.playoff_pulse.brierScore).toFixed(4)}. Both paired 95% intervals include zero. The reconstruction evaluates a fixed configuration whose parameters predate the harness and were never refit; docs/parameter-provenance.md records why this result is descriptive rather than prospective.`,
      "The aggregate edge does not establish dominant superiority over rating-only models. Rolling-origin game evaluation and season-clustered intervals are shown above; feature additions remain excluded when their interval includes harm.",
      "Revision history: July 12 corrected a minutes parser and truncated home patterns. The July 26 extension added 2003–2015 and the era-correct 2–3–2 NBA Finals pattern through 2013. The July 27 fold added the separately scored 2026 holdout and regenerated the pooled 2003–2026 archive without changing the frozen pre-2026 record.",
    ],
  },
  {
    title: "Round-Level Finding",
    body: [
      "Round-by-round Brier score against the SRS-proxy-only baseline:",
      {
        type: "table",
        headers: ["Round", "N", "Playoff Pulse", "SRS proxy", "Delta"],
        rows: ([
          "First Round",
          "Conference Semifinal",
          "Conference Final",
          "NBA Finals",
        ] as const).map((round) => {
          const pulse = fixedModel?.breakdown.byRound[round];
          const srs = fixedSrs?.breakdown.byRound[round];
          return [
            round,
            String(pulse?.n ?? 0),
            pulse?.brierScore.toFixed(3) ?? "—",
            srs?.brierScore.toFixed(3) ?? "—",
            pulse && srs
              ? `${pulse.brierScore - srs.brierScore >= 0 ? "+" : ""}${(
                  pulse.brierScore - srs.brierScore
                ).toFixed(4)}`
              : "—",
          ];
        }),
      },
      "The first-round result remains the warning sign: the full fixed blend trails SRS-only where rating gaps are often largest. Later-round point estimates favor the blend, but those slices are progressively smaller and were not used as proof of improvement.",
      "A smooth rating-gap shrinkage rule was frozen and evaluated separately. Its game and series comparison intervals both include zero, so it remains a 2027 research candidate rather than a production change.",
    ],
  },
  {
    title: "Production Retirement Gate",
    body: [
      `Verdict: ${retirementDecision.decision === "retain_production_gate_not_met" ? "retain production" : "retire production to research-only"}. The gate was committed before this verdict and uses a symmetric 0.005 meaningful-deficit threshold, paired season-clustered inference, and log-loss and calibration-slope safeguards.`,
      ...retirementDecision.comparisons.map(
        (comparison) =>
          `Against ${comparison.comparator === "srs_proxy_only" ? "SRS-only" : "net-rating-only"}, production-minus-comparator series Brier is ${formatSigned(comparison.productionMinusComparatorBrier, 6)} with season-clustered 95% interval [${formatSigned(comparison.seasonClusteredBrierDifferenceCi95[0], 6)}, ${formatSigned(comparison.seasonClusteredBrierDifferenceCi95[1], 6)}]. The retirement gate is ${comparison.retirementGateMet ? "met" : "not met"} for this comparison.`,
      ),
      "The retained verdict does not establish that the full model is better than either rating-only comparator. It means only that neither comparator cleared every precommitted condition required to demote the incumbent.",
    ],
  },
  {
    title: "Calibration, Bubble, and Caveats",
    body: [
      {
        type: "subsection",
        label: "Calibration",
        text: `The two calibration regimes point in different directions and must not be conflated. The fixed ${backtestSummary.totalSeries}-series reconstruction is underconfident in its 70–80% bucket (${((fixedModel?.calibrationBuckets.find((bucket) => bucket.bucketMin === 0.7)?.predictedMean ?? 0) * 100).toFixed(1)}% predicted versus ${((fixedModel?.calibrationBuckets.find((bucket) => bucket.bucketMin === 0.7)?.actualWinRate ?? 0) * 100).toFixed(1)}% observed). The stricter rolling-origin SRS + home model is overconfident overall, with slopes ${evidence.modelComparison[0].series.calibrationFit.slope.toFixed(2)} for series and ${evidence.modelComparison[0].game.calibrationFit.slope.toFixed(2)} for games. Therefore the evidence does not support blindly lowering production logisticScale from 6.5. Historical BPM/SRS calibration cannot be transferred to subjective manual production inputs.`,
      },
      {
        type: "subsection",
        label: "Bubble",
        text: `The expanded reconstruction still shows broad bubble degradation across rating models: Playoff Pulse +${((fixedModel?.breakdown.bubble.brierScore ?? 0) - (fixedModel?.breakdown.nonBubble.brierScore ?? 0)).toFixed(3)}, SRS-only +${((fixedSrs?.breakdown.bubble.brierScore ?? 0) - (fixedSrs?.breakdown.nonBubble.brierScore ?? 0)).toFixed(3)}, and net-rating-only +${((fixedNet?.breakdown.bubble.brierScore ?? 0) - (fixedNet?.breakdown.nonBubble.brierScore ?? 0)).toFixed(3)} Brier. Higher-seed is less affected (+${((fixedHigherSeed?.breakdown.bubble.brierScore ?? 0) - (fixedHigherSeed?.breakdown.nonBubble.brierScore ?? 0)).toFixed(3)}). This is one unusual postseason, not an independent sample large enough for causal attribution.`,
      },
      {
        type: "subsection",
        label: "Sample size",
        text: `The smallest fixed-model calibration buckets should not be read as stable signal: the 0.2–0.3 and 0.3–0.4 groups contain only ${fixedModel?.calibrationBuckets.find((bucket) => bucket.bucketMin === 0.2)?.count ?? 0} and ${fixedModel?.calibrationBuckets.find((bucket) => bucket.bucketMin === 0.3)?.count ?? 0} series. Even the expanded Finals subset is only ${fixedModel?.breakdown.byRound["NBA Finals"]?.n ?? 0} series.`,
      },
    ],
  },
  {
    title: "Future Versions",
    body: "The research harness now supports rolling-origin game and series evaluation, rolling climatology baselines, grouped Murphy Brier decomposition, regularized expected-margin models, exact series solving, nested calibration, season-clustered uncertainty, feature ablations, and preregistered candidates. Matchup and player extensions remain research-only unless they improve genuinely future archived seasons.",
  },
  {
    title: "Point-in-Time Reconstruction",
    body: [
      `The research archive reconstructs ${evidence.timeline.length} forecasts immediately before historical playoff games from ${backtestSummary.firstSeason}–${backtestSummary.lastSeason}. A Game N record includes the regular-season snapshot and Games 1 through N-1 only. It never includes Game N's result or a later result.`,
      "These are leakage-safe reconstructed forecasts, not claims about forecasts published at the time. Every record identifies its model version, information set, source snapshot, impact scale, rotation source, and availability assumption.",
    ],
  },
  {
    title: "Replacement Minutes and Scenario Lab",
    body: "Scenario rotations conserve 240 minutes. Out players receive zero minutes; missing or vacated time becomes a disclosed replacement-level player rather than disappearing. Requests above 240 are proportionally scaled. The preserved Finals demonstration resets a completed series to 0–0 and is explicitly hypothetical, never presented as live 2026 state.",
  },
  {
    title: "Calibration and Registered Challengers",
    body: [
      `Nested calibration is trained only on earlier rolling-origin predictions. Across the expanded eligible sample, game calibration improves Brier ${evidence.calibration.game.raw.brier.toFixed(4)} → ${evidence.calibration.game.calibrated.brier.toFixed(4)}, while series calibration improves ${evidence.calibration.series.raw.brier.toFixed(4)} → ${evidence.calibration.series.calibrated.brier.toFixed(4)}. Both improve log loss and remain research-only. Neither mapping is applied to production because historical BPM/SRS inputs and subjective manual inputs are not interchangeable.`,
      `The coherent alternative calibrates each possible future game's probability and then reruns the exact series solver. It improves the eligible series point estimate from ${evidence.calibration.gamePropagatedThroughExactSeries.raw.brier.toFixed(4)} to ${evidence.calibration.gamePropagatedThroughExactSeries.calibrated.brier.toFixed(4)}, but its season-clustered comparison interval includes zero, so it remains research-only.`,
      `The single primary challenger combines the exact SRS-series logit with seed difference. On ${evidence.primarySeriesChallenger.metrics.n} matched rolling series it changes Brier ${evidence.primarySeriesChallenger.baselineMetrics.brier.toFixed(4)} → ${evidence.primarySeriesChallenger.metrics.brier.toFixed(4)}; the point improvement exceeds the declared 0.005 threshold, but the 95% interval still crosses zero. The 2026 result cannot promote it because registration followed the postseason and a single season cannot supply the required season-clustered interval.`,
      `A frozen ten-season training-window challenger improves historical game Brier by ${Math.abs(evidence.temporalWindowCandidate.comparisonToSrsHome.game.candidateMinusBaselineBrier).toFixed(4)}, with its historical season-clustered interval below zero. This is encouraging but retrospective: it remains ineligible for promotion until 2027 because the window was selected before, not during, that future evaluation.`,
      "The dynamic_margin_update_v1 and rating_gap_player_shrinkage_v1 candidates are frozen for 2027. Their pooled historical comparison intervals include zero; results through 2026 are descriptive and cannot qualify either for promotion.",
    ],
  },
  {
    title: "Limitations",
    body: [
      "The current numbers should be read as model estimates from assumed inputs. They are not official data or certainties. Historical calibration evidence applies to the SRS-based research model; it does not automatically calibrate subjective production player ratings. The bracket is structurally complete, but team ratings, player impacts, and injury statuses remain manual assumptions.",
      "Historical validation does not perfectly match the live model inputs. The backtest uses season-long BPM as the player-impact proxy, while the live product uses manually configured per-player impact ratings. That gap matters: the backtest validates the model structure and broad weighting approach, but it does not prove the current manual player ratings are calibrated at the same scale. Roster recency checks reduce a data-staleness risk; they do not validate the subjective impact ratings.",
      `Historical availability has ${evidence.availability.observations} eligible point-in-time observations across ${evidence.availability.playerSeriesOpportunities} player-series opportunities. Injury effects are therefore not estimable. Participation after a forecast deadline is deliberately not backfilled as availability evidence.`,
      `Production-equivalent lagged rotations are not estimable yet: the timestamped rotation contract has ${evidence.inputAudit.laggedRotations.observations} observations and ${evidence.inputAudit.laggedRotations.completePairedSeries} completely covered series. External benchmark comparison is also unestimated (${evidence.inputAudit.externalBenchmarks.observations} eligible observations). Empty coverage is surfaced as a failed prerequisite, not replaced with hindsight-derived participation or unsourced prices.`,
      `Sensitivity bands are evaluated only as a grouped reliability diagnostic: ${evidence.sensitivityReliability.groupsWithinBand} of ${evidence.sensitivityReliability.totalGroups} equal-count groups contain the observed group rate. This is not individual probability-interval coverage because one binary outcome cannot identify a series' true latent probability.`,
    ],
  },
  {
    title: "Prospective Issuance Protocol",
    body: [
      "The archive command now distinguishes retrospective snapshots from prospective before-game issuance. Prospective issuance requires an explicit issue time, series ID, game ID, and scheduled start; it rejects forecasts issued before their data snapshot or at/after tipoff.",
      "Archive filenames include issue time and model version and are immutable: an existing issue cannot be overwritten. Each prospective archive also seals the registered primary challenger's probability beside the production estimate without replacing it. Promotion decisions begin with the 2027 postseason because no forecasts were issued contemporaneously in 2026.",
      "The promotion gate has one primary challenger, one primary endpoint, a 0.005 minimum meaningful Brier improvement, paired season-clustered uncertainty, no-worse log loss and calibration checks, production-equivalent input requirements, and a mandatory future archived season. Exploratory candidates cannot be promoted from the same evaluation.",
    ],
  },
];

function SectionBody({ body }: { body: SectionBodyContent }) {
  if (typeof body === "string") {
    return (
      <p className="mt-3 text-sm leading-7 text-[var(--color-text-muted)]">
        {body}
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-4 text-sm leading-7 text-[var(--color-text-muted)]">
      {body.map((item, index) => {
        if (typeof item === "string") {
          return <p key={index}>{item}</p>;
        }

        if (item.type === "table") {
          return (
            <div key={index} className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left">
                <thead>
                  <tr className="border-y-2 border-[var(--color-border-strong)]">
                    {item.headers.map((header) => (
                      <th
                        key={header}
                        className="pp-kicker px-3 py-2 text-[var(--color-text-primary)]"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {item.rows.map((row) => (
                    <tr
                      key={row[0]}
                      className="border-b border-[var(--color-border-subtle)]"
                    >
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${row[0]}-${cell}`}
                          className={`px-3 py-2 ${
                            cellIndex > 0
                              ? "pp-number text-right font-bold text-[var(--color-text-primary)]"
                              : ""
                          }`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <div key={index}>
            <h3 className="pp-kicker text-[var(--color-text-primary)]">
              {item.label}
            </h3>
            <p className="mt-2">{item.text}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto grid max-w-7xl gap-[18px] px-3 py-3 md:px-[18px] md:py-[18px] xl:grid-cols-[1.4fr_0.8fr] xl:items-start">
        <div className="flex flex-col gap-[18px]">
          <div className="pp-card">
            <div className="pp-section-head">
              <div className="pp-kicker text-[var(--color-accent)]">Methodology</div>
              <h1 className="mt-3 text-2xl font-bold tracking-normal">
                How Playoff Pulse estimates probabilities
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
                The model is intentionally simple for the production MVP:
                visible inputs, pure TypeScript calculations, and clear
                limitations.
              </p>
            </div>
            <div className="p-4">
              <Link
                href="/"
                className="pp-button"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to retrospective
              </Link>
            </div>
          </div>

          <ResearchEvidence />

          <div className="pp-card">
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {sections.map((section, index) => (
                <section key={section.title} className="grid gap-3 p-4 sm:grid-cols-[72px_1fr]">
                  <div className="pp-kicker text-[var(--color-accent)]">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <h2 className="pp-kicker text-[var(--color-text-primary)]">
                      {section.title}
                    </h2>
                    <SectionBody body={section.body} />
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>

        <aside className="grid gap-[18px] xl:sticky xl:top-[18px]">
          <div className="pp-card">
            <div className="pp-section-head">
              <h2 className="pp-kicker text-[var(--color-danger)]">Limits</h2>
            </div>
            <div className="grid gap-3 p-4 text-sm leading-6 text-[var(--color-text-muted)]">
              <p>
                The current numbers should be read as model estimates from
                assumed inputs. They are not official data or certainties;
                research-model calibration does not validate subjective live inputs.
              </p>
              <div className="border-y-2 border-[var(--color-border-strong)] bg-[var(--overlay-danger-soft)] px-3 py-2">
                <span className="pp-kicker text-[var(--color-danger)]">
                  Not betting advice
                </span>
              </div>
              <p>
                Playoff Pulse does not compare prices, recommend wagers, or
                claim to identify profitable betting opportunities.
              </p>
            </div>
          </div>

          <div className="pp-card">
            <div className="pp-section-head">
              <h2 className="pp-kicker">Backtest snapshot</h2>
            </div>
            <div className="grid gap-2 p-4">
              {[
                ["Series", String(backtestSummary.totalSeries)],
                [
                  "Seasons",
                  `${backtestSummary.firstSeason}–${backtestSummary.lastSeason}`,
                ],
                [
                  "Brier",
                  formatNumber(backtestSummary.models.playoff_pulse.brierScore, 3),
                ],
                [
                  "vs Coinflip",
                  formatSigned(
                    backtestSummary.models.playoff_pulse.brierScore -
                      backtestSummary.models.coinflip.brierScore,
                    3,
                  ),
                ],
                [
                  "vs Higher-Seed",
                  formatSigned(
                    backtestSummary.models.playoff_pulse.brierScore -
                      backtestSummary.models.higher_seed.brierScore,
                    3,
                  ),
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] pb-2">
                  <span className="pp-kicker">{label}</span>
                  <span className="pp-number text-sm font-bold">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pp-card">
            <div className="pp-section-head">
              <h2 className="pp-kicker">Method snapshot</h2>
            </div>
            <div className="grid gap-2 p-4">
              {[
                ["Weights", "0.55 / 0.25 / 0.20"],
                ["Home court", "+2.2 points"],
                ["Logistic", "scale 6.5"],
                ["Series", "Exact solver"],
                ["Bracket", "10,000 runs"],
                ["Model", "2026.3 point-in-time"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] pb-2">
                  <span className="pp-kicker">{label}</span>
                  <span className="pp-number text-sm font-bold">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
