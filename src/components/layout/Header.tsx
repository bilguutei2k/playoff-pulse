import Link from "next/link";
import { Brand548 } from "@/components/brand/Brand548";
import { FreshnessChip } from "@/components/layout/FreshnessChip";
import { NavLinks } from "@/components/layout/NavLinks";
import { liveState } from "@/lib/season/published";
import { formatStampEt } from "@/lib/utils/dates";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-panel/95 backdrop-blur supports-[backdrop-filter]:bg-panel/85">
      <div className="pp-container flex h-14 items-center gap-3 sm:h-16 sm:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg" aria-label="548, NBA forecasts: today's games">
          <Brand548 size={36} />
          <span className="kicker whitespace-nowrap text-ink-2">NBA forecasts</span>
        </Link>
        <div className="hidden min-w-0 flex-1 md:block">
          <NavLinks />
        </div>
        <div className="ml-auto shrink-0">
          <FreshnessChip
            iso={liveState.generatedAt}
            stamp={formatStampEt(liveState.generatedAt)}
            modelVersion={liveState.modelVersion}
          />
        </div>
      </div>
      <div className="border-t border-line md:hidden">
        <div className="pp-container">
          <NavLinks />
        </div>
      </div>
    </header>
  );
}
