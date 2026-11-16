import { SiteLink } from "@/components/layout/SiteLink";
import { Mark548 } from "@/components/brand/Mark548";
import { FreshnessChip } from "@/components/layout/FreshnessChip";
import { MobileMenu, NavLinks } from "@/components/layout/NavLinks";
import { SiteSearch } from "@/components/layout/SiteSearch";
import { getDelivery, getLiveState } from "@/lib/live-data/published";

/**
 * The black masthead on every page: the mark, the nav, how old the published state is
 * (or that the page shows the bundled copy), and the search trigger. Below 1024 px the
 * nav folds into a Menu button; the freshness chip stays visible at every width and
 * wraps onto two lines on the narrowest phones rather than crowding the buttons.
 */
export async function Header() {
  const [liveState, { delivery }] = await Promise.all([getLiveState(), getDelivery()]);
  return (
    <header data-masthead className="sticky top-0 z-40 bg-masthead text-white">
      <div className="pp-container flex h-14 items-center gap-3 sm:gap-6 lg:h-[68px] lg:gap-8 xl:gap-14">
        <SiteLink href="/" className="flex min-h-11 shrink-0 items-center" aria-label="548, NBA forecasts: today's games">
          <span className="lg:hidden">
            <Mark548 height={26} tone="light" />
          </span>
          <span className="hidden lg:block">
            <Mark548 height={34} tone="light" />
          </span>
        </SiteLink>
        <div className="hidden min-w-0 flex-1 lg:block">
          <NavLinks />
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-4 lg:gap-5">
          <div className="min-w-0">
            <FreshnessChip iso={liveState.generatedAt} delivery={delivery} />
          </div>
          <SiteSearch />
          <div className="lg:hidden">
            <MobileMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
