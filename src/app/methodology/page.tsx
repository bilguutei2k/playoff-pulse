import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const sections = [
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
    body: "The bracket simulation repeatedly resolves configured first-round and conference semifinal series, creates future best-of-seven rounds from winners when matchups are not manually configured, and then simulates the Finals across 10,000 iterations. That produces title probability estimates stable to within roughly +/-1 percentage point. It reports each team's probability of reaching the conference finals, reaching the Finals, and winning the championship.",
  },
  {
    title: "Manual and Static Inputs",
    body: "The forecast model still uses static configuration files for teams, players, injuries, ratings, series scores, model settings, and placeholder market odds. A read-only scoreboard probe can display external game status, but it does not update model inputs yet. No odds API, account system, database, or authentication is active.",
  },
  {
    title: "Future Versions",
    body: "Planned extensions include real data ingestion, market odds comparison, hybrid model probabilities, historical backtesting, calibration reports, player-level external ratings, editable playoff rotations, real bracket synchronization, and citations.",
  },
  {
    title: "Limitations",
    body: "The current numbers should be read as model estimates from assumed inputs. They are not official data, not calibrated against historical outcomes, and not certainties. The bracket is structurally complete, but team ratings, player impacts, injury statuses, and series scores are still manual assumptions.",
  },
];

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
                    <p className="mt-3 text-sm leading-7 text-[var(--color-text-muted)]">
                      {section.body}
                    </p>
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
