import Link from "next/link";
import { getLiveState } from "@/lib/live-data/published";

const LEDGER_URL = "https://github.com/bilguutei2k/playoff-pulse/tree/live-data/data/live/ledger";

const FORECAST_LINKS = [
  { href: "/", label: "Games" },
  { href: "/odds", label: "Odds" },
  { href: "/injuries", label: "Injuries" },
  { href: "/players", label: "Players" },
  { href: "/teams", label: "Teams" },
  { href: "/record", label: "Record" },
  { href: "/how-it-works", label: "Method" },
];

const ARCHIVE_LINKS = [
  { href: "/retrospective", label: "Retrospective" },
  { href: "/snapshot", label: "Final 2026 snapshot" },
  { href: "/evidence", label: "Evidence" },
  { href: "/methodology", label: "2026 methodology" },
  { href: "/lab", label: "Scenario lab" },
];

function LinkRow({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label={title} className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
      <h2 className="font-semibold text-ink">{title}</h2>
      {links.map(({ href, label }) => (
        <Link key={href} href={href} className="hover:text-ink hover:underline hover:underline-offset-4">
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** One grey line of notices and sources, as in v8, then the links. */
export async function SiteFooter() {
  const liveState = await getLiveState();
  const sameModel = liveState.referenceModelVersion === liveState.modelVersion;
  return (
    <footer className="mt-12 sm:mt-[72px]">
      <div className="pp-container grid gap-4 pb-12 text-[13px] leading-5 text-ink-2">
        <p>
          Not betting advice. Not affiliated with or endorsed by the NBA or its teams; team names and logos are
          their trademarks. Scores ESPN · Injuries NBA report, read unofficially · Market DraftKings via ESPN, vig
          removed.
        </p>
        <p>
          Published model <span className="num text-ink">{liveState.modelVersion}</span>
          {sameModel ? null : (
            <>
              {" "}
              with <span className="num text-ink">{liveState.referenceModelVersion}</span> still sealing beside it
            </>
          )}
          . Every forecast is in the{" "}
          <a href={LEDGER_URL} className="text-ink underline underline-offset-4 hover:decoration-2">
            public ledger on GitHub
          </a>
          .
        </p>
        <div className="grid gap-2 border-t border-line pt-4">
          <LinkRow title="548" links={FORECAST_LINKS} />
          <LinkRow title="2026 archive" links={ARCHIVE_LINKS} />
        </div>
      </div>
    </footer>
  );
}
