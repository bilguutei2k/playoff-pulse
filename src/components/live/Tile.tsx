import type { TileKind } from "@/lib/view/bracket";

const KIND_CLASS: Record<TileKind, string> = { sealed: "", live: "tile-live", dash: "tile-dash" };
const SIZE_CLASS = { xs: "tile-xs", sm: "tile-sm", md: "", lg: "tile-lg" } as const;

/**
 * The tile: 548's number. Solid is sealed and scored, outline is a live estimate,
 * dashed is a number that is never scored (provisional, projection).
 */
export function Tile({
  kind = "sealed",
  size = "md",
  children,
  title,
  className = "",
}: {
  kind?: TileKind;
  size?: keyof typeof SIZE_CLASS;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span title={title} className={`tile ${KIND_CLASS[kind]} ${SIZE_CLASS[size]} ${className}`}>
      {children}
    </span>
  );
}
