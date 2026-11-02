import Link from "next/link";

const LEDGER_URL = "https://github.com/bilguutei2k/playoff-pulse/tree/main/data/live/ledger";

const LIVE_LINKS = [
  { href: "/", label: "Today's games" },
  { href: "/odds", label: "Season odds" },
  { href: "/how-it-works", label: "How it works" },
];

const ARCHIVE_LINKS = [
  { href: "/retrospective", label: "Retrospective" },
  { href: "/snapshot", label: "Final 2026 snapshot" },
  { href: "/evidence", label: "Evidence" },
  { href: "/methodology", label: "2026 methodology" },
  { href: "/lab", label: "Scenario lab" },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)]">
      <div className="pp-container grid gap-8 py-10 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="max-w-md">
          <p className="font-semibold text-[var(--color-text-primary)]">Playoff Pulse</p>
          <p className="mt-2 leading-6 text-[var(--color-text-muted)]">
            An independent project. Team names and logos are trademarks of the NBA and its teams;
            Playoff Pulse is not affiliated with or endorsed by them. Live scores, schedules,
            injuries and market lines come from ESPN&apos;s unofficial public feeds, and injury
            statuses from the NBA&apos;s public injury report, used unofficially. Not a betting
            product.
          </p>
        </div>
        <nav aria-label="Live forecast">
          <p className="font-semibold text-[var(--color-text-primary)]">Live forecast</p>
          <ul className="mt-2 grid gap-1.5">
            {LIVE_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                >
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <a href={LEDGER_URL} className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]">
                Forecast ledger on GitHub
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="2026 archive">
          <p className="font-semibold text-[var(--color-text-primary)]">2026 archive</p>
          <ul className="mt-2 grid gap-1.5">
            {ARCHIVE_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
