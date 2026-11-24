"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Below 1024 px, where the sticky "On this page" column is hidden: a slim "Contents"
 * bar fixed under the masthead once the section list at the top of /how-it-works
 * (`listId`) has scrolled out of view. It names the section being read and opens the
 * same list of plain anchors in a native <details>. A link, Escape or a tap outside
 * closes it. Before hydration and without script it stays hidden, and the list at the
 * top still works. Anchors land below the bar: shared.css (`.hiw-contents`) widens
 * `scroll-padding-top` on this page.
 */
export function ContentsBar({ sections, listId }: { sections: ReadonlyArray<{ id: string; title: string }>; listId: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  const [shown, setShown] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const list = document.getElementById(listId);
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => el !== null);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const mast = details.current?.getBoundingClientRect().top ?? 56;
      // The list is display:none at 1024 px and up (no offsetParent): the bar stays hidden there.
      const past = list !== null && list.offsetParent !== null && list.getBoundingClientRect().bottom < mast;
      setShown(past);
      if (!past && details.current?.open) details.current.open = false;
      // The section being read: the last whose top has passed a line a third of the way down.
      const line = Math.max(160, window.innerHeight / 3);
      let active: string | null = null;
      for (const el of targets) {
        if (el.getBoundingClientRect().top <= line) active = el.id;
      }
      setCurrent(active);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const closeOutside = (event: PointerEvent) => {
      const box = details.current;
      if (box?.open && event.target instanceof Node && !box.contains(event.target)) box.open = false;
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("pointerdown", closeOutside);
    schedule();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [sections, listId]);

  const close = () => {
    if (details.current) details.current.open = false;
  };
  const title = sections.find((section) => section.id === current)?.title ?? null;
  return (
    <details
      ref={details}
      className="hiw-contents"
      data-shown={shown ? "" : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !details.current?.open) return;
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }}
    >
      <summary className="pp-container">
        <span className="font-semibold text-ink">Contents</span>
        {title ? <span className="min-w-0 flex-1 truncate text-ink-2">{title}</span> : <span className="flex-1" />}
        <ChevronDown aria-hidden className="hiw-contents-chevron h-4 w-4 flex-none" strokeWidth={2.25} />
      </summary>
      <nav aria-label="Contents" className="hiw-contents-panel">
        <ul className="pp-container">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} aria-current={section.id === current ? "location" : undefined} onClick={close}>
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
