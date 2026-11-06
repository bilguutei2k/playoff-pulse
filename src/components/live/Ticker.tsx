import Link from "next/link";
import { TeamLogo } from "@/components/live/TeamLogo";
import { Tile } from "@/components/live/Tile";
import { loadDayView, todayEtDate } from "@/lib/live-data/day-loader";
import { getLiveState } from "@/lib/live-data/published";
import { bracketView, type BracketSide } from "@/lib/view/bracket";
import type { DayGame } from "@/lib/view/day";
import { teamLines } from "@/lib/view/teams";

const SHOWN = 8;
/** Items past the fourth fold away as the screen narrows; below 768 px the strip hides. */
const VISIBILITY = ["flex", "flex", "flex", "flex", "hidden lg:flex", "hidden lg:flex", "hidden xl:flex", "hidden xl:flex"];

const ORDER: Record<DayGame["status"], number> = { "in-progress": 0, scheduled: 1, final: 2, postponed: 3, canceled: 3 };

/** Live games first, then the next to tip, then the latest finals. */
function tickerOrder(games: readonly DayGame[]): DayGame[] {
  return [...games].sort((a, b) => {
    const rank = ORDER[a.status] - ORDER[b.status];
    if (rank !== 0) return rank;
    const tip = Date.parse(a.tipUtc) - Date.parse(b.tipUtc);
    return a.status === "final" ? -tip : tip;
  });
}

function Row({ side }: { side: BracketSide }) {
  return (
    <span className={`grid grid-cols-[auto_1fr_auto] items-center gap-1.5 text-[13px] ${side.dim ? "text-ink-2" : ""}`}>
      <TeamLogo teamId={side.teamId} size={14} />
      <span>{side.code}</span>
      <b className="num font-bold">{side.score ?? ""}</b>
    </span>
  );
}

/**
 * Today's games in a strip under the masthead on the inner pages: status, both teams
 * with their scores, and 548's tile. The day page has the days row instead.
 */
export async function Ticker() {
  const today = todayEtDate();
  const [view, liveState] = await Promise.all([loadDayView(today), getLiveState()]);
  if (view.games.length === 0) return null;
  const lines = teamLines(liveState);
  const games = tickerOrder(view.games).slice(0, SHOWN);
  return (
    <nav aria-label="Today's games" className="hidden border-b border-line md:block">
      <div className="pp-container flex items-start gap-[34px] py-3">
        <ul className="flex min-w-0 flex-1 items-start gap-[34px] overflow-hidden">
          {games.map((game, index) => {
            const card = bracketView({ game, lines, modelVersion: view.modelVersion });
            const { status, tile } = card;
            return (
              <li key={game.id} className={VISIBILITY[index]}>
                <Link
                  href={`/game/${game.id}`}
                  className="flex w-24 flex-col gap-[3px] hover:opacity-80"
                  aria-label={`${card.away.shortName} at ${card.home.shortName}, ${status.lead}${status.detail ? ` ${status.detail}` : ""}`}
                >
                  <span className="truncate text-[13px] leading-5">
                    <b className="font-bold">{status.lead}</b>
                    {status.detail && game.status !== "final" ? <span className="text-ink-2"> {status.detail.replace(" · ", " ")}</span> : null}
                    {game.status === "final" && /OT/.test(status.detail ?? "") ? <span className="text-ink-2"> OT</span> : null}
                  </span>
                  <Row side={card.away} />
                  <Row side={card.home} />
                  <span className="mt-1">
                    {tile.kind === "none" ? (
                      <span className="flex h-[22px] items-center text-[12.5px] text-ink-2">{tile.text}</span>
                    ) : (
                      <Tile kind={tile.kind} size="xs" className="w-full">
                        {tile.code} {tile.percent}%
                      </Tile>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <Link href="/" className="shrink-0 self-center text-[13px] font-bold hover:underline hover:underline-offset-4">
          All {view.games.length} games
        </Link>
      </div>
    </nav>
  );
}
