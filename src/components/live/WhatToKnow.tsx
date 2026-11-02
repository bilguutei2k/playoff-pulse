import Link from "next/link";
import { ArrowRight } from "lucide-react";

const ITEMS: Array<{ title: string; body: string }> = [
  {
    title: "Injuries are modeled, in part.",
    body: "Each forecast counts the expected absence of players on the NBA injury report, weighted by status, and season odds use return estimates from a survival table. Unknown future injuries, minutes shifting to teammates and matchups are not modeled.",
  },
  {
    title: "Not a betting product.",
    body: "The market number is shown for reference and comparison only. No claim is made about the model against the market yet.",
  },
  {
    title: "Unofficial data.",
    body: "Scores, schedules and market lines come from ESPN's unofficial public feeds, and injury statuses from the NBA's public injury report, used unofficially. Playoff Pulse is not affiliated with the NBA.",
  },
  {
    title: "Every seal counts.",
    body: "Missed seals, games with no final seal and seals made before an earlier result was in are always counted. Provisional numbers are labeled and never scored.",
  },
  {
    title: "Slightly overconfident.",
    body: "In testing, game forecasts ran a little too sure of themselves: a stated 80% has won about 77% of the time.",
  },
  {
    title: "Season odds are rougher.",
    body: "Midseason playoff odds are not claimed to be well calibrated, and no skill is claimed for title odds.",
  },
];

export function WhatToKnow() {
  return (
    <section
      aria-labelledby="what-to-know-title"
      className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="what-to-know-title"
          className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
        >
          What to know
        </h2>
        <Link href="/how-it-works" className="pp-link inline-flex items-center gap-1 text-sm">
          How it works and how it tested
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <ul className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((item) => (
          <li key={item.title} className="text-sm leading-6 text-[var(--color-text-muted)]">
            <span className="font-semibold text-[var(--color-text-primary)]">{item.title}</span>{" "}
            {item.body}
          </li>
        ))}
      </ul>
    </section>
  );
}
