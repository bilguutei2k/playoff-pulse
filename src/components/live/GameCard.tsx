import { SiteLink } from "@/components/layout/SiteLink";
import { PlayerLink } from "@/components/live/PlayerLink";
import { TeamLink } from "@/components/live/TeamLink";
import { Tile } from "@/components/live/Tile";
import { bracketView, outPoints, type BracketSide, type BracketView } from "@/lib/view/bracket";
import { cardOutNames, cardOutStatusWord, type CardOutSide } from "@/lib/view/card-out";
import type { DayGame } from "@/lib/view/day";
import { OUT_DEFINITION, tileHelp } from "@/lib/view/how-to-read";
import { gameHref } from "@/lib/view/routes";
import { pairColors, teamDisplay, type TeamLine } from "@/lib/view/teams";

/**
 * A figure in a card arm (record or score) that takes the wider of the two teams'
 * widths: the other team's figure sits under it, invisible, so both arms leave their
 * names the same room and the pair's names switch form together.
 */
function Matched({ value, other }: { value: string | number | null; other: string | number | null }) {
  if (value === null && other === null) return null;
  return (
    <>
      <span>{value ?? ""}</span>
      {other !== null ? (
        <span aria-hidden className="arm-ghost">
          {other}
        </span>
      ) : null}
    </>
  );
}

