import Link from "next/link";
import { StatusTag } from "@/components/live/Badge";
import { Notes, Section } from "@/components/live/GameSections";
import { Hint } from "@/components/live/Hint";
import { PlayerLink } from "@/components/live/PlayerLink";
import { TeamLink } from "@/components/live/TeamLink";
import { formatShortDay } from "@/lib/utils/dates";
import { formatAverage, formatMinutes, formatScore } from "@/lib/view/players";
import type { DidNotPlayRow, PlayedRow, RosterRow, Squads, SquadSide } from "@/lib/view/squads";
import { teamDisplay } from "@/lib/view/teams";

// ---------------------------------------------------------------------------
// Squads: each team's players with Min, Pts and the 548 score. Display only: rows are
// never ordered, coloured or weighted by the score, and nothing here adds scores up.

const UNAVAILABLE = "Player stats are not published yet.";

function Columns() {
  return (
    <colgroup>
      <col />
      <col className="sq-fig" />
      <col className="sq-fig" />
      <col className="sq-score" />
    </colgroup>
  );
}

function Head({ scoreLabel, now, hidden = false }: { scoreLabel: string; now: boolean; hidden?: boolean }) {
  const title = now ? "548 score now" : "548 score";
  return (
    <thead className={hidden ? "sr-only" : undefined}>
      <tr>
        <th scope="col">Player</th>
        <th scope="col" className="nm">
          {hidden ? "Minutes" : <abbr title={now ? "Minutes in this game" : "Minutes per game"} className="no-underline">Min</abbr>}
        </th>
        <th scope="col" className="nm">
          {hidden ? "Points" : <abbr title={now ? "Points in this game" : "Points per game"} className="no-underline">Pts</abbr>}
        </th>
        <th scope="col" className="nm">
          {hidden ? (
            title
          ) : (
            <Hint term={title} label={title}>
              {scoreLabel} It is not a reliable ranking of players.
            </Hint>
          )}
        </th>
      </tr>
    </thead>
  );
}

function PlayerCell({
  athleteId,
  name,
  position,
  tag,
}: {
  athleteId: string;
  name: string;
  position: string | null;
  tag?: RosterRow["tag"];
}) {
  return (
    <th scope="row" className="sq-player">
      {/* Wrapping items, so a long name or a tag moves to the next line instead of running past the cell. */}
      <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        {/* One inline run: the position stays on the line of the name's last word. */}
        <span className="min-w-0">
          <PlayerLink athleteId={athleteId} name={name} />
          {position ? (
            <>
              {" "}
              <span className="ml-0.5 text-[12px] text-ink-2">{position}</span>
            </>
          ) : null}
        </span>
        {tag ? <StatusTag tone={tag.tone}>{tag.label}</StatusTag> : null}
      </span>
    </th>
  );
}

function RosterRows({ rows }: { rows: readonly RosterRow[] }) {
  return (
    <tbody>
      {rows.map((row) => (
        <tr key={row.athleteId}>
          <PlayerCell athleteId={row.athleteId} name={row.name} position={row.position} tag={row.tag} />
          <td className="num nm">{formatAverage(row.minutes)}</td>
          <td className="num nm">{formatAverage(row.points)}</td>
          <td className="num nm">{formatScore(row.score)}</td>
        </tr>
      ))}
    </tbody>
  );
}

function Toggle({ children }: { children: React.ReactNode }) {
  return (
    <summary className="cursor-pointer list-none py-1.5 text-[14px] text-ink-2 hover:text-ink">
      {children}
      <span className="ml-2 text-[12.5px] underline underline-offset-2 group-open:hidden">show</span>
      <span className="ml-2 hidden text-[12.5px] underline underline-offset-2 group-open:inline">hide</span>
    </summary>
  );
}

function RosterTables({ side, scoreLabel }: { side: Extract<SquadSide, { kind: "roster" }>; scoreLabel: string }) {
  const team = teamDisplay(side.teamId);
  if (side.shown.length === 0) {
    return <p className="notice-quiet mt-2">No {team.shortName} player is known from this season&apos;s box scores yet.</p>;
  }
  return (
    <>
      <table className="tb squad-tb">
        <caption className="sr-only">
          {team.name}: players with minutes and points per game this season and the 548 score
        </caption>
        <Columns />
        <Head scoreLabel={scoreLabel} now={false} />
        <RosterRows rows={side.shown} />
      </table>
      {side.more.length > 0 ? (
        <details className="group">
          <Toggle>{side.more.length} more</Toggle>
          <table className="tb squad-tb">
            <caption className="sr-only">{team.name}: the other {side.more.length} players</caption>
            <Columns />
            <Head scoreLabel={scoreLabel} now={false} hidden />
            <RosterRows rows={side.more} />
          </table>
        </details>
      ) : null}
    </>
  );
}

