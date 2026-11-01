import Image from "next/image";

/** Set to false to fall back to team abbreviations everywhere. Names always show. */
const SHOW_TEAM_LOGOS = true;

/**
 * A team's logo, shown small and unaltered beside its name. Decorative, because the
 * name or abbreviation is always next to it. Files are already 56px, so Next does
 * not need to resize them.
 */
export function TeamLogo({ teamId, size = 20 }: { teamId: string; size?: number }) {
  if (!SHOW_TEAM_LOGOS) return null;
  return (
    <Image
      src={`/logos/nba/${teamId}.png`}
      alt=""
      width={size}
      height={size}
      unoptimized
      className="inline-block shrink-0"
    />
  );
}
