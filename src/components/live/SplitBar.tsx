import { pairColors } from "@/lib/view/teams";

/**
 * One bar split between two teams by win probability, away on the left. Team colors
 * come from `team-colors.ts`, which keeps each at 3:1 or better on the panel and the
 * two distinct; a 2px panel gap separates them. Decorative: the numbers print beside it.
 */
export function SplitBar({
  awayId,
  homeId,
  homeProbability,
  height = 8,
}: {
  awayId: string;
  homeId: string;
  homeProbability: number;
  height?: number;
}) {
  const [awayColor, homeColor] = pairColors(awayId, homeId);
  const away = Math.min(0.99, Math.max(0.01, 1 - homeProbability));
  return (
    <div aria-hidden className="flex w-full gap-[2px]" style={{ height }}>
      <span className="block rounded-l-full" style={{ width: `${away * 100}%`, background: awayColor }} />
      <span className="block flex-1 rounded-r-full" style={{ background: homeColor }} />
    </div>
  );
}