function PlayedGroup({ label, rows }: { label: string | null; rows: readonly PlayedRow[] }) {
  return (
    <tbody>
      {label ? (
        <tr>
          <th scope="colgroup" colSpan={4} className="sq-group">
            {label}
          </th>
        </tr>
      ) : null}
      {rows.map((row) => (
        <tr key={row.athleteId}>
          <PlayerCell athleteId={row.athleteId} name={row.name} position={row.position} />
          <td className="num nm">{formatMinutes(row.minutes)}</td>
          <td className="num nm">{row.points}</td>
          <td className="num nm">{formatScore(row.score)}</td>
        </tr>
      ))}
    </tbody>
  );
}

function DidNotPlay({ rows }: { rows: readonly DidNotPlayRow[] }) {
  return (
    <details className="group">
      <Toggle>Did not play ({rows.length})</Toggle>
      <ul className="pb-2">
        {rows.map((row) => (
          <li key={row.athleteId} className="flex flex-wrap justify-between gap-x-3 py-0.5 text-[14px]">
            <PlayerLink athleteId={row.athleteId} name={row.name} className="[overflow-wrap:anywhere]" />
            {row.reason ? <span className="text-ink-2">{row.reason}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function PlayedTables({ side, scoreLabel }: { side: Extract<SquadSide, { kind: "played" }>; scoreLabel: string }) {
  const team = teamDisplay(side.teamId);
  const starters = side.played.filter((row) => row.starter);
  const bench = side.played.filter((row) => !row.starter);
  const grouped = starters.length > 0 && bench.length > 0;
  return (
    <>
      {side.played.length > 0 ? (
        <table className="tb squad-tb">
          <caption className="sr-only">
            {team.name}: who played in this game, with minutes and points in it and the 548 score published now
          </caption>
          <Columns />
          <Head scoreLabel={scoreLabel} now />
          {grouped ? (
            <>
              <PlayedGroup label="Starters" rows={starters} />
              <PlayedGroup label="Bench" rows={bench} />
            </>
          ) : (
            <PlayedGroup label={null} rows={side.played} />
          )}
        </table>
      ) : (
        <p className="notice-quiet mt-2">No {team.shortName} player has a line in this game&apos;s box score.</p>
      )}
      {side.didNotPlay.length > 0 ? <DidNotPlay rows={side.didNotPlay} /> : null}
    </>
  );
}

function SquadTeam({ side, scoreLabel }: { side: SquadSide; scoreLabel: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-3 border-b-2 border-ink pb-2">
        <h3 className="whitespace-nowrap text-[16px] font-bold">
          <TeamLink teamId={side.teamId} logo={20} />
        </h3>
      </div>
      {side.kind === "roster" ? (
        <RosterTables side={side} scoreLabel={scoreLabel} />
      ) : side.kind === "played" ? (
        <PlayedTables side={side} scoreLabel={scoreLabel} />
      ) : side.kind === "not-stored" ? (
        <p className="notice-quiet mt-2">This game&apos;s lineup is not stored yet.</p>
      ) : (
        <p className="notice-quiet mt-2">{UNAVAILABLE}</p>
      )}
    </div>
  );
}

export function SquadsSection({ squads, tagsShown }: { squads: Squads; tagsShown: boolean }) {
  const bothUnavailable = squads.away.kind === "unavailable" && squads.home.kind === "unavailable";
  const roster = squads.figures === "season";
  const played = squads.figures === "game";
  return (
    <Section
      id="squads"
      title="Squads"
      note={roster ? "Season averages" : played ? "This game" : undefined}
    >
      {bothUnavailable ? (
        <p className="notice-quiet">{UNAVAILABLE}</p>
      ) : (
        // Side by side only where each team gets room for full player names.
        <div className="grid gap-10 md:grid-cols-2 md:gap-14 lg:grid-cols-1 lg:gap-10 xl:grid-cols-2 xl:gap-14">
          <SquadTeam side={squads.away} scoreLabel={squads.scoreLabel} />
          <SquadTeam side={squads.home} scoreLabel={squads.scoreLabel} />
        </div>
      )}
      <Notes>
        {roster ? (
          <p>
            Players are those known from the team&apos;s stored box scores and injury reports this season, most minutes per
            game first. This is not an official roster, and a new signing may be missing. Min and Pts are per game for this
            team this season{squads.inProgress ? ", not from this game" : ""}.
            {tagsShown ? " A tag is the status this game's number counts; the Out section below has what each costs." : ""}
          </p>
        ) : null}
        {played ? (
          <p>
            Who played in this game, starters first; Min and Pts are from this game. The 548 score is the one published now
            {squads.throughEtDate ? `, through ${formatShortDay(squads.throughEtDate)}` : ""}, not his score at the time of
            this game.
          </p>
        ) : null}
        {squads.showsScores ? (
          <p>
            {squads.scoreLabel} It is not a reliable ranking of players.{" "}
            <Link href="/how-it-works#score" className="pp-link">
              How the 548 score works
            </Link>
          </p>
        ) : null}
      </Notes>
    </Section>
  );
}
