import Link from "next/link";
import { AutoRefresh } from "@/components/live/AutoRefresh";
import { TeamLink } from "@/components/live/TeamLink";
import { Tile } from "@/components/live/Tile";
import { loadDayView, todayEtDate } from "@/lib/live-data/day-loader";
import { getLiveState } from "@/lib/live-data/published";
import { bracketView, type BracketSide, type BracketView } from "@/lib/view/bracket";
import type { DayGame } from "@/lib/view/day";
import { gameHref } from "@/lib/view/routes";
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

/**
 * The status line, time or state only: "7:30 PM ET", "Live 3rd 4:12", "Final OT".
 * The broadcast list the card shows is left out; it does not fit a ticker cell.
 */
function statusText(game: DayGame, status: BracketView["status"]): { lead: string; detail: string | null } {
  switch (game.status) {
    case "scheduled":
      return { lead: `${status.lead} ET`, detail: null };
    case "in-progress":
      return { lead: status.lead, detail: status.detail ? status.detail.replace(" · ", " ") : null };
    case "final":
      return { lead: status.lead, detail: /OT/.test(status.detail ?? "") ? (status.detail ?? "").split(" · ")[0] : null };
    default:
      return { lead: status.lead, detail: null };
  }
}

function Row({ side }: { side: BracketSide }) {
  return (
    <span className={`flex items-center justify-between gap-1.5 text-[13px] ${side.dim ? "text-ink-2" : ""}`}>
      <TeamLink teamId={side.teamId} form="code" logo={14} raised className="min-h-5" />
      <b className="num font-bold">{side.score ?? ""}</b>
    </span>
  );
}

/**
 * Today's games in a strip under the masthead on the inner pages: status, both teams
 * with their scores, and 548's tile. Each team is a link to its page; the status line
 * is the cell's game link, and its cover makes the rest of the cell (scores, tile)
 * open the game too, with the team links raised above it. While a game is live the
 * page re-renders every minute so the scores move (a page that also mounts its own
 * AutoRefresh would refresh twice; the day and game pages show no ticker).
 * The day page has the days row instead.
 */
export async function Ticker() {
  const today = todayEtDate();
  const [view, liveState] = await Promise.all([loadDayView(today), getLiveState()]);
  if (view.games.length === 0) return null;
  const lines = teamLines(liveState);
  const games = tickerOrder(view.games).slice(0, SHOWN);
  const anyLive = view.games.some((game) => game.status === "in-progress");
  return (
    <nav aria-label="Today's games" className="hidden border-b border-line md:block">
      <div className="pp-container flex items-start gap-[30px] py-3">
        <ul className="flex min-w-0 flex-1 items-start gap-[30px] overflow-hidden">
          {games.map((game, index) => {
            const card = bracketView({ game, lines, modelVersion: view.modelVersion });
            const { tile } = card;
            const status = statusText(game, card.status);
            return (
              <li key={game.id} className={`relative w-[104px] flex-none flex-col gap-[3px] ${VISIBILITY[index]}`}>
                <Link
                  href={gameHref(game.id)}
                  className="text-[13px] leading-5 after:absolute after:inset-0 hover:underline hover:underline-offset-4"
                  aria-label={`${card.away.shortName} at ${card.home.shortName}, ${status.lead}${status.detail ? ` ${status.detail}` : ""}: game details`}
                >
                  <b className="font-bold">{status.lead}</b>
                  {status.detail ? <span className="text-ink-2"> {status.detail}</span> : null}
                </Link>
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
              </li>
            );
          })}
        </ul>
        <Link href="/" className="inline-flex min-h-11 shrink-0 items-center self-center text-[13px] font-bold hover:underline hover:underline-offset-4">
          All {view.games.length} games
        </Link>
      </div>
      {anyLive ? <AutoRefresh live /> : null}
    </nav>
  );
}
