import Link from "next/link";
import { addDays } from "@/lib/season/dates";
import { formatShortDay, formatWeekday } from "@/lib/utils/dates";

export function dayHref(etDate: string, today: string): string {
  return etDate === today ? "/" : `/games/${etDate}`;
}

function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d={direction === "left" ? "M10 3.5 5.5 8 10 12.5" : "M6 3.5 10.5 8 6 12.5"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Seven ET days around the one shown, with previous and next links and game counts. */
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
  // Phones show three days, tablets five, desktops seven, always centred on the selection.
  const days = [-3, -2, -1, 0, 1, 2, 3]
    .map((offset) => ({ day: addDays(selected, offset), offset }))
    .filter(({ day }) => day >= first && day <= last);
  const visibility = (offset: number) =>
    Math.abs(offset) === 3 ? "hidden lg:block" : Math.abs(offset) === 2 ? "hidden sm:block" : "";
  const previous = addDays(selected, -1);
  const next = addDays(selected, 1);
  const arrowClass =
    "flex h-14 w-10 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-wash hover:text-ink";
  return (
    <nav aria-label="Game days" className="flex items-stretch gap-1">
      {previous >= first ? (
        <Link href={dayHref(previous, today)} className={arrowClass} aria-label="Previous day">
          <Arrow direction="left" />
        </Link>
      ) : (
        <span className={`${arrowClass} opacity-30`} aria-hidden>
          <Arrow direction="left" />
        </span>
      )}
      <ol className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {days.map(({ day, offset }) => {
          const count = counts[day] ?? 0;
          const active = day === selected;
          return (
            <li key={day} className={`min-w-[5.25rem] flex-1 ${visibility(offset)}`}>
              <Link
                href={dayHref(day, today)}
                aria-current={active ? "date" : undefined}
                className={`relative flex h-14 flex-col items-center justify-center rounded-md px-2 text-center leading-tight transition-colors ${
                  active ? "bg-ink text-white" : "text-ink hover:bg-wash"
                }`}
              >
                <span className={`font-mono text-[10.5px] uppercase tracking-[0.08em] ${active ? "text-white/80" : "text-ink-3"}`}>
                  {day === today ? "Today" : formatWeekday(day)}
                </span>
                <span className="text-[14px] font-semibold">{formatShortDay(day)}</span>
                <span className={`num text-[11px] ${active ? "text-white/80" : "text-ink-3"}`}>
                  {count === 0 ? "No games" : `${count} ${count === 1 ? "game" : "games"}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      {next <= last ? (
        <Link href={dayHref(next, today)} className={arrowClass} aria-label="Next day">
          <Arrow direction="right" />
        </Link>
      ) : (
        <span className={`${arrowClass} opacity-30`} aria-hidden>
          <Arrow direction="right" />
        </span>
      )}
    </nav>
  );
}
