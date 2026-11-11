import type { Metadata } from "next";
import Link from "next/link";
import { PageStamp } from "@/components/live/FreshnessGuard";
import { InjuryReport } from "@/components/live/InjuryReport";
import { SectionHeading } from "@/components/live/SectionHeading";
import { getLiveState, getProjections, getTeamInjuryLists } from "@/lib/live-data/published";
import { SEASON_TEAMS } from "@/lib/season/teams";
import { formatReportTime } from "@/lib/utils/dates";
import { buildInjuryReport } from "@/lib/view/injury-report";
import { teamDisplay } from "@/lib/view/teams";
import { Ticker } from "@/components/live/Ticker";

export const metadata: Metadata = {
  title: "Injuries: every team's list for its next game",
  description:
    "Every NBA team's injury list for its next game, from the NBA's public injury report, read unofficially, and from box scores, with the points of margin 548's model counts for each player.",
  alternates: { canonical: "/injuries" },
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
  const [lists, projections, stamp] = await Promise.all([getTeamInjuryLists(), getProjections(), getLiveState()]);
  const view = lists ? buildInjuryReport({ lists, projections }) : null;
  const teams = SEASON_TEAMS.map((team) => teamDisplay(team.id))
    .map((team) => ({ id: team.id, code: team.code, name: team.name, shortName: team.shortName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const latest = view?.latestReportAt ? formatReportTime(view.latestReportAt, "") : null;

  return (
    <>
      <Ticker />
      <PageStamp generatedAt={stamp.generatedAt} />
    <main className="pp-container pb-4 pt-7 sm:pt-11">
      <SectionHeading
        as="h1"
        kicker="Injury lists"
        title="Injuries"
        dek={
          <span className="block max-w-[64ch]">
            Every team&apos;s injury list for its next game, game by game for the next two days with games, then
            every other team.{" "}
            {latest ? <>The newest NBA report in use is from {latest}. </> : null}
            Lists update about every ten minutes.
          </span>
        }
      />

      <div className="mt-8">
        {view ? (
          view.slates.length === 0 && view.others.length === 0 ? (
            <p className="notice-quiet">No team has a game scheduled, so there are no injury lists.</p>
          ) : (
            <InjuryReport
              view={view}
              teams={teams}
              caveat={
                <>
                  These lists are projections, not sealed forecasts: a game&apos;s seals count the report in use when
                  they are made. The model does not foresee new injuries, shift minutes to teammates or model
                  matchups. The injury reports are the NBA&apos;s public documents, read unofficially.{" "}
                  <Link href="/how-it-works#injuries" className="pp-link">How injuries work</Link>
                </>
              }
              definitions={
                <dl className="grid gap-x-10 gap-y-3 text-13 leading-5 text-ink-2 md:grid-cols-2">
                  {SOURCES.map(([term, definition]) => (
                    <div key={term} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-t border-line pt-3">
                      <dt className="font-semibold text-ink">{term}</dt>
                      <dd>{definition}</dd>
                    </div>
                  ))}
                </dl>
              }
            />
          )
        ) : (
          <div>
            <p className="notice-quiet">
              The injury lists are not published yet. They appear here once 548 publishes them. Each game
              page still lists the players its sealed forecast counts.
            </p>
            <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-14">
              <Link className="pp-link" href="/">Today&apos;s games</Link>
              <Link className="pp-link" href="/odds#absences-title">Who the model counts as out</Link>
            </p>
          </div>
        )}
      </div>
    </main>
    </>
  );
}
