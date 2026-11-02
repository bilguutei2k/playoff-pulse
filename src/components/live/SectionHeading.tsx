import Link from "next/link";

/** Kicker, headline and an optional "see all" link: the head of every page section. */
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
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 max-w-3xl">
        {kicker ? <p className="kicker">{kicker}</p> : null}
        <Tag
          id={id}
          className={`headline mt-1 ${Tag === "h1" ? "text-[32px] sm:text-[42px]" : "text-[22px] sm:text-[26px]"}`}
        >
          {title}
        </Tag>
        {dek ? <div className="mt-2 text-[15px] leading-6 text-ink-2">{dek}</div> : null}
      </div>
      {href && linkLabel ? (
        <Link href={href} className="pp-link shrink-0 text-[14px]">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
