"use client";

import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { dayHref, jumpDate } from "@/lib/view/day-nav";

/**
 * Set just before the control navigates, so the control on the next page (a new
 * instance when the route changes between "/" and "/games/...") takes focus back.
 */
let refocusAfterJump = false;

/**
 * The right end of the days row: "Today" whenever another day is shown, and a native
 * date control bounded to the stored season. From 640 px the control is a visible
 * field; on a phone it sits, invisible, over a calendar icon, so a tap opens the
 * system picker and the row keeps its five weekdays. ET remains the only date shown.
 *
 * Keys never navigate on their own: arrow keys and typing only change the field, and
 * the page moves on Enter or when the field loses focus. A date chosen in the picker
 * (no key involved) moves at once. Escape puts the shown day back.
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
  const input = useRef<HTMLInputElement>(null);
  // The field follows the shown day when the page changes under it.
  const [shown, setShown] = useState(selected);
  const [value, setValue] = useState(selected);
  if (shown !== selected) {
    setShown(selected);
    setValue(selected);
  }
  // True from a key press until the change it causes is committed or dropped.
  const typing = useRef(false);

  useEffect(() => {
    if (refocusAfterJump) {
      refocusAfterJump = false;
      input.current?.focus();
    }
  }, []);

  const go = (raw: string) => {
    typing.current = false;
    const day = jumpDate(raw, first, last);
    if (!day || day === selected) return;
    refocusAfterJump = document.activeElement === input.current;
    router.push(dayHref(day, today));
  };

  return (
    <div className="flex shrink-0 items-center gap-4 text-[14px]">
      {selected !== today ? (
        <Link href="/" className="inline-flex h-11 items-center font-bold text-ink hover:underline hover:underline-offset-4">
          Today
        </Link>
      ) : null}
      <span className="relative inline-flex items-center">
        <label htmlFor={id} className="sr-only">
          Go to a date (Enter to go)
        </label>
        <input
          ref={input}
          id={id}
          type="date"
          min={first}
          max={last}
          value={value}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              go(event.currentTarget.value);
            } else if (event.key === "Escape") {
              typing.current = false;
              setValue(selected);
            } else if (event.key !== "Tab" && event.key !== "Shift") {
              typing.current = true;
            }
          }}
          onPointerDown={() => {
            typing.current = false;
          }}
          onChange={(event) => {
            setValue(event.target.value);
            // A key changed it: wait for Enter or blur. The picker: go now.
            if (!typing.current) go(event.target.value);
          }}
          onBlur={(event) => {
            if (typing.current) go(event.currentTarget.value);
          }}
          className="peer h-8 border border-line bg-panel px-2 text-[13px] text-ink max-sm:absolute max-sm:inset-0 max-sm:h-full max-sm:w-full max-sm:cursor-pointer max-sm:opacity-0"
        />
        <span
          aria-hidden
          className="inline-flex h-11 w-11 items-center justify-center text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ink sm:hidden"
        >
          <CalendarDays size={18} />
        </span>
      </span>
    </div>
  );
}
