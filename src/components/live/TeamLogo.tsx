import Image from "next/image";
import { teamColor } from "@/lib/view/teams";

/** Set to false to fall back to team color chips everywhere. Names always show. */
export const SHOW_TEAM_LOGOS = true;

/**
 * A team's logo, shown small and unaltered beside its name. Decorative, because the
 * name or abbreviation is always next to it. Files are already 56px, so Next does
 * not need to resize them. With logos switched off, a square chip in the team's
 * display color stands in at the same spot (v8's chip), unless `chip` is false.
 */
export function TeamLogo({ teamId, size = 20, chip = true }: { teamId: string; size?: number; chip?: boolean }) {
  if (!SHOW_TEAM_LOGOS) {
    if (!chip) return null;
    const side = Math.max(8, Math.round(size * 0.6));
    return (
      <span
        aria-hidden
        className="inline-block shrink-0"
        style={{ width: side, height: side, margin: (size - side) / 2, background: teamColor(teamId) }}
      />
    );
  }
  return (
    <Image
      src={`/logos/nba/${teamId}.png`}
      alt=""
      width={size}
      height={size}
      unoptimized
      // max-w-none: the base reset's percentage max-width makes an image "compressible", so
      // every engine counts it as 0px wide in a min-content size (CSS Sizing 3, 5.2.2) and an
      // auto table column or flex row would leave no room for the logo beside the name.
      className="inline-block max-w-none shrink-0 object-contain"
    />
  );
}
