"use client";

import { useEffect, useState } from "react";

/**
 * The sticky "On this page" list beside /how-it-works, with the section being read
 * marked (aria-current="location"). Plain anchors, so it works without script; the
 * scroll listener only adds the mark. A section is current once its top passes a
 * line a third of the way down the window.
 */
export function OnThisPage({ sections }: { sections: ReadonlyArray<{ id: string; title: string }> }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    let frame = 0;
    const pick = () => {
      frame = 0;
      // The last section whose top has passed the reading line (a third of the way
      // down, below where an anchor lands under the masthead); the last one at the bottom.
      const line = Math.max(160, window.innerHeight / 3);
      let active: string | null = null;
      for (const el of targets) {
        if (el.getBoundingClientRect().top <= line) active = el.id;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setCurrent(atBottom ? targets[targets.length - 1].id : active);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(pick);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    pick();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [sections]);

  return (
    <nav aria-label="On this page" className="sticky top-[calc(var(--mast)+24px)]">
      <p className="kicker">On this page</p>
      <ul className="mt-3 grid gap-1 border-l border-line text-[14px]">
        {sections.map((section) => {
          const active = section.id === current;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={active ? "location" : undefined}
                className={`-ml-px block border-l-2 py-1 pl-3 hover:border-ink hover:text-ink ${
                  active ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2"
                }`}
              >
                {section.title}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
