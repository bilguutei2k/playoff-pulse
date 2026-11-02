import { TeamLogo } from "@/components/live/TeamLogo";
import { teamPairColors } from "@/lib/season/team-colors";
import { teamById } from "@/lib/season/teams";
import { formatChance } from "@/lib/utils/format";

/** Cards and tables sit on white; team colors are chosen for contrast against it. */
const SURFACE = "#ffffff";

/**
 * A two-tone bar split by one probability, in team colors. Logos and abbreviations
 * sit at both ends, so color never carries the identity alone.
 */
export function TeamProbabilityBar({
  leftId,
  rightId,
  leftProbability,
  label,
  exact = false,
}: {
  leftId: string;
  rightId: string;
  /** Chance for the left team; the right team gets the rest. */
  leftProbability: number;
  /** What the split measures, for the accessible name, e.g. "Model win probability". */
  label: string;
  /** Show 0% and 100% for settled outcomes. */
  exact?: boolean;
}) {
  const [leftColor, rightColor] = teamPairColors(leftId, rightId, SURFACE);
  const left = teamById(leftId);
  const right = teamById(rightId);
  const leftShare = Math.min(1, Math.max(0, leftProbability));
  const rightShare = 1 - leftShare;
  const description = `${label}: ${left.name} ${formatChance(leftShare, { exact })}, ${right.name} ${formatChance(rightShare, { exact })}`;
  return (
    <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
      <span className="flex w-14 shrink-0 items-center gap-1.5">
        <TeamLogo teamId={leftId} size={16} />
        {left.abbreviation}
      </span>
      <div role="img" aria-label={description} title={description} className="flex h-2 min-w-0 flex-1 gap-[2px]">
        {leftShare > 0 ? (
          <span
            className={`block h-full ${rightShare > 0 ? "rounded-l-full" : "rounded-full"}`}
            style={{ flex: `${leftShare} 1 0%`, background: leftColor }}
          />
        ) : null}
        {rightShare > 0 ? (
          <span
            className={`block h-full ${leftShare > 0 ? "rounded-r-full" : "rounded-full"}`}
            style={{ flex: `${rightShare} 1 0%`, background: rightColor }}
          />
        ) : null}
      </div>
      <span className="flex w-14 shrink-0 items-center justify-end gap-1.5">
        {right.abbreviation}
        <TeamLogo teamId={rightId} size={16} />
      </span>
    </div>
  );
}
