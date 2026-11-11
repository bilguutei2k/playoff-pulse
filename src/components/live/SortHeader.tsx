/**
 * SortHeader: one sortable column heading (DS-10). Renders the <th> with aria-sort,
 * a button that sorts, and the arrow after the label (a 12px slot that is always
 * reserved, so headings do not shift when the sort changes). Use it inside a client
 * component that owns the sort state; it holds none itself.
 *
 *   <SortHeader
 *     label="Proj."
 *     active={sort.key === "proj"}
 *     descending={sort.descending}
 *     onSort={() => sortBy("proj")}
 *     align="right"                        // numeric column: right-aligned, tabular
 *     title="Projected regular-season wins" // optional: mouse tooltip on the button
 *     hint="Projected wins at the end of the regular season."  // optional "?" Hint
 *     className="sticky top-[var(--mast)] z-10 bg-panel"
 *   />
 *
 * In a .tb table it takes the table's head style. aria-sort is "ascending",
 * "descending" or "none" on every sortable column.
 */
import { Hint } from "@/components/live/Hint";

export function SortHeader({
  label,
  active,
  descending,
  onSort,
  align = "left",
  title,
  hint,
  hintLabel,
  className = "",
}: {
  label: React.ReactNode;
  active: boolean;
  descending: boolean;
  onSort: () => void;
  align?: "left" | "right";
  title?: string;
  /** An explanation behind a "?" button after the label (Hint). */
  hint?: React.ReactNode;
  /** The term the hint explains; defaults to the label when it is a string. */
  hintLabel?: string;
  className?: string;
}) {
  const sort = active ? (descending ? "descending" : "ascending") : "none";
  return (
    <th scope="col" aria-sort={sort} className={`${align === "right" ? "nm" : ""} ${className}`}>
      <span className={`sort-head ${align === "right" ? "justify-end" : ""}`}>
        <button
          type="button"
          onClick={onSort}
          title={title}
          className={`sort-btn ${active ? "is-active" : ""}`}
        >
          {label}
          <svg aria-hidden viewBox="0 0 10 10" className={`sort-arrow ${descending || !active ? "" : "is-up"}`}>
            <path d="M1 3h8L5 8z" fill="currentColor" />
          </svg>
        </button>
        {hint ? (
          <Hint label={hintLabel ?? (typeof label === "string" ? label : "This column")}>{hint}</Hint>
        ) : null}
      </span>
    </th>
  );
}
