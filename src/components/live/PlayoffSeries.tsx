import { SectionHeading } from "@/components/live/SectionHeading";
import { SplitBar } from "@/components/live/SplitBar";
import { TeamLogo } from "@/components/live/TeamLogo";
import type { PlayoffRound, SeriesForecast } from "@/lib/season/types";
import { formatChance } from "@/lib/utils/format";
import { teamDisplay } from "@/lib/view/teams";

const ROUNDS: Array<{ round: PlayoffRound; label: string }> = [
  { round: "finals", label: "NBA Finals" },
  { round: "conference-final", label: "Conference finals" },
  { round: "conference-semifinal", label: "Conference semifinals" },
  { round: "first-round", label: "First round" },
];

function SeriesRow({ series }: { series: SeriesForecast }) {
  const a = teamDisplay(series.homeCourtId);
  const b = teamDisplay(series.otherId);
  const finished = series.homeCourtWins >= 4 || series.otherWins >= 4;
  const aLeads = series.homeCourtSeriesProbability >= 0.5;
  const favorite = aLeads ? a : b;
  const chance = aLeads ? series.homeCourtSeriesProbability : 1 - series.homeCourtSeriesProbability;
  const winner = series.homeCourtWins >= 4 ? a : b;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[14px]">
        <span className="flex items-center gap-2 font-medium text-ink">
          <TeamLogo teamId={series.homeCourtId} size={20} />
          {a.code}
          <span className="num rounded bg-wash px-1.5 py-0.5 font-semibold">
            {series.homeCourtWins}–{series.otherWins}
          </span>
          {b.code}
          <TeamLogo teamId={series.otherId} size={20} />
        </span>
        <span className="num text-[12px] text-ink-2">
          {finished
            ? `${winner.code} won the series`
            : `${favorite.code} ${formatChance(chance, { exact: true })} to win`}
        </span>
      </div>
      <div className="mt-2">
        {/* Left to right as listed: the home-court team first. */}
        <SplitBar awayId={series.homeCourtId} homeId={series.otherId} homeProbability={1 - series.homeCourtSeriesProbability} />
      </div>
    </li>
  );
}

export function PlayoffSeries({ series }: { series: SeriesForecast[] }) {
  return (
    <section aria-labelledby="series-title">
      <SectionHeading
        id="series-title"
        kicker="Playoffs"
        title="Series odds"
        dek="Each series from its current score. The team listed first has home court."
      />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {ROUNDS.map(({ round, label }) => {
          const rows = series.filter((row) => row.round === round);
          if (rows.length === 0) return null;
          return (
            <div key={round} className="panel px-4 pt-3">
              <h3 className="kicker">{label}</h3>
              <ul className="divide-y divide-line">
                {rows.map((row) => (
                  <SeriesRow key={row.id} series={row} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
