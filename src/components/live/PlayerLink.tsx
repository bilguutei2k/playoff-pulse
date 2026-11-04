import Link from "next/link";
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
    <Link
      href={playerHref(athleteId)}
      className={`underline decoration-line-strong decoration-1 underline-offset-[3px] hover:decoration-pulse hover:decoration-2 ${className}`}
    >
      {name}
    </Link>
  );
}
