"use client";

/**
 * Hint: a short explanation behind a column header or a stat label (DS-28). Opens on
 * click, tap, Enter or Space; closes on Escape, an outside click or a second press.
 * Nothing depends on hover. The panel sits in the top layer, so a table's scroll box
 * or a sticky header never clips it.
 *
 *   <Hint term="GP" label="Games played">Games he appeared in, starts included.</Hint>
 *     prints "GP" with a dotted underline; the term itself opens the hint.
 *   <Hint label="Rating">Points better than an average team on a neutral court.</Hint>
 *     prints a small "?" button after whatever precedes it (SortHeader uses this).
 *
 * Never put a Hint inside a link or another button. It renders spans only, so it is
 * valid inside a <p>, a <th> or a heading.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

const GAP = 6;

function supportsPopover(): boolean {
  return typeof HTMLElement !== "undefined" && Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover");
}

const never = () => () => {};

export function Hint({
  term,
  label,
  children,
  className = "",
}: {
  /** The visible term that opens the hint. Omit for a "?" button. */
  term?: React.ReactNode;
  /** What the term stands for; heads the panel and names the "?" button. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  // The server renders the popover attribute; a browser without the Popover API
  // toggles the panel by state instead (data-open).
  const native = useSyncExternalStore(never, supportsPopover, () => true);

  // Under the trigger, or above it in the lower part of the screen. The CSS keeps it
  // inside the viewport horizontally from --hx (the trigger's left edge).
  const place = useCallback(() => {
    const button = trigger.current;
    const box = panel.current;
    if (!button || !box) return;
    const anchor = button.getBoundingClientRect();
    box.style.setProperty("--hx", `${Math.round(anchor.left)}px`);
    if (anchor.bottom > window.innerHeight * 0.6) {
      box.style.top = "auto";
      box.style.bottom = `${Math.round(window.innerHeight - anchor.top + GAP)}px`;
    } else {
      box.style.bottom = "auto";
      box.style.top = `${Math.round(anchor.bottom + GAP)}px`;
    }
  }, []);

  // Native popover: place it before it shows, and mirror its state.
  useEffect(() => {
    const box = panel.current;
    if (!native || !box) return;
    const onBeforeToggle = (event: Event) => {
      const next = (event as ToggleEvent).newState === "open";
      if (next) place();
      setOpen(next);
    };
    box.addEventListener("beforetoggle", onBeforeToggle);
    return () => box.removeEventListener("beforetoggle", onBeforeToggle);
  }, [native, place]);

  // Fallback: place before paint.
  useLayoutEffect(() => {
    if (open && !native) place();
  }, [open, native, place]);

  // While open: follow the trigger on scroll and resize; in the fallback, also close
  // on Escape and an outside press.
  useEffect(() => {
    if (!open) return;
    const follow = () => place();
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    if (!native) {
      document.addEventListener("keydown", onKey);
      document.addEventListener("pointerdown", onPointer);
    }
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, native, place]);

  const panelId = `hint-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span className={`hint ${className}`}>
      <button
        ref={trigger}
        type="button"
        className={term === undefined ? "hint-icon" : "hint-term"}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={term === undefined ? `What is ${label}?` : undefined}
        popoverTarget={native ? panelId : undefined}
        onClick={native ? undefined : () => setOpen((value) => !value)}
      >
        {term === undefined ? <span aria-hidden>?</span> : term}
      </button>
      <span
        ref={panel}
        id={panelId}
        popover={native ? "auto" : undefined}
        data-open={!native && open ? "" : undefined}
        className="hint-pop"
      >
        <b className="hint-label">{label}</b>
        {children}
      </span>
    </span>
  );
}
