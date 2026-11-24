import { SiteLink } from "@/components/layout/SiteLink";
import { playerHref } from "@/lib/view/players";

/**
 * A player's name, linked to his page whenever his ESPN athlete ID is known. A printed
 * name that matched nobody stays plain text. With `fullName`, a shortened printed name
 * (a surname on a game card) is read out in full.
 */
export function PlayerLink({
  athleteId,
  name,
  fullName,
  className = "",
}: {
  athleteId: string | null;
  name: string;
  fullName?: string;
  className?: string;
}) {
  const text =
    fullName && fullName !== name ? (
      <>
        <span aria-hidden>{name}</span>
        <span className="sr-only">{fullName}</span>
      </>
    ) : (
      name
    );
  if (!athleteId) return <span className={className}>{text}</span>;
  return (
    <SiteLink
      href={playerHref(athleteId)}
      className={`underline-offset-[3px] hover:underline ${className}`}
    >
      {text}
    </SiteLink>
  );
}
