import Link from "next/link";
import { Brand548 } from "@/components/brand/Brand548";
import { getLiveState } from "@/lib/live-data/published";

const LEDGER_URL = "https://github.com/bilguutei2k/playoff-pulse/tree/live-data/data/live/ledger";

const FORECAST_LINKS = [
  { href: "/", label: "Today's games" },
  { href: "/odds", label: "Playoff and title odds" },
  { href: "/teams", label: "Teams" },
  { href: "/record", label: "Track record" },
  { href: "/how-it-works", label: "How it works" },
];

const ARCHIVE_LINKS = [
  { href: "/retrospective", label: "Retrospective" },
  { href: "/snapshot", label: "Final 2026 snapshot" },
  { href: "/evidence", label: "Evidence" },
  { href: "/methodology", label: "2026 methodology" },
  { href: "/lab", label: "Scenario lab" },
];

const SOURCES = [
  "Schedules, scores and box scores: ESPN's public feeds",
  "Player availability: the NBA's public injury reports, read unofficially",
  "Market reference: DraftKings lines via ESPN, vig removed",
];

function LinkColumn({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label={title}>
      <h2 className="kicker">{title}</h2>
      <ul className="mt-3 grid gap-2">
        {links.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} className="text-ink-2 hover:text-ink hover:underline hover:decoration-pulse hover:underline-offset-4">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export async function SiteFooter() {
  const liveState = await getLiveState();
  const sameModel = liveState.referenceModelVersion === liveState.modelVersion;
  return (
    <footer className="mt-20 border-t border-line bg-panel">
      <div className="pp-container grid gap-10 py-12 text-[14px] md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <div className="max-w-sm">
          <div className="flex items-center gap-3">
            <Brand548 size={32} />
            <p className="font-semibold text-ink">NBA forecasts, updated through the day.</p>
          </div>
          <p className="mt-4 leading-6 text-ink-2">
            For information only. 548 is an independent project and is not affiliated with or
            endorsed by the NBA or its teams. Team names and logos are their trademarks. Nothing
            here is betting advice.
          </p>
          <p className="mt-4 text-[13px] leading-5 text-ink-3">
            Published model <span className="num text-ink-2">{liveState.modelVersion}</span>
            {sameModel ? null : (
              <>
                {" "}
                with <span className="num text-ink-2">{liveState.referenceModelVersion}</span> still
                sealing beside it
              </>
            )}
            .
          </p>
        </div>
        <LinkColumn title="Forecast" links={FORECAST_LINKS} />
        <LinkColumn title="2026 archive" links={ARCHIVE_LINKS} />
        <div>
          <h2 className="kicker">Data</h2>
          <ul className="mt-3 grid gap-2 text-ink-2">
            {SOURCES.map((source) => (
              <li key={source} className="leading-5">
                {source}
              </li>
            ))}
            <li>
              <a href={LEDGER_URL} className="pp-link">
                The forecast ledger on GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
