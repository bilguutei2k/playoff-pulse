import { dataLastUpdated, playoffConfig } from "@/lib/data/playoff-config";
import { ForecastDashboard } from "@/components/forecast/ForecastDashboard";
import type { Team } from "@/lib/model/types";

const teamLogoColors: Record<
  string,
  { background: string; border: string; color: string }
> = {
  nyk: { background: "#f58426", border: "#006bb6", color: "#0b2341" },
  det: { background: "#c8102e", border: "#1d42ba", color: "#ffffff" },
  cle: { background: "#6f263d", border: "#ffb81c", color: "#ffffff" },
  phi: { background: "#006bb6", border: "#ed174c", color: "#ffffff" },
  okc: { background: "#007ac1", border: "#ef3b24", color: "#ffffff" },
  lal: { background: "#552583", border: "#fdb927", color: "#ffffff" },
  min: { background: "#0c2340", border: "#78be20", color: "#ffffff" },
  sas: { background: "#c4ced4", border: "#000000", color: "#111111" },
};

function formatDataLastUpdated(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function teamStatus(team: Team, activeTeamIds: Set<string>): string {
  if (team.id === "phi") {
    return "Elim";
  }

  if (activeTeamIds.has(team.id)) {
    return "Live";
  }

  return "CF";
}

export default function Home() {
  const activeSeriesCount = playoffConfig.series.filter(
    (series) => series.winsA < 4 && series.winsB < 4,
  ).length;
  const activeTeamIds = new Set(
    playoffConfig.series
      .filter((series) => series.winsA < 4 && series.winsB < 4)
      .flatMap((series) => [series.teamA, series.teamB]),
  );

  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-[18px] px-3 py-3 md:px-[18px] md:py-[18px]">
        <section className="pp-card">
          <div className="grid gap-0 divide-y divide-[var(--color-border-subtle)] xl:grid-cols-[1.4fr_1fr] xl:divide-x xl:divide-y-0">
            <div className="p-4">
              <div className="pp-kicker text-[var(--color-accent)]">Dashboard</div>
              <h1 className="mt-3 text-2xl font-bold tracking-normal text-[var(--color-text-primary)] md:text-3xl">
                Playoff Pulse
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
                Transparent NBA playoff forecasting built from manual ratings,
                player availability, home court, and Monte Carlo simulation.
              </p>
              <div className="mt-8">
                <div className="pp-kicker text-[var(--color-text-muted)]">
                  Teams in model
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  {playoffConfig.teams.map((team) => {
                    const colors = teamLogoColors[team.id] ?? {
                      background: "var(--color-panel-secondary)",
                      border: "var(--color-border-strong)",
                      color: "var(--color-text-primary)",
                    };
                    const status = teamStatus(team, activeTeamIds);

                    return (
                      <div
                        key={team.id}
                        className={`pp-team-logo-tile ${
                          status === "Elim" ? "pp-team-logo-tile-muted" : ""
                        }`}
                      >
                        <div
                          className="pp-team-logo-mark"
                          style={{
                            background: colors.background,
                            borderColor: colors.border,
                            color: colors.color,
                          }}
                          aria-label={`${team.name} logo mark`}
                        >
                          {team.abbreviation}
                        </div>
                        <div className="min-w-0">
                          <div className="pp-number truncate text-xs font-bold">
                            {team.abbreviation}
                          </div>
                          <div className="pp-kicker mt-1">
                            {team.conference.slice(0, 1)}
                            {team.seed} / {status}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid gap-0 divide-y divide-[var(--color-border-subtle)] sm:grid-cols-3 sm:divide-x sm:divide-y-0 xl:grid-cols-1 xl:divide-x-0 xl:divide-y">
              <div className="p-4">
                <div className="pp-kicker">Last update</div>
                <div className="pp-number mt-2 text-sm font-bold">
                  Data last updated: {formatDataLastUpdated(dataLastUpdated)}
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                  Injury statuses and ratings are manually maintained estimates.
                </p>
              </div>
              <div className="p-4">
                <div className="pp-kicker">Manual input set</div>
                <div className="pp-number mt-2 text-xl font-bold">
                  {playoffConfig.teams.length} teams / {activeSeriesCount} active
                </div>
              </div>
              <div className="p-4">
                <div className="pp-kicker">Market status</div>
                <div className="pp-number mt-2 text-sm font-bold text-[var(--color-warning)]">
                  Calibration planned
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                  No odds feed or betting recommendation is active.
                </p>
              </div>
            </div>
          </div>
        </section>

        <ForecastDashboard />
      </div>
    </main>
  );
}
