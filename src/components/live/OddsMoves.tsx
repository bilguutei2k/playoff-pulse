import { TeamLink } from "@/components/live/TeamLink";
import { formatShortDay } from "@/lib/utils/dates";
import { formatChance, formatPointChange } from "@/lib/utils/format";
import type { OddsMove, OddsMoves as Moves } from "@/lib/view/odds-moves";

/** "after beating the Celtics 113–106": the winner's score first. Placed beside the move, never as its cause. */
function After({ move }: { move: OddsMove }) {
  const game = move.game;
  if (!game) return null;
  const high = Math.max(game.teamScore, game.opponentScore);
  const low = Math.min(game.teamScore, game.opponentScore);
  return (
    <span className="block text-[13px] leading-5 text-ink-2">
      after {game.won ? "beating" : "losing to"} the <TeamLink teamId={game.opponentId} form="short" />{" "}
      <span className="tabular">
        {high}–{low}
      </span>
    </span>
  );
}

function MoveList({ title, moves }: { title: string; moves: OddsMove[] }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-[13px] font-medium text-ink-2">{title}</h3>
      {moves.length === 0 ? (
        <p className="border-t border-ink py-3 text-[14px] text-ink-2">No team moved a point or more.</p>
      ) : (
        <ul className="border-t border-ink">
          {moves.map((move) => (
            <li key={move.teamId} className="flex items-start justify-between gap-4 border-b border-line py-2.5">
              <span className="min-w-0">
                <TeamLink teamId={move.teamId} form="short" logo={18} className="font-bold" />
                <After move={move} />
              </span>
              <span className="whitespace-nowrap text-right">
                <b className="tabular text-[15px] font-bold">{formatChance(move.now)}</b>
                <span className="tabular block text-[13px] text-ink-2">
                  {formatPointChange(move.change)} pts
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The biggest playoff-odds moves across one slate: the latest once it has a final ("since"),
 * the one before it until then ("day"), so a morning reader sees what last night did.
 */
export function OddsMoves({ moves }: { moves: Moves }) {
  const day = moves.kind === "day";
  return (
    <section aria-labelledby="moves-title">
      <div className="sh">
        <h2 id="moves-title">{day ? `Biggest moves on ${formatShortDay(moves.to)}` : `Biggest moves since ${formatShortDay(moves.from)}`}</h2>
        <span>Playoff odds</span>
      </div>
      <div className="grid gap-x-14 gap-y-8 sm:grid-cols-2">
        <MoveList title="Up" moves={moves.rises} />
        <MoveList title="Down" moves={moves.falls} />
      </div>
      <p className="mt-3 text-[13px] leading-5 text-ink-2">
        {day ? (
          <>
            Playoff odds at the last forecast of {formatShortDay(moves.to)} and the change in percentage points from the
            last forecast of {formatShortDay(moves.from)}; moves under one point are left out. Today&apos;s games have
            not finished, so these are the latest full day&apos;s moves, and the table above has today&apos;s odds. A
            result is the team&apos;s game that day, set beside the move, not named as its cause.
          </>
        ) : (
          <>
            Playoff odds now and the change in percentage points from the last forecast of {formatShortDay(moves.from)},
            which counted that day&apos;s games; moves under one point are left out. A result is the team&apos;s game
            since then, set beside the move, not named as its cause.
          </>
        )}
      </p>
    </section>
  );
}
