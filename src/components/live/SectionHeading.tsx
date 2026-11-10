import Link from "next/link";

/**
 * The head of a page section in v8: an ink rule, the heading, and at the right
 * either a link (ink, with an arrow, kept on the heading's line on phones when it
 * fits) or a grey note. A page title (as="h1") has no rule; its link sits at the
 * right of the title block.
 *
 *   <SectionHeading id="odds-title" title="Season odds" href="/odds" linkLabel="Every team's odds" />
 *   <SectionHeading title="Out" note="From the 5:30 PM report" />
 *   <SectionHeading as="h3" size="sub" title={<TeamLink teamId={id} form="full" />} />
 *   <SectionHeading as="h1" kicker="Season forecast" title="Odds" dek="..." />
 *
 * `title` may hold a TeamLink (never another link around it). `kicker` on an h2 is
 * the old name for `note`; on an h1 it is the grey line above the title.
 */
export function SectionHeading({
  id,
  kicker,
  note,
  title,
  dek,
  href,
  linkLabel,
  as: Tag = "h2",
  size = "section",
  className = "",
}: {
  id?: string;
  kicker?: string;
  /** Grey text at the right of an h2 or h3 (ignored when there is a link). */
  note?: React.ReactNode;
  title: React.ReactNode;
  dek?: React.ReactNode;
  href?: string;
  linkLabel?: string;
  as?: "h1" | "h2" | "h3";
  /** "sub": a 1px rule and a 17px heading, for a heading inside a section. */
  size?: "section" | "sub";
  className?: string;
}) {
  if (Tag === "h1") {
    return (
      <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-2 ${className}`}>
        <div className="min-w-0 max-w-3xl">
          {kicker ? <p className="text-15 text-ink-2">{kicker}</p> : null}
          <h1 id={id} className="headline mt-2.5 text-32 sm:text-46">
            {title}
          </h1>
          {dek ? <div className="mt-3 text-15 leading-6 text-ink-2">{dek}</div> : null}
        </div>
        {href && linkLabel ? (
          <Link href={href} className="pp-link shrink-0 text-14">
            {linkLabel}
          </Link>
        ) : null}
      </div>
    );
  }
  const right = note ?? kicker;
  return (
    <div className={className}>
      <div className={`sh !mb-0 ${size === "sub" ? "sh-sub" : ""}`}>
        <Tag id={id}>{title}</Tag>
        {href && linkLabel ? <Link href={href}>{linkLabel}</Link> : right ? <span>{right}</span> : null}
      </div>
      {dek ? <div className="mt-2 max-w-3xl text-14 leading-6 text-ink-2">{dek}</div> : null}
    </div>
  );
}
