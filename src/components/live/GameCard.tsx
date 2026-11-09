import Link from "next/link";
import { TeamLogo } from "@/components/live/TeamLogo";
import { Tile } from "@/components/live/Tile";
import { bracketView, outPoints, type BracketSide, type BracketView } from "@/lib/view/bracket";
import type { DayGame } from "@/lib/view/day";
import { OUT_DEFINITION, tileHelp } from "@/lib/view/how-to-read";
import { pairColors, type TeamLine } from "@/lib/view/teams";

function Arm({ side, color, large }: { side: BracketSide; color: string; large: boolean }) {
  return (
    <div className={`arm ${side.dim ? "arm-lo" : ""}`}>
      <span className="arm-logo">
        <TeamLogo teamId={side.teamId} size={large ? 36 : 20} />
      </span>
      <span className="arm-t">
        {large ? (
          <>
            <span className="sm:hidden">{side.shortName}</span>
            <span className="hidden sm:inline">{side.name}</span>
          </>
        ) : (
          side.shortName
        )}
      </span>
      <span className="arm-r">{side.record ?? ""}</span>
      <span className="arm-sc">{side.score ?? ""}</span>
      <span aria-hidden className="arm-ln">
        {side.percent !== null ? <i style={{ width: `${side.percent}%`, background: color }} /> : null}
        {side.marketPercent !== null ? (
          <b className="mk" style={{ left: `calc(${side.marketPercent}% - 1px)` }} />
        ) : null}
        {side.pregamePercent !== null ? <b style={{ left: `calc(${side.pregamePercent}% - 1px)` }} /> : null}
      </span>
    </div>
  );
}

/** The two arms, the bracket and the tile. Shared by the card and the game page header. */
export function Bracket({ view, large = false }: { view: BracketView; large?: boolean }) {
  const [awayColor, homeColor] = pairColors(view.away.teamId, view.home.teamId);
  const { tile } = view;
  return (
    <div className={`bk ${view.dashed ? "bk-dash" : ""} ${large ? "bk-l" : ""}`}>
      <div className="min-w-0">
        <Arm side={view.away} color={awayColor} large={large} />
        <Arm side={view.home} color={homeColor} large={large} />
      </div>
      <div aria-hidden className="bk-j" />
      <div className="bk-o">
        <span aria-hidden className="bk-stem" />
        {tile.kind === "none" ? (
          <span className="bk-none">{tile.text}</span>
        ) : (
          <>
            <Tile kind={tile.kind}>{tile.percent}%</Tile>
            <span className="bk-who">
              <b>{tile.code}</b>
              <span>{tile.label}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** The context row: absences first, then the market in grey, or the pregame seal on a live game. */
export function BracketContext({ view, marketLabel = "Market" }: { view: BracketView; marketLabel?: string }) {
  const parts: React.ReactNode[] = [];
  if (view.pregame) {
    parts.push(
      <span key="pregame">
        <span aria-hidden className="gc-key" />
        Pregame seal <b>{view.pregame.code} {view.pregame.percent}%</b>
      </span>,
    );
  }
  for (const note of view.notes) parts.push(<span key={note}>{note}</span>);
  if (view.out.length > 0 || view.unfiled.length > 0) {
    // "Out DET −5.4 pts": points of margin, so the figure is not read as a count of players.
    parts.push(
      <span key="out" title={OUT_DEFINITION}>
        Out{" "}
        {view.out.map((side, index) => (
          <span key={side.code}>
            {index > 0 ? " " : ""}
            <b>
              {side.code} {outPoints(side.points)}
            </b>
          </span>
        ))}
        {view.out.length > 0 ? " pts" : null}
        {view.unfiled.map((code) => (
          <span key={code}> · {code} not filed</span>
        ))}
      </span>,
    );
  }
  if (view.market === "none") {
    parts.push(
      <span key="market">
        {marketLabel} <b>no line yet</b>
      </span>,
    );
  } else if (view.market) {
    parts.push(
      <span key="market">
        <span aria-hidden className="gc-key mk" />
        {marketLabel} <b>{view.market.code} {view.market.percent}%</b>
      </span>,
    );
  }
  if (parts.length === 0) return null;
  return <div className="gc-cx">{parts}</div>;
}

/** A sentence for screen readers: the card's lines and tile are decorative. */
function cardLabel(view: BracketView): string {
  const { away, home, tile } = view;
  const scores = away.score !== null && home.score !== null ? `, ${away.score} to ${home.score}` : "";
  const number = tile.kind === "none" ? tile.text : `548 ${tile.label}: ${tile.code} ${tile.percent}%`;
  return `${away.shortName} at ${home.shortName}${scores}. ${view.status.lead}. ${number}. Game details`;
}

/**
 * The v8 game card. Each team stands on a line as long as its chance; the lines join
 * into 548's tile. Grey tick: the market. Black tick: the pregame seal on a live game.
 */
export function GameCard({
  game,
  lines,
  modelVersion,
  modelNote = true,
  future = false,
}: {
  game: DayGame;
  lines: Record<string, TeamLine>;
  modelVersion: string;
  /** Say on the card when its number predates the injury model. Off when the page says it. */
  modelNote?: boolean;
  /** Show the weekday beside the tip time. */
  future?: boolean;
}) {
  const view = bracketView({ game, lines, modelVersion, modelNote, future });
  return (
    <article className="gc group">
      <div className="gc-st">
        <b>{view.status.lead}</b>
        {view.status.detail ? <span>{view.status.detail}</span> : null}
        {view.status.right ? (
          <span className="r" title={view.status.title ?? undefined}>
            {view.status.right}
          </span>
        ) : null}
      </div>
      <Bracket view={view} />
      <BracketContext view={view} />
      <Link
        href={`/game/${game.id}`}
        className="absolute inset-0 -m-2 outline-offset-0 group-hover:bg-ink/[0.025]"
        aria-label={cardLabel(view)}
        title={view.tile.kind === "none" ? undefined : tileHelp(view.tile.kind)}
      />
    </article>
  );
}
