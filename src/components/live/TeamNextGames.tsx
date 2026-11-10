import Link from "next/link";
import { TeamLink } from "@/components/live/TeamLink";
import { gameHref } from "@/lib/view/routes";
import type { NextGameBar } from "@/lib/view/team-page";
import { teamDisplay } from "@/lib/view/teams";

/** Games shown below the sm breakpoint; the rest stay in the Schedule table. */
export const NEXT_GAMES_ON_PHONE = 5;

/** A bar plus who it is against (the page adds these from its schedule rows). */
export type NextGameColumn = NextGameBar & { opponentId: string; home: boolean };

// Plot geometry in CSS px (teams.css draws the rest): the 0-to-100 scale is PLOT
// tall, with HEAD px above it for the 100% bar's value.
const PLOT = 132;
const HEAD = 20;
const lineTop = (tick: number) => HEAD + ((100 - tick) / 100) * PLOT;

/**
 * The team's chance in each of its next games, as HTML bars at real pixel sizes (no
 * scaled SVG, so no label drops below 11px). Dashed outline: a projection, never
 * scored. Solid: a sealed number. Each bar is its game's link and each opponent
 * label a link to that team; they are siblings, never nested. Phones show the first
 * five, with a link to the full schedule.
 */
export function TeamNextGames({
  bars,
  color,
  name,
  scheduleHref,
}: {
  bars: NextGameColumn[];
  color: string;
  /** "Timberwolves'": heads the text summary. */
  name: string;
  /** Where "more games" points on phones, e.g. "#upcoming-title". */
  scheduleHref: string;
}) {
  const summary = bars
    .map((entry) => `${entry.label} ${entry.date}: ${entry.percent}%${entry.sealed ? ", sealed" : ", projection"}`)
    .join("; ");
  const hiddenOnPhone = Math.max(0, bars.length - NEXT_GAMES_ON_PHONE);
  return (
    <figure className="tng" aria-labelledby="tng-summary">
      <figcaption id="tng-summary" className="sr-only">
        {name} chance in the next {bars.length} games. {summary}.
      </figcaption>
      <div className="tng-frame">
        <div aria-hidden className="tng-axis">
          {[100, 50, 0].map((tick) => (
            <span key={tick} className="tng-tick num" style={{ top: lineTop(tick) }}>
              {tick}%
            </span>
          ))}
        </div>
        <div className="tng-area">
          {[100, 50, 0].map((tick) => (
            <i key={tick} aria-hidden className={`tng-grid tng-grid-${tick}`} style={{ top: lineTop(tick) }} />
          ))}
          <ol className="tng-cols">
            {bars.map((entry, index) => {
              const opponent = teamDisplay(entry.opponentId);
              return (
                <li key={entry.gameId} className={`tng-col ${index >= NEXT_GAMES_ON_PHONE ? "tng-late" : ""}`}>
                  <Link
                    href={gameHref(entry.gameId)}
                    className="tng-game"
                    aria-label={`${entry.date}, ${entry.home ? "vs" : "at"} ${opponent.name}: ${entry.percent}%, ${entry.sealed ? "sealed" : "projection, never scored"}`}
                  >
                    <span aria-hidden className="tng-bar-slot">
                      <span
                        className={`tng-bar ${entry.sealed ? "" : "tng-bar-dash"}`}
                        style={{
                          height: `${(entry.percent / 100) * PLOT}px`,
                          ...(entry.sealed ? { background: color } : { borderColor: color }),
                        }}
                      >
                        <span className="tng-pct num">{entry.percent}</span>
                      </span>
                    </span>
                  </Link>
                  <span className="tng-opp">
                    {entry.home ? null : (
                      <span aria-hidden className="tng-at">
                        @
                      </span>
                    )}
                    <TeamLink teamId={entry.opponentId} form="code" className="tng-team" />
                  </span>
                  <span aria-hidden className="tng-date num">
                    {entry.date}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {hiddenOnPhone > 0 ? (
        <p className="mt-3 text-13 sm:hidden">
          <Link href={scheduleHref} className="pp-link">
            {hiddenOnPhone} more {hiddenOnPhone === 1 ? "game" : "games"} in the schedule
          </Link>
        </p>
      ) : null}
    </figure>
  );
}
