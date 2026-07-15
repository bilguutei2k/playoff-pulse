import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

const sections = [
  {
    title: "Problem",
    body: "NBA playoff forecasts are easy to overstate and hard to explain. This project frames the work as an uncertainty-aware dashboard: take visible assumptions, run a transparent simulation, and show where the numbers come from.",
  },
  {
    title: "Why NBA playoff forecasting is hard",
    body: "Playoff rotations shrink, injuries matter, home court changes by game, and series context is path-dependent. A useful public artifact has to communicate those assumptions instead of pretending the model has live certainty.",
  },
  {
    title: "Methodology",
    body: "Team strength combines player-minute impact, net rating, a rating-derived point value, and a manual adjustment. Game margins become win probabilities; remaining series paths are solved exactly, while bracket paths sample shared input and parameter uncertainty.",
  },
  {
    title: "Data pipeline",
    body: "The current pipeline keeps model-driving data manual while adding a read-only live scoreboard probe. Static TypeScript configuration still owns teams, players, injuries, ratings, series state, and model settings; the live feed is normalized separately before any future reconciliation.",
  },
  {
    title: "Architecture",
    body: "The app uses Next.js App Router, typed model modules, isolated validation checks, reusable forecast components, and a UI layer that consumes a generated forecast snapshot. No database, authentication, or live API dependency is required for deployment.",
  },
  {
    title: "Tradeoffs",
    body: "Manual inputs make the methodology inspectable and reliable for a portfolio demo, but they require clear timestamps and caveats. The model favors explainability over calibration and avoids claims of betting accuracy.",
  },
  {
    title: "What is currently built",
    body: "The deployed dashboard includes a full bracket Monte Carlo simulator, current series cards, probability tables, team strength breakdowns, model controls, validation checks, methodology documentation, clickable team detail drawers, and a read-only live scoreboard probe.",
  },
  {
    title: "Current limitations",
    body: "Forecast inputs are not official live NBA data, player impacts are subjective estimates, injury status is manually maintained, and probabilities are not historically calibrated. The live scoreboard is observational only. Market odds comparison exists only as a planned extension.",
  },
  {
    title: "Future improvements",
    body: "Next steps include official data ingestion, injury source citations, odds comparison, backtesting, calibration reports, editable rotations, API refresh jobs, and a clearer provenance trail for each manual input.",
  },
  {
    title: "Skills demonstrated",
    body: "The project demonstrates problem framing, transparent modeling, TypeScript architecture, simulation, validation, product writing, public-facing data visualization, and restrained design iteration on an existing deployed app.",
  },
];

const highlights = [
  ["Stack", "Next.js, React, TypeScript, Tailwind CSS"],
  ["Model", "Manual inputs, exact series solver, uncertainty simulation"],
  ["Status", "Manual model snapshot, read-only live scores"],
  ["Positioning", "Portfolio analytics showcase, not sportsbook"],
];

export default function CaseStudyPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto grid max-w-7xl gap-[18px] px-3 py-3 md:px-[18px] md:py-[18px] xl:grid-cols-[1.35fr_0.75fr] xl:items-start">
        <div className="flex flex-col gap-[18px]">
          <section className="pp-card">
            <div className="pp-section-head">
              <div className="pp-kicker text-[var(--color-accent)]">Case Study</div>
              <h1 className="mt-3 text-2xl font-bold tracking-normal md:text-3xl">
                Playoff Pulse as a forecasting showcase
              </h1>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--color-text-muted)]">
                A concise technical and product overview for portfolio review,
                internship applications, and analytics discussions.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 p-4">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-border-strong)] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] transition hover:border-[var(--color-accent)]"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to forecast
              </Link>
              <Link
                href="/methodology"
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-border-strong)] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] transition hover:border-[var(--color-accent)]"
              >
                Methodology
                <ExternalLink className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </section>

          <section className="pp-card">
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {sections.map((section, index) => (
                <section
                  key={section.title}
                  className="grid gap-3 p-4 sm:grid-cols-[72px_1fr]"
                >
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
          </section>
        </div>

        <aside className="grid gap-[18px] xl:sticky xl:top-[18px]">
          <section className="pp-card">
            <div className="pp-section-head">
              <h2 className="pp-kicker text-[var(--color-text-primary)]">
                Review snapshot
              </h2>
            </div>
            <div className="grid gap-2 p-4">
              {highlights.map(([label, value]) => (
                <div
                  key={label}
                  className="border-b border-[var(--color-border-subtle)] pb-3"
                >
                  <div className="pp-kicker">{label}</div>
                  <div className="mt-2 text-sm font-bold leading-6 text-[var(--color-text-secondary)]">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="pp-card">
            <div className="pp-section-head">
              <h2 className="pp-kicker text-[var(--color-danger)]">
                Communication stance
              </h2>
            </div>
            <div className="grid gap-3 p-4 text-sm leading-6 text-[var(--color-text-muted)]">
              <p>
                The app presents probabilities as estimates from assumed inputs.
                It does not claim official data coverage, betting utility, or
                live predictive authority.
              </p>
              <span className="pp-pill border-[rgba(184,65,47,0.4)] text-[var(--color-danger)]">
                Honest uncertainty
              </span>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
