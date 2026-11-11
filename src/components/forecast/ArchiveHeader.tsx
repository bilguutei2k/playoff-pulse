import Link from "next/link";
import { dataLastUpdated } from "@/lib/data/playoff-config";
import { formatFullDay } from "@/lib/utils/dates";

/**
 * The five pages of the frozen 2026 archive, in reading order. The layout can use the
 * hrefs to tell an archive route from a live one (for example to skip the live
 * freshness notice there).
 */
export const ARCHIVE_PAGES = [
  { href: "/retrospective", label: "Retrospective" },
  { href: "/snapshot", label: "Final snapshot" },
  { href: "/evidence", label: "Evidence" },
  { href: "/methodology", label: "Methodology" },
  { href: "/lab", label: "Scenario lab" },
] as const;

export type ArchivePath = (typeof ARCHIVE_PAGES)[number]["href"];

/** True for a path inside the 2026 archive. */
export function isArchivePath(pathname: string): boolean {
  return ARCHIVE_PAGES.some((page) => pathname === page.href || pathname.startsWith(`${page.href}/`));
}

/**
 * The top of every archive page: a breadcrumb, one line saying this is the frozen
 * 2026 archive (with the way back to the live forecast), and links between the five
 * archive pages, the current one marked. The archive keeps its own older look below.
 */
export function ArchiveHeader({ current }: { current: ArchivePath }) {
  const page = ARCHIVE_PAGES.find((entry) => entry.href === current)!;
  return (
    <header className="border-b border-line bg-page">
      <div className="mx-auto max-w-7xl px-3 pt-4 md:px-[18px] md:pt-5">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2">
            <li>
              <Link href="/" className="hover:text-ink hover:underline hover:underline-offset-4">
                548
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href="/retrospective" className="hover:text-ink hover:underline hover:underline-offset-4">
                2026 archive
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-ink">
              {page.label}
            </li>
          </ol>
        </nav>
        <p className="mt-2 max-w-4xl text-[15px] leading-6 text-ink">
          <strong>The 2026 archive is frozen.</strong> It is an earlier project, the manually configured 2026 playoff
          forecast, kept as it was on {formatFullDay(dataLastUpdated)} and not updated since. Today&apos;s forecast is on{" "}
          <Link href="/" className="pp-link">
            Games
          </Link>{" "}
          and its scored results are on{" "}
          <Link href="/record" className="pp-link">
            Record
          </Link>
          .
        </p>
        <nav aria-label="2026 archive pages" className="mt-2">
          <ul className="flex flex-wrap gap-x-5 text-[14px]">
            {ARCHIVE_PAGES.map((entry) => {
              const active = entry.href === current;
              return (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    aria-current={active ? "page" : undefined}
                    className={`-mb-px inline-flex min-h-11 items-center border-b-2 ${
                      active ? "border-ink font-bold text-ink" : "border-transparent text-ink-2 hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    {entry.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
