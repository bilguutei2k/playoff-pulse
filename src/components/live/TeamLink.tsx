/**
 * TeamLink: the one way to show a team. A link to its page, with an optional logo,
 * whose name never ellipsizes or clips; the accessible name is always the full name.
 *
 *   <TeamLink teamId={id} />                         "Knicks", linked
 *   <TeamLink teamId={id} form="full" logo={20} />   logo + "New York Knicks"
 *   <TeamLink teamId={id} form="code" />             "NYK" (title and screen readers: full name)
 *   <TeamLink teamId={id} form={{ base: "code", sm: "short", lg: "full" }} />   by viewport
 *   <TeamLink teamId={id} form="auto" logo={20} />   the longest name its slot fits
 *   <TeamLink teamId={id} link={false} />            same look, no link (inside another link)
 *   <TeamLink teamId={id} raised />                  above a card's absolute inset-0 game link
 *   <TeamLink teamId={id} form="auto" pair={otherId} />   a game's two names change form together
 *
 * Forms: "full" (New York Knicks), "short" (Knicks), "code" (NYK). "full" and "short"
 * may wrap between words; add whitespace-nowrap only where the slot always fits.
 *
 * form="auto" picks full, else short, else code, from the width its slot gives it.
 * With `pair` (the other team in a game card), each form's width is the wider of the
 * two teams', so two equal slots always show the same form: both full names, both
 * nicknames or both codes, never "Thunder" over "Portland Trail Blazers". The two
 * slots must be equally wide (GameCard sizes the record and score as a pair).
 * It asks for the full name's width and shrinks to the code's (never below), so:
 *   - flex row: works as is; the name shrinks before the row overflows. Give the
 *     things beside it flex-none or a fixed width.
 *   - grid cell: works as is (minmax(0,1fr) or auto tracks). The track must allow at
 *     least the code's width.
 *   - table cell: works, but an auto-layout table hands the column only what the
 *     other columns leave; for a predictable result give the column a width
 *     (<th className="w-[40%]">) or use the viewport form instead.
 *   - narrow card or block: works; it fills at most the line.
 *   - not for running prose (it is one unbreakable slot) or any text with
 *     letter-spacing above 0 or uppercase transforms (the widths would be wrong).
 *   It is calibrated for Schibsted Grotesk up to weight 900 (lib/view/team-name-widths).
 *
 * Raised links: a card that is one big link keeps that link as a sibling cover
 * (<Link className="absolute inset-0" />) and puts TeamLink raised in the card, so
 * links never nest. Hover underlines the name; focus uses the site's focus ring.
 */
import Link from "next/link";
import type { CSSProperties } from "react";
import { TeamLogo } from "@/components/live/TeamLogo";
import { TEAM_NAME_EM } from "@/lib/view/team-name-widths";
import { teamDisplay, teamHref } from "@/lib/view/teams";

export type TeamNameForm = "full" | "short" | "code";
export type TeamNameBreakpoints = {
  base: TeamNameForm;
  sm?: TeamNameForm;
  md?: TeamNameForm;
  lg?: TeamNameForm;
  xl?: TeamNameForm;
};
export type TeamLinkForm = TeamNameForm | "auto" | TeamNameBreakpoints;

const BREAKPOINTS = ["sm", "md", "lg", "xl"] as const;
// Literal class names, so Tailwind finds them.
const SHOW: Record<(typeof BREAKPOINTS)[number], string> = {
  sm: "sm:inline",
  md: "md:inline",
  lg: "lg:inline",
  xl: "xl:inline",
};
const HIDE: Record<(typeof BREAKPOINTS)[number], string> = {
  sm: "sm:hidden",
  md: "md:hidden",
  lg: "lg:hidden",
  xl: "xl:hidden",
};

// Head room on the measured widths: rounding, subpixel layout, a fallback font.
const SAFETY = 1.03;
const em = (value: number) => `${(Math.ceil(value * SAFETY * 100) / 100).toFixed(2)}em`;

function textOf(teamId: string, form: TeamNameForm): string {
  const team = teamDisplay(teamId);
  return form === "full" ? team.name : form === "short" ? team.shortName : team.code;
}

