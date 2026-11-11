import Link from "next/link";
import { Badge, StatusTag } from "@/components/live/Badge";
import { PlayerLink } from "@/components/live/PlayerLink";
import { TeamLink } from "@/components/live/TeamLink";
import { SOURCE_LABELS, gameWhen, totalPoints, type InjuryBlock, type InjuryRowView } from "@/lib/view/injury-report";
import { statusSourceLabel } from "@/lib/view/players";
import { teamDisplay } from "@/lib/view/teams";

/** The reason cell: the report's reason, or why a player not on it is shown. */
function reasonText(row: InjuryRowView): string {
  if (row.reason) return row.reason;
  if (row.source === "box-score") return row.status === null ? `Not on the report; ${row.statusView.label.toLowerCase()}` : "No reason given";
  if (row.source === "projection") return "–";
  return "No reason given";
}

/**
 * Where his status comes from, in the same terms as his tag (VB-2). A box-score row that
 * carries a status took it from the team's earlier report, so it reads "Earlier report".
 */
function SourceTag({ row }: { row: InjuryRowView }) {
  const label = row.source === "projection" ? SOURCE_LABELS.projection : statusSourceLabel({ status: row.status, source: row.source });
  const inferred = row.source !== "report";
  return (
    <span
      className={`whitespace-nowrap text-12 text-ink-2 ${inferred ? "italic" : ""}`}
      title={
        label === "NBA report"
          ? "Status and reason as printed on the NBA's injury report"
          : label === "Box scores"
            ? "The model's inference from box scores: he missed recent team games and is not on the report"
            : label === "Earlier report"
              ? `Listed on the team's latest earlier report, and no report covering this game lists him${row.source === "box-score" ? "; box scores show he has missed recent games" : ""}`
              : "A player the projection counts for this game"
      }
    >
      {label}
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
    <div className="@container min-w-0 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading id={captionId} className="text-15 font-bold text-ink">
          <TeamLink teamId={block.teamId} form="short" logo={20} />
        </Heading>
        <p className="num text-12 text-ink-2">
          <span title="Points of margin the model takes off this team for the game, summed over its list">
            548 {totalPoints(block.absencePoints)}
          </span>
        </p>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-13 text-ink-2">
        {block.unfiled ? <Badge tone="warn">Not yet submitted</Badge> : <span className="font-medium text-ink">{block.sourceLabel}</span>}
        {showGame ? (
          <>
            <span aria-hidden>·</span>
            {/* The opponent opens its team page, the date and time open the game. */}
            <span>
              {block.home ? "vs" : "at"} <TeamLink teamId={block.opponentId} className="font-medium text-ink" />,{" "}
              <Link href={`/game/${block.gameId}`} className="pp-link font-normal">
                {gameWhen(block.etDate, block.tipUtc)}
              </Link>
            </span>
          </>
        ) : null}
      </p>
      {block.note ? <p className="mt-1.5 max-w-[64ch] text-12 leading-5 text-ink-2">{block.note}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-3 text-13 text-ink-2">{emptyText ?? (block.complete ? "Nobody is listed or counted." : "Nobody is counted.")}</p>
      ) : (
        <table className="tb mt-3">
          <caption className="sr-only">
            {team.shortName} injury list, {block.gameLabel}
          </caption>
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Status</th>
              <th scope="col" className="hidden @lg:table-cell">Reason</th>
              <th scope="col" className="hidden @lg:table-cell">Source</th>
              <th scope="col" className="text-right" title="Points of margin the model takes off his team for this game, weighted by status">
                548 pts
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="align-top">
                <th scope="row" className="!whitespace-normal text-left">
                  <PlayerLink athleteId={row.athleteId} name={row.name} className="players-name font-medium text-ink" />
                  <span className="mt-0.5 block text-12 leading-4 text-ink-2 @lg:hidden">
                    {row.source === "projection" ? null : <>{reasonText(row)} · </>}
                    <SourceTag row={row} />
                  </span>
                </th>
                <td>
                  <StatusTag tone={row.statusView.tone} title={row.statusView.label}>{row.statusView.short}</StatusTag>
                </td>
                <td className="hidden leading-5 text-ink-2 @lg:table-cell">{reasonText(row)}</td>
                <td className="hidden @lg:table-cell"><SourceTag row={row} /></td>
                <td className="whitespace-nowrap text-right text-ink-2">{row.pointsText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!block.complete && rows.length > 0 ? (
        <p className="mt-2 text-12 leading-5 text-ink-2">Only players with points are listed for this game.</p>
      ) : null}
    </div>
  );
}
