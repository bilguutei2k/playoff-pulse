import Link from "next/link";
import { addDays } from "@/lib/season/dates";
import { formatShortDay, formatWeekday } from "@/lib/utils/dates";

export function dayHref(etDate: string, today: string): string {
  return etDate === today ? "/" : `/games/${etDate}`;
}

/**
 * The days row under the masthead: seven ET days around the one shown (five on a
 * phone, by weekday), each with its game count. Selecting an edge day recentres it.
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
      <ol className="pp-container no-scrollbar flex h-12 items-center gap-[22px] overflow-x-auto whitespace-nowrap text-[14px] text-ink-2 md:gap-[30px]">
        {days.map(({ day, offset }) => {
          const count = counts[day] ?? 0;
          const active = day === selected;
          const label = `${formatWeekday(day)} ${formatShortDay(day)}`;
          return (
            <li key={day} className={Math.abs(offset) === 3 ? "hidden md:block" : ""}>
              <Link
                href={dayHref(day, today)}
                aria-current={active ? "date" : undefined}
                aria-label={`${day === today ? "Today, " : ""}${label}: ${count === 0 ? "no games" : `${count} ${count === 1 ? "game" : "games"}`}`}
                className={`inline-flex h-11 items-center hover:text-ink ${active ? "font-bold text-ink" : ""}`}
              >
                <span className="md:hidden">{day === today ? "Today" : formatWeekday(day)}</span>
                <span className="hidden md:inline">{label}</span>
                <span className="ml-1 hidden md:inline">
                  {count === 0 ? <span className="font-normal text-ink-2">none</span> : <b className="font-bold text-ink">{count}</b>}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
