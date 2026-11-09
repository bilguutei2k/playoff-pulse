"use client";

import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { dayHref, jumpDate } from "@/lib/view/day-nav";

/**
 * The right end of the days row: "Today" whenever another day is shown, and a native
 * date control bounded to the stored season. From 640 px the control is a visible
 * field; on a phone it sits, invisible, over a calendar icon, so a tap opens the
 * system picker and the row keeps its five weekdays. ET remains the only date shown.
 */
export function DateJump({
  selected,
  today,
  first,
  last,
}: {
  selected: string;
  today: string;
  first: string;
  last: string;
}) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex shrink-0 items-center gap-4 text-[14px]">
      {selected !== today ? (
        <Link href="/" className="inline-flex h-11 items-center font-bold text-ink hover:underline hover:underline-offset-4">
          Today
        </Link>
      ) : null}
      <span className="relative inline-flex items-center">
        <label htmlFor={id} className="sr-only">
          Go to a date
        </label>
        <input
          key={selected}
          id={id}
          type="date"
          min={first}
          max={last}
          defaultValue={selected}
          onChange={(event) => {
            const day = jumpDate(event.target.value, first, last);
            if (day && day !== selected) router.push(dayHref(day, today));
          }}
          className="peer h-8 border border-line bg-panel px-2 text-[13px] text-ink max-sm:absolute max-sm:inset-0 max-sm:h-full max-sm:w-full max-sm:cursor-pointer max-sm:opacity-0"
        />
        <span
          aria-hidden
          className="inline-flex h-9 w-9 items-center justify-center text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ink sm:hidden"
        >
          <CalendarDays size={18} />
        </span>
      </span>
    </div>
  );
}
