import type { ReactNode } from "react";

type SectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="pp-card">
      <div className="pp-section-head flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="pp-kicker text-[var(--color-text-muted)]">{title}</h2>
          {description ? (
            <p className="mt-2 max-w-4xl text-xs leading-5 text-[var(--color-text-muted)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div>{children}</div>
    </section>
  );
}
