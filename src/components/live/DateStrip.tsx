import Link from "next/link";
import { DateJump } from "@/components/live/DateJump";
import { addDays } from "@/lib/season/dates";
import { formatShortDay, formatWeekday } from "@/lib/utils/dates";
import { dayHref } from "@/lib/view/day-nav";

export { dayHref };

/**
 * The days row under the masthead: seven ET days around the one shown (five below
 * 1024 px, and on a phone by weekday), each with its game count ("6 games", under the
 * date from 768 px). Selecting an edge day recentres it. At the right, "Today" whenever
 * another day is shown, and a date control for any day of the stored season, so a day
 * two weeks back is one action away.
 */
export function DateStrip({
  selected,
  today,
  counts,
  first,
  last,
}: {
  selected: string;
  today: string;
  counts: Record<string, number>;
  first: string;
  last: string;
}) {
  const days = [-3, -2, -1, 0, 1, 2, 3]
    .map((offset) => ({ day: addDays(selected, offset), offset }))
    .filter(({ day }) => day >= first && day <= last);
  return (
    <nav aria-label="Game days" className="border-b border-line">
      <div className="pp-container flex h-12 items-center gap-4 md:gap-8">
        <ol className="no-scrollbar flex min-w-0 flex-1 items-center gap-[22px] overflow-x-auto whitespace-nowrap text-[14px] text-ink-2 md:gap-[30px]">
          {days.map(({ day, offset }) => {
            const count = counts[day] ?? 0;
            const active = day === selected;
            const label = `${formatWeekday(day)} ${formatShortDay(day)}`;
            return (
              <li key={day} className={Math.abs(offset) === 3 ? "hidden lg:block" : ""}>
                <Link
                  href={dayHref(day, today)}
                  aria-current={active ? "date" : undefined}
                  aria-label={`${day === today ? "Today, " : ""}${label}: ${count === 0 ? "no games" : `${count} ${count === 1 ? "game" : "games"}`}`}
                  className={`group inline-flex h-11 items-center hover:text-ink md:flex-col md:items-start md:justify-center md:leading-[1.15] ${active ? "font-bold text-ink" : ""}`}
                >
                  <span className="md:hidden">{day === today ? "Today" : formatWeekday(day)}</span>
                  <span className="hidden group-hover:underline group-hover:underline-offset-4 md:inline">{label}</span>
                  <span className="hidden text-[12px] font-normal text-ink-2 md:inline">
                    {count === 0 ? "No games" : `${count} ${count === 1 ? "game" : "games"}`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
        <DateJump selected={selected} today={today} first={first} last={last} />
      </div>
    </nav>
  );
}
