import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import backtestSummary from "../../../docs/backtest/summary.json";
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

const sections: MethodologySection[] = [
  {
    title: "Purpose",
    body: "Playoff Pulse is a transparent forecast engine for NBA playoff series. It turns manual input assumptions into game, series, finals, and championship model estimates. It is not a betting product and does not make wagering recommendations.",
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
      'Across 150 playoff series from 2016 through 2025, Playoff Pulse posts a Brier score of 0.191 -- comfortably better than a 50/50 coinflip (0.250), a "higher seed always wins" rule (0.213), and a "home team always wins" rule (0.215). Against the historical SRS-proxy-only model (0.194) or net-rating-only model (0.195), the aggregate edge is small.',
      "The aggregate edge does not establish dominant superiority over rating-only models. Rolling-origin game evaluation and season-clustered intervals are shown above; feature additions remain excluded when their interval includes harm.",
      "Correction, July 2026: the original May 2026 run contained two input defects -- a minutes-parsing bug that promoted a handful of deep-bench players into 21 historical rotations, and truncated home patterns that placed unplayed late-series games on neutral court. Both were fixed and every number on this page was regenerated on July 12, 2026. The headline Brier improved from 0.193 to 0.190 and every qualitative conclusion below survived the correction.",
    ],
  },
  {
    title: "Round-Level Finding",
    body: [
      "Round-by-round Brier score against the SRS-proxy-only baseline:",
      {
        type: "table",
        headers: ["Round", "N", "Playoff Pulse", "SRS proxy", "Delta"],
        rows: [
          ["First Round", "80", "0.143", "0.128", "+0.0157"],
          ["Conference Semifinal", "40", "0.262", "0.294", "-0.0320"],
          ["Conference Final", "20", "0.246", "0.262", "-0.0163"],
          ["NBA Finals", "10", "0.173", "0.181", "-0.0079"],
        ],
      },
      "The first-round result is the warning sign: the player-impact layer appears to add noise when seed gaps are large and the simpler rating proxy is already confident. Later-round improvements are suggestive but based on smaller samples.",
      "This is a known weakness, documented here rather than tuned against.",
    ],
  },
  {
    title: "Calibration, Bubble, and Caveats",
    body: [
      {
        type: "subsection",
        label: "Calibration",
        text: "In the 50-60% probability bucket calibration is good: 55.1% predicted produces 53.1% actual. The model remains underconfident higher up the board. In the 60-70% bucket, 65.6% predicted produces 68.8% actual; in the 70-80% bucket, 74.3% predicted produces 83.3% actual. One likely explanation is that the logistic-scale parameter, currently 6.5, may be too conservative. Recalibration via leave-one-year-out cross-validation is a candidate future improvement; we have not retuned against the historical data to avoid overfitting.",
      },
      {
        type: "subsection",
        label: "Bubble",
        text: "Across the rating-based baselines (Elo-only, net-rating-only, and Playoff Pulse), bubble degradation clusters around +0.03 Brier -- the rating-based models suffer comparably. The structural baselines behave differently: higher-seed is the most robust (+0.011), and home-team is the most affected (+0.039), since fixed home-court priors collapse to coinflip-equivalent when home court goes to zero.",
      },
      {
        type: "subsection",
        label: "Sample size",
        text: "The smallest calibration buckets should not be read as signal: the 0.2-0.3 bucket has n=1, the 0.3-0.4 bucket has n=2, and the 0.9-1.0 bucket has n=5. The Finals subset is also only n=10, too small to draw conclusions from Finals-only Brier numbers.",
      },
    ],
  },
  {
    title: "Future Versions",
    body: "The research harness now supports rolling-origin game and series evaluation, regularized expected-margin models, exact series solving, equal-count calibration, season-clustered uncertainty, and feature ablations. Matchup and player extensions remain research-only unless they improve future held-out seasons.",
  },
  {
    title: "Point-in-Time Reconstruction",
    body: [
      "The research archive reconstructs 834 forecasts immediately before historical playoff games from 2016–2025. A Game N record includes the regular-season snapshot and Games 1 through N-1 only. It never includes Game N's result or a later result.",
      "These are leakage-safe reconstructed forecasts, not claims about forecasts published at the time. Every record identifies its model version, information set, source snapshot, impact scale, rotation source, and availability assumption.",
    ],
  },
  {
    title: "Replacement Minutes and Scenario Lab",
    body: "Scenario rotations conserve 240 minutes. Out players receive zero minutes; missing or vacated time becomes a disclosed replacement-level player rather than disappearing. Requests above 240 are proportionally scaled. The preserved Finals demonstration resets a completed series to 0–0 and is explicitly hypothetical, never presented as live 2026 state.",
  },
  {
    title: "Calibration and Dynamic Candidate",
    body: [
      "Nested calibration is trained only on earlier rolling-origin predictions. It worsened both game Brier and game log loss and was rejected. It improved the eligible 75-series research subset, but is not applied to production because historical BPM/SRS inputs and subjective manual inputs are not interchangeable.",
      "The dynamic_margin_update_v1 candidate is preregistered for a genuinely future season: after each prediction it splits 12% of margin residual between opponents and caps the carried postseason adjustment at +/-4 points. Results through 2025 are descriptive and cannot qualify it for promotion.",
    ],
  },
  {
    title: "Limitations",
    body: [
      "The current numbers should be read as model estimates from assumed inputs. They are not official data or certainties. Historical calibration evidence applies to the SRS-based research model; it does not automatically calibrate subjective production player ratings. The bracket is structurally complete, but team ratings, player impacts, and injury statuses remain manual assumptions.",
      "Historical validation does not perfectly match the live model inputs. The backtest uses season-long BPM as the player-impact proxy, while the live product uses manually configured per-player impact ratings. That gap matters: the backtest validates the model structure and broad weighting approach, but it does not prove the current manual player ratings are calibrated at the same scale. Roster recency checks reduce a data-staleness risk; they do not validate the subjective impact ratings.",
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
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-border-strong)] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] transition hover:border-[var(--color-accent)]"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to forecast
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
