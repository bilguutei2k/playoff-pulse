import Link from "next/link";

/**
 * The head of a page section in v8: an ink rule, the heading, and a grey link at the
 * right. A page title (h1) keeps its grey line above instead of the rule.
 */
export function SectionHeading({
  id,
  kicker,
  title,
  dek,
  href,
  linkLabel,
  as: Tag = "h2",
}: {
  id?: string;
  kicker?: string;
  title: string;
  dek?: React.ReactNode;
  href?: string;
  linkLabel?: string;
  as?: "h1" | "h2" | "h3";
}) {
  if (Tag === "h1") {
    return (
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 max-w-3xl">
          {kicker ? <p className="text-[15px] text-ink-2">{kicker}</p> : null}
          <h1 id={id} className="headline mt-2.5 text-[32px] sm:text-[46px]">
            {title}
          </h1>
          {dek ? <div className="mt-3 text-[15px] leading-6 text-ink-2">{dek}</div> : null}
        </div>
        {href && linkLabel ? (
          <Link href={href} className="pp-link shrink-0 text-[14px]">
            {linkLabel}
          </Link>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      <div className="sh !mb-0">
        <Tag id={id}>{title}</Tag>
        {href && linkLabel ? <Link href={href}>{linkLabel}</Link> : kicker ? <span>{kicker}</span> : null}
      </div>
      {dek ? <div className="mt-2 max-w-3xl text-[14px] leading-6 text-ink-2">{dek}</div> : null}
    </div>
  );
}
