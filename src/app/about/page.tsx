import type { Metadata } from "next";
import Link from "next/link";
import { ISSUES_URL } from "@/components/layout/SiteFooter";
import { PageStamp } from "@/components/live/FreshnessGuard";

// Every statement here follows AGENTS.md and the live section of docs/claims-ledger.md:
// no performance figures, no claim of official data, no affiliation, no betting framing.

const LEDGER_URL = "https://github.com/bilguutei2k/playoff-pulse/tree/live-data/data/live/ledger";

export const metadata: Metadata = {
  title: "About",
  description:
    "What 548 is: a win probability for every NBA game, sealed before tip and scored in public, with playoff and title odds for all 30 teams.",
  alternates: { canonical: "/about" },
};

/** One section: an ink rule, the heading in its own column from 1024 px, then the text. */
function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-x-12 gap-y-3 border-t-2 border-ink pt-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:pt-5"
    >
      <h2 id={id} className="headline text-21">
        {title}
      </h2>
      <div className="grid max-w-[64ch] gap-4 text-[16px] leading-7 text-ink">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <main className="pp-container pb-4 pt-7 sm:pt-11">
      <PageStamp generatedAt={null} />
      <header className="max-w-3xl pb-10 sm:pb-14">
        <p className="text-15 text-ink-2">About</p>
        <h1 className="headline mt-2.5 text-32 sm:text-46">Every NBA game, forecast before tip and scored in public</h1>
        <p className="mt-4 max-w-[60ch] text-[17px] leading-7 text-ink-2">
          548 puts a win probability on every game, playoff and title odds on all 30 teams, and its own record on the
          line. It updates automatically through the day.
        </p>
      </header>

      <div className="grid gap-10 sm:gap-12">
        <Block id="what-title" title="What it is">
          <p>
            548 is an independent NBA forecast, live since November 2026. Every game gets a chance of each team winning,
            built from injury-adjusted team ratings, home court, rest and the players on the NBA injury report. The same
            ratings simulate the rest of the season for every team&apos;s{" "}
            <Link href="/odds" className="pp-link">
              playoff and title odds
            </Link>
            . During a game, a live estimate follows the score and the clock.
          </p>
        </Block>

        <Block id="sealed-title" title="Sealed, then scored">
          <p>
            Only a forecast sealed before tip is scored. Each game is sealed twice: in the morning,
            and again in the hour before tip. The final seal is the one scored against the result, in a{" "}
            <Link href="/record" className="pp-link">
              public track record
            </Link>
            .
          </p>
          <p>
            Seals are never edited or backfilled. A game that tips without one is counted as missed, and the record
            shows it. Every sealed forecast is written to an append-only{" "}
            <a href={LEDGER_URL} className="pp-link">
              ledger on GitHub
            </a>
            . Early in the season the sample is small, and the record says so.
          </p>
        </Block>

        <Block id="data-title" title="Where the data comes from">
          <p>
            Scores, schedules and box scores come from ESPN&apos;s public feeds. Injury statuses come from the NBA&apos;s
            public injury report. The DraftKings line, via ESPN, appears beside some games as a market reference only;
            it never feeds the forecast.
          </p>
          <p>
            548 reads these sources unofficially, without any arrangement with their owners. It is not affiliated with
            or endorsed by the NBA or its teams; team names and logos are their trademarks.
          </p>
        </Block>

        <Block id="not-title" title="What it is not">
          <p>
            548 is not betting advice, and it does not make picks. Its numbers are a model&apos;s estimates with known
            limits: it does not foresee injuries that have not happened, how minutes shift between teammates, or
            matchups.{" "}
            <Link href="/how-it-works" className="pp-link">
              How it works
            </Link>{" "}
            explains the model, what it leaves out and its known issues.
          </p>
          <p>
            Before the live forecast, 548 forecast the 2026 playoffs from hand-entered data. That work is kept as a
            frozen{" "}
            <Link href="/retrospective" className="pp-link">
              2026 archive
            </Link>
            .
          </p>
        </Block>

        <Block id="contact-title" title="Contact">
          <p>
            Found a mistake, or a number that looks wrong?{" "}
            <a href={ISSUES_URL} className="pp-link">
              Open an issue on GitHub
            </a>
            . The code and the full forecast ledger are public there too.
          </p>
        </Block>
      </div>
    </main>
  );
}
