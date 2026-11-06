import Link from "next/link";
import { Badge, StatusTag } from "@/components/live/Badge";
import { PlayerLink } from "@/components/live/PlayerLink";
import { TeamLogo } from "@/components/live/TeamLogo";
import { SOURCE_LABELS, totalPoints, type InjuryBlock, type InjuryRowView } from "@/lib/view/injury-report";
import { teamDisplay, teamHref } from "@/lib/view/teams";

/** The reason cell: the report's reason, or why a player not on it is shown. */
function reasonText(row: InjuryRowView): string {
  if (row.reason) return row.reason;
  if (row.source === "box-score") return `Not on the report; ${row.statusView.label.toLowerCase()}`;
  if (row.source === "projection") return "–";
  return "No reason given";
}

function SourceTag({ row }: { row: InjuryRowView }) {
  const inferred = row.source !== "report";
  return (
    <span
      className={`whitespace-nowrap text-[12.5px] ${inferred ? "text-ink-2 italic" : "text-ink-2"}`}
      title={
        row.source === "report"
          ? "Status and reason as printed on the NBA's injury report"
          : row.source === "box-score"
            ? "The model's inference from box scores: he missed recent team games and is not on the report"
            : row.source === "earlier-report"
              ? "Listed out or doubtful on the team's latest earlier report, and not on one covering this game"
              : "A player the projection counts for this game"
      }
    >
      {SOURCE_LABELS[row.source]}
    </span>
  );
}

/**
 * One team's injury list for one game: where it comes from, then every player with his
 * status, reason, source and the model's points. Columns collapse into the player cell
 * when the list is narrow (a container query, so it works beside another list).
 */
export function InjuryTable({
  block,
  rows = block.rows,
  showGame = false,
  emptyText,
  headingLevel = "h3",
}: {
  block: InjuryBlock;
  /** The rows to show, when filtered. */
  rows?: InjuryRowView[];
  /** Say which game the list is for (outside a game's own panel). */
  showGame?: boolean;
  emptyText?: string;
  headingLevel?: "h3" | "h4";
}) {
  const team = teamDisplay(block.teamId);
  const Heading = headingLevel;
  const captionId = `injuries-${block.teamId}-${block.gameId}`;
  return (
    <div className="@container min-w-0 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading id={captionId} className="flex items-center gap-2 text-[16px] font-bold text-ink">
          <TeamLogo teamId={block.teamId} size={20} />
          <Link href={teamHref(block.teamId)} className="hover:underline hover:underline-offset-4">
            {team.shortName}
          </Link>
        </Heading>
        <p className="num text-[12px] text-ink-2">
          <span title="Points of margin the model takes off this team for the game, summed over its list">
            548 {totalPoints(block.absencePoints)}
          </span>
        </p>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-2">
        {block.unfiled ? <Badge tone="warn">Not yet submitted</Badge> : <span className="font-medium text-ink">{block.sourceLabel}</span>}
        {showGame ? (
          <>
            <span aria-hidden className="text-ink-4">·</span>
            <Link href={`/game/${block.gameId}`} className="pp-link font-normal">
              {block.gameLabel}
            </Link>
          </>
        ) : null}
      </p>
      {block.note ? <p className="mt-1.5 text-[12px] leading-5 text-ink-3">{block.note}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">{emptyText ?? (block.complete ? "Nobody is listed or counted." : "Nobody is counted.")}</p>
      ) : (
        <table className="mt-3 w-full text-[13px]">
          <caption className="sr-only">
            {team.shortName} injury list, {block.gameLabel}
          </caption>
          <thead>
            <tr className="border-b-2 border-ink text-left">
              <th scope="col" className="kicker py-1.5 pr-2 font-medium">Player</th>
              <th scope="col" className="kicker py-1.5 pr-2 font-medium">Status</th>
              <th scope="col" className="kicker hidden py-1.5 pr-2 font-medium @lg:table-cell">Reason</th>
              <th scope="col" className="kicker hidden py-1.5 pr-2 font-medium @lg:table-cell">Source</th>
              <th scope="col" className="kicker whitespace-nowrap py-1.5 text-right font-medium" title="Points of margin the model takes off his team for this game, weighted by status">
                548 pts
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-line align-top last:border-0">
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  <PlayerLink athleteId={row.athleteId} name={row.name} className="font-medium text-ink" />
                  <span className="mt-0.5 block text-[12px] leading-4 text-ink-3 @lg:hidden">
                    {row.source === "projection" ? null : <>{reasonText(row)} · </>}
                    <SourceTag row={row} />
                  </span>
                </th>
                <td className="py-2 pr-2">
                  <span title={row.statusView.label}>
                    <StatusTag tone={row.statusView.tone}>{row.statusView.short}</StatusTag>
                  </span>
                </td>
                <td className={`hidden py-2 pr-2 leading-5 @lg:table-cell ${row.reason ? "text-ink-2" : "text-ink-3"}`}>{reasonText(row)}</td>
                <td className="hidden py-2 pr-2 @lg:table-cell"><SourceTag row={row} /></td>
                <td className="num py-2 text-right text-ink-2">{row.pointsText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!block.complete && rows.length > 0 ? (
        <p className="mt-2 text-[12px] leading-5 text-ink-3">Only players with points are listed for this game.</p>
      ) : null}
    </div>
  );
}
