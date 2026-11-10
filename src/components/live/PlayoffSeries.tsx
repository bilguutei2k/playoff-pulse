import { TeamLink } from "@/components/live/TeamLink";
import type { PlayoffRound, SeriesForecast } from "@/lib/season/types";
import { formatChance } from "@/lib/utils/format";
import { pairColors, teamDisplay } from "@/lib/view/teams";

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
  const [aColor, bColor] = pairColors(series.homeCourtId, series.otherId);
  const aShare = Math.min(0.99, Math.max(0.01, series.homeCourtSeriesProbability));
  return (
    <li className="border-b border-line py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[14px]">
        <span className="flex items-center gap-2 font-bold">
          <TeamLink teamId={series.homeCourtId} form="code" logo={20} />
          <span className="num px-1 font-normal text-ink-2">
            {series.homeCourtWins}–{series.otherWins}
          </span>
          <TeamLink teamId={series.otherId} form="code" logo={20} />
        </span>
        <span className="text-[13px]">
          {finished ? (
            <>
              <TeamLink teamId={winner.id} form="code" className="font-bold" />{" "}
              <span className="text-ink-2">won the series</span>
            </>
          ) : (
            <>
              <b>
                <TeamLink teamId={favorite.id} form="code" /> {formatChance(chance, { exact: true })}
              </b>{" "}
              <span className="text-ink-2">to win</span>
            </>
          )}
        </span>
      </div>
      {/* Left to right as listed: the home-court team first. */}
      <span aria-hidden className="mt-2 flex h-2.5 gap-0.5">
        <span style={{ width: `${aShare * 100}%`, background: aColor }} />
        <span className="flex-1" style={{ background: bColor }} />
      </span>
    </li>
  );
}

/** Every playoff series from its current score. The team listed first has home court. */
export function PlayoffSeries({ series }: { series: SeriesForecast[] }) {
  return (
    <section aria-labelledby="series-title">
      <div className="sh">
        <h2 id="series-title">Series odds</h2>
        <span>From each current score · home court listed first</span>
      </div>
      <div className="grid gap-x-20 gap-y-8 md:grid-cols-2">
        {ROUNDS.map(({ round, label }) => {
          const rows = series.filter((row) => row.round === round);
          if (rows.length === 0) return null;
          return (
            <div key={round}>
              <h3 className="border-b-2 border-ink pb-2 text-[16px] font-bold">{label}</h3>
              <ul>
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
