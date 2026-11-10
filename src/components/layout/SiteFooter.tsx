import Link from "next/link";
import { getLiveState } from "@/lib/live-data/published";
import { LIVE_MODEL_VERSION, REFERENCE_MODEL_VERSION } from "@/lib/season/params";
import { currentPolicyRevision } from "@/lib/season/policy-revisions";

const REPO_URL = "https://github.com/bilguutei2k/playoff-pulse";
const LEDGER_URL = `${REPO_URL}/tree/live-data/data/live/ledger`;
export const ISSUES_URL = `${REPO_URL}/issues`;

const FORECAST_LINKS = [
  { href: "/", label: "Games" },
  { href: "/odds", label: "Odds" },
  { href: "/injuries", label: "Injuries" },
  { href: "/players", label: "Players" },
  { href: "/teams", label: "Teams" },
  { href: "/record", label: "Record" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
];

const ARCHIVE_LINKS = [
  { href: "/retrospective", label: "Retrospective" },
  { href: "/snapshot", label: "Final 2026 snapshot" },
  { href: "/evidence", label: "Evidence" },
  { href: "/methodology", label: "2026 methodology" },
  { href: "/lab", label: "Scenario lab" },
];

/** What each live model is, in a reader's words; any other version shows as it is. */
const MODEL_WORDS: Record<string, string> = {
  [LIVE_MODEL_VERSION]: "team ratings plus injuries",
  [REFERENCE_MODEL_VERSION]: "team ratings only",
};

/** "v2" from "live-2026.27-v2"; the full version goes in the tooltip. */
function shortVersion(version: string): string {
  return MODEL_WORDS[version] ? (version.split("-").at(-1) ?? version) : version;
}

/** Inline links get a taller hit area without moving the text (VA-18). */
const PROSE_LINK = "py-3 text-ink underline underline-offset-4 hover:decoration-2";
const LINK = "inline-flex min-h-11 items-center hover:text-ink hover:underline hover:underline-offset-4 lg:min-h-0";

function LinkRow({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label={title} className="flex flex-wrap items-center gap-x-5 lg:gap-y-1">
      <h2 className="w-full font-semibold text-ink sm:w-auto">{title}</h2>
      {links.map(({ href, label }) => (
        <Link key={href} href={href} className={LINK}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * One grey line of notices and sources, as in v8, then the model in plain words (the
 * published version and its policy revision stay on every page), then the links.
 */
export async function SiteFooter() {
  const liveState = await getLiveState();
  const version = liveState.modelVersion;
  const revision = currentPolicyRevision(version, liveState.generatedAt);
  const reference = liveState.referenceModelVersion;
  const sameModel = reference === version;
  return (
    <footer className="mt-12 sm:mt-[72px]">
      <div className="pp-container grid gap-4 pb-12 text-[13px] leading-5 text-ink-2">
        <p>
          Not betting advice. Not affiliated with or endorsed by the NBA or its teams; team names and logos are
          their trademarks. Scores ESPN · Injuries NBA report, read unofficially · Market DraftKings via ESPN, vig
          removed.
        </p>
        <p>
          Forecasts by model{" "}
          <span className="text-ink" title={version}>
            {shortVersion(version)}
          </span>
          {MODEL_WORDS[version] ? ` (${MODEL_WORDS[version]})` : null}
          {revision !== null ? (
            <>
              ,{" "}
              <Link href="/how-it-works#policy-revisions" className={PROSE_LINK}>
                policy revision {revision}
              </Link>
            </>
          ) : null}
          {sameModel ? null : (
            <>
              ; model <span title={reference}>{shortVersion(reference)}</span>
              {MODEL_WORDS[reference] ? ` (${MODEL_WORDS[reference]})` : null} keeps sealing beside it as a reference
            </>
          )}
          . Every forecast is in the{" "}
          <a href={LEDGER_URL} className={PROSE_LINK}>
            public ledger on GitHub
          </a>
          . Spotted an error?{" "}
          <a href={ISSUES_URL} className={PROSE_LINK}>
            Open an issue
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
