import type { Tone } from "@/lib/view/card";

const TONES: Record<Tone, string> = {
  good: "border-ink text-ink",
  warn: "border-warn bg-warn-wash text-warn",
  bad: "border-bad bg-bad-wash text-bad",
  quiet: "border-line-strong text-ink-2",
};

/** A small square label for what a number is: sealed, provisional, projection, missed. */
export function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap border px-1.5 py-[3px] text-[12px] font-semibold leading-none ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Status of the game itself: scheduled, live (with a pulsing square), final. */
export function StatusPill({ label, live }: { label: string; live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-bold text-ink">
      {live ? <span aria-hidden className="pp-live-dot h-2 w-2 bg-ink" /> : null}
      {label}
    </span>
  );
}

const STATUS_TONES: Record<Tone, string> = {
  bad: "border-ink font-bold text-ink",
  warn: "border-ink text-ink",
  good: "border-line-strong text-ink",
  quiet: "border-dashed border-line-strong text-ink-2",
};

/**
 * A player's status (Out, Doubtful, Questionable, Missed 2...) in v8's ink and grey:
 * the word carries the meaning, the weight and border only rank it.
 */
export function StatusTag({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap border px-1.5 py-[3px] text-[12px] leading-none ${STATUS_TONES[tone]}`}
    >
      {children}
    </span>
  );
}
