import { TeamLink } from "@/components/live/TeamLink";
import { teamIdFromRepoCode } from "@/lib/season/teams";

/** The live team ID for a 2026 archive team code, or null when there is none. */
function liveTeamId(code: string): string | null {
  try {
    return teamIdFromRepoCode(code);
  } catch {
    return null;
  }
}

/**
 * The archive's team chip ("NYK" in team colors). Its code links to the live team
 * page (accessible name: the full name). Never use inside a button or another link;
 * pass link={false} there.
 */
export function ArchiveTeamBadge({ code, link = true }: { code: string; link?: boolean }) {
  const teamId = liveTeamId(code);
  return (
    <span className="pp-team-badge" data-team={code}>
      {teamId ? <TeamLink teamId={teamId} form="code" link={link} /> : code}
    </span>
  );
}
