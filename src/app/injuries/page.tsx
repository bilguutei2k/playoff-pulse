import type { Metadata } from "next";
import Link from "next/link";
import { InjuryReport } from "@/components/live/InjuryReport";
import { SectionHeading } from "@/components/live/SectionHeading";
import { getProjections, getTeamInjuryLists } from "@/lib/live-data/published";
import { SEASON_TEAMS } from "@/lib/season/teams";
import { formatReportTime } from "@/lib/utils/dates";
import { buildInjuryReport } from "@/lib/view/injury-report";
import { teamDisplay } from "@/lib/view/teams";
import { Ticker } from "@/components/live/Ticker";

export const metadata: Metadata = {
  title: "NBA injury report",
  description:
    "Every NBA team's injury list for its next game, from the NBA's injury report and from box scores, with the points of margin 548's model counts for each player.",
};

// Re-rendered about once a minute from the published data (src/lib/live-data/published.ts).
export const revalidate = 60;

const SOURCES: Array<[string, string]> = [
  ["NBA report", "Status and reason as printed on the NBA's injury report covering the game, with the report's time."],
  [
    "Box scores",
    "The model's inference, not the report: he missed his team's recent games and is not on the report. On a team that has filed he counts 0 points, as at a seal; on a team that has not, he counts as out.",
  ],
  ["Earlier report", "Listed out or doubtful on the team's latest earlier report, when no report covers this game yet."],
  [
    "548 pts",
    "Points of margin the model takes off his team for this game: his 548 impact weighted by his status. The model's estimate, not validated per player.",
  ],
];

export default async function InjuriesPage() {
  const [lists, projections] = await Promise.all([getTeamInjuryLists(), getProjections()]);
  const view = lists ? buildInjuryReport({ lists, projections }) : null;
  const teams = SEASON_TEAMS.map((team) => teamDisplay(team.id))
    .map((team) => ({ id: team.id, code: team.code, name: team.name, shortName: team.shortName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const latest = view?.latestReportAt ? formatReportTime(view.latestReportAt, "") : null;

  return (
    <>
      <Ticker />
    <main className="pp-container pb-4 pt-7 sm:pt-11">
      <SectionHeading
        as="h1"
        kicker="Injury report"
        title="Injuries"
        dek={
          <>
            Every team&apos;s injury list for its next game, game by game for the next two days with games, then
            every other team.{" "}
            {latest ? <>The newest NBA report in use is from {latest}. </> : null}
            Lists update with each run of the forecast job, about every ten minutes.
          </>
        }
      />

      <section aria-labelledby="sources-title" className="mt-6">
        <h2 id="sources-title" className="sr-only">What each part means</h2>
        <dl className="grid gap-x-8 gap-y-3 rounded-[var(--radius-card)] border border-line bg-panel p-4 text-[13px] leading-5 text-ink-2 sm:p-5 md:grid-cols-2">
          {SOURCES.map(([term, definition]) => (
            <div key={term} className="flex gap-3">
              <dt className="w-24 shrink-0 text-[13px] font-bold leading-5 text-ink">{term}</dt>
              <dd>{definition}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12.5px] leading-5 text-ink-3">
          These lists are projections, not sealed forecasts: a game&apos;s seals count the report in use when they are
          made. The model does not foresee new injuries, shift minutes to teammates or model matchups. The injury
          reports are the NBA&apos;s public documents, read unofficially.{" "}
          <Link href="/how-it-works#injuries" className="pp-link">How injuries work</Link>
        </p>
      </section>

      <div className="mt-8">
        {view ? (
          view.slates.length === 0 && view.others.length === 0 ? (
            <p className="notice-quiet">No team has a game scheduled, so there are no injury lists.</p>
          ) : (
            <InjuryReport view={view} teams={teams} />
          )
        ) : (
          <div className="panel px-6 py-10 text-center">
            <p className="headline text-[22px]">The injury lists are not published yet</p>
            <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-2">
              They appear here once the forecast job publishes them. Each game page still lists the players its
              sealed forecast counts.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3 text-[14px]">
              <Link className="pp-button" href="/">Today&apos;s games</Link>
              <Link className="pp-button" href="/odds#absences-title">Who the model counts as out</Link>
            </div>
          </div>
        )}
      </div>
    </main>
    </>
  );
}