/** The forms "auto" chooses between, longest first, each narrower than the one before. */
function autoForms(teamId: string, pair?: string): Array<{ form: TeamNameForm; width: number }> {
  const own = TEAM_NAME_EM[teamId] ?? [99, 99, 99];
  const other = pair ? (TEAM_NAME_EM[pair] ?? [99, 99, 99]) : own;
  const [full, short, code] = own.map((width, index) => Math.max(width, other[index]));
  const forms: Array<{ form: TeamNameForm; width: number }> = [{ form: "full", width: full }];
  for (const next of [
    { form: "short" as const, width: short },
    { form: "code" as const, width: code },
  ]) {
    if (next.width < forms[forms.length - 1].width) forms.push(next);
  }
  return forms;
}

function AutoName({ teamId, pair }: { teamId: string; pair?: string }) {
  const forms = autoForms(teamId, pair);
  const narrowest = forms[forms.length - 1];
  // The slot's widest is a hair over the full name's threshold, so a slot sized to
  // its content always prints the full name.
  const slot = {
    "--tl-min": em(narrowest.width),
    "--tl-max": `calc(${em(forms[0].width)} + 0.02em)`,
  } as CSSProperties;
  return (
    <span className="tl-n" style={slot} aria-hidden>
      <span className="tl-box">
        {forms.map((entry, index) => (
          <span
            key={entry.form}
            className={`tl-v ${entry.form === "code" ? "tl-code" : ""}`}
            style={
              {
                "--lo": index === forms.length - 1 ? "0px" : em(entry.width),
                "--hi": index === 0 ? "100000px" : em(forms[index - 1].width),
              } as CSSProperties
            }
          >
            {textOf(teamId, entry.form)}
          </span>
        ))}
      </span>
    </span>
  );
}

function BreakpointName({ teamId, form }: { teamId: string; form: TeamNameBreakpoints }) {
  const active = (index: number): TeamNameForm => {
    let current = form.base;
    for (let i = 0; i <= index; i += 1) current = form[BREAKPOINTS[i]] ?? current;
    return current;
  };
  const forms = [...new Set<TeamNameForm>([form.base, ...BREAKPOINTS.map((_, i) => active(i))])];
  return (
    <>
      {forms.map((name) => {
        const classes = [name === form.base ? "inline" : "hidden"];
        let shown = name === form.base;
        BREAKPOINTS.forEach((bp, i) => {
          const now = active(i) === name;
          if (now !== shown) classes.push(now ? SHOW[bp] : HIDE[bp]);
          shown = now;
        });
        return (
          <span key={name} aria-hidden className={`tl-t ${name === "code" ? "tl-code" : ""} ${classes.join(" ")}`}>
            {textOf(teamId, name)}
          </span>
        );
      })}
    </>
  );
}

export function TeamLink({
  teamId,
  form = "short",
  logo,
  link = true,
  raised = false,
  pair,
  className = "",
}: {
  /** ESPN team ID. */
  teamId: string;
  /** Which name prints. Default "short". */
  form?: TeamLinkForm;
  /** Logo size in px, through TeamLogo; omit for no logo. */
  logo?: number;
  /** false renders the same thing as a span, for a place inside another link. */
  link?: boolean;
  /** Lift above a sibling whole-card link. */
  raised?: boolean;
  /** form="auto" only: the other team of a pair shown together; both switch form at the same widths. */
  pair?: string;
  className?: string;
}) {
  const team = teamDisplay(teamId);
  const plainFull = form === "full";
  const name =
    form === "auto" ? (
      <AutoName teamId={teamId} pair={pair} />
    ) : typeof form === "object" ? (
      <BreakpointName teamId={teamId} form={form} />
    ) : (
      <span aria-hidden={plainFull ? undefined : true} className={`tl-t ${form === "code" ? "tl-code" : ""}`}>
        {textOf(teamId, form)}
      </span>
    );
  const content = (
    <>
      {logo ? (
        <span className="tl-logo">
          <TeamLogo teamId={teamId} size={logo} />
        </span>
      ) : null}
      {name}
      {plainFull ? null : <span className="sr-only">{team.name}</span>}
    </>
  );
  const classes = `tl ${raised ? "tl-raised" : ""} ${className}`;
  const title = plainFull ? undefined : team.name;
  if (!link) {
    return (
      <span className={classes} title={title}>
        {content}
      </span>
    );
  }
  return (
    // No viewport prefetch: a page can show dozens of teams, and each refresh would refetch them all.
    <Link href={teamHref(teamId)} className={classes} title={title} prefetch={false}>
      {content}
    </Link>
  );
}
