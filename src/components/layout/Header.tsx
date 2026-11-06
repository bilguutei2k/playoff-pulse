import Link from "next/link";
import { Mark548 } from "@/components/brand/Mark548";
import { FreshnessChip } from "@/components/layout/FreshnessChip";
import { MobileMenu, NavLinks } from "@/components/layout/NavLinks";
import { getLiveState, getLiveStateSource } from "@/lib/live-data/published";
import { formatStampEt } from "@/lib/utils/dates";

/**
 * The black masthead on every page: the mark, the nav, and how old the published
 * state is (or that the page shows the bundled copy). Below 1024 px the nav folds
 * into a Menu button.
 */
export async function Header() {
  const [liveState, source] = await Promise.all([getLiveState(), getLiveStateSource()]);
  const chip = (
    <FreshnessChip
      iso={liveState.generatedAt}
      stamp={formatStampEt(liveState.generatedAt)}
      modelVersion={liveState.modelVersion}
      stored={source === "bundled"}
    />
  );
  return (
    <header className="sticky top-0 z-40 bg-masthead text-white">
      <div className="pp-container flex h-14 items-center gap-6 lg:h-[68px] lg:gap-14">
        <Link href="/" className="flex shrink-0 items-center" aria-label="548, NBA forecasts: today's games">
          <span className="lg:hidden">
            <Mark548 height={26} tone="light" />
          </span>
          <span className="hidden lg:block">
            <Mark548 height={34} tone="light" />
          </span>
        </Link>
        <div className="hidden min-w-0 flex-1 lg:block">
          <NavLinks />
        </div>
        <div className="ml-auto hidden shrink-0 lg:block">{chip}</div>
        <div className="ml-auto lg:hidden">
          <MobileMenu>{chip}</MobileMenu>
        </div>
      </div>
    </header>
  );
}
