import { SiteLink } from "@/components/layout/SiteLink";
import { playerHref } from "@/lib/view/players";

/**
 * A player's name, linked to his page whenever his ESPN athlete ID is known. A printed
 * name that matched nobody stays plain text.
 */
export function PlayerLink({
  athleteId,
  name,
  className = "",
}: {
  athleteId: string | null;
  name: string;
  className?: string;
}) {
  if (!athleteId) return <span className={className}>{name}</span>;
  return (
    <SiteLink
      href={playerHref(athleteId)}
      className={`underline-offset-[3px] hover:underline ${className}`}
    >
      {name}
    </SiteLink>
  );
}