function Arm({
  side,
  other,
  color,
  large,
  home,
}: {
  side: BracketSide;
  /** The other team in the game: the card's names, records and scores are sized as a pair. */
  other: BracketSide;
  color: string;
  large: boolean;
  home: boolean;
}) {
  const team = teamDisplay(side.teamId);
  return (
    <div className={`arm ${side.dim ? "arm-lo" : ""}`}>
      {large ? (
        // The game page: the city (and the record) on a small line over the nickname, so
        // the largest type never needs the whole name on one line.
        <span className="arm-nm">
          <span className="arm-city">
            <span aria-hidden>
              {home ? <span className="arm-at">at </span> : null}
              {team.place}
            </span>
            {side.record ? <span className="arm-rec"> · {side.record}</span> : null}
          </span>
          <TeamLink teamId={side.teamId} form="short" logo={36} className="arm-t" />
        </span>
      ) : (
        <>
          {home ? (
            <span aria-hidden className="arm-at">
              at
            </span>
          ) : null}
          {/* Above the card's game link (a sibling), so the name opens the team. */}
          <TeamLink teamId={side.teamId} pair={other.teamId} form="auto" logo={20} raised className="arm-t" />
          <span className="arm-r">
            <Matched value={side.record} other={other.record} />
          </span>
        </>
      )}
      <span className="arm-sc">{large ? (side.score ?? "") : <Matched value={side.score} other={other.score} />}</span>
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

/** "morning seal 6:00 AM": when the label wraps, the clock stays on one line. */
function TileLabel({ label }: { label: string }) {
  const match = /^(.*) (\d{1,2}:\d{2} [AP]M)$/.exec(label);
  if (!match) return <>{label}</>;
  return (
    <>
      {match[1]} <span className="nowrap">{match[2]}</span>
    </>
  );
}

/**
 * The two arms, the bracket and the tile. Shared by the card and the game page header.
 * Each team's logo and name link to its page; away team first, the home team marked "at".
 */
export function Bracket({ view, large = false }: { view: BracketView; large?: boolean }) {
  const [awayColor, homeColor] = pairColors(view.away.teamId, view.home.teamId);
  const { tile } = view;
  return (
    <div className={`bk ${view.dashed ? "bk-dash" : ""} ${large ? "bk-l" : ""}`}>
      <div className="bk-arms">
        <Arm side={view.away} other={view.home} color={awayColor} large={large} home={false} />
        <Arm side={view.home} other={view.away} color={homeColor} large={large} home />
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
              <b>
                <Code view={view} code={tile.code} link={large} />
              </b>
              <span>
                <TileLabel label={tile.label} />
              </span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** The context row: absences first, then the market in grey, or the pregame seal on a live game. */
/**
 * A team's code in the tile or the context row: a team link on the game page, plain
 * text on a card (whose links stay team, team, game).
 */
function Code({ view, code, link }: { view: BracketView; code: string; link: boolean }) {
  const teamId = [view.away, view.home].find((side) => side.code === code)?.teamId;
  if (!link || !teamId) return <>{code}</>;
  return <TeamLink teamId={teamId} form="code" />;
}

/**
 * One side of a card's "Out" row: the figure, then the largest absences as player links
 * (raised over the card's game link), a status letter for doubtful or questionable, and
 * how many more are listed. Each name stays whole; the line wraps between names.
 */
function OutLine({ code, points, named }: { code: string; points: number; named: CardOutSide | null }) {
  return (
    <span className="gc-out-s">
      <span className="gc-out-f">
        <b>
          {code} {outPoints(points)}
        </b>{" "}
        pts
      </span>
      {named ? (
        <span className="gc-out-n">
          {named.names.map((player, index) => (
            <span key={`${player.athleteId ?? player.name}-${index}`} className="gc-out-p">
              <PlayerLink athleteId={player.athleteId} name={player.name} fullName={player.fullName} className="gc-pl" />
              {player.status ? (
                <>
                  {" "}
                  <abbr title={cardOutStatusWord(player.status)}>{player.status}</abbr>
                </>
              ) : null}
              {index < named.names.length - 1 ? "," : null}
            </span>
          ))}
          {named.more > 0 ? <span className="gc-out-p">+{named.more}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

export function BracketContext({
  view,
  marketLabel = "Market",
  linkTeams = false,
  names,
}: {
  view: BracketView;
  marketLabel?: string;
  /** Team codes as team links (the game page; never on a card). */
  linkTeams?: boolean;
  /** A card's named absences by team code (`cardOutNames`); the game page lists them in full instead. */
  names?: Record<string, CardOutSide>;
}) {
  // Each label and value is its own unbroken unit (gc-u, b): on a card, the items beside
  // the "Out" block may wrap between the two to stay beside it.
  const before: React.ReactNode[] = [];
  const after: React.ReactNode[] = [];
  if (view.pregame) {
    before.push(
      <span key="pregame" className="gc-i">
        <span className="gc-u">
          <span aria-hidden className="gc-key" />
          Pregame seal
        </span>{" "}
        <b>
          <Code view={view} code={view.pregame.code} link={linkTeams} /> {view.pregame.percent}%
        </b>
      </span>,
    );
  }
  const notes = view.notes.map((note) => <span key={note}>{note}</span>);
  if (view.market === "none") {
    after.push(
      <span key="market" className="gc-i">
        <span className="gc-u">{marketLabel}</span> <b>no line yet</b>
      </span>,
    );
  } else if (view.market) {
    after.push(
      <span key="market" className="gc-i">
        <span className="gc-u">
          <span aria-hidden className="gc-key mk" />
          {marketLabel}
        </span>{" "}
        <b>
          <Code view={view} code={view.market.code} link={linkTeams} /> {view.market.percent}%
        </b>
      </span>,
    );
  }

  if (view.out.length > 0 && names) {
    // A card: one line a side under one "Out" label, "MEM −3.1 pts Morant, Clarke +2",
    // the names from the shown number's own drivers (lib/view/card-out.ts). Notes come
    // first, as on the game page; the pregame seal and market share what is left of the
    // block's two lines.
    return (
      <div className="gc-cx">
        {notes}
        <span className="gc-out" title={OUT_DEFINITION}>
          <span className="gc-out-l">Out</span>
          {view.out.map((side) => (
            <OutLine key={side.code} code={side.code} points={side.points} named={names[side.code] ?? null} />
          ))}
          {view.unfiled.map((code) => (
            <span key={code} className="gc-out-u">
              <b>{code}</b> not filed
            </span>
          ))}
        </span>
        {before.length + after.length > 0 ? (
          <span className="gc-cx-r">
            {before}
            {after}
          </span>
        ) : null}
      </div>
    );
  }

  const parts: React.ReactNode[] = [...before, ...notes];
  if (view.out.length > 0 || view.unfiled.length > 0) {
    // "Out DET −5.4 pts": points of margin, so the figure is not read as a count of players.
    parts.push(
      <span key="out" title={OUT_DEFINITION}>
        Out{" "}
        {view.out.map((side, index) => (
          <span key={side.code}>
            {index > 0 ? " " : ""}
            <b>
              <Code view={view} code={side.code} link={linkTeams} /> {outPoints(side.points)}
            </b>
          </span>
        ))}
        {view.out.length > 0 ? " pts" : null}
        {view.unfiled.map((code) => (
          <span key={code}>
            {" "}
            · <Code view={view} code={code} link={linkTeams} /> not filed
          </span>
        ))}
      </span>,
    );
  }
  parts.push(...after);
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
    <article className="gc">
      <div className="gc-st">
        <b>{view.status.lead}</b>
        {view.status.detail ? (
          game.status === "scheduled" ? (
            // The broadcast: shown whole when it fits, otherwise left out; never cut.
            <span className="gc-st-drop">
              <span>{view.status.detail}</span>
            </span>
          ) : (
            <span>{view.status.detail}</span>
          )
        ) : null}
        {view.status.right ? (
          <span className="r" title={view.status.title ?? undefined}>
            {view.status.right}
          </span>
        ) : null}
      </div>
      <Bracket view={view} />
      <BracketContext view={view} names={cardOutNames(game.absences)} />
      {/* The whole card opens the game; the team links above sit over this cover. */}
      <SiteLink
        href={gameHref(game.id)}
        className="gc-cover"
        aria-label={cardLabel(view)}
        title={view.tile.kind === "none" ? undefined : tileHelp(view.tile.kind)}
      />
    </article>
  );
}
