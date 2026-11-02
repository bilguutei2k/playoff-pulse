import type { Tone } from "@/lib/view/card";

const TONES: Record<Tone, string> = {
  good: "border-[#cfe3da] bg-[#eef6f2] text-good",
  warn: "border-warn-line bg-warn-wash text-warn",
  bad: "border-[#f3c9c4] bg-bad-wash text-bad",
  quiet: "border-line bg-wash text-ink-2",
};

/** A small mono label for what a number is: sealed, provisional, projection, missed. */
export function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-[4px] border px-1.5 py-[3px] font-mono text-[10.5px] font-medium uppercase leading-none tracking-[0.06em] ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Status of the game itself: scheduled, live with a pulsing dot, final. */
export function StatusPill({ label, live }: { label: string; live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] font-semibold uppercase tracking-[0.06em] ${
        live ? "text-pulse-ink" : "text-ink"
      }`}
    >
      {live ? <span aria-hidden className="pp-live-dot h-2 w-2 rounded-full bg-pulse" /> : null}
      {label}
    </span>
  );
}
