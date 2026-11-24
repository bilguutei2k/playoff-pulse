"use client";

import { useEffect, useRef, useState } from "react";

type Edges = { start: boolean; end: boolean };

const NONE: Edges = { start: false, end: false };

/**
 * A sideways scroller for a table wider than its column (the `.table-scroll` box).
 *
 * While the table overflows, a fade marks each edge that has more columns beyond it
 * (none at the end the reader has reached), and the box becomes a named, focusable
 * region (`role="region"`, `aria-label`, `tabindex="0"`), so the keyboard can scroll it
 * with the arrow keys. When the table fits, it renders a plain box with no fade and no
 * extra tab stop, so the desktop look is unchanged.
 *
 * Server and client first paint are identical: "overflows" is decided only after
 * hydration, by a ResizeObserver (on the box and the table) and a scroll listener, both
 * coalesced to one measurement per animation frame. Without script the box still
 * scrolls; it just shows no fade.
 *
 * `label` names the table, e.g. "Game log"; the region is announced as "Game log,
 * scrolls sideways", which also keeps it distinct from a section of the same name
 * (axe landmark-unique). `className` goes on the
 * outer frame (margins, a border): the fades are drawn inside it (shared.css,
 * `.table-scroll-frame`).
 */
export function TableScroll({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>(NONE);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const hidden = box.scrollWidth - box.clientWidth;
      const left = Math.abs(box.scrollLeft);
      const start = hidden > 1 && left > 1;
      const end = hidden > 1 && left < hidden - 1;
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    // The observer reports each target once when observation starts: that is the first measurement.
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    box.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      box.removeEventListener("scroll", schedule);
    };
  }, []);

  const overflows = edges.start || edges.end;
  return (
    <div
      className={`table-scroll-frame${className ? ` ${className}` : ""}`}
      data-more-start={edges.start ? "" : undefined}
      data-more-end={edges.end ? "" : undefined}
    >
      <div
        ref={ref}
        className="table-scroll"
        role={overflows ? "region" : undefined}
        aria-label={overflows ? `${label}, scrolls sideways` : undefined}
        tabIndex={overflows ? 0 : undefined}
      >
        {children}
      </div>
    </div>
  );
}
