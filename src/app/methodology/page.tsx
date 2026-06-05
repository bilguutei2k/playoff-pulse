import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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
    body: "Players marked out are excluded from the player-minute impact calculation. Limited and questionable players receive conservative availability multipliers. These are simple assumptions for the MVP, not medical or official availability forecasts.",
  },
  {
    title: "Home Court",
    body: "Expected margin starts with the difference between the two teams' strength estimates. The configured home-court advantage is 2.2 points added to the expected margin when the home team has court advantage. This is a manual assumption, not empirically fitted to playoff data.",
  },
  {
    title: "Monte Carlo Simulation",
    body: "Game margins are converted to win probabilities with a logistic function using a scale parameter of 6.5. In plain language, a team with a +6.5 expected margin wins approximately 73% of the time, while a team with a +13 margin wins approximately 88% of the time. The remaining games in each best-of-seven series are simulated until one team reaches four wins, respecting the current series score and home pattern.",
  },
  {
    title: "Full Bracket Simulation",
    body: "The bracket simulation repeatedly resolves configured first-round, conference semifinal, and conference final series, creates future best-of-seven rounds from winners when matchups are not manually configured, and then simulates the Finals across 10,000 iterations. When an NBA Finals series is manually configured, the championship simulation respects that current Finals score and home pattern instead of restarting the Finals at 0-0. That produces title probability estimates stable to within roughly +/-1 percentage point. It reports each team's probability of reaching the conference finals, reaching the Finals, and winning the championship.",
  },
  {
    title: "Manual and Static Inputs",
    body: "Team ratings, player impact, projected minutes, injury statuses, model weights, and the placeholder market odds remain manual configuration in static files. Current NBA Finals roster inputs were manually rechecked against public Game 2 notes on June 5, 2026, and projected minutes use Game 1 participation as the baseline, but the impacts are still subjective estimates. Series scores and the snapshot timestamp are the only model inputs that are no longer fully manual: a daily GitHub Actions cron consumes the same ESPN public scoreboard the read-only probe uses, detects finalized games between teams in active series, and opens a pull request proposing win-count updates that a human reviews and merges before anything reaches the live site. The automation is bookkeeping only - it does not adjust ratings, minutes, injuries, or rosters. No odds API, account system, database, or authentication is active.",
  },
  {
    title: "Backtest Results",
    body: [
      'Across 150 playoff series from 2016 through 2025, Playoff Pulse posts a Brier score of 0.193 -- comfortably better than a 50/50 coinflip (0.250), a "higher seed always wins" rule (0.213), and a "home team always wins" rule (0.215). It also beats those simple baselines on log loss. Against single-component baselines built from just Elo (0.194) or just net rating (0.195), the aggregate edge is small. Where the full model earns its weight, and where it doesn\'t, is described round-by-round below.',
      "The aggregate Brier edge is only 0.001 better than Elo-only and 0.002 better than net-rating-only. That means the three-component formula does not dominantly outperform single-component baselines overall; its value shows up in specific rounds, not as a clean sweep across the whole sample.",
    ],
  },
  {
    title: "Round-Level Finding",
    body: [
      "Round-by-round Brier score against the Elo-only baseline:",
      {
        type: "table",
        headers: ["Round", "N", "Playoff Pulse", "Elo-only", "Delta vs Elo"],
        rows: [
          ["First Round", "80", "0.147", "0.129", "+0.0184"],
          ["Conference Semifinal", "40", "0.258", "0.292", "-0.0342"],
          ["Conference Final", "20", "0.256", "0.263", "-0.0073"],
          ["NBA Finals", "10", "0.169", "0.184", "-0.0150"],
        ],
      },
      "The first-round result is the warning sign: the player-impact layer appears to add noise when seed gaps are large and the simpler Elo-only baseline is already confident. The same layer earns more of its weight in balanced matchups, especially the conference semifinals, where Playoff Pulse improves materially against Elo-only.",
      "This is a known weakness, documented here rather than tuned against.",
    ],
  },
  {
    title: "Calibration, Bubble, and Caveats",
    body: [
      {
        type: "subsection",
        label: "Calibration",
        text: "In the 40-50% and 50-60% probability buckets, calibration is good: predicted probability and actual win rate are within about one percentage point. The model is underconfident higher up the board. In the 60-70% bucket, 65.3% predicted produces 70.2% actual; in the 70-80% bucket, 74.7% predicted produces 83.3% actual. One likely explanation is that the logistic-scale parameter, currently 6.5, may be too conservative. Recalibration via leave-one-year-out cross-validation is a candidate future improvement; we have not retuned against the historical data to avoid overfitting.",
      },
      {
        type: "subsection",
        label: "Bubble",
        text: "Across the rating-based baselines (Elo-only, net-rating-only, and Playoff Pulse), bubble degradation clusters around +0.03 Brier -- the rating-based models suffer comparably. The structural baselines behave differently: higher-seed is the most robust (+0.011), and home-team is the most affected (+0.039), since fixed home-court priors collapse to coinflip-equivalent when home court goes to zero.",
      },
      {
        type: "subsection",
        label: "Sample size",
        text: "The smallest calibration buckets should not be read as signal: the 0.2-0.3 bucket has n=1, the 0.3-0.4 bucket has n=3, and the 0.9-1.0 bucket has n=6. The Finals subset is also only n=10, too small to draw conclusions from Finals-only Brier numbers.",
      },
    ],
  },
  {
    title: "Future Versions",
    body: "Planned extensions include real data ingestion, market odds comparison, hybrid model probabilities, player-level external ratings, editable playoff rotations, real bracket synchronization, and citations.",
  },
  {
    title: "Limitations",
    body: [
      "The current numbers should be read as model estimates from assumed inputs. They are not official data, not calibrated against historical outcomes, and not certainties. The bracket is structurally complete, but team ratings, player impacts, injury statuses, and series scores are still manual assumptions.",
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
                assumed inputs. They are not official data, not calibrated
                against historical outcomes, and not certainties.
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
                ["Series", "150"],
                ["Seasons", "2016–2025"],
                ["Brier", "0.193"],
                ["vs Coinflip", "-0.057"],
                ["vs Higher-Seed", "-0.020"],
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
                ["Simulation", "10,000 runs"],
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
